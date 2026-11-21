deepSection('l4-vs-l7', {
  id: 'l7',
  nav: 'How L7 works',
  title: 'How an L7 load balancer works, request by request',
  goal: 'Walk one HTTPS request through an L7 proxy and name everything it can do along the way.',
  card: {
    emoji: '📨',
    text: `An L7 balancer is a **full proxy**: the client's TCP connection ends at the proxy, and the proxy opens its own connections to backends. It completes the TCP handshake, then the TLS handshake (it holds the certificate and private key), then reads until it has a whole HTTP request. Only then does it decide, using host, path, headers or cookies. It can reuse a pool of warm connections to backends, retry a failed request elsewhere, add headers like \`X-Forwarded-For\`, and log every request. The price: real work for every request, so it costs far more CPU than L4.`,
  },
  blocks: [
    {
      type: 'text',
      md: `An L4 balancer is a very smart packet forwarder. An L7 balancer is something else entirely: a **full proxy**. There are two separate TCP connections, client to proxy and proxy to backend. Envoy calls them **downstream** and **upstream**, words you'll see in every service-mesh doc. Nothing flows from one to the other until the proxy has read, understood and decided.

That is what lets it act on meaning instead of addresses. It also means the proxy carries the full cost of being "the server" as far as the client can tell: accepting the connection, doing the TLS handshake, buffering and parsing.`,
    },
    {
      type: 'stepper',
      title: 'One HTTPS request through an L7 proxy',
      diagram: {
        h: 300,
        nodes: [
          { id: 'c', x: 55, y: 150, label: 'Client', icon: '📱', shape: 'pill' },
          { id: 'p', x: 175, y: 150, label: 'L7 proxy', icon: '🔀', tone: 'accent' },
          { id: 'v1', x: 300, y: 55, label: 'Cart v1', icon: '🛒' },
          { id: 'v2', x: 300, y: 150, label: 'Cart v2\n(canary)', icon: '🧪', tone: 'warn' },
          { id: 's', x: 300, y: 250, label: 'Search', icon: '🔍' },
        ],
        edges: [
          { from: 'c', to: 'p', flow: true, label: 'TLS' },
          { from: 'p', to: 'v1', flow: true },
          { from: 'p', to: 'v2', dashed: true },
          { from: 'p', to: 's' },
        ],
      },
      steps: [
        {
          title: 'TCP handshake with the proxy',
          focus: ['c', 'c>p', 'p'],
          text: 'The client\'s SYN is answered by the **proxy**, not by any backend. The client\'s TCP connection ends here.',
        },
        {
          title: 'TLS handshake',
          focus: ['c>p', 'p'],
          text: 'The proxy reads the SNI hostname in the ClientHello, picks the matching certificate, negotiates **ALPN** (`h2` or `http/1.1`) and completes the handshake. A full TLS 1.3 handshake costs one round trip; session resumption can cut that further.',
        },
        {
          title: 'Parse the request',
          focus: ['p'],
          text: 'Bytes are decrypted and parsed: `GET /api/cart/42`, `Host: shop.example`, headers, cookies. Policy runs here: authentication, rate limits, WAF rules, redirects, header rewrites.',
        },
        {
          title: 'Route and pick an endpoint',
          focus: ['p', 'p>v1', 'v1', 'p>v2', 'v2'],
          text: '`/api/cart/*` matches the cart route, which splits traffic 99% to v1 and 1% to the v2 canary. Within the chosen cluster, an algorithm (round robin, least request, ring hash…) picks one instance.',
        },
        {
          title: 'Reuse a warm upstream connection',
          focus: ['p>v1', 'v1'],
          text: 'The proxy keeps a **pool** of keep-alive connections to each backend, so there is no new TCP or TLS handshake per request. Thousands of client connections funnel into a few dozen upstream ones.',
        },
        {
          title: 'Forward, stream back, observe',
          focus: ['c>p', 'p', 'p>v1'],
          text: 'It adds `X-Forwarded-For`, `X-Forwarded-Proto` and a request ID, forwards the request, then streams the response back (maybe compressing it). It records the status, latency and bytes for **this one request**. On a connect failure or a 503, it can retry on another instance.',
        },
      ],
    },
    {
      type: 'list',
      title: 'What only an L7 balancer can do',
      items: [
        { title: 'Content routing:', text: 'host, path, header, cookie or method decides the backend pool (`/api` vs `/static`, `api.` vs `www.`).' },
        { title: 'Traffic splitting:', text: 'canaries (1% to v2), blue/green switches, A/B tests, header-based routing for internal testers.' },
        { title: 'Resilience:', text: 'timeouts, retries, circuit breaking, and outlier detection that ejects a host returning errors.' },
        { title: 'Security at the edge:', text: 'TLS termination, auth and JWT checks, WAF rules, per-client rate limits.' },
        { title: 'Request surgery:', text: 'add or strip headers, redirect HTTP to HTTPS, rewrite paths, compress, cache.' },
        { title: 'Per-request observability:', text: 'access logs, latency histograms per route, distributed-tracing headers.' },
        { title: 'Protocol bridging:', text: 'HTTP/1.1 clients to HTTP/2 backends, gRPC-Web to gRPC, WebSocket upgrades.' },
      ],
    },
    {
      type: 'text',
      md: `Two benefits are easy to miss.

**Connection pooling shields backends.** Without a proxy, 50,000 phones mean 50,000 TCP and TLS sessions on your app servers. With an L7 proxy in front, those sessions end at the proxy and the backends see a few hundred long-lived, already-warm connections. Speaking HTTP/2 to the backends goes further: many requests share one connection.

**Buffering absorbs slow clients.** A phone on a weak signal might take seconds to upload a request or download a response. A proxy like NGINX buffers the slow side, so an application worker is busy only for the milliseconds it takes to compute the answer. The same trick defends against **slowloris** attacks, where an attacker opens many connections and dribbles bytes painfully slowly to tie up every worker.

**Per-request balancing fixes HTTP/2 and gRPC.** A gRPC client sends all of its requests over one long-lived HTTP/2 connection. An L4 balancer pins that whole connection to one backend. An L7 proxy balances each request (each HTTP/2 stream) independently, so one chatty client spreads across the whole pool.`,
    },
    {
      type: 'code',
      title: 'An Envoy route: 1% canary, timeout, retries',
      lang: 'yaml',
      code: `route_config:
  virtual_hosts:
  - name: shop
    domains: ["shop.example"]
    routes:
    - match: { prefix: "/api/cart" }
      route:
        weighted_clusters:
          clusters:
          - name: cart_v1
            weight: 99
          - name: cart_v2          # the canary
            weight: 1
        timeout: 2s
        retry_policy:
          retry_on: "5xx,reset,connect-failure"
          num_retries: 2
    - match: { prefix: "/" }
      route: { cluster: web }`,
      caption: 'The cart route sends 1% of requests to a canary, gives up after 2 seconds and retries twice on 5xx responses, resets and connect failures. None of this is possible at L4, because L4 never sees a path or a status code.',
    },
    {
      type: 'callout',
      tone: 'warn',
      title: 'Retries are a loaded gun',
      text: 'A retry adds load at the worst possible moment, when a backend is already struggling. If the edge proxy, the service mesh and the client library each make up to 3 attempts, one user request can become 3 × 3 × 3 = **27** requests against a dying service. Retry only idempotent requests, add jitter, and cap retries with a **budget** (Envoy can limit retries to a percentage of active requests).',
    },
    {
      type: 'deep',
      title: 'Go deeper: what TLS termination really costs',
      blocks: [
        {
          type: 'text',
          md: `The expensive part of TLS is the **handshake**, which uses asymmetric cryptography: a key exchange (ECDHE) plus a signature made with the server's private key. Bulk encryption afterwards uses AES-GCM or ChaCha20, which modern CPUs run at gigabytes per second. So L7 proxies worry about **handshakes per second** much more than bytes per second.

The ways to cut the cost: TLS 1.3 (one round trip instead of two), session resumption so returning clients skip the full handshake, ECDSA certificates (signing is much cheaper than with RSA keys of similar strength), and keeping connections alive so one handshake serves many requests.

Holding private keys on thousands of edge proxies is also a security problem. Cloudflare's **Keyless SSL** lets a customer keep the key on its own server: the edge proxy sends only the private-key operation to that server over a secure channel, so it can terminate TLS without ever holding the key.`,
        },
      ],
    },
    {
      type: 'quiz',
      q: 'Which of these can only an L7 balancer do?',
      options: ['Spread TCP connections across servers', 'Fail over when a server stops answering', 'Forward UDP game traffic', 'Send 1% of /api/cart requests to a canary build'],
      answer: 3,
      explain: 'Matching `/api/cart` means reading the HTTP path, which only an L7 proxy can do after terminating TLS. The other three work fine at L4.',
    },
    {
      type: 'quiz',
      q: 'An L7 proxy holds 40,000 client connections but only 300 connections to its backends. Why?',
      options: ['It silently drops most requests', 'It reuses pooled keep-alive (and multiplexed) connections to backends', 'Backends only accept 300 connections', 'It serves every response from cache'],
      answer: 1,
      explain: 'Client connections end at the proxy. Upstream, it keeps a pool of warm connections and sends many requests over each, so backends do far fewer handshakes.',
    },
  ],
});
