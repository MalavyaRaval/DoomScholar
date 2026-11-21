registerDeepDive({
  id: 'l4-vs-l7',
  title: 'L4 vs L7 Load Balancing',
  short: 'L4 vs L7',
  emoji: '🔬',
  color: '#6366f1',
  related: 'load-balancer',
  tagline: 'What each layer sees, how packets really move, and who runs what in production',
  hook: 'The quick cards said "L4 is fast, L7 is smart". Now open the box: packets, flow tables, Maglev, TLS, and how Google, Meta and AWS stack both.',
  intro: `The quick cards told you **L4 is fast and L7 is smart**. That's true, and it's nowhere near enough to debug a real outage or survive a senior interviewer's follow-up questions.

This deep dive goes byte by byte. You'll see what is actually inside a request, what an L4 balancer does with the very first packet of a connection, why an L7 proxy has to decrypt your traffic to do its job, and how Google, Meta, Cloudflare, GitHub, AWS and Kubernetes stack **both** kinds in front of almost every request you make.

Every part ends with a checkpoint. The paragraph at the top of each part also shows up in your feed, so you'll meet these ideas more than once. That's on purpose: repetition is what makes it stick.`,
  recap: [
    'L4 balances connections using the 5-tuple and never reads the payload',
    'L7 terminates TCP and TLS, parses HTTP, and balances every request',
    'Big L4 tiers use ECMP + consistent hashing + direct server return',
    'Production stacks layer DNS/anycast → L4 → L7 → service',
    'Classic outages: idle timeouts, retry storms, pinned HTTP/2, lost client IPs',
  ],
});
