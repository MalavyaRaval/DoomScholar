interviewPhase('design-load-balancer', {
  id: 'deep-dives',
  nav: 'Deep dives',
  time: '38–43',
  start: 38,
  end: 43,
  title: 'Deep dives: TLS, affinity, timeouts and retries, the proxy itself',
  goal: 'Fast, precise answers to the details that separate senior from staff.',
  blocks: [
    { type: 'say', who: 'them', text: 'Where do you terminate TLS?' },
    {
      type: 'say',
      who: 'me',
      text: "At the L7 tier by default: decrypt once, route on HTTP, then talk to backends either over the private network or, better, **re-encrypted with mTLS** for zero trust.\n\nFor customers who need end-to-end encryption we offer **TLS passthrough** at L4, routing on the **SNI** hostname, which the client sends unencrypted in its ClientHello. (Encrypted Client Hello will eventually hide that, but it isn't the norm yet.)",
    },
    {
      type: 'table',
      title: 'TLS modes',
      head: ['Mode', 'LB sees HTTP?', 'Use when'],
      rows: [
        ['Terminate (offload)', 'Yes', 'Default. Backends get plain HTTP on a trusted network'],
        ['Terminate + re-encrypt', 'Yes', 'Zero trust / compliance: encrypted on every hop'],
        ['Passthrough (SNI routing)', 'No', 'Backend must hold the key; strict end-to-end TLS'],
      ],
    },
    {
      type: 'list',
      title: 'TLS at scale',
      items: [
        'Thousands of certificates: pick per connection by **SNI**; load lazily; hot-reload without restarts.',
        'Automate issuance and renewal (ACME) and alert long before expiry. Expired certificates are a classic self-inflicted outage.',
        'Prefer **ECDSA** certificates (much cheaper handshakes), **TLS 1.3**, and **session resumption**.',
        'Protect private keys: HSMs, or a keyless signing service so edge machines never store raw keys.',
      ],
    },
    { type: 'say', who: 'them', text: 'How would you implement sticky sessions?' },
    {
      type: 'say',
      who: 'me',
      text: "At L7 I'd use an **LB-issued cookie**. On the first response the LB sets `lb_affinity=<opaque backend id>`. Later requests carrying it go to that backend if it's healthy; otherwise we re-pick and reset the cookie.\n\nSource-IP hashing is the L4 fallback, but it breaks behind NAT (a whole office shares one IP) and when phones switch networks. And I'd push teams to make services **stateless** with sessions in Redis, because stickiness fights both balancing and draining.",
    },
    {
      type: 'code',
      title: 'Cookie-based affinity in the L7 pick path',
      lang: 'python',
      code: `def choose(req, pool):
    sticky = req.cookies.get("lb_affinity")
    backend = pool.by_id(sticky) if sticky else None
    if backend and pool.is_healthy(backend):
        return backend, None                    # honor the affinity
    backend = pool.algorithm.pick()             # e.g. P2C
    # opaque ID, never the backend's real IP
    cookie = f"lb_affinity={pool.id_of(backend)}; Max-Age=3600; HttpOnly; Secure"
    return backend, cookie                      # set on the response`,
    },
    { type: 'say', who: 'them', text: 'A backend gets slow. Do you retry? What are your timeouts?' },
    {
      type: 'say',
      who: 'me',
      text: "Timeouts first: a short **connect timeout** (~1 s), a **per-request timeout** tied to the route's SLO, and an **idle timeout** on upstream connections that is *shorter* than the backend's own keep-alive timeout. Otherwise the backend closes an idle connection at the same moment we reuse it, and the user gets a 502.\n\nRetries: only for **idempotent** requests (GET, or writes with an idempotency key), on a **different** backend, at most once or twice, with backoff and jitter. And a **retry budget**, say retries may add at most 10% extra load. Without a budget, retries multiply the load on a struggling service and turn a slowdown into a meltdown.",
    },
    {
      type: 'callout',
      tone: 'trap',
      text: 'Three layers that each make up to 3 attempts = up to **27×** traffic on the bottom service during an incident (3 × 3 × 3). Retry at one layer, with a budget.',
    },
    {
      type: 'code',
      title: 'Retry budget: allow retries only while they stay under 10% of traffic',
      lang: 'python',
      code: `class RetryBudget:
    def __init__(self, ratio=0.1, min_per_sec=10):
        self.ratio, self.min = ratio, min_per_sec
        self.requests = 0.0                # decayed counters (≈ last few seconds)
        self.retries = 0.0

    def on_request(self):
        self.requests += 1

    def can_retry(self):
        allowed = max(self.min, self.requests * self.ratio)
        if self.retries < allowed:
            self.retries += 1
            return True
        return False                       # over budget: fail fast instead

    def decay(self, factor=0.9):           # call every 100 ms
        self.requests *= factor
        self.retries *= factor`,
    },
    {
      type: 'deep',
      title: 'Go deeper: a working L4 TCP load balancer in ~45 lines',
      blocks: [
        {
          type: 'text',
          md: 'This is the heart of a TCP load balancer: accept a client connection, pick a backend with least connections, open an upstream connection, and pipe bytes both ways until either side closes. Run it, point a few `python -m http.server` backends at it, and watch it work.',
        },
        {
          type: 'code',
          title: 'tcp_lb.py',
          lang: 'python',
          code: `import asyncio

BACKENDS = [("127.0.0.1", 8001), ("127.0.0.1", 8002), ("127.0.0.1", 8003)]
active = {b: 0 for b in BACKENDS}
healthy = set(BACKENDS)                  # a health checker would keep this updated

def pick():
    candidates = [b for b in BACKENDS if b in healthy] or BACKENDS  # fail open
    return min(candidates, key=active.get)                           # least connections

async def pipe(reader, writer):
    try:
        while data := await reader.read(65536):
            writer.write(data)
            await writer.drain()         # back-pressure: never buffer unboundedly
    except ConnectionError:
        pass
    finally:
        writer.close()

async def handle(client_r, client_w):
    backend = pick()
    active[backend] += 1
    try:
        try:
            up_r, up_w = await asyncio.wait_for(
                asyncio.open_connection(*backend), timeout=1.0)    # connect timeout
        except (OSError, asyncio.TimeoutError):
            healthy.discard(backend)     # passive health signal
            client_w.close()
            return
        await asyncio.gather(pipe(client_r, up_w), pipe(up_r, client_w))
    finally:
        active[backend] -= 1

async def main():
    server = await asyncio.start_server(handle, "0.0.0.0", 9000, backlog=4096)
    print("LB listening on :9000 →", BACKENDS)
    async with server:
        await server.serve_forever()

asyncio.run(main())`,
          caption: 'Try it: run `python -m http.server 8001` (and 8002, 8003) in three terminals, then `python tcp_lb.py`, then `curl localhost:9000` a few times.',
        },
        {
          type: 'text',
          md: 'Production proxies add TLS, HTTP parsing, upstream connection pools, proper half-close handling, per-connection buffer limits, and one event loop per CPU core with `SO_REUSEPORT` so the kernel spreads new connections across cores.',
        },
      ],
    },
    {
      type: 'deep',
      title: "Go deeper: preserving the client's IP address",
      blocks: [
        {
          type: 'text',
          md: 'A full proxy connects to backends from its **own** IP, so backends lose the real client address, which they need for logs, rate limits and fraud checks.',
        },
        {
          type: 'list',
          items: [
            { title: 'L7:', text: 'add `X-Forwarded-For: <client-ip>` (append to it; never trust a value the client sent) or the standard `Forwarded` header.' },
            { title: 'L4:', text: 'prepend a **PROXY protocol** header (HAProxy\'s spec) to the TCP stream, e.g. `PROXY TCP4 198.51.100.7 203.0.113.10 51234 443`. The backend must be configured to expect it.' },
            { title: 'DSR / transparent modes:', text: 'the original source IP is preserved automatically.' },
          ],
        },
      ],
    },
    {
      type: 'deep',
      title: 'Go deeper: protecting the load balancer itself',
      blocks: [
        {
          type: 'list',
          items: [
            { title: 'SYN floods:', text: 'SYN cookies, so half-open connections cost no memory.' },
            { title: 'Slow clients (slowloris):', text: 'header / body read timeouts, per-IP connection limits, capped per-connection buffers.' },
            { title: 'Abusive clients:', text: 'L7 rate limiting per IP / API key (token bucket in a shared store).' },
            { title: 'Overload:', text: 'when CPU or connection count crosses a limit, shed load early with fast 503s rather than making everyone slow.' },
            { title: 'Volumetric DDoS:', text: 'absorbed upstream: anycast spreads it across every site; scrubbing at the edge.' },
          ],
        },
      ],
    },
    {
      type: 'deep',
      title: 'Go deeper: changing config without dropping connections',
      blocks: [
        {
          type: 'text',
          md: 'NGINX reloads by starting new worker processes with the new config while old workers finish their existing connections. Envoy receives updates over **xDS** and swaps routing tables in memory with no restart at all. For binary upgrades, Envoy\'s hot restart and HAProxy\'s seamless reload hand the listening sockets to the new process, and `SO_REUSEPORT` lets old and new processes accept on the same port during the handover.\n\nRoll config out like code: validate it, push to a few canary nodes first, watch error rates, then the fleet, with automatic rollback to the last good version.',
        },
      ],
    },
    {
      type: 'quiz',
      q: 'Which request is safe for the LB to retry automatically on another backend?',
      options: ['POST /payments with no idempotency key', 'GET /products/42', 'POST /orders', 'PATCH /cart that adds +1 to a quantity'],
      answer: 1,
      explain: 'GET is idempotent: running it twice has the same effect as once. The others could double-charge, double-order or double-increment.',
    },
    {
      type: 'quiz',
      q: 'Behind your L4 proxy, backends log the LB\'s IP for every connection. Cleanest fix for raw TCP traffic?',
      options: ['Ask clients to put their IP in the payload', 'A PROXY protocol header sent by the LB', 'Remove the load balancer', 'Add X-Forwarded-For to the TCP stream'],
      answer: 1,
      explain: 'X-Forwarded-For is an HTTP header, so it doesn\'t exist at L4. PROXY protocol prepends the original addresses to the stream, and the backend parses it.',
    },
    {
      type: 'quiz',
      q: 'You pass TLS through to backends untouched. How can the LB still route by hostname?',
      options: ['Read the HTTP Host header', 'Read the SNI field in the unencrypted ClientHello', "Decrypt with the backend's key", "It can't"],
      answer: 1,
      explain: 'The client names the server (SNI) in the first, unencrypted TLS message, so the LB can route on it without decrypting anything.',
    },
    {
      type: 'quiz',
      q: 'Users see random 502s right after quiet periods. Upstream keep-alive is on. Most likely cause?',
      options: [
        'The backend closes idle connections just as the LB reuses them (LB idle timeout ≥ backend keep-alive)',
        'DNS TTL is too low',
        'The LB uses round robin',
        'TLS certificates expired',
      ],
      answer: 0,
      explain: "Classic race. Make the LB's upstream idle timeout **shorter** than the backend's keep-alive timeout, and retry idempotent requests once on a fresh connection.",
    },
  ],
});
