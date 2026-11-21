registerDeepDive({
  id: 'hashing-in-depth',
  title: 'Consistent Hashing, in Depth',
  short: 'Hashing deep',
  emoji: '💍',
  color: '#0d9488',
  related: 'consistent-hashing',
  tagline: 'Rings, vnodes, quorums, rendezvous, jump hash, Maglev and slots: how real systems decide where each key lives',
  hook: 'Every cache, database and load balancer answers one question billions of times a day: which machine owns this key? Here are the answers production actually uses.',
  intro: `The quick cards gave you the ring and virtual nodes. That's the classic answer, and it's only the start. Real systems also copy every key onto several machines, cap how hot any one server can get, and sometimes throw the ring away for an algorithm that needs no memory at all.

This deep dive walks through all of it: exactly why \`hash mod N\` collapses, how a ring lookup runs in code, why Cassandra cut its default virtual nodes from 256 to 16, how Dynamo-style quorums sit on top of the ring, and the newer algorithms from Google (jump hash, Maglev hashing, bounded loads). Then the contrarian: Redis Cluster, which uses 16,384 fixed slots instead of a ring.

Each part opens with a paragraph that also plays in your feed and ends with checkpoints. Key ideas come back more than once. That's deliberate: seeing the same idea from three angles is how it sticks.`,
  recap: [
    'hash mod N moves about N/(N+1) of keys when one server joins',
    'Ring: walk clockwise to the owner; virtual nodes even out the load',
    'Replicas go to the next distinct nodes; R + W > N makes quorums overlap',
    'Rendezvous, jump hash and Maglev skip the ring; bounded loads caps hot servers',
    'Redis Cluster uses 16,384 fixed slots that operators migrate explicitly',
  ],
});

deepSection('hashing-in-depth', {
  id: 'mod-n',
  nav: 'Why mod N breaks',
  title: 'Why hash mod N falls apart',
  goal: 'Say exactly how many keys move when N changes, and why that number is a disaster for caches and databases.',
  card: {
    emoji: '➗',
    text: `The simplest way to spread keys across N servers is \`hash(key) % N\`: even, stateless, and every client agrees. It breaks the moment N changes. Going from N to N+1 servers moves about **N/(N+1)** of all keys: 75% when you grow from 3 to 4 servers, about 91% from 10 to 11. For a cache that means a sudden wave of misses landing on the database at the worst moment. The ideal is the opposite: when a server joins, only its fair share, about **1/(N+1)** of keys, should move. Consistent hashing gets close to that ideal.`,
  },
  blocks: [
    {
      type: 'text',
      md: `A hash function turns any key, \`user:42\` or a URL or an IP address, into a big number that looks random but is completely deterministic. Same key, same number, on every machine, in every language, as long as everyone uses the same function. That determinism is the whole point: thousands of clients can agree on where a key lives **without asking a central directory**.

The obvious way to turn that number into a server is the modulo: \`server = hash(key) % N\`. It's perfectly balanced, costs nothing, and needs no state. It works beautifully right up until N changes. And N always changes: autoscaling adds servers at peak, a machine dies at 3am, a rolling upgrade takes one out of rotation, the team buys bigger boxes.`,
    },
    {
      type: 'text',
      md: `Here's the exact math. A key stays on the same server only if \`hash % N\` equals \`hash % (N+1)\`. Take any block of N × (N+1) consecutive hash values: exactly N of them satisfy both (the values 0 to N−1 at the start of the block). So for a uniform hash, only **1 in N+1 keys stays put**, and **N/(N+1) move**. Removing a server is just as bad.

The cruel part is that it gets *worse* as you grow. With 3 servers, adding one moves 75% of keys. With 100 servers, adding one moves 99%. The bigger and more important your fleet, the more an ordinary scaling event hurts.`,
    },
    {
      type: 'stats',
      stats: [
        { value: '75%', label: 'of keys move growing from 3 to 4 servers' },
        { value: '~91%', label: 'move growing from 10 to 11' },
        { value: '~99%', label: 'move growing from 100 to 101' },
        { value: '~9%', label: 'the ideal for 10 → 11: only the new server\'s share' },
      ],
      caption: 'With `hash % N`, the bigger the fleet, the worse adding one server gets. The ideal is 1/(N+1).',
    },
    {
      type: 'text',
      md: `**Why caches suffer.** Your database was sized for a 5% cache miss rate. You add one cache node to relieve pressure, and the miss rate jumps to about 90% because nearly every key now lives on a node that has never seen it. Every app server stampedes the database at once (a **thundering herd**). Adding capacity just caused an outage.

**Why databases suffer even more.** In a cache, a misplaced key is a miss. In a sharded database, it's data that must physically be copied to its new home. With \`hash % N\`, adding one node means moving almost the entire dataset across the network.`,
    },
    {
      type: 'callout',
      tone: 'key',
      title: 'The two properties you actually want',
      text: '**Balance:** every server gets about the same share of keys. **Minimal disruption** (often called monotonicity): when servers join or leave, only the keys that must move do move. `hash % N` nails balance and fails disruption completely. Every scheme in this deep dive is a different trade between these two, plus lookup speed and memory.',
    },
    {
      type: 'deep',
      title: 'Go deeper: where "consistent hashing" comes from',
      blocks: [
        {
          type: 'text',
          md: `The term comes from a 1997 paper by David Karger and colleagues at MIT, "Consistent Hashing and Random Trees", written to relieve hot spots on the early web by spreading content across many caches.

The word *consistent* refers to a subtle goal: different clients may have slightly different views of which caches exist, yet each key should still map to only a few caches, and adding or removing one cache should move only a small fraction of keys. The same research group went on to found **Akamai** in 1998, and mapping content onto servers this way was part of its foundation.`,
        },
      ],
    },
    {
      type: 'quiz',
      q: 'You grow a `hash % N` cache from 10 to 11 servers. Roughly what share of keys now map to a different server?',
      options: ['About 9%', 'About 50%', 'About 91%', 'None of them'],
      answer: 2,
      explain: 'Going from N to N+1 moves about **N/(N+1)** of keys: 10/11 ≈ 91%. Only 1 in 11 keys stays put.',
    },
    {
      type: 'quiz',
      q: 'When one server joins a cluster of N, what share of keys should ideally move?',
      options: ['About 1/(N+1): the newcomer\'s fair share', 'About half', 'About N/(N+1)', 'All of them'],
      answer: 0,
      explain: 'The new server should end up with an equal share, about 1/(N+1) of keys, and nothing else should move. That\'s minimal disruption.',
    },
  ],
});

deepSection('hashing-in-depth', {
  id: 'ring',
  nav: 'The ring',
  title: 'The ring, step by step',
  goal: 'Run a ring lookup in your head, and explain how it is implemented in a few lines of code.',
  card: {
    emoji: '💍',
    text: `Picture the hash space, say 0 to 2⁶⁴−1, bent into a circle. Hash each server's name to a point on it, and hash each key onto the same circle. A key belongs to the **first server clockwise** from its position, wrapping past the top. When a server leaves, only the keys in its arc move, all to the next server clockwise. When one joins, it takes over just the slice before it. In code the ring is simply a **sorted array** of server positions: a lookup is one binary search, O(log n), with no coordination between clients.`,
  },
  blocks: [
    {
      type: 'text',
      md: `The trick behind the ring is almost embarrassingly simple: **a server's position depends only on its own name**, not on how many servers there are. In \`hash % N\`, every key's destination depends on N, so changing N changes everything. On the ring, adding a server places one new point. Every other server stays exactly where it was, so the only keys that can possibly move are the ones in the arc where the newcomer lands.

Step through it below. Watch which keys change owner at each event, and notice how few there are.`,
    },
    {
      type: 'stepper',
      title: 'Four servers, four keys, one ring',
      diagram: {
        h: 316,
        nodes: [
          { id: 'a', x: 180, y: 38, label: 'A', icon: '🖥️', w: 56, h: 50 },
          { id: 'k1', x: 268, y: 69, label: 'cat', shape: 'pill', tone: 'warn', w: 46, h: 26 },
          { id: 'b', x: 312, y: 160, label: 'B', icon: '🖥️', w: 56, h: 50 },
          { id: 'k2', x: 273, y: 246, label: 'dog', shape: 'pill', tone: 'warn', w: 46, h: 26 },
          { id: 'c', x: 180, y: 282, label: 'C', icon: '🖥️', w: 56, h: 50 },
          { id: 'k3', x: 82, y: 242, label: 'fox', shape: 'pill', tone: 'warn', w: 46, h: 26 },
          { id: 'd', x: 48, y: 160, label: 'D', icon: '🖥️', w: 56, h: 50 },
          { id: 'k4', x: 82, y: 78, label: 'owl', shape: 'pill', tone: 'warn', w: 46, h: 26 },
        ],
        edges: [
          { from: 'a', to: 'k1', curve: -16, arrow: false },
          { from: 'k1', to: 'b', curve: -23, flow: true, tone: 'accent' },
          { from: 'b', to: 'k2', curve: -20, arrow: false },
          { from: 'k2', to: 'c', curve: -19, flow: true, tone: 'accent' },
          { from: 'c', to: 'k3', curve: -21, arrow: false },
          { from: 'k3', to: 'd', curve: -17, flow: true, tone: 'accent' },
          { from: 'd', to: 'k4', curve: -17, arrow: false },
          { from: 'k4', to: 'a', curve: -21, flow: true, tone: 'accent' },
        ],
        notes: [
          { x: 180, y: 154, text: 'clockwise ↻' },
        ],
      },
      steps: [
        {
          title: 'Hash the servers onto the circle',
          focus: ['a', 'b', 'c', 'd'],
          text: 'Each server\'s name (or IP) is hashed to a point on the 0 to 2⁶⁴−1 circle. Here A, B, C and D land at four spots. Their positions depend on nothing but their own names.',
        },
        {
          title: 'Hash a key onto the same circle',
          focus: ['k1'],
          text: 'The key `cat` is hashed with the same function and lands between A and B. Servers and keys share one hash space: that\'s what makes "next server" meaningful.',
        },
        {
          title: 'Walk clockwise to the first server',
          focus: ['k1', 'k1>b', 'b'],
          text: 'From `cat`, walk clockwise and take the first server you meet: **B** owns `cat`. A is numerically closer, but it\'s *behind* the key, so it doesn\'t count.',
        },
        {
          title: 'Every key follows the same rule',
          focus: ['k1>b', 'k2>c', 'k3>d', 'k4>a', 'b', 'c', 'd', 'a'],
          text: '`dog` goes to C, `fox` to D, and `owl` walks past the top of the circle and wraps around to **A**. Each server owns the arc that ends at its position.',
        },
        {
          title: 'Server B leaves',
          focus: ['k1', 'k1>b', 'b', 'b>k2', 'k2>c', 'c'],
          text: 'B crashes. `cat` now walks past where B was and lands on **C**. That\'s the only change: `dog`, `fox` and `owl` keep their owners. Only B\'s arc moved, and all of it went to one neighbor. (Remember that detail; part 3 fixes it.)',
        },
        {
          title: 'Server E joins between D and A',
          focus: ['k4', 'd>k4', 'k4>a', 'a'],
          text: 'Suppose a new server E hashes to a spot between `owl` and A. Now `owl` meets E before A, so `owl` moves from A to E. Nothing else moves. On average a newcomer takes about **K/N** keys (K keys, N servers), which is exactly its fair share.',
        },
        {
          title: 'How the lookup really runs',
          text: 'There is no circle in memory. The ring is a **sorted array** of server positions. To find a key\'s owner, binary-search for the first position greater than `hash(key)`; if you run off the end, wrap to index 0. That\'s O(log n) per lookup and a few lines of code.',
        },
      ],
    },
    {
      type: 'text',
      md: `Notice what *isn't* needed. Clients don't talk to each other and don't consult a directory. Two app servers on opposite sides of the world will route \`cat\` to the same cache, as long as they share two things: **the same list of servers** and **the same hash function** (including how server names are turned into points). Most real-world ring bugs come from breaking one of those two assumptions, as you'll see in part 8.

Memory is tiny: one array entry per server point. Even 1,000 servers with 200 points each is 200,000 entries, a few megabytes at most.`,
    },
    {
      type: 'callout',
      tone: 'trap',
      title: 'Next, not nearest',
      text: 'The owner is the first server **clockwise**, not the server whose hash is numerically closest. A server just behind the key doesn\'t own it. Mixing up "nearest" and "next" is a classic interview slip. What really matters is that every client uses the same rule.',
    },
    {
      type: 'quiz',
      q: 'Server B leaves a ring that has no virtual nodes. Where do B\'s keys go?',
      options: ['Spread evenly across all servers', 'All to the next server clockwise', 'To the server with the fewest keys', 'Nowhere until B returns'],
      answer: 1,
      explain: 'Only B\'s arc changes hands, and the whole arc goes to its clockwise neighbor. Every other key keeps its owner.',
    },
    {
      type: 'quiz',
      q: 'A ring has 400 points stored in a sorted array. How does a client find a key\'s owner?',
      options: ['Ask a central directory', 'Scan all 400 points', 'Binary-search for the first point after hash(key), wrapping to the start', 'Compute hash(key) % 400'],
      answer: 2,
      explain: 'A sorted array plus binary search gives O(log n) lookups. Running off the end wraps to index 0, which is the "circle".',
    },
  ],
});

deepSection('hashing-in-depth', {
  id: 'vnodes',
  nav: 'Virtual nodes',
  title: 'Virtual nodes: fixing the lumpy ring',
  goal: 'Explain why one point per server is uneven, how virtual nodes fix it, and why more is not always better.',
  card: {
    emoji: '👯',
    text: `With one point per server, arcs are wildly uneven: random points on a circle leave some gaps several times larger than others, so one server might hold twice its fair share. **Virtual nodes** fix this by hashing each physical server to many points (\`cache-a#0\`, \`cache-a#1\`, …). Many small arcs average out, a failed server's keys scatter across many survivors instead of crushing one neighbor, and a bigger machine can simply get more points. The cost: a bigger ring to store and, in replicated databases, each node shares data with more peers.`,
  },
  blocks: [
    {
      type: 'text',
      md: `Drop N random points on a circle and the gaps between them are nothing like equal. The average gap is 1/N of the circle, but the largest gap tends to be around **ln(N) times** the average, and some gaps are tiny. Since each server owns the arc before it, a ring with one point per server is lopsided by design: some servers carry far more than their share.

It gets worse on failure. When a server dies, its *entire* arc goes to one clockwise neighbor. That neighbor's load roughly doubles, it may fall over too, and now the next neighbor inherits two arcs. That's a cascading failure, started by the very mechanism meant to give you graceful scaling.`,
    },
    {
      type: 'text',
      md: `**Virtual nodes** (vnodes, or "tokens" in Cassandra) fix both problems at once. Instead of hashing \`cache-a\` once, you hash \`cache-a#0\`, \`cache-a#1\`, … \`cache-a#99\` and give the physical server all 100 points. Each server now owns many small arcs scattered around the ring, and the sum of many random arcs is much more even than one. A useful rule of thumb: the relative spread shrinks roughly with **1/√(points per server)**.

Here's what that looks like in practice, from one run of the Python ring further down (3 servers, 100,000 keys):`,
    },
    {
      type: 'table',
      title: 'Same 3 servers, same 100,000 keys, more points',
      head: ['Points per server', 'Keys per server', 'Spread'],
      rows: [
        ['1', '22,785 · 31,389 · 45,826', 'Biggest holds 2× the smallest'],
        ['10', '29,896 · 34,014 · 36,090', 'About ±10% of average'],
        ['100', '30,925 · 33,457 · 35,618', 'About ±7%'],
        ['1,000', '33,195 · 33,203 · 33,602', 'Within 1%'],
      ],
    },
    {
      type: 'code',
      title: 'A complete consistent-hash ring with virtual nodes',
      lang: 'python',
      code: `import bisect, hashlib
from collections import Counter

def h(s):
    # 64-bit ring position from MD5: stable across runs, machines and languages
    return int.from_bytes(hashlib.md5(s.encode()).digest()[:8], "big")

class Ring:
    def __init__(self, vnodes=100):
        self.vnodes = vnodes
        self.points = []   # sorted ring positions
        self.owner = {}    # position -> physical server

    def add(self, server, weight=1):
        for i in range(self.vnodes * weight):   # bigger box, more points
            p = h(f"{server}#{i}")
            self.owner[p] = server
            bisect.insort(self.points, p)

    def remove(self, server):
        self.points = [p for p in self.points if self.owner[p] != server]
        self.owner = {p: s for p, s in self.owner.items() if s != server}

    def get(self, key):
        # first point clockwise from the key; % wraps past the top of the ring
        i = bisect.bisect(self.points, h(key)) % len(self.points)
        return self.owner[self.points[i]]

ring = Ring(vnodes=100)
for s in ["cache-a", "cache-b", "cache-c"]:
    ring.add(s)

keys = [f"user:{n}" for n in range(100_000)]
before = {k: ring.get(k) for k in keys}
print(Counter(before.values()))           # roughly a third each

ring.add("cache-d")
moved = sum(before[k] != ring.get(k) for k in keys)
print(f"moved {moved / len(keys):.1%}")   # roughly a quarter: the newcomer's share`,
      caption: 'One run prints about 27% moved with 100 points per server, close to the newcomer\'s ideal 25%. Try `Ring(1)` and `Ring(1000)` and watch the balance change.',
    },
    {
      type: 'tabs',
      title: 'What virtual nodes buy you',
      tabs: [
        {
          label: '⚖️ Balance',
          blocks: [
            { type: 'text', md: 'Many small arcs per server average out into an even share. With 100 to 200 points per server, most fleets land within a few percent of perfect, which is why memcached client libraries and load balancers default to point counts in that range.' },
          ],
        },
        {
          label: '💥 Failure',
          blocks: [
            { type: 'text', md: 'When a server dies, each of its many arcs goes to a *different* clockwise neighbor. The dead server\'s load is spread across most of the survivors, each taking a small slice, instead of one neighbor taking everything. No cascade.' },
          ],
        },
        {
          label: '🏋️ Weights',
          blocks: [
            { type: 'text', md: 'A server\'s share is roughly proportional to its number of points. Twice the RAM? Give it twice the points (the `weight` argument in the code above). Draining a server gently? Lower its points step by step instead of removing it in one go.' },
          ],
        },
      ],
    },
    {
      type: 'text',
      md: `**So why not a million points per server?** For a cache client, memory is the only cost and it's small. For a **replicated database**, there's a subtler one. Replicas are placed on the next nodes clockwise (part 4), so every vnode creates replica relationships with its neighbors. With hundreds of vnodes per node, every node ends up sharing data ranges with nearly every other node. Repairs and data streaming then involve most of the cluster, and if any two or three nodes fail together, *some* range is very likely to lose a majority of its replicas.

That's why **Apache Cassandra 4.0 lowered its default \`num_tokens\` from 256 to 16**, pairing it with a token allocation algorithm that places those few tokens deliberately instead of randomly, so balance stays good without the downsides.`,
    },
    {
      type: 'quiz',
      q: 'Why do virtual nodes help when a server fails?',
      options: ['They make the server restart faster', 'They copy every key to every server', 'They stop keys from moving at all', 'Its keys scatter across many survivors instead of all landing on one neighbor'],
      answer: 3,
      explain: 'A server with many points owns many small arcs. When it dies, each arc goes to a different neighbor, so the load spreads out instead of doubling one machine.',
    },
    {
      type: 'quiz',
      q: 'Cassandra 4.0 cut its default vnodes per node from 256 to 16. What is a real downside of very many vnodes in a replicated database?',
      options: ['Lookups become O(n²)', 'Each node shares ranges with almost every other node, so repairs and multi-node failures touch more of the cluster', 'Keys can no longer be hashed', 'Every write must go to every node'],
      answer: 1,
      explain: 'Replicas follow ring neighbors. Hundreds of vnodes per node mean neighbors everywhere: repair and streaming involve most nodes, and losing a few nodes together is more likely to sink some range.',
    },
  ],
});

deepSection('hashing-in-depth', {
  id: 'replication',
  nav: 'Replicas & quorums',
  title: 'Replicas and quorums on the ring',
  goal: 'Explain preference lists, why R + W > N matters, and what happens when a replica is down.',
  card: {
    emoji: '🗳️',
    text: `Databases don't store a key once. In the Dynamo design, the first node clockwise from a key is its **coordinator**, and the key is also copied to the next N−1 *distinct physical* nodes clockwise: that list is the key's **preference list**. A write succeeds once **W** replicas confirm it, and a read asks **R** replicas. If R + W > N, every read set overlaps every write set, so a read normally sees the latest acknowledged write. With N=3, R=2, W=2 you survive one slow or dead replica on both paths.`,
  },
  blocks: [
    {
      type: 'text',
      md: `The ring makes replication almost free to describe. Any client can compute a key's owner, so any client can also compute the **next few** nodes clockwise. Amazon's 2007 Dynamo paper made this the template: a key lives on its coordinator plus the following N−1 nodes, and that ordered list is the key's **preference list**.

Two details matter in practice. First, with virtual nodes, the next few *points* may belong to the same physical machine, so the walk **skips points of machines already chosen**. Otherwise one machine dying could take out two of your three copies. Second, real deployments walk the ring with **topology awareness**: Cassandra's \`NetworkTopologyStrategy\`, for example, picks replicas in different racks within each data center, so a rack losing power can't take out every copy.`,
    },
    {
      type: 'stepper',
      title: 'One key, three replicas',
      diagram: {
        h: 320,
        nodes: [
          { id: 'a', x: 180, y: 40, label: 'A', icon: '🖥️', w: 56, h: 50 },
          { id: 'k', x: 242, y: 57, label: 'K', shape: 'pill', tone: 'warn', w: 46, h: 26 },
          { id: 'b', x: 288, y: 103, label: 'B', icon: '🖥️', w: 56, h: 50 },
          { id: 'c', x: 288, y: 227, label: 'C', icon: '🖥️', w: 56, h: 50 },
          { id: 'd', x: 180, y: 290, label: 'D', icon: '🖥️', w: 56, h: 50 },
          { id: 'e', x: 72, y: 227, label: 'E', icon: '🖥️', w: 56, h: 50 },
          { id: 'f', x: 72, y: 103, label: 'F', icon: '🖥️', w: 56, h: 50 },
        ],
        edges: [
          { from: 'a', to: 'k', curve: -8, arrow: false },
          { from: 'k', to: 'b', curve: -8, flow: true, tone: 'accent' },
          { from: 'b', to: 'c', curve: -26 },
          { from: 'c', to: 'd', curve: -26 },
          { from: 'd', to: 'e', curve: -26 },
          { from: 'e', to: 'f', curve: -26 },
          { from: 'f', to: 'a', curve: -26 },
        ],
        notes: [
          { x: 180, y: 158, text: 'N = 3' },
          { x: 180, y: 176, text: 'W = 2 · R = 2' },
        ],
      },
      steps: [
        {
          title: 'Hash the key',
          focus: ['k'],
          text: 'Key K hashes to a spot between A and B. Every client and every node computes the same position.',
        },
        {
          title: 'The coordinator: first node clockwise',
          focus: ['k', 'k>b', 'b'],
          text: 'B is the first node clockwise, so B **coordinates** requests for K: it receives the write and fans it out to the other replicas. (In practice any node can accept a request and forward it.)',
        },
        {
          title: 'Keep walking for replicas',
          focus: ['b', 'b>c', 'c', 'c>d', 'd'],
          text: 'With N=3, the next two distinct machines clockwise, C and D, hold copies too. K\'s preference list is **B, C, D**.',
        },
        {
          title: 'Write with W = 2',
          focus: ['b', 'c', 'd'],
          text: 'B stores the write and sends it to C and D. As soon as **two** of the three confirm, the client gets "OK". The third copy still arrives, just not on the critical path, so one slow replica can\'t stall the write.',
        },
        {
          title: 'Read with R = 2',
          focus: ['b', 'c', 'd'],
          text: 'A read asks two replicas. Since 2 + 2 > 3, any two readers share at least one node with any two writers, so at least one reply carries the latest acknowledged version. If replies differ, the newer one wins and the stale replica can be fixed on the spot (read repair).',
        },
        {
          title: 'C is down: sloppy quorum',
          diagram: {
            h: 320,
            nodes: [
              { id: 'a', x: 180, y: 40, label: 'A', icon: '🖥️', w: 56, h: 50, tone: 'muted' },
              { id: 'k', x: 242, y: 57, label: 'K', shape: 'pill', tone: 'warn', w: 46, h: 26 },
              { id: 'b', x: 288, y: 103, label: 'B', icon: '🖥️', w: 56, h: 50, tone: 'good' },
              { id: 'c', x: 288, y: 227, label: 'C', icon: '💀', w: 56, h: 50, tone: 'bad' },
              { id: 'd', x: 180, y: 290, label: 'D', icon: '🖥️', w: 56, h: 50, tone: 'good' },
              { id: 'e', x: 72, y: 227, label: 'E', icon: '📝', w: 56, h: 50, tone: 'warn' },
              { id: 'f', x: 72, y: 103, label: 'F', icon: '🖥️', w: 56, h: 50, tone: 'muted' },
            ],
            edges: [
              { from: 'a', to: 'k', curve: -8, arrow: false },
              { from: 'k', to: 'b', curve: -8, flow: true, tone: 'accent' },
              { from: 'b', to: 'c', curve: -26, dashed: true, tone: 'bad' },
              { from: 'c', to: 'd', curve: -26, dashed: true, tone: 'bad' },
              { from: 'd', to: 'e', curve: -26, flow: true, tone: 'warn' },
              { from: 'e', to: 'f', curve: -26 },
              { from: 'f', to: 'a', curve: -26 },
            ],
            notes: [
              { x: 180, y: 158, text: 'B, D + E (hint for C)' },
              { x: 180, y: 176, text: 'W = 2 still met' },
            ],
          },
          text: 'C has crashed. Rather than fail the write, Dynamo-style systems use the next healthy node, E, which stores K with a **hint**: "this belongs to C". When C comes back, E hands the data over and deletes its copy. That\'s **hinted handoff**.',
        },
      ],
    },
    {
      type: 'table',
      title: 'Tuning N, R and W',
      head: ['N/R/W', 'R + W > N?', 'What you get'],
      rows: [
        ['3, 2, 2', 'Yes (4 > 3)', 'The balanced default: reads overlap writes and both survive one slow or failed replica.'],
        ['3, 1, 3', 'Yes (4 > 3)', 'Fast reads, but a write fails if any replica is down.'],
        ['3, 3, 1', 'Yes (4 > 3)', 'Fast, highly available writes; every read needs all three replicas.'],
        ['3, 1, 1', 'No (2 ≤ 3)', 'Fastest and most available. A read may miss the latest write.'],
      ],
    },
    {
      type: 'text',
      md: `When replicas disagree, someone has to decide who wins. The original Dynamo attached **vector clocks** to values and, if two writes were truly concurrent, returned both versions and let the application merge them (the famous example: merging two versions of a shopping cart). Cassandra takes the simpler road of **last write wins**, using a timestamp on every cell.

Hints don't cover everything, for example a node that was down for days. So these systems also run **anti-entropy repair** in the background. Dynamo compared replicas cheaply with **Merkle trees**: hash trees over each key range, so two nodes can find which ranges differ by exchanging a handful of hashes instead of all the data.`,
    },
    {
      type: 'callout',
      tone: 'warn',
      title: 'R + W > N is not a magic consistency switch',
      text: 'Quorum overlap describes the steady state. Sloppy quorums can write to nodes outside the preference list, concurrent writes can conflict, and last-write-wins depends on clocks. So "R + W > N" usually means "reads normally see the latest write", not strict linearizability. Say that nuance in an interview and you\'ll stand out.',
    },
    {
      type: 'yourturn',
      prompt: 'A key\'s preference list is B, C, D with N=3 and W=2. Node C has been down for an hour. What happens to writes now, and what happens when C returns?',
      answer: `Writes still succeed. The coordinator writes to B and D, which already satisfies W=2, and with a sloppy quorum it also sends the third copy to the next healthy node, E, tagged with a hint that it belongs to C.

When C comes back, E notices and **hands off** the hinted data, then deletes it. Anything the hints missed (say, writes from before E took over, or hints that expired) is fixed by **anti-entropy repair**, which compares Merkle trees of each range and copies only the differences.`,
    },
    {
      type: 'quiz',
      q: 'With N=3 replicas, which R and W guarantee that every read set overlaps every write set?',
      options: ['R=1, W=1', 'R=1, W=2', 'R=2, W=2', 'R=0, W=3'],
      answer: 2,
      explain: 'Overlap needs **R + W > N**. Only R=2, W=2 gives 4 > 3. With R=1, W=2 (3, not more than 3) a read can miss the one replica that hasn\'t got the write.',
    },
    {
      type: 'quiz',
      q: 'Why must a preference list skip extra virtual nodes of the same physical server?',
      options: ['So the copies sit on different machines and one failure can\'t take out two', 'To keep the ring array sorted', 'Because virtual nodes can\'t store data', 'To make lookups O(1)'],
      answer: 0,
      explain: 'Three copies on two machines isn\'t three copies. Walking past points of machines already chosen keeps every replica on a distinct server (and ideally a distinct rack).',
    },
  ],
});

deepSection('hashing-in-depth', {
  id: 'rendezvous-jump',
  nav: 'Rendezvous & jump',
  title: 'No ring required: rendezvous and jump hash',
  goal: 'Explain two ring-free algorithms, what each costs, and where each one fits.',
  card: {
    emoji: '🎯',
    text: `Two famous algorithms skip the ring. **Rendezvous hashing** (highest random weight) scores every server with \`hash(key, server)\` and picks the highest score. Remove a server and only its keys move, each to its runner-up; for replicas, take the top k scores. Its cost is one hash per server per lookup. **Jump consistent hash**, published by Google in 2014, maps a key to one of n numbered buckets in a few lines of code, with no memory and near-perfect balance. Its catch: buckets can only be added or removed at the end.`,
  },
  blocks: [
    {
      type: 'text',
      md: `The ring isn't the only way to get minimal disruption. Both algorithms in this part reach it without storing any ring at all, and each is the best tool for a particular job. Switch between them below.`,
    },
    {
      type: 'tabs',
      tabs: [
        {
          label: '🎯 Rendezvous (HRW)',
          blocks: [
            {
              type: 'text',
              md: `**Rendezvous hashing**, also called **highest random weight (HRW)**, was described by David Thaler and Chinya Ravishankar at the University of Michigan in the mid-1990s. The idea fits in one sentence: for each key, compute a score \`hash(key, server)\` for every server and pick the server with the **highest score**.

Why is that consistent? Each server's score for a key depends only on that key and that server. Remove server D and the scores of A, B and C don't change, so only the keys D was winning move, each to whichever server had the second-highest score. Add a server E and it wins exactly the keys where its score beats the current winner, about 1/(N+1) of them. Minimal disruption, no ring, no virtual nodes.`,
            },
            {
              type: 'code',
              title: 'Rendezvous hashing, including top-k replicas',
              lang: 'python',
              code: `import hashlib

def score(key, server):
    digest = hashlib.md5(f"{server}|{key}".encode()).digest()
    return int.from_bytes(digest[:8], "big")

def owner(key, servers):
    return max(servers, key=lambda s: score(key, s))

def replicas(key, servers, k=3):        # the top-k scores: a preference list
    return sorted(servers, key=lambda s: score(key, s), reverse=True)[:k]

servers = ["cache-a", "cache-b", "cache-c", "cache-d"]
print(owner("user:42", servers), replicas("user:42", servers))`,
              caption: 'Remove `cache-d` and rerun over many keys: only the keys `cache-d` was winning move (about a quarter), and every other key keeps its owner.',
            },
            {
              type: 'list',
              items: [
                { title: 'Strength:', text: 'perfectly natural replica choice (top k scores), balance without virtual nodes, and a tiny implementation.' },
                { title: 'Weights:', text: 'scale the score as `w / −ln(u)`, where `u` is the hash mapped into (0, 1); a server with twice the weight wins about twice as many keys.' },
                { title: 'Cost:', text: 'one hash per server for every lookup, O(n). Great for tens or hundreds of servers; for thousands, systems precompute a table or use a hierarchical variant.' },
                { title: 'Seen in:', text: 'proxy cache arrays (the CARP protocol from the late 1990s), GitHub\'s GLB Director load balancer, and Apache Ignite\'s data placement.' },
              ],
            },
          ],
        },
        {
          label: '🦘 Jump hash',
          blocks: [
            {
              type: 'text',
              md: `**Jump consistent hash** was published in 2014 by John Lamping and Eric Veach at Google, under the title "A Fast, Minimal Memory, Consistent Hash Algorithm". It maps a 64-bit key to one of \`n\` buckets numbered 0 to n−1, using **no memory at all** beyond the inputs, about ln(n) loop iterations, and near-perfect balance.

The idea: imagine growing the number of buckets one at a time. When going from b to b+1 buckets, each key should move to the new bucket with probability 1/(b+1), which is exactly the newcomer's fair share. The algorithm seeds a pseudo-random generator with the key and, instead of checking every bucket, **jumps** straight to the next bucket count at which this particular key would move. The last jump that's still below n is the answer.`,
            },
            {
              type: 'code',
              title: 'Jump consistent hash (a Python port of the paper\'s C++)',
              lang: 'python',
              code: `def jump_hash(key: int, num_buckets: int) -> int:
    """Lamping & Veach, Google 2014. key must be a 64-bit integer hash."""
    b, j = -1, 0
    while j < num_buckets:
        b = j
        key = (key * 2862933555777941757 + 1) % 2**64   # 64-bit LCG step
        j = int((b + 1) * (2**31 / ((key >> 33) + 1)))  # next bucket count where this key jumps
    return b`,
              caption: 'Going from 10 to 11 buckets moves about 1/11 of keys, and every key that moves goes to the new bucket 10. Strings must be hashed to a 64-bit integer first.',
            },
            {
              type: 'callout',
              tone: 'warn',
              title: 'The catch: numbered buckets only',
              text: 'Jump hash returns a bucket **number**. You can grow from n to n+1 or shrink by removing the last bucket, but you can\'t remove bucket 3 because its machine died. So it fits storage systems where each bucket is a **replicated shard** that never truly disappears (a dead machine is replaced, the shard number lives on), not cache fleets where any box can vanish. It also has no built-in weights.',
            },
          ],
        },
      ],
    },
    {
      type: 'stepper',
      title: 'How jump hash grows, one bucket at a time',
      steps: [
        { title: 'One bucket', text: 'With n = 1, every key is in bucket 0. Nothing to decide.' },
        { title: 'Grow to two', text: 'Each key moves to the new bucket 1 with probability 1/2. Which keys move is decided by a pseudo-random sequence seeded with the key itself, so every client makes the same choice.' },
        { title: 'Grow to three', text: 'Each key moves to bucket 2 with probability 1/3. Keys only ever move **to the newest bucket**, never between old ones. That\'s minimal disruption by construction.' },
        { title: 'The general rule', text: 'Going from b to b+1 buckets moves 1/(b+1) of the keys, exactly the newcomer\'s fair share, so balance stays near perfect at every size.' },
        { title: 'The jump', text: 'Checking every bucket count up to n would be slow. Instead the algorithm computes the next count at which this key would move and jumps straight there. Those jumps get longer as b grows, which is why it takes only about ln(n) steps.' },
      ],
    },
    {
      type: 'table',
      title: 'Ring vs rendezvous vs jump',
      head: ['', 'Ring + vnodes', 'Rendezvous', 'Jump hash'],
      rows: [
        ['Lookup cost', 'O(log points), binary search', 'O(n): score every server', 'About ln(n) loop steps'],
        ['Memory', 'All ring points', 'The server list', 'None'],
        ['Remove any server?', 'Yes', 'Yes', 'Only the last bucket'],
        ['Weights', 'More points', 'Weighted score', 'Not directly'],
        ['Replicas', 'Walk to next distinct nodes', 'Take the top k scores', 'Usually each bucket is itself a replica set'],
      ],
    },
    {
      type: 'quiz',
      q: 'Rendezvous hashing picks a key\'s owner by…',
      options: ['Walking clockwise on a ring', 'Taking the server with the highest hash(key, server) score', 'Computing hash(key) % n', 'Asking a central directory'],
      answer: 1,
      explain: 'Every server gets a score for the key and the highest wins. Removing a server only moves the keys it was winning, each to its runner-up.',
    },
    {
      type: 'quiz',
      q: 'Why is jump hash a poor fit for a memcached fleet where any box can die?',
      options: ['It needs too much memory', 'It is too slow for caches', 'It can only remove the last-numbered bucket, not an arbitrary failed server', 'It can\'t hash string keys at all'],
      answer: 2,
      explain: 'Buckets are numbered 0 to n−1 and only the last can be removed. A dead cache box in the middle has no clean answer, while a ring or rendezvous handles it naturally.',
    },
  ],
});

deepSection('hashing-in-depth', {
  id: 'maglev-bounded',
  nav: 'Maglev & bounded loads',
  title: 'Maglev tables and bounded loads',
  goal: 'Explain how Maglev fills its lookup table, what it trades away, and how bounded loads keeps hot servers in check.',
  card: {
    emoji: '🧲',
    text: `Two Google ideas fix what plain rings get wrong. **Maglev hashing**, from Google's load balancer, precomputes a lookup table of prime size (65,537 slots is a common choice, and Envoy's default): each backend has its own preference order over the slots, and backends take turns claiming free ones. Lookups become a single array index and balance is nearly perfect, at the price of slightly more keys moving when backends change. **Consistent hashing with bounded loads** caps every server at (1+ε) times the average: if a key's server is full, the key walks on to the next one with room.`,
  },
  blocks: [
    {
      type: 'text',
      md: `Google's Maglev is a software L4 load balancer (described in an NSDI 2016 paper and covered in the L4 vs L7 deep dive). It has two needs a classic ring handles poorly: it must pick a backend for **every packet** at line rate, so it wants an O(1) lookup, and it wants backends of equal capacity to get **nearly equal** shares, without hundreds of virtual nodes.

Maglev's answer is a precomputed **lookup table** of prime size M. To choose a backend: \`table[hash(key) % M]\`. One array read. All the cleverness goes into how the table is filled:

1. Each backend derives two numbers from its name: an **offset** and a **skip** (between 1 and M−1).
2. Its **preference list** over the slots is offset, offset + skip, offset + 2·skip, …, all mod M. Because M is prime, this list visits every slot exactly once.
3. Backends take turns. On its turn, a backend walks its own list to the first **free** slot and claims it. Round after round, until the table is full.

Because everyone takes turns, each backend ends up with M/N slots, give or take one. That's near-perfect balance.`,
    },
    {
      type: 'table',
      title: 'Maglev\'s worked example: M = 7, three backends',
      head: ['Backend', 'Offset, skip', 'Preference order (slots)'],
      rows: [
        ['B0', '3, 4', '3, 0, 4, 1, 5, 2, 6'],
        ['B1', '0, 2', '0, 2, 4, 6, 1, 3, 5'],
        ['B2', '3, 1', '3, 4, 5, 6, 0, 1, 2'],
      ],
    },
    {
      type: 'table',
      title: 'The resulting table, before and after B1 is removed',
      head: ['Slot', '0', '1', '2', '3', '4', '5', '6'],
      rows: [
        ['Before', 'B1', 'B0', 'B1', 'B0', 'B2', 'B2', 'B0'],
        ['After', 'B0', 'B0', 'B0', 'B0', 'B2', 'B2', 'B2'],
      ],
    },
    {
      type: 'text',
      md: `Trace the first table yourself: in round one B0 takes slot 3, B1 takes slot 0, and B2 wants slot 3 but finds it taken, so it takes slot 4. Round two: B0 takes 1, B1 takes 2, B2 takes 5. Round three: B0 takes 6, and the table is full.

Now compare the rows. Slots 0 and 2 belonged to B1, so they had to move. But **slot 6 also moved**, from B0 to B2, even though B0 is perfectly healthy. That's the trade Maglev makes on purpose: **near-perfect balance at the cost of slightly more than minimal disruption.** The paper shows the extra churn stays small, especially when M is much larger than the number of backends.`,
    },
    {
      type: 'callout',
      tone: 'key',
      title: 'Why the extra churn is fine for a load balancer',
      text: 'Maglev also keeps a **connection table**: once a connection is assigned a backend, its packets keep going there even if the lookup table changes. Only new connections use the new table. So a little churn in the table costs nothing for live traffic, while perfect balance saves real money on every backend.',
    },
    {
      type: 'text',
      md: `**Bounded loads** attacks a different problem. Even a perfectly balanced key space doesn't guarantee balanced *load*, because some keys are far more popular than others, and with a modest number of servers some arcs are simply bigger. In a load balancer hashing users to cache servers, one server can end up with far more active requests than the rest.

In 2016, Vahab Mirrokni, Mikkel Thorup and Morteza Zadimoghaddam at Google Research published **consistent hashing with bounded loads** (Google's research blog featured it in 2017). Pick a balance parameter ε. Each server's capacity is **⌈(1+ε) × average load⌉**. A key goes to its usual server on the ring, unless that server is at capacity, in which case it keeps walking clockwise to the **first server with room**. Load is now capped at (1+ε) times the average, and the paper proves the number of keys that move when servers or keys change stays bounded too.

**Vimeo** implemented it in HAProxy for its video caches and contributed it upstream, where it's the \`hash-balance-factor\` setting. Envoy exposes the same idea as \`hash_balance_factor\` for its ring hash and Maglev policies.`,
    },
    {
      type: 'stepper',
      title: 'Bounded loads in action: 4 servers, ε = 0.25',
      steps: [
        { title: 'Set the cap', text: 'Eight requests are in flight across four servers, so the average is 2. With ε = 0.25 the cap is ⌈1.25 × 2⌉ = **3** requests per server.' },
        { title: 'Normal case', text: 'A request for video X hashes to server A, which has 1 request. A serves it. Most requests take this path, so most keys keep their cache-friendly home.' },
        { title: 'A popular video fills A', text: 'A trending video sends more requests to A until it holds 3, its cap. A is now full, even though it\'s still healthy.' },
        { title: 'Overflow walks clockwise', text: 'The next request that hashes to A skips it and walks clockwise to B, which has room. B serves it, warming its cache for that video too.' },
        { title: 'Back to normal', text: 'As A\'s requests finish it drops below the cap and accepts its keys again. Tuning ε is the trade: small ε means tight balance but more spillover and cache misses; large ε means better locality but looser balance.' },
      ],
    },
    {
      type: 'quiz',
      q: 'With bounded loads, what happens when a key\'s server is already at its cap?',
      options: ['The request is rejected', 'The cap is raised for that server', 'The whole ring is rebuilt', 'The key walks clockwise to the next server with room'],
      answer: 3,
      explain: 'A full server is skipped, not failed: the key keeps walking clockwise to the first server under the (1+ε) × average cap.',
    },
    {
      type: 'quiz',
      q: 'In the Maglev example, slot 6 moved from B0 to B2 when B1 was removed, although B0 is healthy. What does this show?',
      options: ['A bug in the algorithm', 'Maglev trades a little extra disruption for near-perfect balance', 'Maglev rebuilds its table randomly', 'B0 was overloaded'],
      answer: 1,
      explain: 'Backends refill the table by taking turns, which keeps shares nearly equal but can reassign a few slots that didn\'t strictly need to move. A connection table hides that churn from live connections.',
    },
  ],
});

deepSection('hashing-in-depth', {
  id: 'slots',
  nav: 'Redis slots',
  title: 'Fixed slots: why Redis Cluster skipped the ring',
  goal: 'Explain hash slots, hash tags and MOVED/ASK redirects, and when fixed slots beat a ring.',
  card: {
    emoji: '🎰',
    text: `Redis Cluster doesn't use a ring. Every key maps to one of **16,384 hash slots** with \`CRC16(key) mod 16384\`, and each primary node owns ranges of slots. Adding a node means explicitly migrating some slots to it, key by key, while clients follow \`MOVED\` and \`ASK\` redirects and update their slot map. **Hash tags** like \`{user:1000}:cart\` hash only the part in braces, so related keys share a slot and multi-key commands work. Fixed slots trade automatic placement for control: operators decide exactly what moves, and when.`,
  },
  blocks: [
    {
      type: 'text',
      md: `Fixed slots add one level of indirection: **key → slot → node**. The first step is a fixed function that never changes, because the number of slots never changes. Only the second step, a small table saying which node owns which slots, changes when the cluster changes. Rebalancing means moving whole slots, and since keys never change slots, nothing moves unless an operator (or a tool) decides to move it.

It's the same idea behind several systems: the Dynamo paper's later strategy of fixed, equal-size partitions; Couchbase's 1,024 vBuckets; and Elasticsearch's primary shard count, fixed when an index is created. A ring decides placement for you. Slots let you decide.`,
    },
    {
      type: 'code',
      title: 'Slots and hash tags in redis-cli',
      lang: 'text',
      code: `127.0.0.1:7000> CLUSTER KEYSLOT user:1000
(integer) 1649
127.0.0.1:7000> CLUSTER KEYSLOT user:1000:cart
(integer) 7185
127.0.0.1:7000> CLUSTER KEYSLOT {user:1000}:cart
(integer) 1649
127.0.0.1:7000> GET user:1000:cart
(error) MOVED 7185 127.0.0.1:7001`,
      caption: 'Slot numbers are real CRC16 results. With the hash tag `{user:1000}`, the cart lands in the user\'s slot, so a transaction or Lua script can touch both. Without it, the cart lives in another slot, possibly on another node.',
    },
    {
      type: 'text',
      md: `**Hash tags** are the escape hatch for multi-key operations. If a key contains \`{…}\` with something inside, Redis hashes **only** the substring between the first \`{\` and the next \`}\`. So \`{user:1000}:cart\` and \`{user:1000}:profile\` always share a slot. Use them carefully: tag everything with one value and you've put all your data in one slot on one node.

**Why 16,384?** Salvatore Sanfilippo, Redis's creator, explained it: nodes constantly exchange heartbeat messages that include a bitmap of the slots they own. 16,384 bits is 2 KB, small enough to send often, while 65,536 slots would need 8 KB. And since Redis Cluster isn't designed for more than roughly 1,000 primary nodes, 16,384 slots still leaves plenty of granularity per node.`,
    },
    {
      type: 'stepper',
      title: 'Moving slot 7185 from node A to node B, live',
      steps: [
        { title: 'Mark both sides', text: 'The operator tells B the slot is `IMPORTING` from A, and tells A the slot is `MIGRATING` to B (both with `CLUSTER SETSLOT`). The slot still officially belongs to A.' },
        { title: 'Move keys in batches', text: '`MIGRATE` copies keys from A to B atomically, a batch at a time, deleting them from A once B has them. During this, some of the slot\'s keys are on A and some on B.' },
        { title: 'ASK: a one-time detour', text: 'A client asks A for a key. If A still has it, A answers. If it has already moved, A replies `-ASK 7185 B`. The client sends `ASKING` and then the command to B, **just this once**, and keeps its slot map unchanged, because the migration isn\'t finished.' },
        { title: 'Hand over the slot', text: 'When the slot is empty on A, `CLUSTER SETSLOT 7185 NODE B` assigns it to B, and the new ownership spreads through the cluster\'s gossip.' },
        { title: 'MOVED: update your map', text: 'A client that still sends slot 7185 to A now gets `-MOVED 7185 B`. Unlike ASK, MOVED is permanent: the client updates its cached slot map, so all future requests for that slot go straight to B.' },
      ],
    },
    {
      type: 'table',
      title: 'Choosing a scheme',
      head: ['Scheme', 'Lookup', 'Balance', 'Remove any node?', 'Typical home'],
      rows: [
        ['`hash % N`', 'O(1)', 'Perfect', 'Yes, but almost all keys move', 'Systems that never resize'],
        ['Ring + vnodes', 'O(log points)', 'Good with enough vnodes', 'Yes', 'Cassandra, memcached clients, NGINX and HAProxy consistent hashing'],
        ['Rendezvous', 'O(servers)', 'Good', 'Yes', 'Small server sets, top-k replica choice, GitHub GLB'],
        ['Jump hash', 'About ln(n) steps', 'Near perfect', 'Only the last bucket', 'Numbered shards of replicated storage'],
        ['Maglev', 'O(1) table read', 'Near perfect', 'Yes, with a little extra churn', 'L4 load balancers, Envoy\'s maglev policy'],
        ['Fixed slots', 'O(1) table read', 'Whatever you assign', 'Yes, by migrating slots', 'Redis Cluster, Couchbase vBuckets'],
      ],
    },
    {
      type: 'quiz',
      q: 'In Redis Cluster, why would you name keys `{user:1000}:cart` and `{user:1000}:profile`?',
      options: ['So both hash to the same slot and multi-key operations work', 'To encrypt the user ID', 'To set a default TTL', 'To spread them across more nodes'],
      answer: 0,
      explain: 'Redis hashes only the text inside the braces, so both keys land in one slot on one node. That makes transactions, Lua scripts and multi-key commands possible.',
    },
    {
      type: 'quiz',
      q: 'A client gets `-MOVED 7185 127.0.0.1:7001`. What should it do?',
      options: ['Retry the same node later', 'Send ASKING and retry once on that node', 'Update its slot map so slot 7185 points to that node, then retry there', 'Give up: the key is lost'],
      answer: 2,
      explain: '**MOVED** means ownership has changed for good, so the client updates its map. **ASK** is the one-time detour during a migration, sent after an ASKING command.',
    },
  ],
});

deepSection('hashing-in-depth', {
  id: 'in-the-wild',
  nav: 'In the wild',
  title: 'Where it runs, and how it breaks',
  goal: 'Name real systems for each algorithm, and diagnose the classic consistent-hashing failures.',
  card: {
    emoji: '🌍',
    text: `Consistent hashing is everywhere data is spread across machines. **Amazon's Dynamo** paper (2007) put rings, virtual nodes and quorums into the mainstream. **Cassandra** assigns token ranges on a ring. **Memcached** clients popularized the ketama ring, which NGINX's \`consistent\` hash option also uses. **Envoy** offers ring hash and Maglev policies, and GitHub's load balancer uses rendezvous hashing. The failures repeat too: one viral key melts its server, flapping nodes churn the cache, and clients that disagree about membership send the same key to different places.`,
  },
  blocks: [
    {
      type: 'text',
      md: `Swipe through the systems below. Notice how the same handful of ideas keeps coming back: a ring with many points, a deterministic way to choose replicas, and a strong preference for algorithms every client can compute on its own.`,
    },
    {
      type: 'wild',
      title: 'In the wild: who uses which algorithm',
      items: [
        {
          emoji: '📦',
          who: 'Amazon',
          what: 'Dynamo (2007 paper)',
          tags: ['ring + vnodes', 'quorums'],
          text: `The Dynamo paper described the key-value store behind parts of Amazon's shopping cart: a ring with virtual nodes, preference lists, sloppy quorums with hinted handoff, vector clocks for conflicts, and Merkle trees for repair. It also reported moving to fixed, equal-size partitions to make bootstrapping and backups simpler.

It inspired Cassandra, Riak and Voldemort. Note that DynamoDB, the AWS service launched in 2012, borrows the name and lessons but is a different system internally.`,
        },
        {
          emoji: '👁️',
          who: 'Apache Cassandra',
          what: 'Token ring',
          tags: ['ring', 'vnodes 256 → 16'],
          text: `Each Cassandra node owns token ranges on a ring; the default Murmur3Partitioner hashes partition keys into the range −2⁶³ to 2⁶³−1. Replication strategies walk the ring clockwise, and \`NetworkTopologyStrategy\` spreads replicas across racks and data centers.

Version 4.0 cut the default \`num_tokens\` from 256 to 16 and added smarter token allocation, keeping balance while reducing repair and availability costs.`,
        },
        {
          emoji: '🧠',
          who: 'Memcached clients',
          what: 'ketama',
          tags: ['ring', 'client-side'],
          text: `Memcached servers don't know about each other: the **client** picks the server. Last.fm released the ketama library in 2007, a ring built with MD5 and many points per server (classic ketama uses 160, scaled by weight), and it became a de facto standard so clients in different languages map keys identically.

NGINX's \`hash $key consistent;\` directive uses the ketama method too.`,
        },
        {
          emoji: '🛰️',
          who: 'Envoy',
          what: 'ring_hash and maglev policies',
          tags: ['L7 proxy', 'session affinity'],
          text: `Envoy can hash on a header, cookie, source IP or query parameter and route with a **ring hash** (minimum ring size 1,024 by default) or **Maglev** (table size 65,537 by default). Teams use it to keep a user on the same backend or to send the same object to the same cache.

A \`hash_balance_factor\` setting adds bounded loads, so one hot key range can't overload a host.`,
        },
        {
          emoji: '⚙️',
          who: 'HAProxy',
          what: 'hash-type consistent',
          tags: ['L4/L7 proxy', 'bounded loads'],
          text: `With \`hash-type consistent\`, HAProxy places servers on a ring with many points, so balancing by URI or source IP survives servers coming and going.

Vimeo engineers implemented consistent hashing with bounded loads in HAProxy for their video caches and contributed it upstream as \`hash-balance-factor\`.`,
        },
        {
          emoji: '🐙',
          who: 'GitHub',
          what: 'GLB Director',
          tags: ['rendezvous', 'L4 LB'],
          text: `GitHub's L4 load balancer uses **rendezvous hashing** to choose a primary and a secondary backend for each entry of its forwarding table. Packets carry both, so if the primary doesn't recognize a connection it can pass the packet to the secondary: GitHub calls this a "second chance".`,
        },
        {
          emoji: '🔍',
          who: 'Google',
          what: 'Maglev, jump hash, bounded loads',
          tags: ['research', 'production'],
          text: `Three of the algorithms in this deep dive came out of Google: **jump consistent hash** (2014), **Maglev hashing** in its software load balancer (NSDI 2016), and **consistent hashing with bounded loads** from Google Research (2016, featured on its blog in 2017).`,
        },
        {
          emoji: '🎮',
          who: 'Discord',
          what: 'Hash ring for guilds',
          tags: ['ring', 'Elixir'],
          text: `Discord's backend routes each guild (a Discord "server") to a process on one machine of its Elixir cluster using a consistent hash ring, so every node agrees where a guild lives. Discord open-sourced its Elixir implementation as \`ex_hash_ring\`.`,
        },
      ],
    },
    {
      type: 'text',
      md: `Now the other side. Each scenario below is a real failure pattern. Diagnose it before you tap to reveal the answer.`,
    },
    {
      type: 'yourturn',
      prompt: '💥 A celebrity posts a link. One cache node goes to 100% CPU while the other 49 sit at 20%. You already use 200 virtual nodes per server.',
      answer: `**A hot key.** Consistent hashing balances *keys*, not *traffic*. One viral key still maps to exactly one server, and no amount of virtual nodes or bounded loads changes that, since bounded loads moves whole keys, not requests for a single key.

**Fixes:** detect hot keys and replicate them, for example by appending a random suffix (\`post:9:r1\` … \`post:9:r8\`) so reads spread over eight servers; add a small in-process cache on the app servers for the hottest keys; or serve them from a CDN.`,
    },
    {
      type: 'yourturn',
      prompt: '💥 Cache hit rate keeps dipping every few minutes. Logs show one node repeatedly failing a health check, being removed from the ring, then re-added 30 seconds later.',
      answer: `**A flapping node.** Each removal moves that node's keys to its neighbors (cold misses there), and each re-add moves them back (cold misses again). The ring is doing its job; membership is changing too often.

**Fixes:** add hysteresis (remove only after several consecutive failures, re-add only after it's been healthy for a while), and treat a briefly unreachable node as "skip for now" in the client instead of rewriting the ring for everyone.`,
    },
    {
      type: 'yourturn',
      prompt: '💥 After a deploy, half your app servers read stale cart data. The other half are fine. A new cache node was added around the same time.',
      answer: `**Clients disagree about membership.** Servers with the new list send some keys to the new node; servers with the old list still use the old owner. The same key now has two copies, and writes through one group never reach the other's copy.

**Fixes:** have a single source of truth for membership (a config service, etcd or ZooKeeper, or gossip that converges), version the ring and roll changes out quickly, and invalidate or use short TTLs around membership changes.`,
    },
    {
      type: 'yourturn',
      prompt: '💥 A Python service and a Java service share one memcached fleet. They each see the other\'s writes as misses, even though both use "consistent hashing".',
      answer: `**Incompatible rings.** Consistent hashing only agrees if every client uses the same hash function, the same point naming (\`server#i\` vs \`server-i\`), the same number of points and the same ordering rules. Two libraries with different defaults build different rings.

**Fix:** configure every client for the same scheme, typically ketama-compatible mode, and test it by checking that both clients map a sample of keys to the same servers.`,
    },
    {
      type: 'yourturn',
      prompt: '💥 You add partitions to a Kafka topic to get more throughput. Now events for the same customer are sometimes processed out of order.',
      answer: `**That's \`hash % N\` in disguise.** Kafka's default partitioner picks a partition from a hash of the key modulo the partition count. Change the count and most keys map to a new partition, while their older events are still waiting in the old one, so per-key ordering breaks during the transition.

**Fixes:** choose a generous partition count up front, or, if you must grow, migrate deliberately (for example, a new topic and a coordinated cutover).`,
    },
    {
      type: 'callout',
      tone: 'tip',
      title: 'The question behind every failure',
      text: 'Consistent hashing gives you **agreement and stability**: everyone computes the same owner, and few keys move when membership changes. It doesn\'t give you **load balance for skewed traffic**, and it can\'t protect you when clients disagree about membership. When something breaks, ask: is this a hot key, a membership problem, or a mismatch between clients?',
    },
    {
      type: 'quiz',
      q: 'Which problem does consistent hashing NOT solve by itself?',
      options: ['Keys reshuffling when nodes join', 'One viral key overloading its server', 'Clients agreeing on an owner without a directory', 'Spreading keys across nodes'],
      answer: 1,
      explain: 'A key maps to one owner, so a viral key hammers one server no matter how good the ring is. Replicate hot keys or cache them closer to the app.',
    },
    {
      type: 'quiz',
      q: 'Half your app servers think the cache fleet has 10 nodes and half think it has 11. What goes wrong?',
      options: ['Nothing, the ring absorbs it', 'Every key moves to a new node', 'The same key can map to two nodes: extra misses and stale copies', 'The ring array becomes unsorted'],
      answer: 2,
      explain: 'Consistent hashing only works if clients share the same membership. With two views, about 1/11 of keys have two owners: one group writes to one copy while the other reads another.',
    },
  ],
});

deepSection('hashing-in-depth', {
  id: 'recap',
  nav: 'Explain it back',
  title: 'Explain it back',
  goal: 'Say every idea out loud, in full sentences, before you flip the card.',
  card: {
    emoji: '🧠',
    text: `In one breath: \`hash % N\` is balanced but moves almost every key when N changes. A ring hashes servers and keys into one space and gives each key to the next server clockwise, so a change moves only about 1/N of keys, and virtual nodes even out the arcs. Databases replicate onto the next distinct nodes and use R + W > N quorums. Rendezvous, jump hash and Maglev reach the same goal without a ring, bounded loads caps hot servers, and Redis Cluster uses fixed slots. Now flip the cards.`,
  },
  blocks: [
    {
      type: 'text',
      md: `Reading builds familiarity. **Recalling** builds memory. Try to answer each card out loud, as if an interviewer just asked you, before you flip it. If you stumble, scroll back to that part and read it again: the second pass is where it sticks.`,
    },
    {
      type: 'flashcards',
      cards: [
        { q: 'Why does `hash % N` fail when you add a server?', a: 'About N/(N+1) of keys map to a different server (about 91% going from 10 to 11), which means a cache miss storm or moving nearly all data. Ideally only the newcomer\'s share, 1/(N+1), would move.' },
        { q: 'How does a ring lookup work, and how is it implemented?', a: 'Servers and keys are hashed into one circular space; a key\'s owner is the first server point clockwise. In code: a sorted array of points plus a binary search, wrapping to index 0. O(log n).' },
        { q: 'What moves when a server joins or leaves a ring?', a: 'Only the affected arc. A newcomer takes the keys between its predecessor and itself; a leaver\'s keys go to the next server clockwise. On average about K/N keys move.' },
        { q: 'What do virtual nodes fix, and what do they cost?', a: 'They even out lumpy arcs, spread a failed server\'s load across many survivors, and allow weights. The cost: more ring memory and, in replicated databases, each node shares ranges with more peers, which is why Cassandra 4.0 dropped the default from 256 to 16 tokens.' },
        { q: 'What is a preference list?', a: 'For a key: the coordinator (first node clockwise) plus the next N−1 distinct physical nodes clockwise, ideally in different racks or zones. It\'s where the replicas live.' },
        { q: 'Why does R + W > N matter, and what doesn\'t it promise?', a: 'Every read quorum overlaps every write quorum, so a read normally reaches at least one replica with the latest acknowledged write. It isn\'t strict linearizability: sloppy quorums, concurrent writes and clock-based conflict resolution can still surprise you.' },
        { q: 'Rendezvous hashing in one sentence, plus its trade-off.', a: 'Score every server with hash(key, server) and take the highest (top k for replicas): minimal disruption with no ring, but O(n) work per lookup.' },
        { q: 'What is jump hash great at, and what can\'t it do?', a: 'No memory, about ln(n) steps, near-perfect balance, and growing from n to n+1 buckets moves exactly the fair 1/(n+1). But buckets are numbered and only the last can be removed, and it has no built-in weights.' },
        { q: 'What do Maglev hashing and bounded loads each add?', a: 'Maglev: a prime-size table filled by backends taking turns, giving O(1) lookups and near-perfect balance with slightly more churn. Bounded loads: a cap of (1+ε) × average per server, with overflow walking clockwise to the next server with room.' },
        { q: 'How does Redis Cluster place keys, and how do clients follow resharding?', a: 'CRC16(key) mod 16,384 picks a slot, and nodes own slot ranges; hash tags in braces co-locate keys. During a migration, ASK is a one-time redirect (after ASKING). Afterwards, MOVED tells the client to update its slot map.' },
      ],
    },
    {
      type: 'quiz',
      q: 'Which statement is true?',
      options: ['Virtual nodes make ring lookups O(1)', 'On a ring, adding a server moves only about 1/N of keys', 'Jump hash can remove any failed server', 'Redis Cluster hashes keys onto a ring'],
      answer: 1,
      explain: 'The newcomer takes over one slice of the ring, about 1/N of keys. Lookups stay O(log n), jump hash removes only the last bucket, and Redis uses fixed slots.',
    },
    {
      type: 'quiz',
      q: 'You must pick 3 replicas per key from 20 storage nodes, and any node may fail. Which fits best?',
      options: ['Jump hash', 'hash(key) % 20', 'Rendezvous hashing, taking the top 3 scores (or a ring preference list)', 'A random choice per request'],
      answer: 2,
      explain: 'Top-k rendezvous (or walking a ring to the next distinct nodes) gives every client the same three replicas, and a failure only reshuffles keys that involved the failed node.',
    },
  ],
});
