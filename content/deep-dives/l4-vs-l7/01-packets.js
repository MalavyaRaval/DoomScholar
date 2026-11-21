deepSection('l4-vs-l7', {
  id: 'packets',
  nav: 'Inside a request',
  title: 'First: what is actually inside a request?',
  goal: 'Know exactly which bytes an L4 box can read, and which only an L7 box can.',
  card: {
    emoji: '✉️',
    text: `Every request travels as nested envelopes. Your HTTP message (method, path, headers, cookies) is encrypted into TLS records, chopped into TCP segments stamped with ports, wrapped in an IP packet with source and destination addresses, and framed for the next hop. "L4" and "L7" are layer numbers from the OSI model: **Layer 4 is transport (TCP/UDP)** and **Layer 7 is the application (HTTP)**. An L4 balancer reads only the outside of the envelope: IPs and ports. An L7 balancer opens it and reads the letter. Every other difference follows from that.`,
  },
  blocks: [
    {
      type: 'text',
      md: `When your phone sends \`GET /cart\` to a shop, the request doesn't travel as one neat message. Each layer of the network stack wraps the layer above it in its own envelope, adds its own header, and hands it down. At the receiver, each layer peels off its envelope and passes the rest up. That's **encapsulation**, and it's the key to the whole L4 vs L7 story.

The layer names come from the **OSI model**, a seven-layer textbook model from the late 1970s and 80s. Real networks run the simpler TCP/IP stack, but the OSI numbers stuck as vocabulary. **Layer 2** is the link (Ethernet, Wi-Fi, MAC addresses). **Layer 3** is the network (IP addresses, routing). **Layer 4** is transport (TCP and UDP, ports). **Layer 7** is the application (HTTP, gRPC, DNS, SMTP). Layers 5 and 6, session and presentation, mostly blur into TLS and the application in practice, which is why nobody sells an "L6 load balancer".`,
    },
    {
      type: 'layers',
      title: 'One HTTPS request as nested envelopes. Pick a reader to see what it can see.',
      layers: [
        { tag: 'L2', name: 'Ethernet frame', fields: ['dst MAC `3c:22:fb:…`', 'src MAC', 'EtherType: IPv4'] },
        { tag: 'L3', name: 'IP packet', fields: ['src IP `203.0.113.7` (you)', 'dst IP `198.51.100.10` (the VIP)', 'TTL 56', 'protocol 6 = TCP'] },
        { tag: 'L4', name: 'TCP segment', fields: ['src port `52814`', 'dst port `443`', 'seq / ack numbers', 'flags SYN · ACK · FIN'] },
        { tag: 'TLS', name: 'TLS records', fields: ['ClientHello: SNI `shop.example`', 'ALPN: `h2`', 'after the handshake: all encrypted'] },
        { tag: 'L7', name: 'HTTP request', fields: ['`GET /cart/42`', 'Host: `shop.example`', 'Cookie: `session=9f…`', 'User-Agent, body…'] },
      ],
      views: [
        {
          label: '🛣️ Router',
          sees: ['L2', 'L3'],
          text: 'A router needs only the **destination IP** to pick the next hop. It rebuilds the L2 frame at every hop and never interprets anything deeper. (Routers that spread traffic with ECMP do hash the port numbers too, but they don\'t act on what they mean.)',
        },
        {
          label: '📦 L4 LB',
          sees: ['L2', 'L3', 'L4'],
          text: 'An L4 balancer reads the **5-tuple**: protocol, source IP, source port, destination IP, destination port. Those five values identify one connection. It picks a backend once per connection and then just moves packets. The TLS and HTTP inside are opaque bytes to it.',
        },
        {
          label: '🔎 L4 + SNI peek',
          sees: ['L2', 'L3', 'L4', 'TLS'],
          text: 'Some L4 proxies peek at the **unencrypted ClientHello** to read the SNI hostname and route on it without decrypting anything (HAProxy\'s `req.ssl_sni`, NGINX\'s `ssl_preread`). That\'s TLS passthrough with hostname routing. Encrypted Client Hello (ECH) hides the SNI, which makes this trick harder over time.',
        },
        {
          label: '📨 L7 LB',
          sees: ['L2', 'L3', 'L4', 'TLS', 'L7'],
          text: 'An L7 balancer **terminates** TLS: it holds the certificate and private key, decrypts the stream and parses the full HTTP request. Now it can route on path, host, headers, cookies, even the body, and it decides **per request**, not per connection.',
        },
      ],
    },
    {
      type: 'callout',
      tone: 'key',
      title: 'The one-sentence difference',
      text: 'An **L4** balancer decides using the envelope (addresses and ports) without opening it. An **L7** balancer opens the envelope, reads the letter and decides based on what it says. Speed, cost, features and failure modes all follow from this one fact.',
    },
    {
      type: 'text',
      md: `Two consequences fall straight out of the picture above.

**L4 decisions happen once per connection.** The first packet of a TCP connection, the SYN, carries no payload at all: just addresses, ports and flags. The L4 balancer must commit to a backend right then, before a single byte of HTTP exists. Every later packet with the same 5-tuple must go to that same backend, because the TCP connection state (sequence numbers, windows, buffers) lives on that one machine. Send a mid-connection packet anywhere else and that server answers with a reset (RST), killing the connection.

**L7 decisions happen once per request.** The L7 proxy accepts the connection itself, waits until a complete HTTP request has arrived, and only then chooses. One client connection carrying 500 requests can be spread across 50 backends. That's its superpower and its cost: it has to do the TCP handshake, the TLS handshake and the HTTP parsing for every single client.`,
    },
    {
      type: 'quiz',
      q: 'An L4 load balancer receives the first packet (the SYN) of an HTTPS connection. What can it use to choose a backend?',
      options: ['The URL path, e.g. /cart', 'The session cookie', 'Source/destination IPs and ports', 'The HTTP Host header'],
      answer: 2,
      explain: 'A SYN carries **no payload**, and HTTPS would be encrypted anyway. An L4 balancer chooses from the 5-tuple: protocol, IPs and ports.',
    },
    {
      type: 'quiz',
      q: 'Why must every packet of one TCP connection reach the same backend?',
      options: ['Backends can\'t share IP addresses', 'TCP state (sequence numbers, buffers) lives on that one backend', 'Routers drop packets that change paths', 'TLS forbids changing servers'],
      answer: 1,
      explain: 'Only the backend that completed the handshake knows the connection. A packet that lands anywhere else gets a **RST**, and the connection dies.',
    },
  ],
});
