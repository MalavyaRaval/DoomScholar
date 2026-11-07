interviewPhase('design-load-balancer', {
  id: 'wrap-up',
  nav: 'Wrap-up',
  time: '43–45',
  start: 43,
  end: 45,
  title: 'Wrap-up: operations, trade-offs, and your 60-second summary',
  goal: "Close strong: what you'd measure, what you traded away, and a crisp summary.",
  blocks: [
    { type: 'say', who: 'them', text: "We're nearly out of time. How would you operate this, and can you sum it up?" },
    {
      type: 'say',
      who: 'me',
      text: "For operations: the four golden signals per listener, pool and backend.\n\n**Traffic:** RPS, active connections, bytes. **Errors:** 4xx/5xx, split into *LB-generated* vs *backend-generated*, because that tells you whose fault it is. **Latency:** p50/p99 of LB-added time and backend time, measured separately. **Saturation:** CPU, connection-table size, ephemeral ports, and the share of each pool that's healthy.\n\nAccess logs are sampled, trace headers are injected so one request can be followed end to end, and alerts fire on SLO error-budget burn, not individual blips.",
    },
    {
      type: 'table',
      title: 'The trade-offs you made (say them before you are asked)',
      head: ['Decision', 'Chose', 'Gave up'],
      rows: [
        ['Architecture', 'L4 tier + L7 tier', 'An extra hop; more moving parts'],
        ['L4 forwarding', 'DSR over tunnels', 'No L7 features at L4; backend setup'],
        ['Default algorithm', 'P2C least-request', 'Exact optimality, on purpose'],
        ['Affinity', 'Cookie-based, opt-in per pool', 'Perfect balance for those pools'],
        ['Health', 'Active + passive, fail-open', 'Some traffic may reach bad hosts in rare cases'],
        ['Global', 'Anycast + regional VIPs', 'BGP operational complexity'],
        ['Config', 'Pushed snapshots (xDS-style)', 'Brief inconsistency while a push propagates'],
      ],
    },
    {
      type: 'yourturn',
      prompt: 'Give the 60-second summary of your whole design, out loud. Then compare.',
      answer: "\"We built a two-tier load-balancing platform.\n\nA **control plane** stores versioned configs (listeners, rules, pools) and pushes snapshots to every node; nodes keep serving on the last good config if it goes away.\n\nRouters spread flows over an **active-active L4 tier** using BGP and ECMP. L4 nodes use **Maglev** consistent hashing plus a local flow table, so nodes can come and go without breaking connections, and replies return directly via **DSR**.\n\nThe **L7 tier** terminates TLS with SNI, routes by host and path, balances requests with **P2C least-request**, pools upstream connections, and enforces timeouts, **budgeted retries** and **outlier detection**.\n\nActive health checks with rise/fall thresholds and a **panic threshold** avoid cascading ejections; **slow start** and **draining** make deploys safe. Globally, **anycast** sends users to the nearest healthy site.\n\nAt 1M RPS that's roughly 6–8 L7 nodes and a few L4 nodes per region, with N+2 headroom.\"",
    },
    {
      type: 'list',
      title: 'Good questions to ask the interviewer at the end',
      items: [
        'How do your teams handle long-lived gRPC connections today: L7, client-side, or connection-age limits?',
        'During incidents, is the bottleneck usually the LB tier or the backends behind it?',
        "Do you run your own L4 tier, or rely on your cloud provider's?",
      ],
    },
    {
      type: 'callout',
      tone: 'tip',
      text: 'Stop talking by 44:00. A crisp summary beats one more half-finished deep dive. Then hand control back: "Is there an area you\'d like me to go deeper on?"',
    },
  ],
});
