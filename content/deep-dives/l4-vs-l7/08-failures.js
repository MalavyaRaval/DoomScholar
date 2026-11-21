deepSection('l4-vs-l7', {
  id: 'failures',
  nav: 'When it breaks',
  title: 'When it breaks: real failure modes',
  goal: 'Recognize the classic load balancer incidents from their symptoms, and know the fix for each.',
  card: {
    emoji: '🚨',
    text: `Load balancers fail in recognizable ways. WebSockets that drop after exactly a minute of silence? An **idle timeout**. One backend melting while new ones idle behind an L4 balancer? Long-lived **HTTP/2 or gRPC** connections pinned to it. A small blip that snowballs into an outage? **Retry storms** multiplying traffic. Every user rate-limited at once? The backend sees the **balancer's IP** instead of the client's. Everything down at midnight with no deploy? An **expired TLS certificate** on the L7 tier. Learn the symptoms and you can diagnose most incidents in minutes.`,
  },
  blocks: [
    {
      type: 'text',
      md: `Each case below starts with a symptom, the way you'd meet it in an incident channel. **Diagnose it out loud before you tap** to reveal the answer. This is the part of the topic that interviewers love, because it separates people who've read about load balancers from people who've run them.`,
    },
    {
      type: 'yourturn',
      prompt: '💥 Chat users on WebSockets get disconnected after **exactly 60 seconds** with no messages. Busy chats are fine.',
      answer: `**An idle timeout.** The balancer closes connections that carry no traffic for its idle timeout, and the AWS Application Load Balancer's default is 60 seconds. Busy chats send data and stay alive; quiet ones get cut.

**Fix:** send application-level heartbeats (or WebSocket ping frames) every 20 to 30 seconds, and/or raise the balancer's idle timeout. Clients should reconnect automatically anyway, because connections will always drop eventually.`,
    },
    {
      type: 'yourturn',
      prompt: '💥 After scaling a gRPC service from 4 to 8 pods behind an L4 balancer, the 4 new pods get almost no traffic. The old pods sit at 90% CPU.',
      answer: `**Pinned HTTP/2 connections.** gRPC clients open one long-lived HTTP/2 connection and send everything over it. L4 balances connections only when they open, so existing clients never move to the new pods.

**Fix:** per-request (L7) balancing in a proxy or mesh, client-side balancing in the gRPC library, or a maximum connection age on the server so clients reconnect and rebalance every few minutes.`,
    },
    {
      type: 'yourturn',
      prompt: '💥 A database slowdown makes the cart service start timing out. Within a minute, request volume at the cart service is **9× normal** and it falls over completely.',
      answer: `**A retry storm.** The edge proxy retries timeouts, and so does the client library: 3 attempts × 3 attempts = 9× the load, aimed at a service that was already struggling.

**Fix:** retry at one layer only, only for idempotent requests, with exponential backoff and jitter, under a **retry budget** (for example, retries may be at most 10% of traffic). Add circuit breakers so callers fail fast while the dependency recovers.`,
    },
    {
      type: 'yourturn',
      prompt: '💥 You add per-IP rate limiting to the API. Within minutes, **every** user is being throttled.',
      answer: `**Lost client IPs.** The application sees the balancer's IP as the source of every request, so all users share a single rate-limit bucket.

**Fix:** behind an L7 proxy, rate-limit on \`X-Forwarded-For\`, using the entry appended by your own trusted proxy rather than the first, client-controlled entry. Behind an L4 TCP proxy, enable the PROXY protocol on both ends. Better still, rate-limit in the edge proxy itself, which sees the real address.`,
    },
    {
      type: 'yourturn',
      prompt: '💥 Health checks are green on every instance, yet 30% of user requests return 500 errors.',
      answer: `**A health check that lies.** A TCP check, or an HTTP check against a \`/health\` endpoint that always returns "OK", proves the process is listening, not that it can do its job.

**Fix:** make the check exercise what matters (can it reach its database and cache?) while keeping it cheap, and pair it with **outlier detection**, which ejects instances based on their real traffic error rate.

Careful with deep checks: if a shared dependency is down, *every* instance fails at once. Many balancers then "fail open" and send traffic to all of them anyway; an AWS ALB does exactly that when every target in a group is unhealthy.`,
    },
    {
      type: 'yourturn',
      prompt: '💥 During every deploy, a few hundred users see connection resets and failed checkouts.',
      answer: `**No connection draining.** Instances are killed while they still have requests in flight, or before the balancer has stopped sending them new ones.

**Fix:** deregister first, then wait. Balancers support a **deregistration delay** (AWS target groups default to 300 seconds) during which no new requests go to the instance while in-flight ones finish. The app should handle SIGTERM by failing its readiness check, finishing current work, and only then exiting.`,
    },
    {
      type: 'yourturn',
      prompt: '💥 At 00:00 UTC, every client starts failing with TLS errors. Nothing was deployed.',
      answer: `**An expired certificate** on the L7 tier, or one in its chain. Because the L7 balancer terminates TLS for everything behind it, one expired certificate takes down every service at once. Microsoft Teams had a widely reported outage in February 2020 for exactly this reason.

**Fix:** automate issuance and renewal (ACME with Let's Encrypt, or a cloud certificate manager), alert weeks before expiry, and monitor certificates from the outside, the way users see them.`,
    },
    {
      type: 'callout',
      tone: 'tip',
      title: 'A pattern worth noticing',
      text: 'L4 failures are mostly about **connections**: timeouts, pinning, reshuffles, lost addresses. L7 failures are mostly about **requests and configuration**: retries, health-check semantics, certificates, a bad routing rule pushed to every proxy at once. When you\'re debugging, the first useful question is often "is this per connection or per request?"',
    },
    {
      type: 'quiz',
      q: 'WebSocket connections drop after exactly 60 idle seconds. What is the most likely cause?',
      options: ['The balancer\'s idle timeout', 'A TLS certificate expiring', 'Round robin rebalancing', 'DNS TTL expiry'],
      answer: 0,
      explain: 'An exact, repeatable idle duration points to a timeout. The AWS ALB default idle timeout is 60 seconds; keep connections busy with heartbeats more often than that.',
    },
    {
      type: 'quiz',
      q: 'Three layers (edge proxy, mesh, client) each make up to 3 attempts per request. Worst case, how many attempts can one user request cause at the bottom service?',
      options: ['3', '6', '27', '9'],
      answer: 2,
      explain: 'Attempts multiply across layers: 3 × 3 × 3 = **27**. That is why you retry at one layer only and cap retries with a budget.',
    },
  ],
});
