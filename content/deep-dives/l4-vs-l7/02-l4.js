deepSection('l4-vs-l7', {
  id: 'l4',
  nav: 'How L4 works',
  title: 'How an L4 load balancer works, packet by packet',
  goal: 'Walk one TCP connection through an L4 balancer, and know NAT from DSR cold.',
  card: {
    emoji: '📦',
    text: `An L4 load balancer owns a **virtual IP (VIP)** that DNS hands out. When a SYN arrives for VIP:443, it looks the 5-tuple up in a **connection table**. A miss means a new flow, so it picks a backend (often by hashing the 5-tuple) and records the choice. Every later packet of that flow hits the table and goes to the same backend. How it forwards matters. **NAT** rewrites the destination IP and must carry replies back too. **Direct server return (DSR)** tunnels packets in and lets the backend reply straight to the client, so the balancer never carries the big responses.`,
  },
  blocks: [
    {
      type: 'text',
      md: `Start with the **VIP**, the virtual IP. DNS for \`shop.example\` returns \`198.51.100.10\`, but no single server "is" that address. The load balancer answers for it (or, as you'll see in the next part, a whole fleet of balancers does). Behind it sits a **pool** of real servers with their own private IPs, which clients never see.

The heart of an L4 balancer is its **connection table**, also called a flow table or conntrack table: a hash map from 5-tuple to chosen backend. Each entry is tiny, on the order of a hundred bytes, so one machine can track millions of concurrent flows in memory. An entry is created by the first packet of a flow, refreshed by every packet after it, and deleted when the connection closes (FIN or RST) or goes quiet for longer than an idle timeout.

Step through one connection below. Watch which parts of the diagram light up.`,
    },
    {
      type: 'stepper',
      title: 'One TCP connection through an L4 balancer',
      diagram: {
        h: 300,
        nodes: [
          { id: 'c', x: 55, y: 120, label: 'Client', icon: '📱', shape: 'pill' },
          { id: 'lb', x: 180, y: 230, label: 'L4 LB\nVIP :443', icon: '⚖️', tone: 'accent' },
          { id: 'a', x: 305, y: 120, label: 'Backend A', icon: '🖥️' },
          { id: 'b', x: 305, y: 250, label: 'Backend B', icon: '🖥️' },
        ],
        edges: [
          { from: 'c', to: 'lb', flow: true },
          { from: 'lb', to: 'a', flow: true },
          { from: 'lb', to: 'b', dashed: true },
          { from: 'a', to: 'c', tone: 'good', dashed: true, flow: true, label: 'DSR reply' },
        ],
        notes: [{ x: 180, y: 40, text: 'with DSR, replies skip the balancer' }],
      },
      steps: [
        {
          title: 'A SYN arrives for the VIP',
          focus: ['c', 'c>lb', 'lb'],
          text: 'Your phone opens a TCP connection to `198.51.100.10:443`. The first packet is a SYN: headers only, no data. Its 5-tuple is `(TCP, 203.0.113.7, 52814, 198.51.100.10, 443)`.',
        },
        {
          title: 'Look it up in the connection table',
          focus: ['lb'],
          text: 'The balancer hashes the 5-tuple and checks its flow table. No entry means a brand-new connection, so it has to decide right now, before any HTTP exists.',
        },
        {
          title: 'Pick a backend and write it down',
          focus: ['lb', 'lb>a', 'a'],
          text: 'It picks Backend A, usually from a hash of the 5-tuple (so the choice is deterministic) or by least connections, and stores `5-tuple → A` in the table.',
        },
        {
          title: 'Forward the packet',
          focus: ['lb>a', 'a'],
          text: 'In **NAT** mode it rewrites the destination IP from the VIP to A\'s private IP and fixes the checksums. In **DSR** mode it leaves the packet itself alone: it either rewrites only the destination MAC address, or wraps the packet in an outer IP header (IP-in-IP, GRE or GUE) addressed to A.',
        },
        {
          title: 'Every later packet: table hit',
          focus: ['c>lb', 'lb', 'lb>a'],
          text: 'The ACK, the TLS ClientHello, every byte of the request: same 5-tuple, so the lookup hits and they all go to A. The balancer never parses any of it. That is why L4 forwarding is so cheap.',
        },
        {
          title: 'The reply',
          focus: ['a>c', 'a', 'c'],
          text: 'With **NAT**, A replies to the client\'s IP, but the reply has to route back through the balancer so it can rewrite the source back to the VIP. With **DSR**, A owns the VIP on a loopback interface and replies straight to the client, so the large response never touches the balancer.',
        },
        {
          title: 'Teardown',
          focus: ['lb'],
          text: 'A FIN or RST, or silence longer than the idle timeout, removes the entry. That timeout is a classic source of bugs: an AWS Network Load Balancer, for example, drops idle TCP flows after 350 seconds by default, so quiet long-lived connections need keepalives.',
        },
      ],
    },
    {
      type: 'table',
      title: 'The four ways an L4 balancer forwards packets',
      head: ['Mode', 'What changes in the packet', 'Reply path', 'Client IP at the backend', 'Where you see it'],
      rows: [
        ['NAT (destination NAT)', 'Destination IP rewritten to the backend', 'Back through the LB', 'Preserved, but the LB must be the backend\'s gateway', 'IPVS NAT mode, kube-proxy, many appliances'],
        ['Full NAT / TCP proxy', 'A new connection from the LB\'s own IP', 'Back through the LB', 'Lost unless you add the PROXY protocol', 'HAProxy `mode tcp`, NGINX `stream`, Envoy TCP proxy'],
        ['DSR at L2', 'Only the destination MAC address', 'Backend → client directly', 'Preserved', 'IPVS "direct routing" mode'],
        ['DSR via tunnel', 'Wrapped in an outer IP header (IP-in-IP, GRE, GUE)', 'Backend → client directly', 'Preserved', 'Google Maglev (GRE), Meta Katran (IP-in-IP), GitHub GLB (GUE)'],
      ],
    },
    {
      type: 'text',
      md: `Why does the reply path matter so much? Because traffic is lopsided. A request is often a few hundred bytes; the response might be a 200 KB page, a video segment or a large API payload, easily **10 to 100 times bigger**. In NAT mode the balancer carries every one of those response bytes. In DSR mode it only ever carries the small inbound direction, so the same machine can front far more traffic.

The price of DSR is that the balancer sees only half of each conversation. It can't track TCP state cleanly, can't terminate TLS, and can't do anything that needs the response. DSR is a pure L4 technique.`,
    },
    {
      type: 'callout',
      tone: 'warn',
      title: 'DSR\'s homework for every backend',
      text: 'In DSR the backend receives packets addressed to the **VIP**, so it must accept them. The VIP is configured on a loopback interface. With L2 DSR, the backend must also **not** answer ARP requests for the VIP (Linux `arp_ignore` / `arp_announce`), or it would steal the VIP from the balancer on the local network. With tunnels, every backend has to decapsulate the outer header first.',
    },
    {
      type: 'deep',
      title: 'Go deeper: SNAT port exhaustion',
      blocks: [
        {
          type: 'text',
          md: `When a balancer opens its own connections to backends (full NAT, or any proxy), each upstream connection is identified by \`(LB IP, LB port, backend IP, backend port)\`. The source port is 16 bits, so one balancer IP can hold at most about **64,000** concurrent connections to one backend IP and port, and fewer in practice because the OS reserves part of the port range.

At high connection rates this bites hard, especially with short-lived connections that linger in \`TIME_WAIT\` after closing. The symptoms are connection failures that appear only under load and look random.

The fixes: reuse connections (keep-alive and pooling), give the balancer several source IPs, spread traffic across more backend ports or IPs, or avoid source NAT entirely with DSR or plain destination NAT. Cloud NAT gateways and Kubernetes nodes doing SNAT hit the same wall.`,
        },
      ],
    },
    {
      type: 'yourturn',
      prompt: 'Your L4 balancer runs in NAT mode. Its network card is saturated but the CPU is mostly idle. The backends serve large video segments. What is going on, and what would you change?',
      answer: `In NAT mode every response byte flows back through the balancer, and video responses are far bigger than the requests. So the NIC saturates on **outbound** traffic while the CPU has little to do.

Switch to **direct server return**: the balancer handles only the small inbound packets and the backends reply straight to clients. Alternatives are adding more balancer nodes behind ECMP, or moving the video bytes to a CDN entirely.`,
    },
    {
      type: 'quiz',
      q: 'With direct server return (DSR), which traffic passes through the L4 balancer?',
      options: ['Requests and responses', 'Only the client → server direction', 'Only the responses', 'Only the TLS handshake'],
      answer: 1,
      explain: 'The balancer forwards inbound packets; the backend owns the VIP and replies **straight to the client**. Big responses never touch the balancer.',
    },
    {
      type: 'quiz',
      q: 'In NAT mode, why must replies travel back through the L4 balancer?',
      options: ['To be re-encrypted with TLS', 'Because backends have no route to the internet', 'To refresh a response cache', 'So it can rewrite the source address back to the VIP'],
      answer: 3,
      explain: 'The client sent its SYN to the VIP. A reply from the backend\'s private IP would be dropped as unknown, so the balancer reverses the NAT and the reply appears to come from the VIP.',
    },
  ],
});
