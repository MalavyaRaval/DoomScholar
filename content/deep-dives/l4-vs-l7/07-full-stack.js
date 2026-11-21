deepSection('l4-vs-l7', {
  id: 'stack',
  nav: 'One request, every layer',
  title: 'Putting it together: one request through every layer',
  goal: 'Trace a request from a phone to a pod, naming the balancing decision made at each layer.',
  card: {
    emoji: '🧭',
    text: `Open a big app and your request crosses several layers of balancing. **DNS**, often geo-aware, hands your phone an address. **Anycast** routing carries your packets to the nearest site announcing it. A router **ECMP**-hashes them onto one of many **L4** balancers, which consistently hash the flow to an **L7** proxy and let replies skip the L4 tier. The L7 proxy terminates TLS, matches the route and sends the request to a service instance, often through a **sidecar** proxy or client-side balancing. Each layer narrows the choice: region, site, proxy, service, instance.`,
  },
  blocks: [
    {
      type: 'text',
      md: `Time to put the parts together. Here's the path of one request, \`GET https://shop.example/api/cart\`, through a large modern stack. Each layer answers a narrower question than the one before: which region, which site, which proxy, which service, which instance.`,
    },
    {
      type: 'stepper',
      title: 'From your phone to a pod',
      diagram: {
        h: 320,
        groups: [{ x: 122, y: 92, w: 236, h: 222, label: 'NEAREST SITE' }],
        nodes: [
          { id: 'dns', x: 55, y: 45, label: 'GeoDNS', icon: '📒' },
          { id: 'ph', x: 55, y: 150, label: 'Phone', icon: '📱', shape: 'pill' },
          { id: 'r', x: 180, y: 150, label: 'Edge\nrouter', icon: '🛣️', tone: 'warn' },
          { id: 'l4', x: 305, y: 150, label: 'L4 LB', icon: '⚖️', tone: 'accent' },
          { id: 'l7', x: 305, y: 262, label: 'L7 proxy', icon: '🔀', tone: 'accent' },
          { id: 'svc', x: 180, y: 262, label: 'Cart pod\n+ sidecar', icon: '🛒', tone: 'good' },
        ],
        edges: [
          { from: 'ph', to: 'dns', dashed: true, bi: true },
          { from: 'ph', to: 'r', flow: true },
          { from: 'r', to: 'l4', flow: true },
          { from: 'l4', to: 'l7', flow: true, label: 'encap' },
          { from: 'l7', to: 'svc', flow: true },
          { from: 'l7', to: 'ph', dashed: true, tone: 'good', label: 'reply' },
        ],
      },
      steps: [
        {
          title: 'DNS: which address?',
          focus: ['ph', 'dns', 'ph>dns'],
          text: 'Your phone asks DNS for `shop.example`. A geo-aware DNS service may answer differently depending on where you are, or every answer may be the same **anycast** address. Answers are cached for their TTL (often 30 to 300 seconds), which is why DNS alone is slow to fail over.',
        },
        {
          title: 'Anycast: which site?',
          focus: ['ph', 'ph>r', 'r'],
          text: 'The same IP prefix is announced over BGP from many sites. Internet routing carries your SYN to the closest one in network terms. If a site fails, it withdraws its announcement and traffic shifts to the next-nearest site, typically within seconds to minutes as routes converge.',
        },
        {
          title: 'ECMP: which L4 balancer?',
          focus: ['r', 'r>l4', 'l4'],
          text: 'Inside the site, the router hashes your 5-tuple across many L4 balancer machines that all announce the VIP. Every packet of your connection lands on the same one, as long as the set doesn\'t change.',
        },
        {
          title: 'L4: which L7 proxy?',
          focus: ['l4', 'l4>l7', 'l7'],
          text: 'The L4 balancer consistently hashes your flow to one L7 proxy and encapsulates the packets to it. The proxy\'s replies will go straight back to you (DSR), skipping the L4 tier.',
        },
        {
          title: 'L7: which service?',
          focus: ['l7', 'l7>svc', 'svc'],
          text: 'The proxy terminates TLS, parses `GET /api/cart`, matches the cart route, picks a healthy instance with that route\'s algorithm, and forwards the request over a pooled, often mutually authenticated, connection.',
        },
        {
          title: 'Sidecar: the last hop',
          focus: ['svc'],
          text: 'In a service mesh, an Envoy sidecar beside the cart pod receives the request, enforces mTLS and policy, records metrics and hands it to the app on localhost. When the cart service calls other services, those calls leave through its sidecar, which balances them per request.',
        },
        {
          title: 'The reply',
          focus: ['l7>ph', 'ph', 'l7'],
          text: 'The response flows back through the L7 proxy, which encrypts it, then straight to your phone, skipping the L4 tier. Each balancing layer adds microseconds (L4) to a few milliseconds (L7); network distance and the application itself usually dominate the total.',
        },
      ],
    },
    {
      type: 'text',
      md: `**Why not just one tier of L7 proxies with DNS in front?** Because the two tiers are good at different jobs.

The **L4 tier** is cheap per packet and nearly stateless, so it scales out with ECMP and soaks up SYN floods that would exhaust an L7 proxy. It gives the world a small, stable set of IPs that never change, even while you add, drain or upgrade the L7 proxies behind it.

The **L7 tier** is expensive per request but understands HTTP. Sitting behind L4, each proxy is just another backend: you can roll a new proxy version out to 1% of the fleet, drain a sick one, or add capacity, all without touching DNS or waiting for resolver caches to expire.

And the **last hop** (sidecar or client-side balancing) exists because inside a data center, services call each other millions of times per second. Putting a smart, per-request balancer one process away from the caller avoids a shared middle tier that every call would have to cross.`,
    },
    {
      type: 'callout',
      tone: 'key',
      title: 'The interview one-liner',
      text: '"**DNS and anycast** get the user to a region and a site. The **L4 tier** spreads connections across proxies with consistent hashing. The **L7 tier** terminates TLS and routes each request to a service. A **sidecar or client library** picks the instance." Say that while drawing five boxes and you have answered most "how does traffic get in?" questions.',
    },
    {
      type: 'yourturn',
      prompt: 'An entire site (one point of presence) loses power. Walk through what each layer does so users barely notice.',
      answer: `The site's routers stop announcing the **anycast** prefix (or their BGP sessions drop), so internet routing sends new packets to the next-nearest site. Connections that were open to the dead site are lost; clients reconnect and land elsewhere.

**DNS** doesn't need to change at all with anycast, which is the point: no waiting for TTLs. With GeoDNS instead, health checks would pull the site's addresses out of answers, and cached answers would keep pointing at it until their TTL expired.

The surviving sites' **L4** tiers absorb the extra connections by ECMP and hashing as usual, and their **L7** fleets need enough headroom to take the shifted load. That headroom is the real design decision: plan capacity so that losing your biggest site doesn't overload the rest.`,
    },
    {
      type: 'quiz',
      q: 'Put the layers in order for an incoming request.',
      options: ['L7 proxy → DNS → L4 → service', 'DNS / anycast → L4 balancer → L7 proxy → service', 'L4 → DNS → service → L7', 'Service → L7 → L4 → DNS'],
      answer: 1,
      explain: 'Coarse to fine: DNS and anycast pick the site, L4 spreads connections across proxies, and L7 reads each request to pick the service and instance.',
    },
    {
      type: 'quiz',
      q: 'Why put an L4 tier in front of the L7 proxies instead of pointing DNS straight at the proxies?',
      options: ['L7 proxies can\'t accept internet traffic', 'L4 balancers cache HTML pages', 'It keeps stable entry IPs while proxies behind it are added, drained or upgraded', 'DNS can only return one IP address'],
      answer: 2,
      explain: 'DNS changes are slow because resolvers cache answers for the TTL. With an L4 tier the public IPs never change and the L7 fleet behind it can change freely. L4 also absorbs SYN floods cheaply.',
    },
  ],
});
