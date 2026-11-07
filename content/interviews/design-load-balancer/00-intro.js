registerInterview({
  id: 'design-load-balancer',
  title: 'Design a Load Balancer',
  short: 'LB Mock Interview',
  emoji: '🎤',
  color: '#8b5cf6',
  related: 'load-balancer',
  duration: 45,
  level: 'Senior / Staff depth',
  tagline: 'The full 45 minutes: requirements, estimates, L4/L7, algorithms, health checks, HA, Maglev, TLS, wrap-up',
  intro: "The interviewer says: **\"Design a load balancer.\"** This page walks through the whole 45 minutes the way a strong candidate would run it, phase by phase, with the actual conversation.\n\n**Practice mode** blurs the candidate's answers. Read the interviewer's line, answer **out loud**, then tap to compare. Start the **45:00 timer** to rehearse pacing; it highlights the phase you should be on.\n\n🔍 **Go deeper** sections hold the extra depth (code, configs, edge cases) that turns a good answer into a great one. Code is Python for readability, plus real NGINX, HAProxy and keepalived configs.",
});

interviewPhase('design-load-balancer', {
  id: 'plan',
  nav: 'Game plan',
  title: 'The 45-minute game plan',
  goal: 'Know the shape of the interview before you say a word.',
  blocks: [
    {
      type: 'table',
      title: 'How a great 45 minutes is spent',
      head: ['Minutes', 'Phase', 'What "great" sounds like'],
      rows: [
        ['0–5', 'Requirements', 'L4 vs L7, traffic types, scale, latency, availability and scope are agreed'],
        ['5–10', 'Estimates', 'Bandwidth, connections, CPU → "one box is never enough; two tiers"'],
        ['10–15', 'API + high-level', 'Control plane vs data plane; the full journey of one request'],
        ['15–20', 'Types of LB', 'L4 vs L7; NAT vs full proxy vs DSR; DNS, anycast, client-side, mesh'],
        ['20–27', 'Algorithms', 'RR → weighted → least-conn → P2C → consistent / Maglev hashing, with code'],
        ['27–32', 'Health checks', 'Active + passive, thresholds, fail-open, slow start, draining'],
        ['32–38', 'HA and scale', 'VRRP → BGP + ECMP active-active, Maglev, anycast, cross-zone'],
        ['38–43', 'Deep dives', 'TLS, affinity, timeouts, retries, client IP, overload, hot reload'],
        ['43–45', 'Wrap-up', 'Metrics, trade-offs, a crisp 60-second summary'],
      ],
    },
    {
      type: 'callout',
      tone: 'key',
      title: 'What interviewers actually grade',
      text: "**Structure** (you drive the conversation), **depth** (you know what happens to the packets), **trade-offs** (every choice has a cost and you say it), and **communication** (you check in and adapt). Memorized facts without reasons score low.",
    },
    {
      type: 'list',
      title: 'Habits that score points the whole way through',
      items: [
        "Think out loud: \"I see two options, A and B. I'll pick A because…\"",
        'Tie every decision back to the numbers you wrote down in minute 5.',
        'Check in at each phase boundary: "Is this the right depth, or should I go deeper on X?"',
        'Name failure modes before the interviewer does.',
        "When you don't know something, reason from first principles out loud instead of guessing silently.",
      ],
    },
  ],
});
