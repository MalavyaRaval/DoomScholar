interviewPhase('design-load-balancer', {
  id: 'ha',
  nav: 'HA + scale',
  time: '32–38',
  start: 32,
  end: 38,
  title: 'High availability and scaling the load balancer itself',
  goal: 'The LB sits on every request\'s path. Show how it survives machine failures, scales out without breaking connections, and goes global.',
  blocks: [
    { type: 'say', who: 'them', text: "Your load balancer is now the single point of failure for the whole company. Convince me it isn't." },
    {
      type: 'say',
      who: 'me',
      text: "Layer by layer. The simplest HA setup is an **active-passive pair** sharing a floating VIP via VRRP, for example with keepalived. When the passive node stops hearing heartbeats, it claims the VIP within a second or two. It works, but half the hardware sits idle and a single machine caps throughput.",
    },
    {
      type: 'code',
      title: 'keepalived (VRRP): the classic active-passive pair',
      lang: 'conf',
      code: `vrrp_script chk_haproxy {
    script "pidof haproxy"      # is the proxy process alive?
    interval 2
}

vrrp_instance VIP_1 {
    state MASTER                # BACKUP on the other node
    interface eth0
    virtual_router_id 51
    priority 150                # the backup uses a lower value, e.g. 100
    advert_int 1                # heartbeat every second
    virtual_ipaddress {
        203.0.113.10/24         # the VIP clients connect to
    }
    track_script {
        chk_haproxy             # give up the VIP if HAProxy dies
    }
}`,
    },
    {
      type: 'say',
      who: 'me',
      text: "At our scale I'd go **active-active**. Every L4 node announces the same VIP to the routers over **BGP**. The routers use **ECMP** (equal-cost multi-path) to hash each flow's 5-tuple onto one of the L4 nodes, so all nodes carry traffic. Need capacity? Add a node and it starts announcing. A node dies? Its BGP session drops, and the routers stop sending it traffic within seconds, or sub-second with BFD.",
    },
    {
      type: 'diagram',
      title: 'Active-active L4 tier with BGP + ECMP',
      diagram: {
        h: 340,
        nodes: [
          { id: 'net', x: 180, y: 34, label: 'Internet', icon: '🌐', shape: 'pill' },
          { id: 'r', x: 180, y: 112, label: 'Router\n(ECMP)', icon: '🔀', tone: 'accent' },
          { id: 'a', x: 55, y: 232, label: 'L4 #1', icon: '⚖️' },
          { id: 'b', x: 180, y: 232, label: 'L4 #2', icon: '⚖️' },
          { id: 'c', x: 305, y: 232, label: 'L4 #3', icon: '⚖️', tone: 'bad' },
          { id: 'l7', x: 118, y: 315, label: 'L7 tier (TLS + HTTP)', tone: 'good' },
        ],
        edges: [
          { from: 'net', to: 'r', flow: true },
          { from: 'r', to: 'a', flow: true },
          { from: 'r', to: 'b', flow: true },
          { from: 'r', to: 'c', dashed: true, tone: 'bad', label: 'BGP down' },
          { from: 'a', to: 'l7', flow: true },
          { from: 'b', to: 'l7', flow: true },
        ],
      },
      caption: 'Every L4 node announces the VIP. The router hashes each flow onto one node. When L4 #3 dies, its BGP session drops and the router spreads flows across the survivors.',
    },
    { type: 'say', who: 'them', text: 'What happens to existing connections when an L4 node is added or removed?' },
    {
      type: 'think',
      text: 'This is the deep question in L4 design. They want to hear about ECMP rehashing and connection consistency.',
    },
    {
      type: 'say',
      who: 'me',
      text: "This is the hard part. When the set of L4 nodes changes, the router's ECMP hashing changes too, so some **existing** flows suddenly arrive at a **different** L4 node. If each node only remembered its own connections, the new node wouldn't know which backend a mid-stream packet belongs to, and the connection breaks.\n\nTwo defenses, used together. First, every L4 node picks backends with the **same consistent hash** (Maglev) of the 5-tuple, so a flow that lands on a different L4 node still maps to the **same backend**. Second, each node keeps a **local connection table**, so when the *backend* set changes, existing flows stay pinned to the backend they started on.",
    },
    {
      type: 'callout',
      tone: 'key',
      text: 'Consistent hashing makes L4 nodes nearly **stateless and interchangeable**. That is what lets you add, remove or lose them without dropping connections. It is the central idea behind Maglev and Katran.',
    },
    {
      type: 'deep',
      title: 'Go deeper: the L4 data path in code',
      blocks: [
        {
          type: 'code',
          title: 'Per-packet logic of a Maglev-style L4 node',
          lang: 'python',
          code: `class L4Node:
    def __init__(self, backends):
        self.table = maglev_table(backends)
        self.conns = {}             # 5-tuple -> backend (an LRU with timeouts in practice)

    def on_packet(self, pkt):
        key = (pkt.src_ip, pkt.src_port, pkt.dst_ip, pkt.dst_port, pkt.proto)
        backend = self.conns.get(key)
        if backend is None:         # new flow, OR a flow ECMP just moved to us
            backend = self.table[h(str(key)) % len(self.table)]
            self.conns[key] = backend
        encapsulate_and_send(pkt, backend)   # IP-in-IP / GUE tunnel → DSR reply

    def on_backends_changed(self, backends):
        # existing flows keep their entry in self.conns; only new flows
        # (and flows we've never seen) use the new table
        self.table = maglev_table(backends)`,
        },
        {
          type: 'text',
          md: 'Production systems run this logic in the kernel with **XDP / eBPF** (Katran) or in user space with **DPDK**, bypassing the normal network stack to forward millions of packets per second per server.',
        },
        {
          type: 'callout',
          tone: 'warn',
          text: 'The rare failure case: ECMP moves a flow to a new L4 node **and** the backend set changed since the flow began. Now the table may point somewhere else and the connection resets. The window is small, which is why Maglev also prefers stable backend sets and gradual changes.',
        },
      ],
    },
    { type: 'say', who: 'them', text: 'Now make it global.' },
    {
      type: 'say',
      who: 'me',
      text: "Two levers.\n\n**GeoDNS / latency-based DNS** returns the VIP of the closest healthy region. It's simple, but resolvers cache answers for the TTL, so failover takes about one TTL. I'd keep TTLs at 30–60 s.\n\n**Anycast** announces the *same* VIP from every region over BGP. The internet routes each client to the nearest site, and if a region withdraws its routes, traffic shifts within seconds. Large edges like Cloudflare and Google use anycast for the front door, with the two-tier LB inside each site.",
    },
    {
      type: 'table',
      title: 'Global traffic steering',
      head: ['Technique', 'Failover speed', 'Granularity', 'Gotcha'],
      rows: [
        ['GeoDNS / latency DNS', '~TTL (30 s to minutes)', 'Per resolver, not per user', 'Some resolvers ignore low TTLs'],
        ['Anycast + BGP', 'Seconds', 'Per network route', 'Route changes can move live TCP flows'],
        ['Client-side / HTTP redirect', 'Per request', 'Per request', 'Needs client cooperation'],
      ],
    },
    {
      type: 'yourturn',
      prompt: 'Cross-zone trap: zone A has 2 backends, zone B has 8. The LB nodes in each zone only send to local backends. What goes wrong, and how do you fix it?',
      answer: "Traffic is split roughly evenly between the zones' LB nodes, so zone A's LB nodes receive ~50% of all traffic but have only 2 backends. Each of those gets **~25%** of all traffic, while each of zone B's 8 backends gets **~6%**. Zone A melts.\n\nFixes: enable **cross-zone load balancing** (spread across all backends and pay some cross-zone latency and data-transfer cost), keep backend counts balanced per zone, or use **locality-weighted** balancing that prefers the local zone but spills over when it's overloaded.",
    },
    {
      type: 'quiz',
      q: 'Why do L4 nodes behind ECMP pick backends with consistent hashing on the 5-tuple, instead of each choosing randomly?',
      options: [
        "It's faster to compute",
        'If ECMP moves a flow to another L4 node, that node picks the same backend, so the connection survives',
        'BGP requires it',
        'It encrypts the traffic',
      ],
      answer: 1,
      explain: 'All L4 nodes agree on flow → backend without talking to each other. That is what makes them interchangeable.',
    },
    {
      type: 'quiz',
      q: 'A whole region goes dark. Which global strategy shifts users away fastest?',
      options: ['GeoDNS with a 1-hour TTL', 'Anycast: the region withdraws its BGP routes', 'Emailing users a new IP', 'Plain round-robin DNS'],
      answer: 1,
      explain: 'BGP withdrawal propagates in seconds. DNS-based failover waits for cached records to expire.',
    },
  ],
});
