interviewPhase('design-load-balancer', {
  id: 'curveballs',
  nav: 'Curveballs',
  title: 'Curveball follow-ups (rapid fire)',
  goal: 'Questions interviewers use to probe the edges. Answer each one out loud in under a minute before revealing.',
  blocks: [
    {
      type: 'yourturn',
      prompt: 'A backend passes every health check, but 20% of its requests take 10× longer than its peers. How does your LB catch it?',
      answer: "That's a **gray failure**: alive, but degraded. Binary health checks miss it.",
      points: [
        'Latency-aware balancing: **P2C with an EWMA** of response time naturally routes around the slow host.',
        'Latency-based **outlier detection**: compare each host\'s p99 with the pool\'s median and eject statistical outliers.',
        'Watch per-backend error and latency dashboards; alert on divergence from peers, not just absolute thresholds.',
      ],
    },
    {
      type: 'yourturn',
      prompt: 'You scaled WebSocket servers from 4 to 8, but the 4 new ones get almost no traffic. Why, and how do you fix it?',
      answer: "WebSockets are **long-lived**: existing connections stay where they are, so only *new* connections reach the new servers. The old servers stay hot for hours.",
      points: [
        'Use least-connections (or P2C) for new connections so newcomers fill up fastest.',
        'Have servers ask a fraction of clients to reconnect (close with a reason code), **with jitter**, to rebalance gradually.',
        'Cap connection age so long-lived connections recycle over time.',
        'Never force everyone to reconnect at once: that is a self-inflicted thundering herd.',
      ],
    },
    {
      type: 'yourturn',
      prompt: 'A backend restarts and is immediately crushed by load, then crashes again. What is going on?',
      answer: 'Least-connections sees the restarted host with **0** connections and every LB node sends it traffic at once, while its caches and JIT are cold.',
      points: ['**Slow start**: ramp its weight from ~10% to 100% over 30–60 s.', '**P2C** instead of pure least-connections, to avoid the herd.', 'Readiness checks that only pass once the app has warmed up.'],
    },
    {
      type: 'yourturn',
      prompt: 'How would you load balance QUIC / HTTP/3?',
      answer: "QUIC runs over **UDP**, and supports **connection migration**: when a phone moves from Wi-Fi to LTE, its IP and port change but the QUIC connection continues. So hashing on the 5-tuple breaks exactly when migration happens.",
      points: [
        'Route on the QUIC **connection ID** instead of the 5-tuple.',
        "Let servers encode a routable server ID inside the connection IDs they issue (the IETF QUIC-LB work), so any LB node can decode where a packet belongs.",
        'Consistent-hash the connection ID as a fallback for IDs you can\'t decode.',
      ],
    },
    {
      type: 'yourturn',
      prompt: 'How does load balancing work in Kubernetes?',
      answer: 'Several layers stacked together:',
      points: [
        "A **Service** gets a virtual ClusterIP. **kube-proxy** programs iptables (random choice) or IPVS rules on every node to spread connections across the Service's pods: L4, per connection.",
        'A `type: LoadBalancer` Service asks the cloud to provision an external L4 load balancer that forwards to node ports.',
        "**Ingress** controllers or the **Gateway API** (NGINX, Envoy-based gateways) provide L7 routing by host and path.",
        "`externalTrafficPolicy: Local` preserves the client IP and avoids an extra hop, but can unbalance load if pods aren't spread evenly across nodes.",
        'A service mesh adds per-request L7 balancing between services through sidecars.',
      ],
    },
    {
      type: 'yourturn',
      prompt: 'Your LB returns 502s and 504s. What is the difference, and what do you check first?',
      answer: '**502 Bad Gateway**: the backend answered badly or not at all: connection refused, reset, or an invalid response. **504 Gateway Timeout**: the backend accepted the request but did not answer in time.',
      points: [
        '502s: crashed or restarting backends; the keep-alive idle-timeout race; missing draining during deploys.',
        '504s: slow backends or dependencies; LB timeout set shorter than real request times; overload and queueing.',
        'Split the metrics by backend: one bad host versus pool-wide trouble points at very different causes.',
      ],
    },
    {
      type: 'yourturn',
      prompt: 'A bad config push routes /checkout to an empty pool. How do you limit the blast radius?',
      answer: 'Treat config like code.',
      points: [
        '**Validate** before accepting: schema checks, every rule must point at a pool with healthy targets, diff review for big changes.',
        '**Stage** the rollout: a few canary LB nodes, then one zone, then a region, then everywhere.',
        '**Auto-rollback** when error rates spike on nodes running the new version.',
        'Keep the **last known-good** snapshot on every node, so rollback is instant and works even if the control plane is down.',
      ],
    },
    {
      type: 'yourturn',
      prompt: 'How would you test the LB before trusting it with production traffic?',
      answer: 'Test the failure modes, not just the happy path.',
      points: [
        'Load tests with realistic shapes: many long-lived connections, high churn, large responses, slow clients.',
        'Chaos: kill L4 and L7 nodes mid-traffic and verify that existing connections survive (this is the Maglev promise).',
        'Fail backends, dependencies and whole zones; check fail-open, outlier detection and draining behavior.',
        'Fuzz the HTTP and TLS parsers; benchmark p99 latency the LB adds at peak load.',
        'Shadow or mirror a slice of real traffic before switching it over.',
      ],
    },
    {
      type: 'quiz',
      q: 'What makes a "gray failure" hard for basic health checks to catch?',
      options: [
        'The server is completely offline',
        'The server passes liveness checks but serves some requests slowly or wrongly',
        'The server is on a different continent',
        'The server uses HTTP/3',
      ],
      answer: 1,
      explain: 'The host is alive, so a binary check says healthy. Only latency- or error-based signals from real traffic reveal it.',
    },
    {
      type: 'quiz',
      q: 'Why does 5-tuple hashing break for QUIC connection migration?',
      options: [
        'QUIC is encrypted',
        "The client's IP or port changes mid-connection, so the tuple and its hash change too",
        'QUIC uses TCP underneath',
        'Hashes cannot handle UDP',
      ],
      answer: 1,
      explain: 'Route on the stable connection ID instead, ideally with the server ID encoded in it.',
    },
  ],
});
