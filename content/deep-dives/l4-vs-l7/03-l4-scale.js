deepSection('l4-vs-l7', {
  id: 'l4-scale',
  nav: 'Scaling L4: Maglev',
  title: 'Scaling the L4 tier: ECMP, consistent hashing and Maglev',
  goal: 'Explain why a fleet of L4 balancers needs a shared consistent hash, and how Maglev builds one.',
  card: {
    emoji: '🧲',
    text: `One balancer is a single point of failure, so big sites run a **fleet** that all announce the same VIP. The routers in front spread packets across them with **ECMP**, hashing each packet's 5-tuple to pick a next hop. The catch: when a balancer is added or dies, the router's hash shifts and some flows land on a balancer that has never seen them. If that node picks a different backend, the connection breaks. The fix, made famous by Google's **Maglev**: every node uses the same **consistent hash**, so any node picks the same backend for the same flow.`,
  },
  blocks: [
    {
      type: 'text',
      md: `A single balancer box, however fast, is a single point of failure with a throughput ceiling. So at scale the L4 tier is a **fleet** of identical machines that all claim the same VIP.

They claim it with **BGP**, the routing protocol of the internet. Each balancer tells the upstream routers "I can reach 198.51.100.10". The router now has several equally good routes to the VIP and uses **ECMP (equal-cost multi-path)** to spread traffic: it hashes each packet's 5-tuple and uses the result to pick a next hop. Every packet of a connection has the same 5-tuple, so a connection keeps landing on the same balancer. When a balancer dies, it stops announcing the route (or its BGP session times out) and the routers drop it from the set, usually within seconds.

Notice what this buys you. Adding capacity means adding a machine that starts announcing the VIP. No DNS change, no client change, no single box in the path.`,
    },
    {
      type: 'diagram',
      title: 'ECMP: one VIP, many balancers',
      diagram: {
        h: 310,
        nodes: [
          { id: 'r', x: 55, y: 150, label: 'Router\nECMP', icon: '🛣️', tone: 'warn' },
          { id: 'l1', x: 180, y: 55, label: 'LB 1', icon: '⚖️', tone: 'accent' },
          { id: 'l2', x: 180, y: 150, label: 'LB 2', icon: '⚖️', tone: 'accent' },
          { id: 'l3', x: 180, y: 245, label: 'LB 3', icon: '⚖️', tone: 'accent' },
          { id: 'b1', x: 305, y: 100, label: 'Backend', icon: '🖥️' },
          { id: 'b2', x: 305, y: 200, label: 'Backend', icon: '🖥️' },
        ],
        edges: [
          { from: 'r', to: 'l1', flow: true },
          { from: 'r', to: 'l2', flow: true },
          { from: 'r', to: 'l3', flow: true },
          { from: 'l1', to: 'b1' },
          { from: 'l2', to: 'b1' },
          { from: 'l2', to: 'b2' },
          { from: 'l3', to: 'b2' },
        ],
        notes: [{ x: 180, y: 300, text: 'all three announce the same VIP over BGP' }],
      },
      caption: 'The router hashes each 5-tuple to pick a balancer. Every balancer must then pick the **same backend** for a given flow, or a reshuffle breaks live connections.',
    },
    {
      type: 'stepper',
      title: 'Why a reshuffle breaks connections, and how a shared hash saves them',
      diagram: {
        h: 300,
        nodes: [
          { id: 'r', x: 55, y: 150, label: 'Router', icon: '🛣️', tone: 'warn' },
          { id: 'l1', x: 175, y: 55, label: 'LB 1', icon: '⚖️' },
          { id: 'l2', x: 175, y: 150, label: 'LB 2', icon: '⚖️' },
          { id: 'l3', x: 175, y: 245, label: 'LB 3', icon: '⚖️' },
          { id: 'a', x: 305, y: 95, label: 'Backend A', icon: '🖥️', tone: 'good' },
          { id: 'b', x: 305, y: 205, label: 'Backend B', icon: '🖥️' },
        ],
        edges: [
          { from: 'r', to: 'l1' },
          { from: 'r', to: 'l2' },
          { from: 'r', to: 'l3' },
          { from: 'l2', to: 'a', tone: 'good' },
          { from: 'l3', to: 'b', tone: 'bad', dashed: true },
          { from: 'l3', to: 'a', tone: 'good' },
        ],
      },
      steps: [
        {
          title: 'Flow X lands on LB 2',
          focus: ['r', 'r>l2', 'l2', 'l2>a', 'a'],
          text: 'The router\'s ECMP hash sends flow X to LB 2. LB 2 picks Backend A and remembers `X → A` in its connection table. The TCP connection is established with A.',
        },
        {
          title: 'LB 1 dies',
          focus: ['r', 'l1'],
          text: 'LB 1 stops announcing the VIP. The router\'s set of next hops shrinks from three to two, and its hash-to-next-hop mapping changes for a share of all flows, including some that were never on LB 1.',
        },
        {
          title: 'Flow X now lands on LB 3',
          focus: ['r', 'r>l3', 'l3'],
          text: 'Flow X\'s next packet hashes to LB 3. LB 3 has no table entry for X: as far as it knows, this is a mid-connection packet for a flow it has never seen.',
        },
        {
          title: 'The naive outcome: a reset',
          focus: ['l3', 'l3>b', 'b'],
          text: 'If LB 3 chooses with its own local state (say, least connections), it may pick Backend B. B has never heard of this connection and answers with a RST. The user sees a dropped connection, and so do thousands of others at the same moment.',
        },
        {
          title: 'With a shared consistent hash: survival',
          focus: ['l3', 'l3>a', 'a'],
          text: 'If every balancer computes the backend from the **same consistent hash of the 5-tuple**, LB 3 independently arrives at Backend A. The connection carries on, and nobody notices LB 1 died.',
        },
      ],
    },
    {
      type: 'text',
      md: `Google's 2016 paper on **Maglev**, the software L4 balancer that has fronted Google's services since 2008, made this design famous. Each Maglev node keeps a connection table, but treats it only as a **cache**. The real decision comes from a **lookup table** that every node builds identically from the same list of backends. For a packet, compute \`hash(5-tuple) mod M\`, and the slot at that index names the backend. Same inputs, same table, same answer, on any node.

The clever part is how the table gets filled. Plain \`hash mod N\` remaps almost every flow whenever N changes. Maglev hashing instead gives each backend its own pseudo-random **preference order** over the table's slots, then lets the backends take turns claiming their next preferred free slot until the table is full. The result is almost perfectly balanced (each backend owns about M/N slots), and when a backend is removed most slots keep their old owner, so only a small share of connections move.

The local connection table still matters. When the backend set changes, the lookup table changes a little too, and the cached entries keep existing connections on their original backends for as long as they last.`,
    },
    {
      type: 'code',
      title: 'Maglev table population, in 25 lines',
      lang: 'python',
      code: `import hashlib

def h(s, seed):
    return int(hashlib.md5(f"{seed}:{s}".encode()).hexdigest(), 16)

def maglev_table(backends, M=65537):      # M must be prime
    # each backend's preference order: offset, offset+skip, offset+2*skip, ...
    prefs = [(h(b, "offset") % M, h(b, "skip") % (M - 1) + 1) for b in backends]
    table = [None] * M
    nxt = [0] * len(backends)
    filled = 0
    while True:
        for i, (offset, skip) in enumerate(prefs):
            c = (offset + nxt[i] * skip) % M
            while table[c] is not None:        # walk to backend i's next free slot
                nxt[i] += 1
                c = (offset + nxt[i] * skip) % M
            table[c] = backends[i]
            nxt[i] += 1
            filled += 1
            if filled == M:
                return table

table = maglev_table(["10.0.0.1", "10.0.0.2", "10.0.0.3"])

def pick(five_tuple):
    return table[h(five_tuple, "flow") % len(table)]`,
      caption: '`M` is prime, so every backend\'s offset-plus-skip walk visits every slot and the loop always finds a free one. Real implementations use fast non-cryptographic hashes and rebuild the table whenever the backend set changes.',
    },
    {
      type: 'callout',
      tone: 'tip',
      title: 'Other ways to soften a reshuffle',
      text: 'Routers can make ECMP itself gentler: **resilient** (consistent) ECMP hashing keeps most flows on their old next hop when one is removed. GitHub\'s GLB Director takes a different route to the same goal with a **"second chance"**: each packet carries both a primary and a secondary backend, and a backend that doesn\'t recognize the connection forwards the packet to the other one.',
    },
    {
      type: 'deep',
      title: 'Go deeper: why not just share the connection table?',
      blocks: [
        {
          type: 'text',
          md: `An obvious alternative is to replicate every node's connection table to every other node, so any balancer knows every flow. Some systems do share state, but it gets expensive fast: connections open and close at enormous rates, and every new flow would need to be broadcast before its second packet arrives somewhere else.

Consistent hashing flips the problem around. Instead of everyone *remembering* the same thing, everyone *computes* the same thing. The only shared state is the list of healthy backends, which changes rarely and is easy to distribute. That's why "stateless-ish L4 with a consistent hash" became the standard design for software load balancers at Google, Meta, GitHub and Cloudflare.`,
        },
      ],
    },
    {
      type: 'quiz',
      q: 'Your L4 fleet sits behind ECMP. One balancer node dies and some live connections suddenly reset. What prevents this?',
      options: ['Every node using the same consistent hash of the 5-tuple', 'Turning off health checks', 'Bigger connection tables on each node', 'Cookie-based sticky sessions'],
      answer: 0,
      explain: 'After ECMP reshuffles, a flow can land on a node that never saw it. If every node computes the same backend from the 5-tuple, that node still picks the right one. Cookies are L7: an L4 box can\'t read them.',
    },
    {
      type: 'quiz',
      q: 'Why does Maglev\'s lookup table have a prime size such as 65537?',
      options: ['Prime numbers hash faster on CPUs', 'To fit the table in one cache line', 'So each backend\'s offset + j·skip walk visits every slot', 'BGP route tables require prime sizes'],
      answer: 2,
      explain: 'With a prime M, every skip from 1 to M−1 shares no factor with M, so each backend\'s walk is a full permutation of the slots and the filling loop always finds a free one.',
    },
  ],
});
