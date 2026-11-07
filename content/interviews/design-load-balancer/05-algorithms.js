interviewPhase('design-load-balancer', {
  id: 'algorithms',
  nav: 'Algorithms',
  time: '20–27',
  start: 20,
  end: 27,
  title: 'Load-balancing algorithms, with code',
  goal: 'Go from naive to production-grade, show the code, and say when each one wins.',
  blocks: [
    { type: 'say', who: 'them', text: 'How does an L7 node choose which backend gets a request?' },
    {
      type: 'say',
      who: 'me',
      text: "It's configurable per pool. I'll build up from the simplest to what I'd actually ship by default, because each step fixes a specific problem with the one before.",
    },
    {
      type: 'code',
      title: '1. Round robin and smooth weighted round robin',
      lang: 'python',
      code: `import itertools, random, threading

class RoundRobin:
    """Every backend in turn. Assumes equal servers AND equal requests."""
    def __init__(self, backends):
        self._cycle = itertools.cycle(backends)
        self._lock = threading.Lock()

    def pick(self):
        with self._lock:
            return next(self._cycle)


class SmoothWeightedRoundRobin:
    """NGINX's algorithm. Weights {a: 5, b: 1, c: 1} produce
    a a b a c a a  (spread out), not  a a a a a b c  (bursty)."""
    def __init__(self, weights):              # {"a": 5, "b": 1, "c": 1}
        self.weights = dict(weights)
        self.current = {b: 0 for b in weights}
        self.total = sum(weights.values())

    def pick(self):
        for b, w in self.weights.items():
            self.current[b] += w               # everyone earns their weight
        best = max(self.current, key=self.current.get)
        self.current[best] -= self.total       # the winner pays the total back
        return best`,
      caption: 'Weights handle **unequal servers** (a 32-core box gets weight 4, an 8-core box weight 1) and canaries (v2 gets weight 1 of 100). But they ignore live load: a server stuck on slow requests still gets its turn.',
    },
    {
      type: 'code',
      title: '2. Least connections, and power of two choices (P2C)',
      lang: 'python',
      code: `class LeastConnections:
    """Send to the backend with the fewest in-flight requests."""
    def __init__(self, backends):
        self.active = {b: 0 for b in backends}
        self.lock = threading.Lock()

    def pick(self):
        with self.lock:
            b = min(self.active, key=self.active.get)
            self.active[b] += 1
            return b

    def done(self, b):                         # call when the request finishes
        with self.lock:
            self.active[b] -= 1


class PowerOfTwoChoices(LeastConnections):
    """Sample 2 backends at random, send to the less loaded one.
    O(1) per pick, and it avoids every LB node stampeding the same server."""
    def pick(self):
        with self.lock:
            a, b = random.sample(list(self.active), 2)
            winner = a if self.active[a] <= self.active[b] else b
            self.active[winner] += 1
            return winner`,
    },
    { type: 'say', who: 'them', text: 'Why not always use least connections? It sounds optimal.' },
    {
      type: 'say',
      who: 'me',
      text: "On a single LB it's great. But we run a **fleet** of LB nodes, and each one only sees **its own** in-flight counts. When a fresh backend joins with zero connections, every LB node sees it as \"least loaded\" at the same moment and they all stampede it. That's **herd behavior**.\n\n**Power of two choices** adds just enough randomness to break the herd: different nodes sample different pairs. And the math is surprisingly strong: comparing just two random choices drops the worst-case load *exponentially* compared with picking one at random (Mitzenmacher). Envoy's `LEAST_REQUEST` uses P2C by default, and Linkerd combines P2C with latency.",
    },
    {
      type: 'callout',
      tone: 'key',
      text: 'Least connections counts requests; it doesn\'t measure **cost**. Better still: weight by observed latency, using an **EWMA** (exponentially weighted moving average) of response time. A server answering in 5 ms beats one answering in 500 ms even if both have 3 requests open.',
    },
    { type: 'say', who: 'them', text: 'Some services need the same user to always reach the same backend, like a cache tier. Then what?' },
    {
      type: 'say',
      who: 'me',
      text: "Then I hash a key: the user ID, a session cookie, or the 5-tuple at L4. Plain `hash(key) % N` remaps almost every key when N changes, which empties every cache at once. So I'd use **consistent hashing**: when a backend is added or removed, only about **1/N** of the keys move.",
    },
    {
      type: 'code',
      title: '3. Consistent hashing ring with virtual nodes',
      lang: 'python',
      code: `import bisect, hashlib

def h(s: str) -> int:
    return int.from_bytes(hashlib.md5(s.encode()).digest()[:8], "big")

class ConsistentHashRing:
    def __init__(self, backends, vnodes=150):
        self.vnodes = vnodes
        self.ring = []                         # sorted list of (hash, backend)
        for b in backends:
            self.add(b)

    def add(self, backend):
        # many points per server → smooth, even split of the ring
        for i in range(self.vnodes):
            bisect.insort(self.ring, (h(f"{backend}#{i}"), backend))

    def remove(self, backend):
        self.ring = [(k, b) for k, b in self.ring if b != backend]

    def pick(self, key: str):
        i = bisect.bisect(self.ring, (h(key), ""))
        return self.ring[i % len(self.ring)][1]   # first point clockwise`,
      caption: 'Without virtual nodes, 3 servers would own 3 random arcs of the ring, and one might get half the keys. With ~150 points each, every server gets close to an equal share.',
    },
    {
      type: 'deep',
      title: 'Go deeper: Maglev hashing (how Google\'s L4 balancer picks)',
      blocks: [
        {
          type: 'text',
          md: 'A ring gives minimal disruption, but every lookup is a binary search, and balance depends on how many virtual nodes you use. **Maglev** precomputes a fixed-size **lookup table** of prime size M (e.g. 65,537) in which each backend owns about M/N slots. A lookup is a single array index: `table[hash(5-tuple) % M]`.',
        },
        {
          type: 'code',
          title: 'Maglev table population',
          lang: 'python',
          code: `def maglev_table(backends, M=65537):      # M must be prime
    """Each backend walks its own permutation of the slots and claims
    the next free one. Backends take turns until the table is full."""
    n = len(backends)
    offset = [h(b + "#offset") % M for b in backends]
    skip = [h(b + "#skip") % (M - 1) + 1 for b in backends]
    nxt = [0] * n
    table = [None] * M
    filled = 0
    while True:
        for i in range(n):
            c = (offset[i] + nxt[i] * skip[i]) % M
            while table[c] is not None:       # taken: next slot in MY permutation
                nxt[i] += 1
                c = (offset[i] + nxt[i] * skip[i]) % M
            table[c] = backends[i]
            nxt[i] += 1
            filled += 1
            if filled == M:
                return table

# per packet:  backend = table[h(five_tuple) % M]`,
        },
        {
          type: 'list',
          items: [
            { title: 'Even:', text: 'each backend owns M/N slots, give or take one.' },
            { title: 'Low disruption:', text: 'removing one backend changes its own slots and only a small fraction of the others.' },
            { title: 'Fast:', text: 'one array read per packet, which matters at millions of packets per second.' },
            { title: 'Agreement without talking:', text: 'every L4 node builds the **same table** from the same backend list, so any node can handle any packet of any flow. This becomes crucial in the HA phase.' },
          ],
        },
      ],
    },
    {
      type: 'deep',
      title: 'Go deeper: rendezvous (highest random weight) hashing',
      blocks: [
        {
          type: 'text',
          md: 'For each key, score every backend with `hash(key, backend)` and choose the highest score. Removing a backend moves only the keys it owned. It costs O(N) per lookup and needs no ring at all, which makes it a neat fit for small pools of a few dozen backends.',
        },
        {
          type: 'code',
          title: 'Rendezvous hashing in one line',
          lang: 'python',
          code: `def rendezvous(key, backends):
    return max(backends, key=lambda b: h(f"{key}|{b}"))`,
        },
      ],
    },
    {
      type: 'table',
      title: 'Which algorithm when?',
      head: ['Algorithm', 'Use when', 'Watch out for'],
      rows: [
        ['Round robin', 'Identical servers, uniform cheap requests', 'Slow servers still get a full share'],
        ['Weighted round robin', 'Mixed instance sizes; canaries (1 vs 99)', 'Ignores live load'],
        ['Least connections', 'Long or variable requests behind a single LB', 'Herding across many LB nodes'],
        ['P2C / least request', '**Default** for a distributed LB fleet', 'Not exactly optimal (by design)'],
        ['Latency-aware (EWMA)', 'Heterogeneous or noisy backends', 'Needs good latency signals; can oscillate'],
        ['Consistent / Maglev hash', 'Caches, stateful shards, L4 flow affinity', 'One hot key still overloads its backend'],
        ['Random', 'Huge pools of stateless servers', 'High variance with small pools'],
      ],
    },
    {
      type: 'yourturn',
      prompt: "Product wants a canary: 1% of traffic to v2 of the cart service. How do you do it with what you've built?",
      answer: "Two pools, `cart-v1` and `cart-v2`, and **weighted routing** between them in the L7 rule: 99 to 1. Smooth weighted round robin keeps that 1% evenly spread instead of bursty.\n\nRamp the weights 1 → 5 → 25 → 100 while watching v2's error rate and p99 against v1's. Roll back instantly by setting v2's weight to 0.\n\nIf the same user should consistently see v2, hash the user ID into 100 buckets and send bucket 0 to v2.",
    },
    {
      type: 'quiz',
      q: 'A new backend joins a pool served by 40 LB nodes, all using pure least-connections. What happens?',
      options: ['Nothing special', 'All 40 nodes see it as least loaded and flood it at once', 'It gets zero traffic forever', 'The other backends shut down'],
      answer: 1,
      explain: 'Each node has only a local view, and they all agree the newcomer has 0 connections. P2C, slow start, or both prevent the stampede.',
    },
    {
      type: 'quiz',
      q: '10 cache servers, keys placed with `hash(user) % N`. One server dies. Roughly what share of users now map to a different server?',
      options: ['~10%', '~50%', '~90%', '0%'],
      answer: 2,
      explain: 'A key stays only if `h % 10 == h % 9`, which is true for 9 out of every 90 hash values, so ~90% move. With consistent hashing only the dead server\'s ~10% move.',
    },
    {
      type: 'quiz',
      q: 'Why does Maglev use a lookup table instead of walking a hash ring?',
      options: ['Tables use less memory', 'One array read per packet is faster, and spreads load more evenly', "Rings can't handle IPv6", 'Tables never need rebuilding'],
      answer: 1,
      explain: 'At millions of packets per second, an O(1) array index beats a binary search, and the table guarantees each backend ~M/N slots.',
    },
  ],
});
