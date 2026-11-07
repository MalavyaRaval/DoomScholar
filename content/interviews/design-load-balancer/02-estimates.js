interviewPhase('design-load-balancer', {
  id: 'estimates',
  nav: 'Estimates',
  time: '5–10',
  start: 5,
  end: 10,
  title: 'Back-of-envelope estimates',
  goal: 'Turn requirements into hardware. The math decides one box vs a fleet, and one tier vs two.',
  blocks: [
    { type: 'say', who: 'them', text: 'How big is this thing going to be?' },
    {
      type: 'say',
      who: 'me',
      text: "Let me size it, rounding aggressively. Bandwidth first, then connections, then CPU, because each one stresses a different resource.",
    },
    {
      type: 'code',
      title: 'The napkin math (say it while you write it)',
      lang: 'text',
      code: `BANDWIDTH
  1M req/s × (~2 KB in + ~20 KB out)  ≈ 22 GB/s
  22 GB/s × 8 bits                   ≈ 176 Gbit/s
  → many 25–100 Gbit NICs, so many machines

CONNECTIONS, L7 tier (full proxy, two sockets + buffers each)
  10M × ~32 KB                       ≈ 320 GB of RAM
  → spread across the fleet

CONNECTIONS, L4 tier (just a flow-table entry)
  10M × ~300 B                       ≈ 3 GB
  → fits in one machine's RAM

CPU, L7 tier (TLS + HTTP parsing)
  ~20K HTTPS req/s per core (keep-alive, resumed TLS)
  1M ÷ 20K                           ≈ 50 cores
  × 2 headroom for spikes            ≈ 100 cores
  ≈ 4 × 32-core machines, + N+2 spares → ~6–8 L7 nodes`,
      caption: 'Label your assumptions ("~20K req/s per core, assuming keep-alive and session resumption"). The interviewer cares that the reasoning is sound, not that the constant is exact.',
    },
    {
      type: 'say',
      who: 'me',
      text: "So one machine is never enough. We need a horizontally scaled fleet. And the cost is lopsided: the **L7 tier**, which does TLS and HTTP parsing, is where the CPU goes. **L4 forwarding** is cheap per packet: a well-tuned L4 node can forward millions of packets per second, especially with kernel bypass or XDP.",
    },
    {
      type: 'say',
      who: 'me',
      text: "That points to the classic **two-tier** design: a thin, fast L4 tier that spreads connections across a larger L7 tier, which does TLS and HTTP routing. Google (Maglev in front of its frontends), Facebook (Katran in front of Proxygen) and most cloud load balancers end up with this shape.",
    },
    {
      type: 'think',
      text: "Naming real systems is good when it's precise and backs up a decision you already reasoned through. It is not a substitute for the reasoning.",
    },
    {
      type: 'table',
      title: 'Where TLS cost really comes from',
      head: ['Operation', 'Rough cost', 'Lever'],
      rows: [
        ['Full handshake, RSA-2048', '~1–2K per second per core', 'Use ECDSA certificates'],
        ['Full handshake, ECDSA P-256', 'Roughly 10× cheaper than RSA', 'Default for new certs'],
        ['Resumed session (TLS 1.3 PSK / tickets)', 'Much cheaper: no certificate signature', 'Enable resumption, long keep-alive'],
        ['Bulk encryption (AES-GCM)', 'Very cheap with AES-NI', 'Rarely the bottleneck'],
      ],
    },
    {
      type: 'deep',
      title: 'Go deeper: the hidden limit, ephemeral ports',
      blocks: [
        {
          type: 'text',
          md: 'An L7 proxy opens its **own** TCP connection to each backend. A connection is identified by (source IP, source port, destination IP, destination port). From one LB IP to one backend `IP:port`, the only thing that varies is the source port, so there are at most ~64K concurrent connections. Linux\'s default `ip_local_port_range` (32768–60999) gives only ~28K.\n\nWith 10M client connections, opening a fresh backend connection per client request would exhaust ports to busy backends quickly. Closed sockets sit in `TIME_WAIT` for 60 s on Linux, which makes it worse.',
        },
        {
          type: 'list',
          title: 'Fixes',
          items: [
            { title: 'Connection pooling / keep-alive to backends:', text: 'reuse a small pool of upstream connections for many client requests.' },
            { title: 'HTTP/2 to backends:', text: 'multiplex many requests over one upstream connection.' },
            { title: 'Several source IPs per LB node:', text: 'each extra IP multiplies the port space.' },
            { title: 'Kernel tuning:', text: 'widen `net.ipv4.ip_local_port_range`, enable `net.ipv4.tcp_tw_reuse` for outgoing connections.' },
          ],
        },
        { type: 'callout', tone: 'key', text: 'Bringing up ephemeral-port exhaustion without being asked is a strong senior signal. It shows you have actually run proxies at scale.' },
      ],
    },
    {
      type: 'quiz',
      q: '1M RPS, and each TLS-terminating core handles ~20K RPS. Roughly how many cores before headroom?',
      options: ['~5', '~50', '~500', '~5,000'],
      answer: 1,
      explain: '1,000,000 ÷ 20,000 = **50 cores**. Then roughly double it for spikes, and add N+2 spare machines for failures and deploys.',
    },
    {
      type: 'quiz',
      q: 'Why is the L4 tier so much cheaper per request than the L7 tier?',
      options: ['It uses UDP', 'It caches responses', 'It forwards packets by 5-tuple and never terminates TLS or parses HTTP', 'It skips health checks'],
      answer: 2,
      explain: 'L4 work per packet is a hash, a table lookup and a rewrite or encapsulation. L7 must finish TCP and TLS handshakes, decrypt, parse HTTP, buffer and re-encrypt.',
    },
  ],
});
