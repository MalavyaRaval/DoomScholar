interviewPhase('design-load-balancer', {
  id: 'high-level',
  nav: 'High-level',
  time: '10–15',
  start: 10,
  end: 15,
  title: 'API and high-level design',
  goal: 'Show the big picture: what service owners configure (control plane) and what touches every packet (data plane).',
  blocks: [
    { type: 'say', who: 'them', text: 'Walk me through the high-level design.' },
    {
      type: 'say',
      who: 'me',
      text: "I'll split it into a **control plane** and a **data plane**. The control plane is where a service owner declares \"send traffic for `api.shop.com/cart` to these 50 backends, least-request, health-check `/healthz`\". The data plane is the fleet of LB nodes that actually move bytes.\n\nThe key property: the data plane must **keep serving when the control plane is down**. Nodes hold the last good config in memory and carry on.",
    },
    {
      type: 'code',
      title: 'Control plane API: what a service owner submits',
      lang: 'json',
      code: `POST /v1/load-balancers
{
  "name": "checkout",
  "listeners": [
    { "port": 443, "protocol": "HTTPS",
      "certificates": ["cert-shop-2026"],
      "rules": [
        { "match": { "host": "api.shop.com", "pathPrefix": "/cart" },
          "pool": "cart-v2" },
        { "match": { "pathPrefix": "/" }, "pool": "web" }
      ] },
    { "port": 5432, "protocol": "TCP", "pool": "pg-replicas" }
  ]
}

PUT /v1/pools/cart-v2
{
  "algorithm": "least_request",
  "healthCheck": { "path": "/healthz", "intervalMs": 2000,
                   "healthyThreshold": 2, "unhealthyThreshold": 3 },
  "slowStartSec": 30,
  "drainTimeoutSec": 30,
  "targets": [
    { "ip": "10.1.4.12", "port": 8080, "weight": 100 },
    { "ip": "10.1.4.13", "port": 8080, "weight": 100 }
  ]
}`,
      caption: 'Listeners (port + protocol) → rules (match → pool) → pools (algorithm, health check, targets). Nearly every real LB uses this model: AWS (listeners / target groups), Envoy (listeners / routes / clusters), NGINX (server / location / upstream).',
    },
    {
      type: 'say',
      who: 'me',
      text: "Configs are versioned and stored in a strongly consistent store such as etcd. A config distributor compiles them into snapshots and pushes them to every LB node over a streaming API, the way Envoy's **xDS** works. Each node validates a snapshot and swaps it in atomically, then acks the version, so we always know which node runs which config.",
    },
    {
      type: 'diagram',
      title: 'The two-tier architecture',
      diagram: {
        h: 330,
        nodes: [
          { id: 'c', x: 115, y: 34, label: 'Clients', icon: '🌐', shape: 'pill' },
          { id: 'r', x: 115, y: 108, label: 'Routers (ECMP)' },
          { id: 'cp', x: 300, y: 60, label: 'Control\nplane', icon: '🎛️', tone: 'accent' },
          { id: 'l4a', x: 60, y: 172, label: 'L4 node' },
          { id: 'l4b', x: 170, y: 172, label: 'L4 node' },
          { id: 'l7a', x: 50, y: 236, label: 'L7 node' },
          { id: 'l7b', x: 135, y: 236, label: 'L7 node' },
          { id: 'l7c', x: 220, y: 236, label: 'L7 node' },
          { id: 'web', x: 50, y: 302, label: 'web', shape: 'pill', tone: 'good' },
          { id: 'cart', x: 135, y: 302, label: 'cart', shape: 'pill', tone: 'good' },
          { id: 'search', x: 220, y: 302, label: 'search', shape: 'pill', tone: 'good' },
          { id: 'hc', x: 305, y: 280, label: 'Health\ncheckers', icon: '🩺' },
        ],
        edges: [
          { from: 'c', to: 'r', flow: true },
          { from: 'r', to: 'l4a', flow: true },
          { from: 'r', to: 'l4b', flow: true },
          { from: 'l4a', to: 'l7a', flow: true },
          { from: 'l4a', to: 'l7b', flow: true },
          { from: 'l4b', to: 'l7b', flow: true },
          { from: 'l4b', to: 'l7c', flow: true },
          { from: 'l7a', to: 'web', flow: true },
          { from: 'l7b', to: 'cart', flow: true },
          { from: 'l7c', to: 'search', flow: true },
          { from: 'cp', to: 'l4b', dashed: true, tone: 'accent' },
          { from: 'cp', to: 'l7c', dashed: true, tone: 'accent' },
          { from: 'hc', to: 'search', dashed: true },
        ],
      },
      caption: 'Routers spread flows over the **L4 tier** (ECMP). L4 nodes hash each connection to an **L7 node**. L7 nodes terminate TLS, match rules and pick a backend. The **control plane** (dashed) only pushes config and is never on the request path.',
    },
    {
      type: 'list',
      title: 'Life of one HTTPS request',
      ordered: true,
      items: [
        'DNS resolves `api.shop.com` to a **VIP** (virtual IP) that our routers announce.',
        'The router picks one L4 node for this flow using **ECMP**, a hash of the 5-tuple.',
        'The L4 node consistent-hashes the flow to one L7 node and forwards the packets **without** terminating TCP.',
        'The L7 node completes the TCP and TLS handshakes, parses the HTTP request and matches `host=api.shop.com, path=/cart` → pool `cart-v2`.',
        'It picks a healthy backend with the pool\'s algorithm, reuses a pooled upstream connection, adds `X-Forwarded-For`, and forwards.',
        'The response streams back through the L7 node. Depending on the L4 mode, it either returns through the L4 node or goes **directly** to the client (DSR, next phase).',
      ],
    },
    {
      type: 'callout',
      tone: 'tip',
      text: 'Say **"the data plane must keep working when the control plane is down"** out loud. It is the single most important reliability property of any load balancer or service mesh, and interviewers listen for it.',
    },
    {
      type: 'yourturn',
      prompt: 'Why not one tier of L7 proxies behind round-robin DNS? Argue it before revealing.',
      answer: "It works at small scale, but at ours it hurts in three ways.\n\n**1. DNS reacts slowly.** Clients and resolvers cache records for the TTL (and some ignore it), so a dead L7 node keeps receiving traffic for minutes.\n\n**2. Exposure.** Every L7 node needs a public IP and must absorb DDoS traffic on its own.\n\n**3. Coupling.** Every L7 fleet change becomes a DNS change for the whole internet.\n\nAn L4 tier in front gives one stable VIP; the expensive L7 fleet can grow, shrink and fail behind it in seconds.",
    },
    {
      type: 'quiz',
      q: 'An LB node loses its connection to the control plane. What should it do?',
      options: ['Stop serving until it reconnects', 'Keep serving with the last known-good config', 'Delete all routes to be safe', 'Reboot itself'],
      answer: 1,
      explain: 'The data plane must never depend on the control plane being up. Serve with the last good snapshot, alert, and resync when the connection comes back.',
    },
  ],
});
