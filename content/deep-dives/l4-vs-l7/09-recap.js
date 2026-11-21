deepSection('l4-vs-l7', {
  id: 'recap',
  nav: 'Explain it back',
  title: 'Explain it back',
  goal: 'Say every core idea out loud, in your own words, without looking.',
  card: {
    emoji: '🃏',
    text: `Here's the whole story in one breath. L4 balancers read the 5-tuple, pick a backend once per connection, and forward packets with NAT or direct server return. At scale they run as ECMP fleets sharing a consistent hash like Maglev's. L7 balancers terminate TCP and TLS, parse HTTP and choose per request, which buys routing, canaries, retries and metrics at a real CPU cost. Production stacks layer both behind DNS and anycast. Now test yourself: try to explain each idea out loud before you flip the card.`,
  },
  blocks: [
    {
      type: 'text',
      md: `Reading builds familiarity. **Recalling** builds memory. Answer each card out loud, in full sentences, before you flip it. If you can explain it to an imaginary interviewer without notes, you know it. If you stumble, jump back to that part with the chips at the top.`,
    },
    {
      type: 'flashcards',
      title: 'Explain it back',
      text: 'Ten questions, from the basics to the war stories.',
      cards: [
        { q: 'What exactly is the difference between an L4 and an L7 load balancer?', a: 'L4 decides from the packet envelope (the 5-tuple of protocol, IPs and ports) once per connection, without reading the payload. L7 terminates the connection and TLS, parses the HTTP request and decides per request using host, path, headers or cookies.' },
        { q: 'Why must all packets of one TCP connection reach the same backend?', a: 'The connection\'s state (sequence numbers, windows, buffers) exists only on the backend that completed the handshake. Any other server would answer with a RST and the connection would die.' },
        { q: 'NAT vs DSR: what is the difference, and why does it matter?', a: 'NAT rewrites the destination IP and must carry replies back to undo the rewrite, so the balancer carries both directions. DSR forwards packets unchanged (MAC rewrite or a tunnel) and the backend replies directly, so the much larger responses skip the balancer.' },
        { q: 'How does a fleet of L4 balancers survive an ECMP reshuffle?', a: 'Every balancer computes the backend from the same consistent hash of the 5-tuple (for example a Maglev lookup table), so whichever node a flow lands on picks the same backend. Local connection tables act as a cache when the backend set changes.' },
        { q: 'What problem does Maglev hashing solve compared with hash mod N?', a: 'hash mod N remaps almost every flow when N changes. Maglev hashing fills a prime-sized table from per-backend preference lists, giving near-perfect balance while moving only a small share of flows when a backend is added or removed.' },
        { q: 'Name five things only an L7 balancer can do.', a: 'Route by host, path or header; split traffic for canaries; retry a failed request on another backend; terminate TLS and enforce auth or WAF rules; emit per-request logs and latency metrics. Also: rewrite headers, compress, cache, bridge HTTP/1.1 to HTTP/2.' },
        { q: 'Why do gRPC services behind an L4 balancer get uneven load?', a: 'Each gRPC client keeps one long-lived HTTP/2 connection and multiplexes all requests over it. L4 picks a backend per connection, so a busy client pins all its traffic to one backend and newly added backends get nothing.' },
        { q: 'How does a backend learn the real client IP?', a: 'Behind L7: from X-Forwarded-For or Forwarded headers, trusting only entries added by your own proxies. Behind an L4 TCP proxy: from the PROXY protocol header. With DSR or plain destination NAT, the packet\'s source IP is still the client\'s.' },
        { q: 'Describe a modern multi-tier load balancing stack, top to bottom.', a: 'DNS (often geo-aware) and anycast pick the region and site. Routers ECMP across a software L4 fleet. L4 consistently hashes flows to L7 proxies, with DSR for replies. L7 terminates TLS and routes per request. A sidecar or client library picks the final instance.' },
        { q: 'Give three real L4 balancers and three real L7 proxies.', a: 'L4: Google Maglev, Meta Katran, GitHub GLB Director, Cloudflare Unimog, Linux IPVS, AWS NLB. L7: NGINX, HAProxy, Envoy, Google GFE, Meta Proxygen, Cloudflare Pingora, AWS ALB.' },
      ],
    },
    {
      type: 'callout',
      tone: 'key',
      title: 'If you remember one thing',
      text: '**L4 moves connections; L7 understands requests.** Every trade-off in this deep dive (cost, latency, features, TLS, client IPs, gRPC behavior, failure modes) is a consequence of that sentence.',
    },
    {
      type: 'quiz',
      q: 'Which statement is true?',
      options: ['L7 balancers are faster than L4 because they cache', 'L4 balancers terminate TLS to read the ports', 'L4 picks a backend per connection; L7 can pick per request', 'DSR lets an L7 proxy skip the TLS handshake'],
      answer: 2,
      explain: 'That is the core difference. L4 commits on the first packet of a connection; L7 terminates it and decides for every HTTP request, including each HTTP/2 stream.',
    },
    {
      type: 'quiz',
      q: 'An interviewer asks which balancer belongs in front of a UDP game server that needs the lowest possible latency. Best answer?',
      options: ['An L7 HTTP proxy with retries', 'An L4 balancer hashing each client\'s flow to a server', 'DNS round robin only', 'A CDN edge cache'],
      answer: 1,
      explain: 'A UDP game protocol isn\'t HTTP, so L7 can\'t help. An L4 balancer hashing the flow keeps each player on one server with microseconds of overhead.',
    },
  ],
});
