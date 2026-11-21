registerDeepDive({
  id: 'edge-in-depth',
  title: 'DNS, Anycast & CDNs, in Depth',
  short: 'Edge deep',
  emoji: '🛰️',
  color: '#0284c7',
  related: 'cdn',
  tagline: 'How a name becomes an address, how one IP lives in 300 cities, and what a CDN really does',
  hook: 'Before your request reaches any server, DNS, BGP and a CDN have already decided where it goes. Here is how each one makes that call.',
  intro: `The quick cards told you a CDN puts content close to users. This deep dive covers the machinery that makes "close" happen: the **DNS** lookup that turns a name into an address, the **CNAME** that hands your hostname to a CDN, the **GeoDNS** and **anycast** tricks that steer you to a nearby site, and the caches, keys and headers that decide what gets served from the edge.

You'll walk through a cold DNS lookup and a CDN cache miss step by step, see how Cloudflare, Akamai, Netflix, Fastly and AWS each solve the problem differently, and diagnose real failures, including the day Facebook took its own DNS off the internet.

Every part ends with a checkpoint, and its first paragraph also plays in your feed. You'll meet these ideas more than once, on purpose.`,
  recap: [
    'DNS resolves through stub → recursive → root → TLD → authoritative, cached per TTL',
    'CDNs take over your hostname with a CNAME, then steer users to a PoP',
    'Anycast announces one IP from many sites over BGP; failover means withdrawing routes',
    'Cache keys and Cache-Control decide what the edge stores and for how long',
    'Classic failures: long TTLs, purge stampedes, leaked personal pages, BGP mistakes',
  ],
});

deepSection('edge-in-depth', {
  id: 'resolution',
  nav: 'A DNS lookup',
  title: 'How a DNS lookup actually works',
  goal: 'Walk a cold lookup from your laptop to the authoritative server and back, and know who caches what.',
  card: {
    emoji: '📇',
    text: `When you type \`shop.example.com\`, your device's **stub resolver** asks a **recursive resolver**: your ISP's, or a public one like 8.8.8.8 or 1.1.1.1. On a cold cache, the resolver walks the hierarchy. A **root** server points it to the \`.com\` servers, those point to the domain's **authoritative** name servers, and the authoritative server returns the actual address. Every answer carries a **TTL**, and every layer (browser, operating system, resolver) caches it for that long. Caching is why DNS is fast, and also why DNS changes are slow.`,
  },
  blocks: [
    {
      type: 'text',
      md: `DNS is a **distributed, hierarchical, heavily cached database**. Its names form a tree: the root (written as a single dot) at the top, then top-level domains like \`.com\`, \`.org\` and \`.uk\`, then domains like \`example.com\`, then names inside them like \`shop.example.com\`.

No server knows the whole tree. Each level only knows who is responsible for the level below it. That's called **delegation**: the root delegates \`.com\` to Verisign's servers, and \`.com\` delegates \`example.com\` to whichever name servers its owner chose. To answer a question, someone has to follow that chain of delegations, and that someone is the recursive resolver.

Four roles do all the work. The **stub resolver** lives in your operating system and is deliberately simple: it sends the question to one configured resolver and trusts the reply. The **recursive resolver** does the legwork and caches everything it learns. The **root** and **TLD** servers only hand out referrals ("ask them, not me"). The **authoritative** server for a zone holds the real records and gives the final answer.`,
    },
    {
      type: 'stepper',
      title: 'A cold lookup for shop.example.com',
      diagram: {
        h: 300,
        nodes: [
          { id: 'app', x: 62, y: 60, label: 'Browser\n+ OS stub', icon: '💻' },
          { id: 'res', x: 62, y: 215, label: 'Recursive\nresolver', icon: '🔁', tone: 'accent' },
          { id: 'root', x: 290, y: 50, label: 'Root (.)', icon: '🌳' },
          { id: 'tld', x: 290, y: 150, label: 'TLD (.com)', icon: '🏷️' },
          { id: 'auth', x: 290, y: 250, label: 'Authoritative', icon: '📜' },
        ],
        edges: [
          { from: 'app', to: 'res', bi: true, flow: true },
          { from: 'res', to: 'root', bi: true },
          { from: 'res', to: 'tld', bi: true },
          { from: 'res', to: 'auth', bi: true },
        ],
      },
      steps: [
        {
          title: 'Check the local caches',
          focus: ['app'],
          text: 'The browser checks its own DNS cache, then asks the operating system. The OS stub resolver checks its cache and the hosts file. If nobody has a fresh answer, the stub forwards the question to the one resolver it is configured to use.',
        },
        {
          title: 'Ask the recursive resolver',
          focus: ['app', 'app>res', 'res'],
          text: 'The query `shop.example.com A?` goes to the recursive resolver, classically over UDP port 53, or encrypted with DNS over HTTPS or DNS over TLS. If the resolver has a fresh cached answer, you are done in a few milliseconds. Assume it doesn\'t.',
        },
        {
          title: 'Ask a root server',
          focus: ['res', 'res>root', 'root'],
          text: 'The resolver asks a root server. The root doesn\'t know `shop.example.com`. It answers with a **referral**: "here are the name servers for `.com`". Resolvers ship with a built-in list of root server addresses, the root hints, so this step can always start.',
        },
        {
          title: 'Ask a .com TLD server',
          focus: ['res', 'res>tld', 'tld'],
          text: 'The resolver asks a `.com` server, which also refers: "`example.com` is served by these name servers". When those name servers live inside the zone they serve, like `ns1.example.com`, the TLD also returns their addresses, called **glue records**, to break the chicken-and-egg loop.',
        },
        {
          title: 'Ask the authoritative server',
          focus: ['res', 'res>auth', 'auth'],
          text: 'The authoritative server for `example.com` holds the zone and gives the real answer: `shop.example.com. 300 IN A 203.0.113.10`. The 300 is the TTL in seconds. It might answer with a CNAME instead, which sends the resolver off to look up another name (next part).',
        },
        {
          title: 'Cache everything, answer the stub',
          focus: ['app', 'app>res', 'res'],
          text: 'The resolver caches every piece it learned: the `.com` referral (for days), the `example.com` name servers, and the final answer for 300 seconds. It returns the address to your OS, which caches it too, and the browser opens a connection. The next user of that resolver gets the answer straight from cache.',
        },
      ],
    },
    {
      type: 'text',
      md: `**Caching is the whole trick.** Every record has a TTL chosen by the zone's owner, and every cache counts it down. When a resolver hands you a cached record, it gives you the *remaining* TTL, so your operating system only keeps it for whatever time is left.

Because popular names and TLD referrals are almost always cached at big resolvers, full walks from the root are rare. That's why the root servers, which in principle sit above every lookup on the internet, handle a manageable load. Even "this name doesn't exist" gets cached: a negative answer (NXDOMAIN) is remembered for a time the zone sets in its SOA record, so typos don't hammer authoritative servers either.

One detail matters for everything that follows: the authoritative server never talks to you. It talks to your **recursive resolver**. When a CDN's DNS decides which edge to send you to, it is really deciding based on where your resolver is. Part 3 is all about the consequences.`,
    },
    {
      type: 'code',
      title: 'Watch a TTL count down in a resolver\'s cache',
      lang: 'text',
      code: `$ dig shop.example.com A +noall +answer
shop.example.com.   300   IN   A   203.0.113.10

# two minutes later, same resolver
$ dig shop.example.com A +noall +answer
shop.example.com.   180   IN   A   203.0.113.10`,
      caption: 'The second answer came from cache, so the TTL shows the time left (180 of 300 seconds). When it reaches zero, the resolver asks the authoritative server again.',
    },
    {
      type: 'stats',
      stats: [
        { value: '13', label: 'root server identities, a.root-servers.net to m.root-servers.net' },
        { value: '12', label: 'independent organizations operating them' },
        { value: '1,000+', label: 'root server instances worldwide, thanks to anycast' },
        { value: 'UDP 53', label: 'the classic DNS transport (TCP for large answers)' },
      ],
      caption: 'The "13" is historical: all root addresses had to fit in a single 512-byte UDP response. Anycast (part 4) is how 13 identities became over a thousand machines.',
    },
    {
      type: 'deep',
      title: 'Go deeper: encrypted DNS, and why your resolver choice matters',
      blocks: [
        {
          type: 'text',
          md: `Classic DNS is unencrypted, so anyone on the path (your Wi-Fi, your ISP) can see and even tamper with which names you look up. Two standards fix the transport: **DNS over TLS** (DoT, port 853) and **DNS over HTTPS** (DoH, regular HTTPS on port 443). Browsers and operating systems can now send DNS straight to a resolver like 1.1.1.1 or 8.8.8.8 over DoH.

Encryption protects the hop between you and the resolver. It doesn't hide your queries from the resolver itself, so picking a resolver is a trust decision. It's also a performance decision: as you'll see in part 3, a CDN chooses your edge based largely on your resolver's location, so a far-away resolver can mean a far-away edge.`,
        },
      ],
    },
    {
      type: 'quiz',
      q: 'On a cold cache, which server finally returns the IP address for shop.example.com?',
      options: ['A root server', 'The domain\'s authoritative name server', 'A .com TLD server', 'The operating system\'s stub resolver'],
      answer: 1,
      explain: 'Root and TLD servers only hand out **referrals** down the tree. The **authoritative** server holds the zone and returns the real record, with its TTL.',
    },
    {
      type: 'quiz',
      q: 'Why aren\'t the root servers overwhelmed by every DNS lookup on the internet?',
      options: ['Browsers skip the root for popular sites', 'Only ISPs may query them', 'Root servers answer only on weekdays', 'Resolvers cache TLD referrals for days, so root queries are rare'],
      answer: 3,
      explain: 'A resolver that has the `.com` referral cached never needs the root for any `.com` name until it expires. Anycast spreads the remaining load over many root instances.',
    },
  ],
});

deepSection('edge-in-depth', {
  id: 'records',
  nav: 'Records & CNAMEs',
  title: 'Records, delegation and the CNAME trick',
  goal: 'Read a zone file, and explain exactly how a CNAME hands your hostname to a CDN.',
  card: {
    emoji: '🏷️',
    text: `DNS stores typed records. **A** maps a name to an IPv4 address and **AAAA** to an IPv6 address. **NS** names the authoritative servers for a zone, which is how delegation works. **TXT** holds free-form text, used to prove domain ownership and for email security. **CNAME** says "this name is an alias: go look up that other name instead". CDNs live on CNAMEs. You point \`www.example.com\` at a hostname the CDN controls, and from then on the CDN's own DNS decides which edge address each user gets.`,
  },
  blocks: [
    {
      type: 'text',
      md: `Every DNS record has the same five parts: a **name**, a **TTL**, a class (always \`IN\` for internet in practice), a **type**, and the **data**. A zone's records are traditionally written in a zone file, one record per line. Modern DNS providers give you a web console or an API instead, but the records underneath are the same.`,
    },
    {
      type: 'table',
      title: 'The record types you will actually meet',
      head: ['Type', 'Holds', 'Example data', 'Used for'],
      rows: [
        ['A', 'An IPv4 address', '`203.0.113.10`', 'Pointing a name at a server or load balancer'],
        ['AAAA', 'An IPv6 address', '`2001:db8::10`', 'The same, for IPv6'],
        ['CNAME', 'Another name (an alias)', '`example.cdnprovider.net.`', 'Handing a hostname to a CDN or SaaS service'],
        ['NS', 'Authoritative name servers', '`ns1.dnsprovider.net.`', 'Delegating a zone or subdomain'],
        ['SOA', 'Zone metadata', 'serial, refresh timers, negative TTL', 'Zone management, negative caching'],
        ['MX', 'Mail servers, with priority', '`10 mail.example.com.`', 'Where to deliver email for the domain'],
        ['TXT', 'Free-form text', '`"v=spf1 … -all"`', 'Ownership checks, SPF, DKIM, DMARC'],
        ['CAA', 'Allowed certificate authorities', '`0 issue "letsencrypt.org"`', 'Limiting who may issue TLS certificates'],
        ['HTTPS / SVCB', 'Connection hints', '`alpn="h2,h3"`', 'Telling browsers a site speaks HTTP/3 before connecting'],
      ],
    },
    {
      type: 'code',
      title: 'A small zone, simplified',
      lang: 'text',
      code: `; zone: example.com
example.com.        86400  IN  NS     ns1.dnsprovider.net.
example.com.        86400  IN  NS     ns2.dnsprovider.net.
example.com.          300  IN  A      203.0.113.10
www.example.com.      300  IN  CNAME  example.cdnprovider.net.
example.com.         3600  IN  MX     10 mail.example.com.
example.com.         3600  IN  TXT    "v=spf1 include:_spf.mailhost.net -all"`,
      caption: 'The apex (`example.com`) has an A record straight to an origin. `www` is a CNAME, so a CDN answers for it. Lines starting with `;` are comments.',
    },
    {
      type: 'stepper',
      title: 'Following a CNAME into a CDN',
      diagram: {
        h: 300,
        nodes: [
          { id: 'br', x: 58, y: 255, label: 'Browser', icon: '💻', shape: 'pill' },
          { id: 'res', x: 62, y: 120, label: 'Recursive\nresolver', icon: '🔁', tone: 'accent' },
          { id: 'auth', x: 285, y: 45, label: 'example.com\nDNS', icon: '📜' },
          { id: 'cdn', x: 285, y: 150, label: 'CDN DNS', icon: '🗺️', tone: 'accent' },
          { id: 'edge', x: 285, y: 255, label: 'Edge\nserver', icon: '🏢', tone: 'good' },
        ],
        edges: [
          { from: 'br', to: 'res', bi: true },
          { from: 'res', to: 'auth', bi: true },
          { from: 'res', to: 'cdn', bi: true },
          { from: 'br', to: 'edge', flow: true, label: 'HTTPS' },
        ],
      },
      steps: [
        {
          title: 'www is an alias',
          focus: ['res', 'res>auth', 'auth'],
          text: 'The resolver asks `example.com`\'s authoritative servers for `www.example.com` and gets back a CNAME: "that name is really `example.cdnprovider.net`". The owner of `example.com` no longer decides the final address.',
        },
        {
          title: 'Resolve the CDN\'s name',
          focus: ['res', 'res>cdn', 'cdn'],
          text: 'The resolver starts a fresh lookup for `example.cdnprovider.net`. The `.net` referral is almost certainly cached, so it goes straight to the **CDN\'s own authoritative name servers**.',
        },
        {
          title: 'The CDN picks an edge',
          focus: ['cdn'],
          text: 'The CDN\'s DNS looks at who is asking (the resolver\'s address), plus its view of server load and health, and answers with the address of a nearby edge. The TTL is short, often under a minute, so it can re-steer traffic quickly.',
        },
        {
          title: 'Connect to the edge',
          focus: ['br', 'br>res', 'br>edge', 'edge'],
          text: 'The resolver returns the whole chain (CNAME plus the final A record) to your device, and the browser opens a TLS connection to the edge server. From here on, part 5 takes over.',
        },
      ],
    },
    {
      type: 'callout',
      tone: 'trap',
      title: 'The apex problem',
      text: `You can't put a CNAME at the **zone apex** (\`example.com\` itself). A CNAME must be the only record at its name, and the apex must hold the zone's SOA and NS records. DNS providers work around it with non-standard tricks: **CNAME flattening** (Cloudflare) or **alias** records (Route 53), where the authoritative server resolves the target itself and returns plain A and AAAA records. That's why many sites redirect \`example.com\` to \`www.example.com\`: \`www\` can be a normal CNAME.`,
    },
    {
      type: 'text',
      md: `Two more record types deserve a sentence each.

**NS records are delegation.** Changing your domain's name servers at the registrar updates the NS records in the parent zone, which moves control of the whole zone to a new provider. The \`.com\` servers hand out those delegation records with a two-day TTL, so a name server change can take a couple of days to be seen everywhere. Plan migrations around that.

**TXT records are proof.** When a service asks you to "add this TXT record", it's checking that you control the domain: Google and Microsoft do this for domain verification, and Let's Encrypt's DNS-01 challenge does it before issuing a certificate. Email security lives in TXT records too: SPF lists the servers allowed to send your mail, and DKIM and DMARC publish signing keys and policies.`,
    },
    {
      type: 'quiz',
      q: 'You put your site behind a CDN. Which record do you usually create for www.example.com?',
      options: ['A CNAME to a hostname the CDN controls', 'An A record pointing at your origin\'s IP', 'A TXT record containing the origin\'s IP', 'One NS record per edge server'],
      answer: 0,
      explain: 'The CNAME hands the name to the CDN. The CDN\'s own DNS then answers with a nearby edge for each resolver, something a fixed A record can\'t do.',
    },
    {
      type: 'quiz',
      q: 'Why can\'t you put a plain CNAME at the zone apex, example.com?',
      options: ['CNAMEs only work for IPv6', 'Browsers refuse to follow CNAMEs at the apex', 'A CNAME can\'t share its name with other records, and the apex needs SOA and NS', 'The apex can only hold TXT records'],
      answer: 2,
      explain: 'A CNAME must stand alone at its name. The apex always has SOA and NS records, so providers use CNAME flattening or alias records that return plain addresses instead.',
    },
  ],
});

deepSection('edge-in-depth', {
  id: 'geodns',
  nav: 'GeoDNS',
  title: 'GeoDNS: steering users with different answers',
  goal: 'Explain how DNS-based steering works, what it can\'t see, and why DNS failover takes minutes.',
  card: {
    emoji: '🧭',
    text: `**GeoDNS** steers users by giving different answers to different askers. The authoritative server checks where a query comes from and returns the address of a nearby, healthy site, often with a TTL under a minute. The catch: it sees your **recursive resolver's** address, not yours, so a user on a far-away resolver can be sent to the wrong continent. And DNS failover is slow, because resolvers, operating systems, browsers and apps all cache answers, and some hold them longer than the TTL says. Steering by DNS is powerful, but never instant.`,
  },
  blocks: [
    {
      type: 'text',
      md: `A normal authoritative server gives everyone the same answer. A **GeoDNS** (or traffic-steering) server answers each query on purpose: it looks at the source address of the query, maps it to a location and network using an IP geolocation database, checks which of your sites are healthy, and returns the best one.

Managed DNS services package this as **routing policies**. Route 53, for example, offers geolocation, latency-based, weighted and failover routing, all backed by health checks that probe your endpoints every 10 or 30 seconds. CDNs that steer with DNS run the same idea at a much finer grain, choosing among thousands of server clusters instead of a few regions.`,
    },
    {
      type: 'tabs',
      title: 'Four ways to steer with DNS',
      tabs: [
        {
          label: 'Geo',
          blocks: [{ type: 'text', md: 'Map the asker\'s country or continent to an endpoint: European users get the Frankfurt address, Indian users get Mumbai. It\'s also how teams meet **data residency** rules, keeping EU users on EU servers. It\'s only as accurate as the geolocation database and, crucially, the resolver\'s location.' }],
        },
        {
          label: 'Latency',
          blocks: [{ type: 'text', md: 'The provider continuously measures latency from networks around the world to each of your regions, then answers with the region that is fastest from the asker\'s network. That\'s usually better than geography: the nearest city on a map isn\'t always the fastest one over the actual cables.' }],
        },
        {
          label: 'Weighted',
          blocks: [{ type: 'text', md: 'Answer with endpoint A 90% of the time and endpoint B 10% of the time. Teams use it for canary releases of a new region or provider, and for gradual migrations: move 1%, then 10%, then everything, watching error rates at each step.' }],
        },
        {
          label: 'Failover',
          blocks: [{ type: 'text', md: 'Answer with the primary while its health checks pass, and switch to the secondary when they fail. Simple and popular for disaster recovery, but read the next section before you promise anyone a 30-second failover.' }],
        },
      ],
    },
    {
      type: 'text',
      md: `**The resolver problem.** The authoritative server sees the address of the recursive resolver that asked, not the user behind it. Usually that's fine, because ISP resolvers sit near their customers and the big public resolvers run in many cities. But a user in Tokyo whose laptop is configured to use a resolver in Europe will look European, and may be sent to a European edge.

The fix is **EDNS Client Subnet** (ECS): the resolver attaches a truncated version of the user's address, typically the first 24 bits of an IPv4 address, so the authoritative server can steer by the user's network instead. Google Public DNS sends ECS to authoritative servers that support it. Cloudflare's 1.1.1.1 deliberately doesn't, trading a little steering precision for privacy. ECS also makes caching harder, since the resolver now has to cache answers per subnet.`,
    },
    {
      type: 'list',
      title: 'Why DNS failover takes minutes, not seconds',
      items: [
        { title: 'Cached answers live out their TTL.', text: 'A resolver that cached the old address keeps serving it until the TTL expires. Lowering the TTL now doesn\'t shorten copies that are already cached.' },
        { title: 'Health checks need time to decide.', text: 'A checker probing every 30 seconds that needs three failures takes over a minute just to declare the site down.' },
        { title: 'Not every cache respects the TTL.', text: 'Some resolvers enforce a minimum TTL, and many serve stale answers when they can\'t reach the authoritative server, by design.' },
        { title: 'Apps cache too.', text: 'Some runtimes, libraries and connection pools cache resolved addresses on their own, sometimes for the life of the process.' },
        { title: 'Open connections don\'t re-resolve.', text: 'A browser or service with a keep-alive connection to the old address keeps using it until that connection breaks.' },
      ],
    },
    {
      type: 'callout',
      tone: 'tip',
      title: 'The migration playbook',
      text: 'Lower the TTL to 60 to 300 seconds **at least one old TTL in advance** (a day early, if the old TTL was a day). Wait. Make the change. Keep the old servers running, or proxying to the new ones, until their traffic drains to zero. Only then shut them down, and raise the TTL again.',
    },
    {
      type: 'yourturn',
      prompt: 'Interviewer: "You have an active region and a standby region, with DNS failover between them. How fast is failover, and how would you make it faster?"',
      answer: `Realistically, **minutes**: health checks take a minute or so to declare the primary dead, then cached answers age out over the TTL (say 60 seconds), with a long tail of clients and resolvers that hold on longer. Many users recover in two or three minutes, some take much longer.

To go faster, take DNS off the critical path: put both regions behind a **stable anycast IP** (a global load balancer such as AWS Global Accelerator or a CDN's load balancing) that can shift traffic behind the same address without any DNS change. Make clients retry against a second endpoint, and keep the standby warm so it can take the load immediately.`,
    },
    {
      type: 'quiz',
      q: 'GeoDNS sends a user in Tokyo to a server in Europe. What\'s the most likely reason?',
      options: ['The record\'s TTL is too short', 'The user\'s recursive resolver is located in Europe', 'Tokyo has no internet exchange', 'GeoDNS only works for IPv6'],
      answer: 1,
      explain: 'The authoritative server sees the **resolver\'s** address, not the user\'s. A resolver in Europe makes the user look European, unless it passes EDNS Client Subnet.',
    },
    {
      type: 'quiz',
      q: 'You lower a record\'s TTL from 1 day to 60 seconds just before a migration. Why do some users still reach the old IP for up to a day?',
      options: ['Resolvers that cached it earlier keep the old answer for its original 1-day TTL', '60 seconds is below the DNS minimum', 'TLS certificates pin the old IP', 'TTL changes only apply to IPv6'],
      answer: 0,
      explain: 'A TTL change only affects answers handed out **after** it. Copies cached under the old 1-day TTL live out their full day. Lower it at least one old TTL ahead.',
    },
  ],
});

deepSection('edge-in-depth', {
  id: 'anycast',
  nav: 'Anycast & BGP',
  title: 'Anycast: one IP in hundreds of places',
  goal: 'Explain how BGP lets many sites share one address, how anycast fails over, and where it falls short.',
  card: {
    emoji: '📡',
    text: `With **anycast**, many sites announce the same IP prefix using **BGP**, the protocol networks use to tell each other which addresses they can reach. Each router picks the best path it hears, so your packets flow to a nearby site with no DNS tricks at all. If a site fails, it withdraws its announcement and traffic shifts to the next-best site, usually within seconds. Anycast also splits a DDoS flood across every site at once. The catch: "nearest" means the best BGP path, which isn't always the lowest latency.`,
  },
  blocks: [
    {
      type: 'text',
      md: `The internet is a network of networks: tens of thousands of **autonomous systems** (ASes), each an ISP, cloud, company or university with its own AS number. They glue themselves together with **BGP**, the Border Gateway Protocol. Each AS announces the address blocks (prefixes) it can deliver to, and neighbors pass those announcements along, adding themselves to the **AS path**.

Every router ends up hearing several possible paths to the same prefix and picks one. The choice is driven first by business policy (networks prefer routes through paying customers, then through free peers, then through their own paid providers), then by the shortest AS path, then by a series of tie-breakers. Notice what's missing: **measured latency**. BGP knows about relationships and hop counts, not milliseconds.

Normally a prefix is announced from one place (**unicast**). With **anycast**, the same prefix is announced from many places at once. Each network simply routes to whichever announcement looks best from where it sits, which is usually a nearby one. The same address now lives in Tokyo, Paris and New York, and each user reaches "their" copy automatically.`,
    },
    {
      type: 'diagram',
      title: 'One address, three sites',
      diagram: {
        h: 300,
        nodes: [
          { id: 'u1', x: 52, y: 55, label: 'Tokyo user', icon: '👤', shape: 'pill' },
          { id: 'u2', x: 52, y: 150, label: 'Paris user', icon: '👤', shape: 'pill' },
          { id: 'u3', x: 52, y: 245, label: 'NYC user', icon: '👤', shape: 'pill' },
          { id: 's1', x: 298, y: 55, label: 'Tokyo PoP\n192.0.2.1', icon: '🏢', tone: 'good' },
          { id: 's2', x: 298, y: 150, label: 'Paris PoP\n192.0.2.1', icon: '🏢', tone: 'good' },
          { id: 's3', x: 298, y: 245, label: 'NYC PoP\n192.0.2.1', icon: '🏢', tone: 'good' },
        ],
        edges: [
          { from: 'u1', to: 's1', flow: true },
          { from: 'u2', to: 's2', flow: true, label: 'best path' },
          { from: 'u3', to: 's3', flow: true },
        ],
        groups: [{ x: 244, y: 8, w: 110, h: 288, label: 'SAME PREFIX' }],
      },
      caption: 'All three PoPs announce `192.0.2.0/24`. Every user dials the same address, and BGP delivers each one to a nearby site.',
    },
    {
      type: 'stepper',
      title: 'Anycast failover, step by step',
      diagram: {
        h: 300,
        nodes: [
          { id: 'up', x: 52, y: 95, label: 'Paris user', icon: '👤', shape: 'pill' },
          { id: 'ut', x: 52, y: 245, label: 'Tokyo user', icon: '👤', shape: 'pill' },
          { id: 'sp', x: 298, y: 45, label: 'Paris PoP', icon: '🏢', tone: 'good' },
          { id: 'sf', x: 298, y: 145, label: 'Frankfurt\nPoP', icon: '🏢', tone: 'good' },
          { id: 'st', x: 298, y: 255, label: 'Tokyo PoP', icon: '🏢', tone: 'good' },
        ],
        edges: [
          { from: 'up', to: 'sp', flow: true },
          { from: 'up', to: 'sf', dashed: true, tone: 'warn', label: 'next best' },
          { from: 'ut', to: 'st', flow: true },
        ],
      },
      steps: [
        {
          title: 'A normal day',
          focus: ['up', 'up>sp', 'sp', 'ut', 'ut>st', 'st'],
          text: 'Every PoP announces the same prefix. Routers near Paris hear the Paris announcement over the best path and send Paris users there. Tokyo users go to Tokyo. Nobody configured that per user: it falls out of routing.',
        },
        {
          title: 'The Paris PoP fails',
          focus: ['sp'],
          text: 'Health checks inside the PoP fail, or an operator drains it for maintenance. Its routers stop announcing the prefix. In BGP terms, that\'s a **withdrawal**.',
        },
        {
          title: 'Routes reconverge',
          focus: ['up', 'up>sf', 'sf'],
          text: 'Neighboring networks remove the Paris path and fall back to the next best one they already know: Frankfurt. This usually settles within seconds, sometimes longer while routes ripple outward. No DNS change, no TTL to wait out.',
        },
        {
          title: 'In-flight connections reset',
          focus: ['up>sf', 'sf'],
          text: 'TCP connections that were open to Paris break, because Frankfurt has no state for them, and clients reconnect. New connections go to Frankfurt from the first packet. Tokyo users never noticed anything.',
        },
      ],
    },
    {
      type: 'text',
      md: `**Anycast and TCP.** For years, conventional wisdom said anycast was only safe for single-packet protocols like DNS over UDP: if routing shifted in the middle of a TCP connection, packets would land at a site that had never seen the connection, and it would be reset. In practice, internet routes are stable for the lifetime of the vast majority of connections, so CDNs run TCP, TLS and HTTP over anycast every day. The rare route change costs one reconnect.

**Nearest isn't always fastest.** Because BGP chooses by policy and AS-path length, a user's ISP may hand traffic to a peer that carries it to a distant site, even when a closer site exists. Anycast operators spend real effort tuning this: announcing some prefixes only from certain sites, adjusting how attractive each announcement looks, and adding peering with the ISPs whose users get routed badly.

**Anycast versus DDoS.** A botnet is spread around the world, so its traffic lands at whichever site is nearest to each infected machine. Instead of one site facing the whole flood, every site absorbs its local share. That's a big reason DNS root servers, public resolvers and CDNs all use anycast.`,
    },
    {
      type: 'table',
      title: 'GeoDNS vs anycast',
      head: ['', 'GeoDNS', 'Anycast'],
      rows: [
        ['How it steers', 'Different DNS answers per resolver', 'Same IP everywhere; BGP picks the path'],
        ['Failover speed', 'Minutes: health checks plus cached TTLs', 'Seconds: withdraw the route'],
        ['Precision', 'Fine-grained: any rule, any weight, per resolver', 'Coarse: whatever BGP decides'],
        ['Who it sees', 'The resolver (or a subnet via ECS)', 'Every packet, wherever it comes from'],
        ['Weak spot', 'Distant resolvers, sticky caches', 'BGP path oddities, route flaps'],
        ['DDoS', 'Doesn\'t help by itself', 'Spreads floods across all sites'],
      ],
    },
    {
      type: 'callout',
      tone: 'key',
      title: 'Most big networks use both',
      text: 'The DNS servers themselves are almost always anycast: root servers, public resolvers, and managed DNS services like Route 53. Then the answers those servers give can be GeoDNS-steered addresses, anycast addresses, or both. A common pattern: anycast to get you to a nearby site fast and resiliently, DNS steering when you need precise control over which cluster serves whom.',
    },
    {
      type: 'quiz',
      q: 'With anycast, how does a failed site stop receiving traffic?',
      options: ['It lowers its DNS TTL to zero', 'It sends TCP resets to every client', 'It withdraws its BGP announcement for the prefix', 'Clients notice and pick a new IP'],
      answer: 2,
      explain: 'The site stops announcing the prefix, routers drop that path and use the next best site. No DNS change is needed, so failover is fast.',
    },
    {
      type: 'quiz',
      q: 'Why does anycast sometimes send a user to a farther site than the closest one?',
      options: ['BGP chooses paths by policy and AS-path length, not measured latency', 'Anycast picks sites at random', 'DNS caches override BGP', 'Each user is pinned to the first site they ever used'],
      answer: 0,
      explain: 'BGP knows business relationships and hop counts, not milliseconds. A user\'s ISP may prefer a peer path that ends at a distant site. Operators tune announcements to fix it.',
    },
  ],
});

deepSection('edge-in-depth', {
  id: 'cdn',
  nav: 'Inside a CDN',
  title: 'Inside a CDN: PoPs, tiers and the edge',
  goal: 'Trace a cache miss and a cache hit through a tiered CDN, and explain why even uncacheable requests get faster.',
  card: {
    emoji: '🏢',
    text: `A CDN is a network of **PoPs**, data centers in hundreds of cities, each packed with cache servers. Your request reaches a nearby PoP through DNS steering or anycast. On a **hit**, the edge serves the bytes from memory or SSD in milliseconds. On a **miss**, it asks a parent tier or **origin shield** before bothering your origin, so a million users turn into a handful of origin requests. The edge also terminates TLS close to you and keeps warm connections to the origin, which speeds up even uncacheable API calls.`,
  },
  blocks: [
    {
      type: 'text',
      md: `A **PoP** (point of presence) is a CDN's local data center: routers that connect to local ISPs and internet exchanges, a load-balancing layer, and a fleet of cache servers with lots of RAM and SSD. Big CDNs run PoPs in hundreds of cities, and some place servers directly inside ISP networks.

Inside a PoP, servers don't each keep a copy of everything. The request's URL is usually **hashed** to pick the server responsible for that object, so the PoP's combined storage behaves like one big cache instead of many small ones holding the same popular files. (Consistent hashing, which you may know from databases, was in fact invented in the late 1990s for exactly this kind of web caching.) Hot objects stay in memory; the long tail lives on SSD.`,
    },
    {
      type: 'stepper',
      title: 'A cache miss, then a hit',
      diagram: {
        h: 300,
        nodes: [
          { id: 'ua', x: 50, y: 70, label: 'User A', icon: '👤', shape: 'pill' },
          { id: 'ub', x: 50, y: 235, label: 'User B', icon: '👤', shape: 'pill' },
          { id: 'edge', x: 170, y: 152, label: 'Edge\ncache', icon: '🏢', tone: 'accent' },
          { id: 'shield', x: 298, y: 60, label: 'Origin\nshield', icon: '🛡️' },
          { id: 'origin', x: 298, y: 245, label: 'Origin', icon: '🖥️' },
        ],
        edges: [
          { from: 'ua', to: 'edge', flow: true },
          { from: 'ub', to: 'edge', flow: true },
          { from: 'edge', to: 'shield', label: 'miss' },
          { from: 'shield', to: 'origin', label: 'miss' },
        ],
      },
      steps: [
        {
          title: 'User A asks for /img/hero.jpg',
          focus: ['ua', 'ua>edge', 'edge'],
          text: 'The request reaches the nearest PoP and lands on the cache server responsible for that URL. It builds the **cache key** (scheme, host, path, and possibly some query parameters or headers) and looks it up. Not there: a miss.',
        },
        {
          title: 'Edge miss: ask the shield',
          focus: ['edge', 'edge>shield', 'shield'],
          text: 'Instead of going straight to your origin, the edge asks its parent tier, the **origin shield**, typically a large PoP near the origin. Good CDNs also **collapse** misses: if 500 users ask for the same missing object at once, one request goes upstream and the other 499 wait for it.',
        },
        {
          title: 'Shield miss: fetch from the origin',
          focus: ['shield', 'shield>origin', 'origin'],
          text: 'The shield doesn\'t have it either, so it makes the one trip to your origin. The response comes back with headers such as `Cache-Control: public, max-age=86400` and an `ETag` that identifies this version.',
        },
        {
          title: 'Store on the way back',
          focus: ['shield', 'edge', 'ua>edge', 'ua'],
          text: 'The shield stores a copy, the edge stores a copy, and User A gets the image. User A paid for one long round trip to the origin. Nobody after them in this city will.',
        },
        {
          title: 'User B: a hit',
          focus: ['ub', 'ub>edge', 'edge'],
          text: 'Seconds later, User B in the same city asks for the same URL. **Hit**: served from the edge\'s memory or SSD in a few milliseconds. The shield and the origin never hear about it.',
        },
        {
          title: 'Another city misses',
          focus: ['edge>shield', 'shield'],
          text: 'When a user in a different city misses at their PoP, that PoP also asks the shield, which already has the object. Your origin sees roughly one request per object per expiry, instead of one per PoP.',
        },
      ],
    },
    {
      type: 'text',
      md: `**Hit ratio is the number that matters.** At a 95% hit ratio, your origin serves 1 request in 20. Push it to 99% and origin traffic drops by another factor of 5, from 5% to 1%. CDNs report both a request hit ratio and a **byte** hit ratio; a site full of large videos can have a great byte ratio even when lots of small requests miss. Tiered caching exists because the long tail of rarely requested objects misses constantly at small PoPs, and a big shared middle tier catches most of those misses.`,
    },
    {
      type: 'stats',
      title: 'Why the edge speeds up even uncacheable requests',
      stats: [
        { value: '~400 ms', label: 'TCP + TLS 1.3 setup to a server 200 ms away (2 round trips)' },
        { value: '~20 ms', label: 'the same setup to an edge 10 ms away' },
      ],
      caption: 'The handshakes happen with the nearby edge. The edge then forwards your request over a connection to the origin that is already open and warmed up.',
    },
    {
      type: 'text',
      md: `For a logged-in API call, there's nothing to cache, yet routing it through a CDN still often helps. This is **dynamic acceleration**:

The **TLS handshake** finishes at an edge a few milliseconds away instead of an origin a continent away. The edge keeps **persistent, pre-warmed connections** to your origin, so your request skips the TCP and TLS setup on the long leg and doesn't start from a cold, slow-growing TCP window. Some CDNs route that long leg over their own backbone or pick the faster of several internet paths. And the edge can speak modern protocols to the user, like HTTP/3 over QUIC, even if your origin only speaks HTTP/1.1.

The edge is also becoming a place to run code. **Cloudflare Workers**, **CloudFront Functions** and **Lambda@Edge**, and **Fastly Compute** let you run small programs in every PoP: auth checks, redirects, A/B test assignment, header rewrites, even rendering whole pages close to the user.`,
    },
    {
      type: 'quiz',
      q: 'Why does an origin shield cut the load on your origin?',
      options: ['It compresses every response', 'It blocks all dynamic requests', 'Edges miss to the shield, so each object is fetched from the origin about once', 'It moves your database to the edge'],
      answer: 2,
      explain: 'Without a shield, every PoP that misses goes to the origin. With one, all those misses meet at a single tier that fetches once and serves every edge.',
    },
    {
      type: 'quiz',
      q: 'An API response can\'t be cached at all. Why might sending it through a CDN still make it faster?',
      options: ['The CDN stores it anyway for one second', 'TLS ends at a nearby edge, which reuses warm connections to the origin', 'CDNs make the origin\'s CPU faster', 'DNS lookups are skipped'],
      answer: 1,
      explain: 'The expensive handshakes happen over a short distance, and the long leg to the origin uses connections that are already open. That\'s dynamic acceleration.',
    },
  ],
});

deepSection('edge-in-depth', {
  id: 'caching',
  nav: 'Keys, TTLs, purge',
  title: 'Cache keys, Cache-Control, ETags and purge',
  goal: 'Control exactly what the edge stores, for how long, and how to change it in a hurry.',
  card: {
    emoji: '🗝️',
    text: `What a CDN stores is decided by the **cache key** (usually scheme, host, path and query), and how long by \`Cache-Control\`. \`max-age\` and \`s-maxage\` set freshness, \`private\` keeps personal responses out of shared caches, and \`no-store\` forbids storing at all. When a copy goes stale, the edge needn't refetch it: it **revalidates** by sending the \`ETag\` back in \`If-None-Match\`, and a \`304 Not Modified\` refreshes the copy without resending the body. For urgent changes you **purge**, but versioned file names beat purging.`,
  },
  blocks: [
    {
      type: 'text',
      md: `**The cache key is the identity of a cached object.** Two requests with the same key get the same cached response. By default, CDNs build it from the scheme, host, path and full query string. That default hides two classic traps.

**Too specific, and the cache fragments.** \`/shoes?utm_source=newsletter\` and \`/shoes?utm_source=ads\` are different keys, so every tracking variant is a separate miss. Most CDNs let you ignore or strip parameters that don't change the response, and sort the rest so \`?a=1&b=2\` and \`?b=2&a=1\` match.

**Too broad, and users see each other's data.** Cookies are normally *not* in the key. If a page varies by the logged-in user and gets cached, the next visitor receives the first visitor's page.

The \`Vary\` response header adds request headers to the key. \`Vary: Accept-Encoding\` is normal (separate gzip and Brotli copies). \`Vary: User-Agent\` is a disaster: browsers send thousands of distinct user-agent strings, so the cache splits into thousands of near-empty copies.`,
    },
    {
      type: 'table',
      title: 'Cache-Control directives, decoded',
      head: ['Directive', 'Meaning', 'Typical use'],
      rows: [
        ['`public`', 'Any cache, including CDNs, may store it', 'Static assets, public pages'],
        ['`private`', 'Only the user\'s own browser may store it', 'Logged-in pages, account data'],
        ['`max-age=N`', 'Fresh for N seconds', 'Browser and CDN lifetime'],
        ['`s-maxage=N`', 'Overrides max-age for shared caches', 'Keep longer at the CDN than in browsers'],
        ['`no-cache`', 'May store, but must revalidate before every use', 'HTML that must always be current'],
        ['`no-store`', 'Never store anywhere', 'Secrets, payment pages'],
        ['`immutable`', 'Never changes while fresh; don\'t even revalidate', 'Hashed file names like `app.3f9a.js`'],
        ['`stale-while-revalidate=N`', 'Serve stale for up to N s while refreshing in the background', 'Popular pages that must stay fast'],
        ['`stale-if-error=N`', 'Serve stale for up to N s if the origin is failing', 'Riding out origin outages'],
      ],
    },
    {
      type: 'tabs',
      title: 'Three ways a cached copy changes',
      tabs: [
        {
          label: '⏳ Expire',
          blocks: [
            { type: 'text', md: 'The simplest model: the copy is **fresh** until its age passes `s-maxage` (or `max-age`), then it\'s **stale**. A stale copy isn\'t thrown away. The cache either revalidates it, or, with `stale-while-revalidate`, serves it once more while it refreshes in the background, so users never wait for the origin.' },
          ],
        },
        {
          label: '✅ Revalidate',
          blocks: [
            { type: 'text', md: 'Instead of downloading the whole object again, the cache asks "has it changed?" by sending the version it has. The origin replies with a tiny `304 Not Modified` if nothing changed, and the cache marks its copy fresh again. `Last-Modified` with `If-Modified-Since` works the same way using timestamps.' },
            {
              type: 'code',
              title: 'Revalidation with an ETag',
              lang: 'http',
              code: `GET /api/catalog HTTP/1.1
Host: shop.example.com
If-None-Match: "v42-9f1c"

HTTP/1.1 304 Not Modified
ETag: "v42-9f1c"
Cache-Control: public, max-age=60`,
              caption: 'No body comes back: the edge already has it. For a 2 MB catalog, that turns a big transfer into a few hundred bytes.',
            },
          ],
        },
        {
          label: '🧹 Purge',
          blocks: [
            { type: 'text', md: 'When you can\'t wait for expiry, you tell the CDN to drop copies now. You can purge **by URL**, **by tag** (Fastly calls these surrogate keys: you label many objects, say every page showing product 42, and purge them all at once), or **everything**. A **soft purge** marks copies stale instead of deleting them, so the edge can still revalidate cheaply or serve stale if the origin struggles.\n\nPurge reaches the CDN, not the browsers that already cached a copy. That\'s why **versioned file names** (`app.3f9a.js`) beat purging for assets: a new version is a new URL, cacheable for a year with `immutable`.' },
          ],
        },
      ],
    },
    {
      type: 'callout',
      tone: 'trap',
      title: 'Caching a personal page is a data leak',
      text: 'If an origin returns a personalized page without `Cache-Control: private` (or `no-store`), and the CDN is told to cache HTML, the first visitor\'s page is served to everyone after them. Attackers can even provoke this: **web cache deception** (described publicly in 2017) tricks a CDN into caching a private page by requesting it with a fake static-looking suffix like `/account/nothing.css`. Mark personal responses private, and bypass the cache whenever a session cookie is present.',
    },
    {
      type: 'yourturn',
      prompt: 'Your product pages are cached at the edge for 10 minutes. Marketing needs price changes live within 30 seconds, and the origin can\'t handle the full traffic. Design the caching.',
      answer: `Keep the long edge TTL for load, and make **publishing** do the invalidation: tag every page with the products it shows (surrogate keys or cache tags) and purge by tag when a price changes, so updates go live in seconds while everything else stays cached.

Add \`stale-while-revalidate\` so the first request after a purge doesn't make users wait, an origin shield with request collapsing so a purge doesn't stampede the origin, and \`stale-if-error\` so an origin hiccup serves slightly old pages instead of errors. If prices change constantly, move the price into a small, short-TTL API call and keep the rest of the page cached.`,
    },
    {
      type: 'quiz',
      q: 'A cached copy is stale. The edge sends If-None-Match with its ETag, and the origin replies 304 Not Modified. What happens next?',
      options: ['The edge downloads the full body again', 'The edge deletes the copy and returns an error', 'The CDN purges every PoP', 'The edge keeps its copy, marks it fresh, and no body is resent'],
      answer: 3,
      explain: 'A `304` means "your version is still current". The edge refreshes the copy\'s freshness and serves it, saving the full transfer.',
    },
    {
      type: 'quiz',
      q: 'After turning on HTML caching at the CDN, logged-in users start seeing each other\'s account pages. Most likely cause?',
      options: ['Personal pages were cached under a key that doesn\'t vary per user', 'The DNS TTL is too long', 'The origin shield is turned off', 'ETags were disabled'],
      answer: 0,
      explain: 'Cookies aren\'t in the cache key by default, so one user\'s page is served to all. Mark personal responses `private` or `no-store`, or bypass the cache for sessions.',
    },
  ],
});

deepSection('edge-in-depth', {
  id: 'in-the-wild',
  nav: 'In the wild',
  title: 'Who runs the edge, and how they differ',
  goal: 'Know how the major CDNs and DNS operators actually route users, and what that teaches about trade-offs.',
  card: {
    emoji: '🌐',
    text: `Real networks route users in different ways. **Cloudflare** announces the same anycast IPs from data centers in over 300 cities and runs every service on every server. **Akamai**, the original big CDN, steers with DNS: its name servers hand each resolver nearby edge addresses. **Netflix** built Open Connect, placing its own caching appliances inside internet providers' networks. **Fastly** made its name with purges that finish in a fraction of a second. Even the DNS root and public resolvers like **8.8.8.8** and **1.1.1.1** run on anycast.`,
  },
  blocks: [
    {
      type: 'text',
      md: `Swipe through the cards below. Watch for three recurring choices: **how users are steered** (anycast or DNS mapping), **where the servers live** (CDN-owned PoPs or inside ISPs), and **how freshness is managed** (TTLs, revalidation, or fast purge).`,
    },
    {
      type: 'wild',
      title: 'In the wild: DNS, anycast and CDNs at real companies',
      items: [
        {
          emoji: '🟠',
          who: 'Cloudflare',
          what: 'Anycast everywhere',
          tags: ['anycast', '300+ cities', 'every server runs everything'],
          text: `Cloudflare announces the same IP prefixes from every data center, so BGP carries each user to a nearby one and a DDoS flood is split across the whole network. Every server runs the full stack (DNS, caching, WAF, Workers), so any machine can handle any request.

Its public resolver **1.1.1.1**, launched on April 1, 2018, runs on the same anycast network and deliberately doesn't send EDNS Client Subnet, trading some steering precision for privacy.`,
        },
        {
          emoji: '🔷',
          who: 'Akamai',
          what: 'DNS-based mapping',
          tags: ['DNS steering', 'founded 1998', 'inside ISPs'],
          text: `Akamai grew out of MIT research in the late 1990s, including the consistent hashing work for web caches. Customers CNAME their hostnames to Akamai names, and Akamai's **mapping system** answers each DNS query with edge servers picked for that resolver's network location, plus server load and health, using short TTLs so it can re-map quickly.

Its servers sit in thousands of locations, many of them deep inside ISP networks, which is the opposite bet from a few huge anycast PoPs.`,
        },
        {
          emoji: '🎬',
          who: 'Netflix',
          what: 'Open Connect',
          tags: ['own CDN', 'inside ISPs', 'video'],
          text: `Netflix runs its own CDN, **Open Connect**, announced in 2012. It provides qualifying internet providers with Open Connect Appliances, storage-heavy cache servers placed inside their networks, and also installs them at internet exchange points.

Appliances are filled during off-peak hours with the titles each region is expected to watch, so most streaming bytes never cross the wider internet. The Netflix app and its backend run on AWS; Open Connect handles the video delivery.`,
        },
        {
          emoji: '⚡',
          who: 'Fastly',
          what: 'Instant purge',
          tags: ['purge in under a second', 'surrogate keys', 'edge compute'],
          text: `Fastly built its platform on a customized version of the Varnish cache and made fast, programmable invalidation its calling card. Purges by URL or by **surrogate key** (a tag shared by many objects) take effect across the network in a fraction of a second, so news and commerce sites can cache aggressively and purge on publish.

On June 8, 2021, a customer's configuration change triggered a latent bug and briefly took down many major news, government and retail sites. Akamai had a widespread DNS incident the following month. Both were reminders of how much of the web flows through a few providers.`,
        },
        {
          emoji: '☁️',
          who: 'AWS',
          what: 'CloudFront + Route 53',
          tags: ['CDN', 'managed DNS', 'tiered caching'],
          text: `**CloudFront** is AWS's CDN: hundreds of edge locations, larger regional edge caches as a built-in middle tier, and an optional **Origin Shield** layer on top. Edge code runs as CloudFront Functions or Lambda@Edge.

**Route 53**, named after DNS's port 53, is AWS's DNS service. Its name servers are anycast, it offers latency, geolocation, weighted and failover routing with health checks, and its alias records solve the apex-CNAME problem for CloudFront distributions and load balancers.`,
        },
        {
          emoji: '🔎',
          who: 'Google Public DNS',
          what: '8.8.8.8',
          tags: ['public resolver', 'anycast', 'since 2009'],
          text: `Launched in December 2009, Google Public DNS answers on the anycast addresses **8.8.8.8** and **8.8.4.4** from sites around the world. It supports DNS over HTTPS and DNS over TLS.

Unlike 1.1.1.1, it sends **EDNS Client Subnet** to authoritative servers that support it, so CDNs that steer with DNS can still see roughly where the user is, not just where the resolver is.`,
        },
        {
          emoji: '🌳',
          who: 'The DNS root',
          what: 'a to m.root-servers.net',
          tags: ['13 identities', '12 operators', 'anycast'],
          text: `The top of DNS is served by 13 named root server identities, run by 12 independent organizations including Verisign (which runs two), ICANN, RIPE NCC, NASA and several universities. The limit of 13 dates from the days when every root address had to fit in one 512-byte UDP response.

Each identity is anycast from many sites, so there are well over a thousand root server instances worldwide, and no single site's failure is noticeable.`,
        },
      ],
    },
    {
      type: 'text',
      md: `**Two schools of steering.** Anycast-first networks (Cloudflare is the clearest example) let BGP route users to large PoPs and get fast, simple failover and DDoS absorption for free. DNS-mapping networks (Akamai is the classic) get fine-grained control over exactly which servers serve which resolver, at the cost of depending on resolver location and TTLs. Many CDNs mix the two.

**Two schools of placement.** Most CDNs run their own PoPs at internet exchanges and peer with ISPs there. Netflix and Akamai also push servers **inside** ISP networks, which is ideal when one kind of traffic (video) dominates and the ISP is happy to keep those bytes local.`,
    },
    {
      type: 'quiz',
      q: 'How does Akamai mainly steer users to nearby edge servers?',
      options: ['Anycast only, with no DNS involvement', 'Users choose an edge from a list', 'Its DNS answers each resolver with nearby edge addresses', 'Browsers ping every edge and pick the fastest'],
      answer: 2,
      explain: 'Customers CNAME to Akamai names, and Akamai\'s mapping system returns edge servers chosen for the resolver\'s location, load and health, with short TTLs.',
    },
    {
      type: 'quiz',
      q: 'Why does Netflix place Open Connect appliances inside ISPs\' networks?',
      options: ['To run the Netflix app\'s backend there', 'So popular video is served from inside the ISP, filled during off-peak hours', 'Because AWS can\'t serve video', 'To host DNS for the ISP\'s customers'],
      answer: 1,
      explain: 'Serving from inside the ISP keeps streaming bytes local, cutting latency and transit. Appliances are pre-filled overnight with what each region is likely to watch.',
    },
  ],
});

deepSection('edge-in-depth', {
  id: 'failures',
  nav: 'When it breaks',
  title: 'When it breaks: diagnosing edge failures',
  goal: 'Recognize the signatures of DNS, CDN and BGP failures from the symptoms alone.',
  card: {
    emoji: '🚨',
    text: `Edge failures have signatures. Users stuck on an old server hours after a migration? Long **TTLs**, still cached. Your origin collapsing right after a purge? A **thundering herd** of simultaneous misses. Strangers seeing each other's account pages? A **cache key** or \`Cache-Control\` mistake that cached personal responses. A region suddenly unreachable, or routed through a distant country? A **BGP** leak or hijack. And in October 2021, Facebook vanished for about six hours when a maintenance mistake caused its DNS servers to withdraw their own BGP routes.`,
  },
  blocks: [
    {
      type: 'text',
      md: `Each case below starts with a symptom, the way you'd meet it during an incident. Try to name the cause, and a fix, out loud before you tap to reveal the answer.`,
    },
    {
      type: 'yourturn',
      prompt: '💥 You moved `shop.example.com` to a new provider at 10:00 and shut the old servers down. At 18:00, about a third of users still can\'t reach the site.',
      answer: `**Long TTLs, still cached.** The record had a one-day TTL (86,400 seconds). Every resolver that cached the old address before 10:00 will keep serving it for up to 24 hours, and some clients hold on even longer.

**Fix now:** bring the old servers back, or make them proxy to the new ones, until traffic drains. **Next time:** lower the TTL to 60 to 300 seconds at least a full day before the move, keep the old servers running until their traffic reaches zero, then raise the TTL again.`,
    },
    {
      type: 'yourturn',
      prompt: '💥 Marketing purges the entire CDN cache to fix one typo. The origin\'s CPU hits 100% and the site is down for ten minutes.',
      answer: `**A thundering herd.** With a 98% hit ratio, the origin normally sees 2% of requests. After a full purge, every PoP misses every object at once, so for a while the origin faces up to 50 times its usual load.

**Fix:** purge only the URL (or a tag) that changed, prefer **soft purge** so copies are revalidated instead of refetched, and use \`stale-while-revalidate\`. An origin shield with request collapsing turns thousands of simultaneous misses into one fetch per object.`,
    },
    {
      type: 'yourturn',
      prompt: '💥 After enabling "cache everything" at the CDN to speed up the homepage, support hears from users who see someone else\'s name and order history.',
      answer: `**Personal pages in a shared cache.** The cache key doesn't include the session cookie, so the first logged-in visitor's page was stored and served to everyone after them.

**Fix:** purge immediately. Mark personalized responses \`Cache-Control: private\` (or \`no-store\`), bypass the cache whenever a session cookie is present, cache only anonymous HTML, and load personal details through an uncached API call. Treat it as a data exposure incident.`,
    },
    {
      type: 'yourturn',
      prompt: '💥 The cache hit ratio falls from 95% to 40% on the day a big marketing campaign launches. Nothing else was deployed.',
      answer: `**Cache key fragmentation.** Campaign links add tracking parameters (\`utm_source\`, \`utm_campaign\`, ad click IDs) to every URL. They are part of the default cache key, so each unique link is a separate miss for the same page.

**Fix:** configure the CDN to ignore or strip parameters that don't change the response, sort the remaining ones, and keep \`Vary\` minimal.`,
    },
    {
      type: 'yourturn',
      prompt: '💥 Users in several countries suddenly can\'t reach your service, or reach it with 300 ms of extra latency. Your servers and DNS look perfectly healthy.',
      answer: `**A BGP leak or hijack.** Another network announced your prefixes (or a more specific slice of them, which routers prefer), or leaked routes it shouldn't have passed on, and parts of the internet now send your traffic the wrong way. In 2008 Pakistan Telecom's attempt to block YouTube domestically leaked a more-specific route and took YouTube offline for much of the world for hours. In June 2019 a route leak from a small ISP, propagated by a large provider, disrupted Cloudflare and many others.

**Fix:** work with your upstreams to filter the bad announcements, publish **RPKI** records for your prefixes so networks that validate routes reject false origins, and monitor BGP so you hear about it in minutes, not from users.`,
    },
    {
      type: 'yourturn',
      prompt: '💥 October 4, 2021: facebook.com, Instagram and WhatsApp stop resolving worldwide. Facebook\'s engineers reportedly struggle to reach the internal tools they need to fix it.',
      answer: `**DNS made unreachable by BGP.** A maintenance command, which an audit tool should have blocked, disconnected Facebook's backbone. Its DNS servers were designed to withdraw their BGP announcements when they couldn't reach the data centers, and they did exactly that, so the authoritative servers for its domains disappeared from the internet. Cached answers expired, resolvers got no reply, and retries from billions of apps piled extra load onto resolvers everywhere. Internal tools depended on the same network and DNS, which slowed recovery to about six hours.

**Lessons:** DNS is a critical dependency, so give it independent failure domains; keep out-of-band access for recovery that doesn't depend on the system being recovered; and be careful with automation that withdraws routes, because a safety mechanism can turn a partial failure into a total one.`,
    },
    {
      type: 'callout',
      tone: 'tip',
      title: 'Read the shape of the outage',
      text: '**DNS** problems are slow in both directions: they spread and heal at the speed of TTLs. **CDN** problems are about keys and freshness: wrong content, stale content, or a stampede at the origin. **BGP** problems look geographic: some countries or networks fail while others are fine. The first question in an edge incident is "who is affected, and since when?"',
    },
    {
      type: 'quiz',
      q: 'Right after you purge your entire CDN cache, your origin falls over. What happened?',
      options: ['The purge deleted files from the origin', 'Every edge missed at once, sending a flood of requests to the origin', 'DNS stopped resolving during the purge', 'The TLS certificates were revoked'],
      answer: 1,
      explain: 'A full purge turns a high hit ratio into near zero for a while. Every PoP refetches at once: a thundering herd. Purge narrowly and use soft purge, shields and request collapsing.',
    },
    {
      type: 'quiz',
      q: 'During the October 2021 Facebook outage, why couldn\'t resolvers find facebook.com?',
      options: ['Its TLS certificate had expired', 'Its domain registration lapsed', 'A CDN purge deleted the site', 'Its DNS servers withdrew their BGP routes, making them unreachable'],
      answer: 3,
      explain: 'With the routes to its authoritative DNS servers withdrawn, no resolver could reach them. Once cached answers expired, the names simply stopped resolving.',
    },
  ],
});

deepSection('edge-in-depth', {
  id: 'recap',
  nav: 'Explain it back',
  title: 'Explain it back',
  goal: 'Turn recognition into recall: explain each idea out loud before you flip the card.',
  card: {
    emoji: '🧠',
    text: `The whole edge in one breath. DNS turns names into addresses through a cached hierarchy: stub, recursive resolver, root, TLD, authoritative. A CNAME hands your hostname to a CDN, whose DNS steering or anycast routing picks a nearby PoP. Anycast announces one IP from many sites over BGP and fails over by withdrawing routes. At the PoP, cache keys and \`Cache-Control\` decide what's stored and for how long, ETags revalidate cheaply, and shields protect the origin. Now flip the cards and explain each idea out loud.`,
  },
  blocks: [
    {
      type: 'text',
      md: `Reading builds familiarity. **Recalling** builds memory. Answer each card out loud, in full sentences, as if an interviewer were listening, and only then flip it. The ones you fumble are the ones to re-read.`,
    },
    {
      type: 'flashcards',
      title: 'Explain it back',
      cards: [
        { q: 'Walk through a cold DNS lookup for shop.example.com.', a: 'The OS stub resolver asks a recursive resolver. The resolver asks a root server (referral to .com), a .com server (referral to example.com\'s name servers), then the authoritative server, which returns the record and its TTL. The resolver caches every step and returns the answer to the stub.' },
        { q: 'What does a TTL control, and what\'s the trade-off?', a: 'How long any cache may keep a record. Short TTLs (60 s) let you change or fail over quickly but cause more lookups. Long TTLs (a day) are cheap and resilient but make changes slow. Lower it at least one old TTL before a migration.' },
        { q: 'How does a CNAME let a CDN take over your hostname?', a: 'www.example.com becomes an alias for a name the CDN controls, so the resolver ends up asking the CDN\'s DNS, which answers with a nearby edge per resolver. The apex can\'t be a CNAME, so providers use CNAME flattening or alias records.' },
        { q: 'What does GeoDNS actually see, and how does ECS help?', a: 'It sees the recursive resolver\'s address, not the user\'s, so users on distant resolvers can be mis-steered. EDNS Client Subnet lets the resolver pass a truncated user subnet. Google Public DNS sends it; 1.1.1.1 doesn\'t, for privacy.' },
        { q: 'Why is DNS failover slow?', a: 'Health checks take time to declare failure, cached answers live out their TTL, some resolvers enforce minimum TTLs or serve stale, apps and runtimes cache addresses, and open connections never re-resolve. Expect minutes, with a long tail.' },
        { q: 'How does anycast work, and how does it fail over?', a: 'Many sites announce the same prefix over BGP; each network routes to the best path it hears, usually a nearby site. A failing site withdraws its announcement and traffic moves to the next best site within seconds, with no DNS change.' },
        { q: 'Give one strength and one weakness each for GeoDNS and anycast.', a: 'GeoDNS: precise, rule-based control per resolver; but slow failover and depends on resolver location. Anycast: fast failover and DDoS spreading; but routing follows BGP policy, not latency, so "nearest" can be wrong.' },
        { q: 'Trace a cache miss through a tiered CDN.', a: 'The edge computes the cache key and misses, asks the origin shield (collapsing duplicate misses), the shield misses and fetches once from the origin, and both tiers store a copy on the way back. The next nearby user gets a hit.' },
        { q: 'max-age, s-maxage, no-cache, no-store, private: what does each mean?', a: 'max-age: fresh for N seconds. s-maxage: the same, but only for shared caches like CDNs. no-cache: store but revalidate before each use. no-store: never store. private: only the user\'s browser may store it.' },
        { q: 'How does ETag revalidation work, and why is it cheap?', a: 'The cache sends its version in If-None-Match. If unchanged, the origin answers 304 Not Modified with no body, and the cache marks its copy fresh. Only headers cross the network instead of the whole object.' },
      ],
    },
    {
      type: 'quiz',
      q: 'Which statement is true?',
      options: ['GeoDNS always sees each user\'s own IP address', 'Lowering a TTL takes effect instantly in every cache', 'Anycast fails over by withdrawing BGP routes, with no DNS change', 'A 304 Not Modified response resends the full body'],
      answer: 2,
      explain: 'Anycast failover is a routing change, so it skips TTLs entirely. GeoDNS sees resolvers, TTL changes only affect new answers, and a 304 carries no body.',
    },
    {
      type: 'quiz',
      q: 'In what order does a first-ever request for an image travel through a tiered CDN?',
      options: ['Origin → shield → edge → user', 'User → edge → shield → origin, storing copies on the way back', 'User → origin, then the edge copies it', 'User → root DNS server → edge'],
      answer: 1,
      explain: 'The edge misses to the shield, the shield misses to the origin, and each tier stores the object as the response flows back. Later requests stop at the first tier that has it.',
    },
  ],
});
