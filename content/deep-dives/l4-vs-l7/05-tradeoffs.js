deepSection('l4-vs-l7', {
  id: 'tradeoffs',
  nav: 'Head to head',
  title: 'Head to head: what you gain and what you pay',
  goal: 'Choose between L4, L7 or both for any scenario, and justify it in one breath.',
  card: {
    emoji: '⚔️',
    text: `L4 is cheap and simple: microseconds of latency, millions of packets per second per server, any protocol, nothing to decrypt. But it's blind. It can't route by URL, can't retry a failed request, and balances whole connections, which goes badly for long-lived HTTP/2 and gRPC connections. L7 is rich: routing, canaries, retries, auth and per-request metrics. But it terminates TLS (so it holds your keys), burns CPU on every request, and adds a hop that can itself misbehave. Real systems rarely pick one: they put a thin L4 tier in front of a fleet of L7 proxies.`,
  },
  blocks: [
    {
      type: 'table',
      title: 'L4 vs L7, dimension by dimension',
      head: ['', 'L4', 'L7'],
      rows: [
        ['Decision unit', 'Connection (flow)', 'Request, including each HTTP/2 stream'],
        ['Added latency', 'Microseconds', 'Sub-millisecond to a few ms, plus TLS handshakes'],
        ['Cost', 'Very low per packet (kernel bypass, XDP)', 'High per request: TLS, parsing, buffering'],
        ['State', 'A small flow table; can be near-stateless', 'Full connection state on both sides'],
        ['TLS', 'Passes through untouched', 'Terminates; can re-encrypt to backends'],
        ['Protocols', 'Anything on TCP or UDP: databases, games, MQTT, QUIC', 'HTTP/1.1, HTTP/2, gRPC, WebSocket (some proxies also speak Redis, Postgres or Kafka)'],
        ['Health checks', 'Can the port accept a TCP connection?', 'Does `GET /healthz` return 200 with the right body?'],
        ['Client IP', 'Kept with DSR or plain DNAT; a TCP proxy needs the PROXY protocol', 'Passed in `X-Forwarded-For` / `Forwarded` headers'],
        ['Observability', 'Bytes, packets, connections', 'Per-request status, latency, route, user'],
        ['Examples', 'AWS NLB, Maglev, Katran, IPVS', 'NGINX, HAProxy, Envoy, AWS ALB'],
      ],
    },
    {
      type: 'text',
      md: `**Where did the client's IP go?** It matters for rate limiting, fraud detection, geo-targeting and plain old logs.

At **L7**, the proxy opens a new connection, so the backend sees the proxy's IP as the source. The proxy records the original in a header: \`X-Forwarded-For: 203.0.113.7\`, or the standardized \`Forwarded: for=203.0.113.7\`. Each proxy in a chain appends to it. Trust only the entries added by your own proxies: a client can send a fake \`X-Forwarded-For\`, and the first entry is whatever the client claimed.

At **L4**, DSR and plain destination NAT keep the client's IP as the packet's source address. But an L4 *proxy* (HAProxy in TCP mode, for example) opens a new connection, and there's no HTTP header to write into. The answer is the **PROXY protocol**, designed by HAProxy: the balancer sends a short header carrying the original addresses at the very start of the TCP connection, before any application bytes. The backend must be configured to expect it, or it will read that header as garbage.`,
    },
    {
      type: 'tabs',
      title: 'Which one, when?',
      tabs: [
        {
          label: '📦 Pick L4',
          blocks: [
            {
              type: 'list',
              items: [
                'The protocol isn\'t HTTP: databases, MQTT, game servers on UDP, SMTP, raw TCP.',
                'TLS must stay **end to end**, and the balancer must never see plaintext (passthrough).',
                'Extreme packet rates or DDoS absorption, where every microsecond and CPU cycle counts.',
                'You want a stable static IP or anycast front door while the proxies behind it change.',
              ],
            },
          ],
        },
        {
          label: '📨 Pick L7',
          blocks: [
            {
              type: 'list',
              items: [
                'Routing by host or path to different services: the classic API gateway or ingress.',
                'Canaries, blue/green deploys, A/B tests, header-based routing.',
                'Retries, timeouts, circuit breaking and per-route metrics without touching app code.',
                'gRPC or HTTP/2 services, where per-request balancing avoids pinned connections.',
              ],
            },
          ],
        },
        {
          label: '🧱 Use both',
          blocks: [
            {
              type: 'text',
              md: 'Almost every large system does. The **L4 tier** gives you a stable, DDoS-resistant entry point and spreads connections across many L7 proxies. The **L7 tier** does TLS, routing and resilience. You scale and deploy each independently: adding an L7 proxy is just adding another backend to the L4 tier.',
            },
          ],
        },
      ],
    },
    {
      type: 'callout',
      tone: 'trap',
      title: 'TLS has three modes, not two',
      text: '**Passthrough** (L4): encrypted end to end; the balancer can\'t see or route on content. **Termination** (L7): the proxy decrypts and talks plain HTTP to backends over the private network. **Re-encryption**, also called TLS bridging: the proxy decrypts, inspects and routes, then opens a fresh TLS connection to the backend. Zero-trust networks and service meshes go one step further with **mutual TLS**, where the backend verifies the proxy\'s certificate too.',
    },
    {
      type: 'yourturn',
      prompt: 'Interviewer: "You\'re putting a load balancer in front of a fleet of PostgreSQL read replicas. L4 or L7?"',
      answer: `**L4.** Postgres speaks its own binary protocol, not HTTP, and its connections are long-lived. An L4 balancer (HAProxy in \`mode tcp\`, a cloud NLB, or a Kubernetes Service) spreads connections and drops replicas that fail a TCP or SQL-level health check.

If you need query-aware routing, such as writes to the primary and reads to replicas, that's a protocol-aware proxy like Pgpool-II, or routing logic in the application.`,
    },
    {
      type: 'yourturn',
      prompt: 'Interviewer: "Compliance says traffic must be encrypted all the way to the app servers, but product wants path-based routing." What do you build?',
      answer: `An L7 proxy with **TLS re-encryption**: terminate the client's TLS at the proxy, route by path, then open a new TLS connection (ideally mutual TLS) to the backend. Data is encrypted on every network hop and is plaintext only inside the proxy's memory.

A service mesh gives you this for every hop between services, with certificates issued and rotated automatically.`,
    },
    {
      type: 'quiz',
      q: 'A team puts an L4 balancer in front of gRPC services and load is badly uneven. Why?',
      options: ['gRPC runs over UDP', 'L4 balancers can\'t health-check gRPC', 'L4 balances connections, and each gRPC client holds one long-lived HTTP/2 connection', 'gRPC requires cookie-based sticky sessions'],
      answer: 2,
      explain: 'L4 picks a backend once per connection. A gRPC client multiplexes everything over one long-lived connection, so a busy client pins all its traffic to one backend.',
    },
    {
      type: 'quiz',
      q: 'Your backend logs show every request coming from 10.0.3.7, the load balancer. Which fix fits an L4 TCP proxy?',
      options: ['Enable the PROXY protocol on the balancer and the backend', 'Read the X-Forwarded-For header', 'Turn on sticky sessions', 'Switch the algorithm to round robin'],
      answer: 0,
      explain: 'A TCP-mode proxy writes no HTTP headers, so there is no X-Forwarded-For. The PROXY protocol sends the original client address at the start of the connection; both sides must enable it.',
    },
  ],
});
