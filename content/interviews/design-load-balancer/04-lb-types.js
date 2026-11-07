interviewPhase('design-load-balancer', {
  id: 'lb-types',
  nav: 'L4 vs L7 + types',
  time: '15–20',
  start: 15,
  end: 20,
  title: 'L4 vs L7, forwarding modes, and every type of load balancer',
  goal: 'Prove you know what actually happens to the packets in each kind of load balancer.',
  blocks: [
    { type: 'say', who: 'them', text: 'You mentioned L4 and L7. What exactly is the difference, and how does your L4 tier forward traffic?' },
    {
      type: 'say',
      who: 'me',
      text: "An **L4** balancer works on TCP/UDP flows. It sees IPs and ports, picks a backend **per connection** (or per UDP flow) and moves packets. It never reads the payload, so it can't route by URL, but it's fast and works for any protocol.\n\nAn **L7** balancer terminates the client connection, parses HTTP and decides **per request**: route by host, path or header, retry, rewrite, add headers.",
    },
    {
      type: 'table',
      title: 'L4 vs L7',
      head: ['', 'L4 (transport)', 'L7 (application)'],
      rows: [
        ['Sees', 'IPs, ports, TCP flags', 'Method, host, path, headers, cookies, body'],
        ['Balances', 'Connections / flows', 'Individual requests'],
        ['TLS', 'Passes it through untouched', 'Terminates it; can re-encrypt'],
        ['Cost', 'Very low per packet', 'High: TLS + parsing + buffering'],
        ['Superpowers', 'Any protocol, huge throughput, fast failover', 'Path routing, retries, rewrites, observability per request'],
        ['Examples', 'AWS NLB, Google Maglev, Facebook Katran, Linux IPVS', 'NGINX, HAProxy, Envoy, AWS ALB'],
      ],
    },
    { type: 'say', who: 'me', text: 'For the L4 tier there are three forwarding modes, and the choice matters a lot:' },
    {
      type: 'list',
      items: [
        { title: 'NAT (destination NAT):', text: "the LB rewrites the destination IP to the backend's. Replies must come back through the LB to be un-NATed, so the LB carries **both directions**, including the big responses." },
        { title: 'Full proxy:', text: 'the LB terminates TCP and opens a separate connection to the backend. Most flexible, most expensive. This is what every L7 proxy does.' },
        { title: 'DSR (direct server return):', text: 'the LB only handles the **inbound** direction. It forwards packets unchanged, via a MAC rewrite or an IP-in-IP / GUE tunnel. The backend owns the VIP on a loopback interface and replies **straight to the client**.' },
      ],
    },
    {
      type: 'diagram',
      title: 'DSR: responses skip the load balancer',
      diagram: {
        h: 290,
        nodes: [
          { id: 'c', x: 60, y: 145, label: 'Client', icon: '👤', shape: 'pill' },
          { id: 'lb', x: 255, y: 55, label: 'L4 LB', icon: '⚖️', tone: 'accent' },
          { id: 'b', x: 255, y: 240, label: 'Backend', icon: '🖥️' },
        ],
        edges: [
          { from: 'c', to: 'lb', flow: true, label: 'request' },
          { from: 'lb', to: 'b', flow: true, label: 'tunnel' },
          { from: 'b', to: 'c', flow: true, tone: 'good', label: 'direct reply' },
        ],
      },
      caption: 'Responses are often 10–100× larger than requests. With DSR the LB never carries them, so one L4 node can front far more traffic.',
    },
    {
      type: 'callout',
      tone: 'warn',
      title: 'The DSR catch',
      text: "The LB never sees the server's half of the conversation. So DSR is **L4-only**: no TLS termination, no HTTP routing, harder TCP state tracking. And every backend must accept packets addressed to the VIP (a loopback alias plus ARP suppression, or tunnel decapsulation).",
    },
    { type: 'say', who: 'them', text: 'What other kinds of load balancing exist beyond a box in the datacenter?' },
    { type: 'say', who: 'me', text: 'Load balancing happens at several layers, and large systems stack them. Here is the whole map:' },
    {
      type: 'table',
      title: 'Every type of load balancer, compared',
      head: ['Type', 'How it works', 'Good at', 'Weak at'],
      rows: [
        ['DNS round robin / GeoDNS', 'Return different IPs per query, or by client location', 'Global reach, cheap, no box on the data path', 'Slow failover (TTL caching); clients pick blindly'],
        ['Anycast + BGP', 'The same IP is announced from many sites; internet routing picks the nearest', 'Global failover in seconds; spreads DDoS', 'Route changes can move live TCP flows'],
        ['Hardware appliance (F5, Citrix)', 'Dedicated boxes with custom ASICs', 'Raw throughput, vendor support', 'Cost, scales in big steps, lock-in'],
        ['Software L4 (IPVS, Katran, Maglev)', 'Kernel / XDP / DPDK packet forwarding on commodity servers', 'Millions of packets/s per server, scales out', 'No L7 features'],
        ['Software L7 proxy (NGINX, HAProxy, Envoy)', 'User-space proxy terminating TLS and HTTP', 'Rich routing, retries, per-request metrics', 'CPU-heavy per request'],
        ['Cloud managed (ALB, NLB, GCP LB)', 'The provider runs the fleet for you', 'Zero ops, elastic', 'Less control; cost at huge scale'],
        ['Client-side (gRPC, Finagle)', 'Clients fetch the server list and choose themselves', 'No extra hop; per-request balancing', 'Every client library must implement it'],
        ['Service mesh sidecar (Envoy / Istio)', 'A local proxy beside every service instance', 'Uniform policy, mTLS, retries everywhere', 'Extra hop and resources per instance'],
      ],
    },
    {
      type: 'deep',
      title: 'Go deeper: why HTTP/2 and gRPC break L4 balancing',
      blocks: [
        {
          type: 'text',
          md: 'gRPC sends all of a client\'s requests over **one long-lived HTTP/2 connection**. An L4 balancer chooses a backend only when a connection opens, so one chatty client pins all its traffic to one backend **forever**. Scale from 3 to 6 backends and the new 3 sit idle, because existing connections never move.',
        },
        {
          type: 'list',
          title: 'Fixes',
          items: [
            'Use an **L7** balancer that balances each HTTP/2 stream (request) independently.',
            'Or **client-side** balancing: the gRPC client keeps connections to many backends and spreads requests itself.',
            'Or cap connection age on the server (gRPC `MAX_CONNECTION_AGE`), so clients reconnect periodically and rebalance.',
          ],
        },
      ],
    },
    {
      type: 'deep',
      title: 'Go deeper: real configs (NGINX for L7, HAProxy for L4)',
      blocks: [
        {
          type: 'code',
          title: 'L7 HTTP load balancing in NGINX',
          lang: 'nginx',
          code: `upstream cart_v2 {
    least_conn;                        # algorithm
    server 10.1.4.12:8080 weight=3 max_fails=3 fail_timeout=10s;
    server 10.1.4.13:8080 weight=1;
    server 10.1.4.14:8080 backup;      # only used if the others fail
    keepalive 64;                      # pooled upstream connections
}

server {
    listen 443 ssl;
    http2 on;
    server_name api.shop.com;
    ssl_certificate     /etc/ssl/shop.crt;
    ssl_certificate_key /etc/ssl/shop.key;

    location /cart/ {
        proxy_pass http://cart_v2;
        proxy_http_version 1.1;        # required for upstream keepalive
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_connect_timeout 1s;
        proxy_read_timeout 10s;
        proxy_next_upstream error timeout http_502 http_503;
        proxy_next_upstream_tries 2;   # retry on another server, once
    }
}`,
          caption: 'Note `proxy_next_upstream`: NGINX only retries non-idempotent requests (POST, etc.) if you explicitly add `non_idempotent`. Safe by default.',
        },
        {
          type: 'code',
          title: 'L4 TCP load balancing in HAProxy (Postgres read replicas)',
          lang: 'haproxy',
          code: `frontend pg_in
    mode tcp
    bind :5432
    default_backend pg_replicas

backend pg_replicas
    mode tcp
    balance leastconn
    option tcp-check                  # active TCP health check
    default-server inter 2s rise 2 fall 3
    server pg1 10.2.0.11:5432 check
    server pg2 10.2.0.12:5432 check`,
          caption: '`rise 2 fall 3`: two passing checks to be added back, three failures to be pulled out. `mode tcp` means HAProxy never parses the Postgres protocol.',
        },
      ],
    },
    {
      type: 'quiz',
      q: 'One gRPC client sends 90% of all traffic. An L4 LB sits in front of 10 backends. What happens?',
      options: [
        'Load spreads evenly across all 10',
        'Most of the load lands on one backend, because its single HTTP/2 connection is pinned there',
        'The LB converts gRPC to REST',
        'The LB rejects HTTP/2',
      ],
      answer: 1,
      explain: 'L4 balances connections, not requests. One long-lived HTTP/2 connection = one backend. Use L7 (per-stream) or client-side balancing.',
    },
    {
      type: 'quiz',
      q: 'In DSR mode, which traffic passes through the load balancer?',
      options: ['Both requests and responses', 'Only responses', 'Only client → server packets', 'Neither; DNS handles everything'],
      answer: 2,
      explain: 'The LB forwards inbound packets; the backend replies directly to the client using the VIP as its source address.',
    },
  ],
});
