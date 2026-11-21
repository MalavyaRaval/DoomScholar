deepSection('l4-vs-l7', {
  id: 'wild',
  nav: 'In the wild',
  title: 'Who runs what in production',
  goal: 'Name the real L4 and L7 systems at Google, Meta, Cloudflare, GitHub, AWS and Kubernetes, and the pattern they share.',
  card: {
    emoji: '🌍',
    text: `The biggest companies converged on the same shape. **Google** runs Maglev, a software L4 balancer on ordinary Linux servers, in front of its L7 Google Front Ends. **Meta** open-sourced **Katran**, an L4 balancer built on XDP and eBPF in the kernel, in front of its Proxygen-based L7 tier. **Cloudflare** runs its L4 balancer, Unimog, on every server instead of on dedicated boxes. **GitHub** built GLB Director for L4 and runs HAProxy for L7. **AWS** sells the split as products: NLB for L4, ALB for L7. **Lyft** created Envoy, now the L7 proxy inside most service meshes.`,
  },
  blocks: [
    {
      type: 'text',
      md: `Here's where the theory lives. Swipe through the cards below, and watch the same three ideas come back again and again: a **software L4 tier** on commodity servers, **consistent hashing** so any node makes the same choice, and **direct server return** so responses skip the L4 tier. Then an L7 tier behind it that terminates TLS and routes.`,
    },
    {
      type: 'wild',
      title: 'L4 and L7 at real companies',
      items: [
        {
          emoji: '🔍',
          who: 'Google',
          what: 'Maglev (L4) → GFE (L7)',
          tags: ['L4', 'software', 'since 2008'],
          text: `**Maglev** is a software L4 balancer that runs on ordinary Linux servers. Google described it in a 2016 NSDI paper; it has served Google's traffic since 2008. Routers spread packets over Maglev machines with ECMP, each Maglev picks a backend with Maglev hashing and wraps the packet in GRE, and responses go straight back to users without passing through Maglev.

Behind it sit the **Google Front Ends (GFEs)**, the L7 proxies that terminate TLS and route requests to services. Google Cloud's load balancers reuse the same pieces: the external passthrough Network Load Balancer is built on Maglev, and the global external Application Load Balancer runs on GFEs.`,
        },
        {
          emoji: '🐝',
          who: 'Meta',
          what: 'Katran (L4) → Proxygen (L7)',
          tags: ['L4', 'XDP + eBPF', 'open source 2018'],
          text: `**Katran** is Meta's L4 balancer, open-sourced in 2018. It runs inside the Linux kernel using **XDP and eBPF**, handling each packet right after the network card receives it, before the normal network stack. It uses a Maglev-style consistent hash, encapsulates packets with IP-in-IP, and the backends reply directly to users.

Katran replaced an earlier IPVS-based balancer. Because XDP doesn't need dedicated busy-polling cores the way kernel-bypass designs do, it can share machines with other work. Behind it, Meta's L7 tier is built on **Proxygen**, its open-source C++ HTTP framework.`,
        },
        {
          emoji: '🟠',
          who: 'Cloudflare',
          what: 'Unimog (L4) + Pingora (L7)',
          tags: ['L4 + L7', 'anycast', 'on every server'],
          text: `Cloudflare announces the same **anycast** IP addresses from every data center, so internet routing delivers you to a nearby one. Inside a data center, its L4 balancer **Unimog**, built on XDP, runs on **every server** instead of on dedicated balancer machines. Any server can receive a packet and forward it to the server that should handle that connection.

For L7, Cloudflare built **Pingora**, a proxy framework written in Rust that replaced much of its NGINX-based stack. It was open-sourced in 2024.`,
        },
        {
          emoji: '🐙',
          who: 'GitHub',
          what: 'GLB Director (L4) + HAProxy (L7)',
          tags: ['L4', 'DPDK', 'open source 2018'],
          text: `**GLB Director** is GitHub's L4 balancer, open-sourced in 2018. It uses DPDK for fast packet processing and is designed to be **stateless**: each packet is encapsulated (in GUE) along with a primary and a secondary backend, chosen by a variant of rendezvous hashing.

If the primary doesn't recognize the connection, for example right after the backend set changed, it forwards the packet to the secondary. GitHub calls this a "second chance". Behind GLB Director, GitHub runs **HAProxy** as its L7 tier.`,
        },
        {
          emoji: '☁️',
          who: 'AWS',
          what: 'NLB (L4), ALB (L7), GWLB (L3)',
          tags: ['managed', 'L3 + L4 + L7'],
          text: `AWS sells the split as separate products. The **Network Load Balancer** (2017) is L4: TCP, UDP and TLS listeners, a static IP per availability zone, client IP preservation, and very high connection rates. It runs on AWS's internal Hyperplane platform. The **Application Load Balancer** (2016) is L7: host and path rules, HTTP/2, gRPC, WebSockets and built-in authentication.

The **Gateway Load Balancer** (2020) works at L3: it steers packets, wrapped in GENEVE, through fleets of firewalls and inspection appliances. The original Classic Load Balancer (2009) mixed L4 and L7 features in one product.`,
        },
        {
          emoji: '☸️',
          who: 'Kubernetes',
          what: 'Services (L4) + Ingress / Gateway API (L7)',
          tags: ['L4 + L7', 'open source'],
          text: `A Kubernetes **Service** gets a virtual IP. **kube-proxy** on every node turns traffic to that IP into traffic to a real pod using iptables or IPVS rules: L4 load balancing by destination NAT, done on every node. **Cilium** can replace kube-proxy with eBPF, including Maglev hashing and DSR.

For HTTP, an **Ingress** controller or the newer, more expressive **Gateway API** adds an L7 tier, usually NGINX, HAProxy or an Envoy-based proxy. On a cloud, a Service of \`type: LoadBalancer\` also provisions a cloud L4 balancer in front of the nodes.`,
        },
        {
          emoji: '🚕',
          who: 'Lyft',
          what: 'Envoy (L7)',
          tags: ['L7', 'open source 2016', 'CNCF'],
          text: `Lyft built **Envoy** while breaking its monolith into microservices, and open-sourced it in 2016. It's an L7 proxy designed to run both at the edge and as a **sidecar** next to every service instance, configured dynamically over APIs (xDS), with retries, circuit breaking, outlier detection and detailed metrics built in.

Envoy graduated from the CNCF in 2018. It is the data plane of Istio and many other service meshes and API gateways.`,
        },
        {
          emoji: '🎬',
          who: 'Netflix',
          what: 'Zuul (L7 gateway) + client-side balancing',
          tags: ['L7', 'edge gateway'],
          text: `Netflix's edge gateway **Zuul** sits behind AWS load balancers and handles routing, authentication, canary testing and load shedding for API traffic. Zuul 2, rebuilt on asynchronous, non-blocking I/O with Netty, was open-sourced in 2018.

Inside, Netflix relied for years on **client-side** load balancing with its Ribbon library: each service looked up instances in the Eureka registry and picked one itself, with no middle-tier proxy at all.`,
        },
        {
          emoji: '🐧',
          who: 'Linux',
          what: 'IPVS / LVS (L4)',
          tags: ['L4', 'in the kernel', 'since 1998'],
          text: `The **Linux Virtual Server** project, started in 1998, put L4 load balancing into the kernel as **IPVS**. It supports NAT, direct routing (DSR at L2) and IP tunneling, with schedulers such as round robin, least connections and source hashing.

It's still everywhere: kube-proxy's IPVS mode, Docker Swarm's routing mesh, and countless keepalived + IPVS pairs in on-premises data centers.`,
        },
      ],
    },
    {
      type: 'text',
      md: `Notice what didn't make the list: big hardware appliances. Boxes from F5 (BIG-IP) and Citrix (NetScaler) still run in many enterprises, banks and telecoms, and they do both L4 and L7. But the companies operating at the very largest scale moved to **software on commodity servers**, because software scales out one cheap machine at a time and ships fixes on their own schedule instead of a vendor's.

The other quiet trend is **pushing balancing into the client or sidecar**. gRPC clients can balance per request themselves, and service meshes put an L7 proxy next to every instance. The L4 and L7 tiers at the edge stay, but the last hop increasingly happens one process away from the code.`,
    },
    {
      type: 'quiz',
      q: 'What do Google\'s Maglev and Meta\'s Katran have in common?',
      options: ['Both are L7 proxies that terminate TLS', 'Both are dedicated hardware appliances', 'Both are DNS-based global balancers', 'Both are software L4 balancers on commodity servers'],
      answer: 3,
      explain: 'Both run on ordinary Linux servers, use Maglev-style consistent hashing, and let backends reply directly. Their L7 tiers (GFEs and Proxygen) sit behind them.',
    },
    {
      type: 'quiz',
      q: 'In Kubernetes, what does kube-proxy do with a Service\'s virtual IP?',
      options: ['Terminates TLS for the Service', 'Programs iptables/IPVS rules on each node that NAT the virtual IP to pod IPs', 'Runs DNS for the whole cluster', 'Routes requests by HTTP path'],
      answer: 1,
      explain: 'kube-proxy does L4 balancing with destination NAT rules on every node. Path routing and other L7 features come from an Ingress or Gateway API controller.',
    },
  ],
});
