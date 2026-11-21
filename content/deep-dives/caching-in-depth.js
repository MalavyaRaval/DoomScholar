registerDeepDive({
  id: 'caching-in-depth',
  title: 'Caching & Redis, in Depth',
  short: 'Caching deep',
  emoji: '🗃️',
  color: '#e11d48',
  related: 'caching-redis',
  tagline: 'Every cache layer, the stale-data race, Redis internals, stampedes, and how Facebook caches at scale',
  hook: 'You know cache-aside and TTLs. Now go inside: the stale-data race, Redis\'s single thread, 16,384 cluster slots, stampede-proof leases, and how Facebook caches a billion requests a second.',
  intro: `The quick cards gave you the vocabulary: hits, misses, TTLs, cache-aside, LRU. That's enough to draw a Redis box on a whiteboard. It isn't enough to explain why a user still sees their old name after an update, why Redis stalls every client at once, or why the database dies the instant a single key expires.

This deep dive goes underneath. You'll follow a request through every cache layer between a phone and a disk, walk through the race condition that leaves stale data in a correctly written cache, see how Redis actually evicts, persists, replicates and shards, and learn the tricks Facebook, Netflix, Twitter and Stack Overflow use to keep their databases alive.

Each part opens with a paragraph that also shows up in your feed, and ends with checkpoints. You'll meet the big ideas more than once. That's the point.`,
  recap: [
    'Caches live at every layer, and each layer passes only its misses down',
    'Default recipe: cache-aside, delete on write, and a TTL as the safety net',
    'Redis: atomic single-threaded commands, rich structures, RDB/AOF, 16,384 cluster slots',
    'Stampedes: coalesce, lock, jitter, refresh early. Hot keys: local copies or split keys',
    'Facebook memcache: leases, commit-log invalidation, and a Gutter pool for failed servers',
  ],
});

deepSection('caching-in-depth', {
  id: 'layers',
  nav: 'Where caches live',
  title: 'Where caches live: from your phone to the disk',
  goal: 'Name every cache layer a request can hit, what each is good at, and why hit ratio matters so much.',
  card: {
    emoji: '🧅',
    text: `A cache is any copy of data kept closer to whoever needs it. A request can be answered at many layers: the **browser** (no network at all), a **CDN** edge near the user, a **reverse proxy** in front of your servers, **in-process memory** inside each app server, a shared **Redis or Memcached** cluster about one network hop away, and finally the database's own **buffer pool** of hot pages. Each layer only passes its misses down. The closer the hit, the cheaper it is, and the harder it becomes to keep that copy fresh.`,
  },
  blocks: [
    {
      type: 'text',
      md: `"Add a cache" sounds like one decision. In a real system it's half a dozen, because there are caches at almost every hop between a user's thumb and a spinning disk. Each one exists because the layer behind it is slower, more expensive, or further away.

The rule that ties them together: **each layer only forwards its misses**. If the browser has a fresh copy, nothing leaves the phone. If the CDN has it, your servers never hear about the request. If Redis has it, the database never runs the query. A healthy stack is a funnel, and the database at the bottom sees only a small fraction of the traffic at the top.`,
    },
    {
      type: 'stepper',
      title: 'One request falling through the layers',
      diagram: {
        h: 270,
        nodes: [
          { id: 'b', x: 60, y: 60, label: 'Browser', icon: '💻' },
          { id: 'cdn', x: 180, y: 60, label: 'CDN edge', icon: '🌍' },
          { id: 'px', x: 300, y: 60, label: 'Reverse\nproxy', icon: '🔀' },
          { id: 'app', x: 300, y: 190, label: 'App\nmemory', icon: '🖥️', tone: 'accent' },
          { id: 'rd', x: 180, y: 190, label: 'Redis /\nMemcached', icon: '⚡', tone: 'good' },
          { id: 'db', x: 60, y: 190, label: 'DB buffer\npool', icon: '🗄️', shape: 'db' },
        ],
        edges: [
          { from: 'b', to: 'cdn', flow: true },
          { from: 'cdn', to: 'px', flow: true },
          { from: 'px', to: 'app', flow: true },
          { from: 'app', to: 'rd', flow: true },
          { from: 'rd', to: 'db', flow: true },
        ],
        notes: [{ x: 180, y: 258, text: 'each layer forwards only its misses' }],
      },
      steps: [
        {
          title: 'The browser cache',
          focus: ['b'],
          text: 'The fastest request is the one never sent. If the last response said `Cache-Control: max-age=300`, the browser reuses its copy for five minutes without touching the network. After that it can **revalidate**: send `If-None-Match` with the ETag it has, and the server answers a tiny `304 Not Modified` if nothing changed.',
        },
        {
          title: 'The CDN edge',
          focus: ['b>cdn', 'cdn'],
          text: 'A CDN keeps copies in data centers close to users, so a hit costs a short trip to a nearby city instead of a trip to your origin. It shines for images, video, JavaScript, CSS, and any response that is identical for many users.',
        },
        {
          title: 'The reverse proxy',
          focus: ['cdn>px', 'px'],
          text: 'In front of your app servers, NGINX\'s `proxy_cache` or Varnish can store whole HTTP responses. One cached page can absorb thousands of identical requests that would otherwise each run your application code.',
        },
        {
          title: 'In-process memory',
          focus: ['px>app', 'app'],
          text: 'Inside each app server, a small in-memory map (Caffeine in Java, an LRU dictionary in Python) answers in well under a microsecond, with no network at all. The catch: every server holds its own copy, so memory is duplicated and invalidating a value means telling every server.',
        },
        {
          title: 'The shared cache: Redis or Memcached',
          focus: ['app>rd', 'rd'],
          text: 'One network round trip inside the data center, typically well under a millisecond. Every app server sees the same copy, so a single delete fixes stale data for everyone. This is what most people mean when they say "the cache".',
        },
        {
          title: 'The database\'s own cache',
          focus: ['rd>db', 'db'],
          text: 'Even the database caches. InnoDB\'s buffer pool and Postgres\'s shared buffers, helped by the operating system\'s page cache, keep hot pages in RAM. A query that hits them skips the disk, but it still pays for parsing, planning, locking and the network round trip.',
        },
      ],
    },
    {
      type: 'table',
      title: 'The layers side by side',
      head: ['Layer', 'Shared by', 'Cost of a hit', 'How you keep it fresh'],
      rows: [
        ['Browser', 'One user', 'No network', 'Short `max-age`, versioned file names like `app.3f9c.js`'],
        ['CDN edge', 'Users near one edge site', 'A nearby city away', 'TTLs, purge APIs, versioned URLs'],
        ['Reverse proxy', 'All users of the site', 'Same data center, no app code', 'TTLs, purge requests'],
        ['In-process', 'One app server', 'A memory lookup', 'Short TTLs, pub/sub invalidation messages'],
        ['Redis / Memcached', 'All app servers', 'One network round trip', 'Delete on write, TTLs'],
        ['DB buffer pool', 'All queries', 'RAM, but the full query cost', 'Automatic: the database manages it'],
      ],
    },
    {
      type: 'text',
      md: `**Why hit ratio deserves your attention.** The average cost of a read is roughly \`hit ratio × hit cost + miss ratio × miss cost\`. Say a Redis hit costs 1 ms and a miss (Redis plus the database) costs 20 ms. At a 90% hit ratio the average is 0.9 + 2.0 = **2.9 ms**. At 99% it's 0.99 + 0.2 ≈ **1.2 ms**.

The database side is even more dramatic. At 90%, one read in ten reaches the database. At 99%, one in a hundred. Nudging the hit ratio from 90% to 99% cuts database read load **tenfold**, which is often the difference between needing read replicas and not.

What deserves caching? Data that is **read far more often than it changes**, is **expensive to compute** (a joined, aggregated query, a rendered page, a call to a slow third-party API), and can tolerate **a little staleness**. A product page is perfect. A bank balance shown right before a transfer is not.`,
    },
    {
      type: 'callout',
      tone: 'tip',
      title: 'Versioned URLs: invalidation for free',
      text: 'Static files are the one place where cache invalidation is easy. Put a content hash in the file name (`app.3f9c.js`), cache it "forever" in browsers and CDNs, and ship a new file name when the content changes. Old copies are never wrong; they are simply never requested again.',
    },
    {
      type: 'quiz',
      q: 'A user revisits a page and it loads without sending any request at all. Which cache answered?',
      options: ['A CDN edge near the user', 'Redis', 'The database buffer pool', 'The browser\'s own cache'],
      answer: 3,
      explain: 'Only the **browser cache** answers with no network at all. Every other layer needs at least one request to reach it.',
    },
    {
      type: 'quiz',
      q: 'A CDN hits on 90% of 100,000 req/s. Redis hits on 80% of what reaches the app. How many req/s reach the database?',
      options: ['20,000', '10,000', '2,000', '8,000'],
      answer: 2,
      explain: 'Only misses go down. 10% of 100,000 = 10,000 reach the app; 20% of those miss Redis = **2,000/s** at the database.',
    },
  ],
});

deepSection('caching-in-depth', {
  id: 'patterns',
  nav: 'Read & write patterns',
  title: 'Who fills the cache, and when writes reach the database',
  goal: 'Explain cache-aside, read-through, write-through, write-behind and write-around, and pick one with confidence.',
  card: {
    emoji: '🔄',
    text: `Caching patterns differ in who loads the cache and when writes reach the database. **Cache-aside**: the app checks the cache, loads from the database on a miss and stores a copy. **Read-through**: the cache loads missing data itself. **Write-through**: every write updates the cache and the database before returning, so reads stay fresh but writes are slower. **Write-behind**: writes land in the cache and are flushed to the database later, which is fast but loses data if the cache dies first. **Write-around**: writes skip the cache entirely.`,
  },
  blocks: [
    {
      type: 'text',
      md: `Every caching design answers two separate questions.

**The read question:** on a miss, who goes to the database? Either your application does it (cache-aside), or the cache layer does it for you (read-through).

**The write question:** when data changes, when does the database find out, and what happens to the cached copy? The database can be updated first and the cache cleared (cache-aside), both can be updated together (write-through), the cache can be updated now and the database later (write-behind), or the cache can be skipped (write-around).

Step through the patterns below. Watch which arrows exist and which are dashed: a dashed arrow happens only sometimes, or later.`,
    },
    {
      type: 'stepper',
      title: 'Six patterns, one picture each',
      steps: [
        {
          title: 'Cache-aside: the read',
          diagram: {
            h: 230,
            nodes: [
              { id: 'app', x: 60, y: 115, label: 'App', icon: '🖥️', tone: 'accent' },
              { id: 'c', x: 290, y: 45, label: 'Cache', icon: '⚡', tone: 'good' },
              { id: 'db', x: 290, y: 185, label: 'Database', icon: '🗄️', shape: 'db' },
            ],
            edges: [
              { from: 'app', to: 'c', label: '1 GET, 3 SET', bi: true },
              { from: 'app', to: 'db', label: '2 on miss', dashed: true },
            ],
          },
          text: 'The application owns everything. It asks the cache first. On a hit it\'s done. On a miss it queries the database, writes the result into the cache with a TTL, and returns it. The cache is a dumb key-value store that knows nothing about your database. This is the default at most companies, and Facebook\'s memcache paper calls it a "demand-filled look-aside cache".',
        },
        {
          title: 'Cache-aside: the write',
          diagram: {
            h: 230,
            nodes: [
              { id: 'app', x: 60, y: 115, label: 'App', icon: '🖥️', tone: 'accent' },
              { id: 'c', x: 290, y: 45, label: 'Cache', icon: '⚡', tone: 'good' },
              { id: 'db', x: 290, y: 185, label: 'Database', icon: '🗄️', shape: 'db' },
            ],
            edges: [
              { from: 'app', to: 'db', label: '1 UPDATE' },
              { from: 'app', to: 'c', label: '2 DEL key', tone: 'warn' },
            ],
          },
          text: 'Update the database first, then **delete** the cached key. The next read misses and reloads the fresh row. Deleting is safer than writing the new value into the cache, because two concurrent writers can reach the cache in the wrong order and leave the older value there. (Part 3 shows that even delete has one sneaky race.)',
        },
        {
          title: 'Read-through',
          diagram: {
            h: 230,
            nodes: [
              { id: 'app', x: 60, y: 115, label: 'App', icon: '🖥️', tone: 'accent' },
              { id: 'c', x: 290, y: 45, label: 'Cache', icon: '⚡', tone: 'good' },
              { id: 'db', x: 290, y: 185, label: 'Database', icon: '🗄️', shape: 'db' },
            ],
            edges: [
              { from: 'app', to: 'c', label: 'GET' },
              { from: 'c', to: 'db', label: 'load on miss', dashed: true },
            ],
          },
          text: 'The app only ever talks to the cache. On a miss, the cache calls a loader you gave it and stores the result. In-process libraries work this way (a Caffeine `LoadingCache` in Java, for example), and so does Amazon DAX in front of DynamoDB. Nice side effect: the cache can make sure only one load per key runs at a time.',
        },
        {
          title: 'Write-through',
          diagram: {
            h: 230,
            nodes: [
              { id: 'app', x: 60, y: 115, label: 'App', icon: '🖥️', tone: 'accent' },
              { id: 'c', x: 290, y: 45, label: 'Cache', icon: '⚡', tone: 'good' },
              { id: 'db', x: 290, y: 185, label: 'Database', icon: '🗄️', shape: 'db' },
            ],
            edges: [
              { from: 'app', to: 'c', label: 'write' },
              { from: 'c', to: 'db', label: 'write now' },
            ],
          },
          text: 'Every write goes to the cache **and** the database before the call returns. Reads are always fresh and the cache is always warm for recently written data. The costs: every write pays for two systems, and you cache data that may never be read. DAX is a write-through cache too.',
        },
        {
          title: 'Write-behind (write-back)',
          diagram: {
            h: 230,
            nodes: [
              { id: 'app', x: 60, y: 115, label: 'App', icon: '🖥️', tone: 'accent' },
              { id: 'c', x: 290, y: 45, label: 'Cache', icon: '⚡', tone: 'good' },
              { id: 'db', x: 290, y: 185, label: 'Database', icon: '🗄️', shape: 'db' },
            ],
            edges: [
              { from: 'app', to: 'c', label: 'write' },
              { from: 'c', to: 'db', label: 'flush later', dashed: true, tone: 'warn' },
            ],
          },
          text: 'Writes land in the cache and the call returns immediately. The cache flushes to the database later, often batching many writes into one. It\'s the fastest option and absorbs write bursts beautifully, which is exactly what your CPU\'s caches and the OS page cache do with dirty pages. The danger: if the cache node dies before flushing, those acknowledged writes are **gone**.',
        },
        {
          title: 'Write-around',
          diagram: {
            h: 230,
            nodes: [
              { id: 'app', x: 60, y: 115, label: 'App', icon: '🖥️', tone: 'accent' },
              { id: 'c', x: 290, y: 45, label: 'Cache', icon: '⚡', tone: 'muted' },
              { id: 'db', x: 290, y: 185, label: 'Database', icon: '🗄️', shape: 'db' },
            ],
            edges: [
              { from: 'app', to: 'db', label: 'write' },
              { from: 'app', to: 'c', label: 'fills on read', dashed: true },
            ],
          },
          text: 'Writes go straight to the database and the cache isn\'t touched. The cache fills only when someone actually reads the data. Good for data that is written once and rarely re-read, like logs, bulk imports and archived records, so they don\'t push genuinely hot keys out of memory.',
        },
      ],
    },
    {
      type: 'code',
      title: 'Cache-aside in Python with redis-py',
      lang: 'python',
      code: `import json
import redis

r = redis.Redis(host="cache", port=6379)
TTL = 300  # seconds: the safety net if an invalidation is ever missed

def get_user(user_id):
    key = f"user:{user_id}"
    cached = r.get(key)
    if cached is not None:                      # hit
        return json.loads(cached)
    row = db.query_one("SELECT * FROM users WHERE id = %s", user_id)  # miss
    if row is not None:
        r.set(key, json.dumps(row), ex=TTL)
    return row

def rename_user(user_id, name):
    db.execute("UPDATE users SET name = %s WHERE id = %s", name, user_id)
    r.delete(f"user:{user_id}")                 # delete, don't overwrite`,
      caption: 'Database first, then delete. The TTL is still there: if a delete is ever lost (a crash between the two lines, a network blip), the stale value can only live for five minutes.',
    },
    {
      type: 'table',
      title: 'Choosing a pattern',
      head: ['Pattern', 'Reads', 'Writes', 'Main risk', 'Typical home'],
      rows: [
        ['Cache-aside', 'App loads on miss', 'DB, then delete key', 'Brief staleness, races', 'Redis or Memcached in most web apps'],
        ['Read-through', 'Cache loads on miss', 'Usually paired with another pattern', 'Loader coupled to the cache', 'Caffeine, Guava, Amazon DAX'],
        ['Write-through', 'Always fresh', 'Cache and DB, synchronously', 'Slower writes, cold data cached', 'Amazon DAX, some data grids'],
        ['Write-behind', 'Fresh from cache', 'Cache now, DB later', 'Data loss on crash', 'Counters, metrics, CPU and OS caches'],
        ['Write-around', 'Fill on first read', 'DB only', 'First read is always a miss', 'Logs, imports, rarely re-read data'],
      ],
    },
    {
      type: 'callout',
      tone: 'trap',
      title: 'Write-behind and money do not mix',
      text: 'Write-behind is great for view counts, likes and analytics events, where losing a few seconds of increments after a crash is acceptable. It\'s wrong for anything you promised the user was saved: payments, orders, messages. For those, the database must have the write before you say "done".',
    },
    {
      type: 'yourturn',
      prompt: 'Interviewer: "Why not just update the cached value on every write instead of deleting it? Then the next read is a hit."',
      answer: 'Because concurrent writers can apply their cache updates in a different order than their database updates. Writer 1 sets the DB to A, writer 2 sets it to B, but writer 2\'s cache write lands first and writer 1\'s lands second. Now the database says B and the cache says A, possibly until the TTL expires. A delete has no ordering problem: whichever delete arrives last, the key is simply gone and the next read loads the truth.',
      points: ['Updates can arrive out of order; deletes are idempotent', 'You pay one extra miss after each write, which is usually cheap', 'Write-through avoids the problem only if writes to one key are serialized'],
    },
    {
      type: 'quiz',
      q: 'Which pattern can lose writes the user was already told were saved, if a cache node crashes?',
      options: ['Cache-aside', 'Write-through', 'Write-behind', 'Read-through'],
      answer: 2,
      explain: '**Write-behind** acknowledges the write once it\'s in the cache and flushes to the database later. A crash before the flush loses it.',
    },
    {
      type: 'quiz',
      q: 'In cache-aside, what should the app do right after updating a row in the database?',
      options: ['Write the new value into the cache', 'Delete the cached key', 'Flush the entire cache', 'Nothing: the TTL will handle it'],
      answer: 1,
      explain: 'Delete the key so the next read reloads the fresh row. Overwriting risks out-of-order writes; flushing everything causes a stampede; waiting for the TTL serves stale data.',
    },
  ],
});

deepSection('caching-in-depth', {
  id: 'invalidation',
  nav: 'The stale-data race',
  title: 'Invalidation, TTLs, and the race that leaves stale data',
  goal: 'See exactly how a correctly coded cache can still serve stale data, and know the fixes.',
  card: {
    emoji: '🏁',
    text: `Every cached copy can go stale the moment the database changes. **TTLs** bound how long: after N seconds the key expires and the next read reloads it. **Delete on write** fixes it sooner: update the database, then delete the key. But there's a subtle race. A reader misses, reads the old row, stalls, and writes that old value into the cache **after** the writer's delete. The stale value then survives until its TTL. That's why TTLs stay on as a safety net, and why Facebook added **leases** to memcache.`,
  },
  blocks: [
    {
      type: 'text',
      md: `Start with a question that sounds like product, not engineering: **how stale is acceptable?** A follower count that's a minute old is fine. A product price that's a minute old during a flash sale is a support nightmare. An account balance that's a minute old is a bug. Your invalidation strategy follows from that answer.

**TTL only** is the simplest strategy: every key expires after N seconds, no matter what. Staleness is bounded by N, and you never have to find all the places that write. Shorter TTLs mean fresher data and more misses.

**Delete on write** gets you fresh data almost immediately: every code path that changes the database also deletes the matching keys. The weakness is human: one forgotten code path, one admin script, one batch job that writes directly to the database, and those keys stay stale until the TTL. That's why you keep a TTL even when you delete on write.

And even with perfect discipline, there's a race.`,
    },
    {
      type: 'stepper',
      title: 'The stale set: a race with no bug in sight',
      diagram: {
        h: 310,
        nodes: [
          { id: 'a', x: 55, y: 155, label: 'Reader A', icon: '📖' },
          { id: 'c', x: 180, y: 45, label: 'Redis', icon: '⚡', tone: 'good' },
          { id: 'db', x: 180, y: 265, label: 'Database', icon: '🗄️', shape: 'db' },
          { id: 'b', x: 305, y: 155, label: 'Writer B', icon: '✍️' },
        ],
        edges: [
          { from: 'a', to: 'db', label: 'read v1' },
          { from: 'b', to: 'db', label: 'v2' },
          { from: 'b', to: 'c', label: 'DEL' },
          { from: 'a', to: 'c', label: 'SET v1', tone: 'bad' },
        ],
      },
      steps: [
        {
          title: 'Reader A misses',
          focus: ['a', 'c'],
          text: 'Reader A asks Redis for `user:42`. It isn\'t there: it expired, was evicted, or was never loaded. Following cache-aside, A will load it from the database.',
        },
        {
          title: 'A reads the old row, then stalls',
          focus: ['a', 'a>db', 'db'],
          text: 'A reads the row and gets **v1**. Then A pauses for a moment before writing it to the cache: a garbage-collection pause, a slow network packet, a busy CPU. Nothing unusual, it happens all the time.',
        },
        {
          title: 'Writer B updates the database',
          focus: ['b', 'b>db', 'db'],
          text: 'Meanwhile Writer B commits **v2** to the database. The database is now correct.',
        },
        {
          title: 'B deletes the key',
          focus: ['b>c', 'c'],
          text: 'B follows the rules and deletes `user:42` from Redis. But the key isn\'t there (A hasn\'t written it yet), so the delete does nothing.',
        },
        {
          title: 'A writes stale data',
          focus: ['a>c', 'c'],
          text: 'A wakes up and SETs **v1** into Redis. The cache now holds the old row, and every reader will see v1 until the TTL expires. Nobody wrote a bug. The two requests just interleaved badly.',
        },
        {
          title: 'The fixes',
          focus: ['c'],
          text: 'A short TTL limits the damage. Facebook\'s **leases** prevent it: a miss hands A a token, B\'s delete invalidates that token, and A\'s late SET is rejected. Other options: store a version number with the value and refuse to overwrite newer versions, or have the writer delete the key again a moment later (a "delayed double delete").',
        },
      ],
    },
    {
      type: 'list',
      title: 'Invalidation tools, from simplest to strongest',
      items: [
        { title: 'TTL:', text: 'bounds staleness for every key, including ones your code forgot. Add jitter so keys written together don\'t expire together.' },
        { title: 'Delete on write:', text: 'the application deletes affected keys right after the database commit. Fast, but only as complete as your code paths.' },
        { title: 'Versioned keys:', text: 'put a version in the key (`user:42:v7`) and bump it on write. Old entries are never read again and age out. Useful for whole groups of keys.' },
        { title: 'Change data capture:', text: 'tail the database\'s replication log (MySQL binlog, Postgres WAL) and issue deletes from there. Every committed write invalidates, even writes from scripts. Facebook\'s McSqueal daemons did this for memcache.' },
        { title: 'Leases:', text: 'the cache itself refuses SETs from readers whose information is older than the last delete. Fixes the stale set race and, as Part 7 shows, stampedes too.' },
      ],
    },
    {
      type: 'callout',
      tone: 'key',
      title: 'Cache invalidation is a distributed systems problem',
      text: 'The cache and the database are two systems with no shared transaction. Any time you update two systems without one atomic operation, there is an ordering where they disagree. The goal isn\'t to make disagreement impossible. It\'s to make it **rare and short-lived**: delete after commit, keep a TTL, and use leases or versions where staleness really hurts.',
    },
    {
      type: 'deep',
      title: 'Go deeper: why "delete, then update the database" is worse',
      blocks: [
        {
          type: 'text',
          md: `It feels safer to clear the cache first. It isn't. If you delete the key and then update the database, there's a window between the two where a reader can miss, read the **old** row from the database (the update hasn't happened yet), and put it back in the cache. Now the stale value is cached and the writer has already done its delete.

With "update the database, then delete", the bad interleaving needs a reader whose database read happened **before** the commit and whose cache write lands **after** the delete. That window is much smaller, because a cache write normally follows a read within milliseconds. Smaller, not zero, which is exactly the stale-set race above.`,
        },
      ],
    },
    {
      type: 'quiz',
      q: 'A reader loads an old row, stalls, and writes it to the cache after the writer deleted the key. What limits how long that stale value survives?',
      options: ['The TTL on the key', 'LRU eviction', 'The database\'s index', 'The CDN in front'],
      answer: 0,
      explain: 'Nothing will delete the key again, so it lives until its **TTL** expires. That\'s why the TTL stays on even when you delete on write.',
    },
    {
      type: 'quiz',
      q: 'With Facebook-style leases, why is the slow reader\'s late SET rejected?',
      options: ['Its TTL was too long', 'Memcache rejects all SETs after a write', 'The database refuses the read', 'The writer\'s delete invalidated the lease token the reader was holding'],
      answer: 3,
      explain: 'On a miss, the reader gets a **lease token**. A delete for that key invalidates outstanding tokens, so a SET with a stale token is refused.',
    },
  ],
});

deepSection('caching-in-depth', {
  id: 'eviction',
  nav: 'Eviction & expiry',
  title: 'Eviction and expiry: who gets thrown out, and when',
  goal: 'Separate expiry from eviction, understand LRU and LFU, and know how Redis approximates them.',
  card: {
    emoji: '🧹',
    text: `Expiry and eviction are different jobs. **Expiry** removes a key when its TTL runs out, to limit staleness. **Eviction** removes keys when memory is full, to make room. Redis expires keys lazily when you touch them and also samples keys with TTLs in the background. When it hits its memory limit, the **maxmemory-policy** decides who goes, and the default, noeviction, simply rejects writes instead. Redis's LRU is approximate: it samples a few keys and evicts the best candidate among them, which costs far less memory than a perfect LRU list.`,
  },
  blocks: [
    {
      type: 'text',
      md: `Memory is finite, so every cache needs a rule for what to throw out. The classic choices:

**LRU (least recently used)** evicts whatever hasn't been touched for the longest time. It bets that recent use predicts future use, which is true for most workloads. Its weakness is a **scan**: a batch job that reads every key once makes all of them "recent" and pushes the genuinely hot ones out.

**LFU (least frequently used)** evicts whatever is used least often. It protects long-term favorites from scans, but it's slow to notice a new trend and can keep yesterday's hits around too long unless counts decay over time.

**FIFO** and **random** are simpler and sometimes good enough. **TTL-based** eviction throws out whatever expires soonest.`,
    },
    {
      type: 'code',
      title: 'A perfect LRU cache in 15 lines',
      lang: 'python',
      code: `from collections import OrderedDict

class LRUCache:
    def __init__(self, capacity):
        self.capacity = capacity
        self.data = OrderedDict()           # oldest first, newest last

    def get(self, key):
        if key not in self.data:
            return None                     # miss
        self.data.move_to_end(key)          # now the most recently used
        return self.data[key]

    def put(self, key, value):
        self.data[key] = value
        self.data.move_to_end(key)
        if len(self.data) > self.capacity:
            self.data.popitem(last=False)   # evict the least recently used`,
      caption: 'Under the hood this is a hash map plus a doubly linked list: O(1) get and put. The interview classic. The price is two pointers per entry, which adds up across hundreds of millions of keys.',
    },
    {
      type: 'text',
      md: `**How Redis actually does it.** A perfect LRU would need a linked list threaded through every key, costing memory on each one. Redis takes a cheaper road: each key stores a small timestamp of its last access, and when Redis needs to evict, it **samples** a handful of keys (\`maxmemory-samples\`, 5 by default) and evicts the one idle the longest. Since Redis 3.0 it also keeps a small pool of good candidates between rounds, which brings the result very close to true LRU. Raising the sample size makes it more accurate and slightly more expensive.

**Redis LFU** (added in 4.0) stores a tiny logarithmic counter per key: it increments probabilistically, so a key needs many more hits to climb from 200 to 201 than from 2 to 3, and the counter **decays** over time so old favorites eventually fade. Two settings tune it: \`lfu-log-factor\` and \`lfu-decay-time\`.

**Expiry** works in two ways. Passively: when you access a key whose TTL has passed, Redis deletes it and reports a miss. Actively: about ten times a second, Redis samples keys that have a TTL and deletes the expired ones, repeating quickly if many of them turned out to be expired. So an expired key that nobody reads again still gets cleaned up, just not at the exact millisecond.`,
    },
    {
      type: 'table',
      title: 'Redis\'s classic eviction policies',
      head: ['Policy', 'Evicts from', 'Chooses by'],
      rows: [
        ['noeviction (default)', 'Nothing', 'Rejects writes with an OOM error once full'],
        ['allkeys-lru', 'All keys', 'Approximately least recently used'],
        ['allkeys-lfu', 'All keys', 'Approximately least frequently used'],
        ['allkeys-random', 'All keys', 'Random'],
        ['volatile-lru', 'Keys with a TTL', 'Approximately least recently used'],
        ['volatile-lfu', 'Keys with a TTL', 'Approximately least frequently used'],
        ['volatile-random', 'Keys with a TTL', 'Random'],
        ['volatile-ttl', 'Keys with a TTL', 'Shortest remaining TTL first'],
      ],
    },
    {
      type: 'code',
      title: 'A typical cache configuration (redis.conf)',
      lang: 'conf',
      code: `maxmemory 4gb                # without a limit, Redis grows until the OS steps in
maxmemory-policy allkeys-lfu # for a pure cache: evict anything, keep the favorites
maxmemory-samples 5          # keys sampled per eviction (higher = closer to exact)`,
      caption: 'For a pure cache, pick an `allkeys-*` policy. The default `noeviction` makes sense when Redis holds data you must not silently lose, like a queue.',
    },
    {
      type: 'callout',
      tone: 'warn',
      title: 'Memcached does it differently',
      text: 'Memcached splits memory into **slab classes** of fixed-size chunks and evicts within the class an item belongs to. A big item can therefore evict other big items while small ones are untouched. Modern Memcached uses a segmented LRU (hot, warm and cold queues) so one-off reads don\'t flush frequently used items. Unlike Redis, it\'s multi-threaded, stores only opaque values, and has no persistence.',
    },
    {
      type: 'yourturn',
      prompt: 'You keep both cache entries (all with TTLs) and permanent configuration keys (no TTL) in one Redis. Which eviction policy protects the config, and what\'s the catch?',
      answer: 'A `volatile-*` policy (for example `volatile-lru`) only evicts keys that have a TTL, so the configuration keys are never chosen. The catch: if memory fills and there are no TTL keys left to evict, Redis behaves like `noeviction` and starts rejecting writes. The cleaner design is two Redis instances, one cache with `allkeys-lru` or `allkeys-lfu` and one store with `noeviction`, so a busy cache can never push out data you need.',
    },
    {
      type: 'quiz',
      q: 'What does Redis do by default when it reaches its maxmemory limit?',
      options: ['Evicts the least recently used keys', 'Rejects writes with an error (noeviction)', 'Writes cold keys to disk', 'Restarts and reloads its snapshot'],
      answer: 1,
      explain: 'The default policy is **noeviction**: reads still work, but writes that need memory fail with an OOM error. A cache should use an `allkeys-*` policy.',
    },
    {
      type: 'quiz',
      q: 'Why is Redis\'s LRU called "approximate"?',
      options: ['It ignores keys with TTLs', 'It evicts at random', 'It samples a few keys and evicts the best candidate, instead of tracking a full ordered list', 'It only runs once a minute'],
      answer: 2,
      explain: 'Sampling (plus a small candidate pool) gets close to true LRU without the memory cost of linking every key into a list.',
    },
  ],
});

deepSection('caching-in-depth', {
  id: 'redis-inside',
  nav: 'Inside Redis',
  title: 'Inside Redis: one thread, many data structures',
  goal: 'Explain why single-threaded Redis is fast, what blocks it, and which data structure fits which job.',
  card: {
    emoji: '🧵',
    text: `Redis executes commands on a **single thread**, one at a time, from an event loop. That sounds slow, but every command works on data already in RAM, so most finish in microseconds, and one-at-a-time means every command is **atomic** without locks. Since Redis 6.0, optional I/O threads can read and write sockets in parallel, but commands still run one by one. The real power is the data structures: strings, hashes, lists, sets, sorted sets, streams, bitmaps and HyperLogLogs, each built for particular jobs.`,
  },
  blocks: [
    {
      type: 'text',
      md: `Redis is a server that holds data structures in memory and lets many clients operate on them over the network. At its core is an **event loop**: one thread asks the operating system (epoll on Linux, kqueue on BSD and macOS) which client sockets have data ready, reads a command, executes it, queues the reply, and moves to the next. Thousands of connections share that one loop.

Why is one thread enough? Because the work per command is tiny. There's no disk seek, no query planner, no lock to wait for: just a hash table lookup and a pointer update in RAM. For most deployments the bottleneck is the network and the cost of parsing requests, not computing the answers. One thread also means **no locks and no races**: \`INCR\` from two clients at the same instant can never lose a count, because the two commands run one after the other.

When you need more CPU, you scale **out**, not up: run more Redis processes and shard keys across them (that's Redis Cluster, in the next part). Redis 6.0 added optional **I/O threads** that read requests from and write replies to sockets in parallel, which helps on busy servers, while command execution stays on the main thread. Background threads handle slow chores like freeing large values (\`UNLINK\`, lazy freeing) and syncing files to disk. Valkey, the open-source fork, has pushed multithreaded I/O further.`,
    },
    {
      type: 'callout',
      tone: 'trap',
      title: 'One slow command stalls every client',
      text: 'The single thread is a superpower until something takes a long time. `KEYS *` on a 20-million-key instance, `DEL` on a set with millions of members, `SMEMBERS` or `HGETALL` on a giant collection, or a long Lua script: while it runs, **every other client waits**. Use `SCAN` instead of `KEYS`, `UNLINK` instead of `DEL` for big values (it frees memory in the background), keep collections bounded, and check `SLOWLOG GET` when latency spikes.',
    },
    {
      type: 'table',
      title: 'The data structures and what they\'re for',
      head: ['Type', 'Under the hood', 'Great for', 'Key commands'],
      rows: [
        ['String', 'Bytes, up to 512 MB', 'Cached JSON or HTML, counters, locks, rate limits', '`GET`, `SET … EX`, `INCR`, `SET NX`'],
        ['Hash', 'Compact listpack when small, hash table when large', 'Objects: `user:42` → name, plan, email', '`HSET`, `HGET`, `HINCRBY`'],
        ['List', 'Quicklist: a linked list of listpacks', 'Queues, recent activity, capped logs', '`LPUSH`, `RPOP`, `BLPOP`, `LTRIM`'],
        ['Set', 'Intset or listpack when small, hash table when large', 'Unique members: tags, who liked a post', '`SADD`, `SISMEMBER`, `SINTER`'],
        ['Sorted set', 'Listpack when small; skiplist + hash table when large', 'Leaderboards, time-ordered feeds, priority queues', '`ZADD`, `ZRANGE`, `ZINCRBY`'],
        ['Stream', 'Radix tree of listpacks', 'Append-only event log with consumer groups', '`XADD`, `XREADGROUP`, `XACK`'],
        ['Bitmap', 'Bit operations on a string', 'One bit per user ID: active today, feature flags', '`SETBIT`, `BITCOUNT`'],
        ['HyperLogLog', 'Probabilistic sketch, at most 12 KB', 'Counting unique visitors (about 0.81% error)', '`PFADD`, `PFCOUNT`'],
        ['Geo', 'Sorted set scored by geohash', 'Nearby drivers or stores', '`GEOADD`, `GEOSEARCH`'],
      ],
    },
    {
      type: 'text',
      md: `Two details in that table are worth slowing down for.

**Small collections use compact encodings.** A hash with a handful of short fields isn't stored as a real hash table. It's packed into a single contiguous block (a *listpack*) that costs far less memory, and Redis converts it to a full hash table only when it grows past configurable size limits. That's why storing millions of small objects as hashes can be much cheaper than storing them as separate string keys. Instagram described using this trick to fit hundreds of millions of ID mappings into a modest amount of RAM.

**The sorted set is two structures at once.** A skiplist keeps members ordered by score, so range queries ("top 10", "everything between these timestamps") are fast. A hash table maps each member to its score, so "what is Ada's score?" is O(1). Updates keep both in sync, in O(log n).`,
    },
    {
      type: 'code',
      title: 'Each structure doing its job',
      lang: 'text',
      code: `# a lock that expires on its own if the holder dies
SET lock:report:7 "worker-3" NX PX 30000

# fixed-window rate limit: 100 requests per minute per user
INCR rl:user:42:202611201405
EXPIRE rl:user:42:202611201405 60

# leaderboard: add points, read the top 10
ZINCRBY leaderboard 50 ada
ZRANGE leaderboard 0 9 REV WITHSCORES

# unique visitors today, in at most 12 KB
PFADD visitors:2026-11-20 user:42 user:77
PFCOUNT visitors:2026-11-20

# event log with consumer groups
XADD orders * id 991 total 42.50
XREADGROUP GROUP billing w1 COUNT 10 STREAMS orders >`,
      caption: 'When you need several commands to run as one unit, `MULTI`/`EXEC` transactions and Lua scripts (or Functions, since Redis 7.0) also execute atomically on the single thread.',
    },
    {
      type: 'quiz',
      q: 'Why are individual Redis commands atomic without any locks?',
      options: ['Each key has its own mutex', 'Redis wraps every command in a database transaction', 'Redis uses optimistic concurrency control', 'Commands execute one at a time on a single thread'],
      answer: 3,
      explain: 'The main thread runs one command to completion before starting the next, so two commands can never interleave. That also means one slow command blocks everyone.',
    },
    {
      type: 'quiz',
      q: 'You must count unique daily visitors (hundreds of millions) and about 1% error is fine. Which structure?',
      options: ['A set of user IDs', 'A sorted set of user IDs', 'A HyperLogLog', 'A list of user IDs'],
      answer: 2,
      explain: 'A **HyperLogLog** estimates distinct counts in at most 12 KB with about 0.81% standard error. A set would need memory for every ID.',
    },
  ],
});

deepSection('caching-in-depth', {
  id: 'redis-scale',
  nav: 'Persistence & Cluster',
  title: 'Keeping Redis alive: persistence, replication, Sentinel and Cluster',
  goal: 'Know what RDB, AOF, replicas, Sentinel and Cluster each protect against, and what they don\'t.',
  card: {
    emoji: '🧩',
    text: `Redis keeps data in RAM but can persist it two ways. **RDB** snapshots fork the process and write the whole dataset to a compact file at intervals. **AOF** logs every write command and replays it on restart, by default syncing to disk about once a second. For availability, **replicas** copy the primary asynchronously, and **Sentinel** promotes a replica when the primary fails. For scale, **Redis Cluster** splits keys across shards using **16,384 hash slots**: a key's slot is CRC16 of the key modulo 16384, and each primary owns a range of slots.`,
  },
  blocks: [
    {
      type: 'text',
      md: `A pure cache can lose everything on restart and simply refill from the database (painfully, as Part 9 shows). But many teams also use Redis for sessions, queues, rate limits and leaderboards, where losing data hurts. Redis offers two persistence mechanisms, and you can use both.`,
    },
    {
      type: 'tabs',
      title: 'Persistence options',
      tabs: [
        {
          label: '📸 RDB snapshots',
          blocks: [
            {
              type: 'text',
              md: `Redis calls \`fork()\`. The child process gets a frozen view of memory and writes it to a compact binary file, while the parent keeps serving clients. The operating system's **copy-on-write** makes this cheap at first: parent and child share memory pages, and a page is copied only when the parent modifies it.

**Good:** compact files, fast restarts, perfect for backups. **Bad:** you lose everything written since the last snapshot. On a large, write-heavy instance, copy-on-write can duplicate a big share of memory during the snapshot, and the fork itself can pause the main thread briefly.`,
            },
          ],
        },
        {
          label: '📝 AOF log',
          blocks: [
            {
              type: 'text',
              md: `Every write command is appended to a log file and replayed on startup. How often the log is flushed to disk is set by \`appendfsync\`: \`always\` (safest, slowest), \`everysec\` (the default: lose about a second of writes at worst), or \`no\` (let the OS decide). The log is periodically **rewritten** in the background to its smallest equivalent form, so it doesn't grow forever.

**Good:** much less data loss than snapshots. **Bad:** bigger files and slower restarts than RDB, and \`always\` puts a disk sync on the path of every write.`,
            },
          ],
        },
        {
          label: '🤝 Both',
          blocks: [
            {
              type: 'text',
              md: `Common in production: AOF for durability and RDB for backups and fast restores. Modern Redis can also start the rewritten AOF with an RDB-format snapshot and append only recent commands after it, getting fast loads with AOF-level durability.

A common trick for latency-sensitive primaries: turn persistence off on the primary and let a **replica** do the snapshots, so the primary never pays for the fork. Just never let a primary with persistence off restart automatically with an empty dataset, or replicas will happily sync to the emptiness.`,
            },
          ],
        },
      ],
    },
    {
      type: 'text',
      md: `**Replication** keeps copies of a primary on other machines. A new replica first gets a full copy (the primary produces an RDB snapshot and streams it over), then receives a continuous stream of every write command. After a short disconnection, a replica can resume from a **replication backlog** instead of starting over.

Crucially, replication is **asynchronous**. The primary acknowledges your write before replicas have it. If the primary dies a moment later and a replica is promoted, that acknowledged write is gone. The \`WAIT\` command lets a client block until N replicas acknowledge, which narrows the window but doesn't turn Redis into a consensus system.

**Sentinel** adds automatic failover for a single primary with replicas. Several Sentinel processes watch the primary. When enough of them agree it's unreachable (a configured **quorum**), they elect one Sentinel to run the failover: promote the best replica, reconfigure the others to follow it, and tell clients, who ask Sentinel "who is the primary now?" instead of hardcoding an address.

**Redis Cluster** is for when one machine's memory or CPU isn't enough. The key space is split into **16,384 hash slots**. Each primary owns a range of slots and has its own replicas, and failover is built in.`,
    },
    {
      type: 'stepper',
      title: 'A request in Redis Cluster',
      diagram: {
        h: 320,
        nodes: [
          { id: 'cl', x: 55, y: 160, label: 'Client', icon: '💻', shape: 'pill' },
          { id: 'na', x: 300, y: 50, label: 'Node A\n0–5460', icon: '⚡' },
          { id: 'nb', x: 300, y: 160, label: 'Node B\n5461–10922', icon: '⚡' },
          { id: 'nc', x: 300, y: 270, label: 'Node C\n10923–16383', icon: '⚡', tone: 'good' },
        ],
        edges: [
          { from: 'cl', to: 'na', label: 'GET cart:9' },
          { from: 'na', to: 'cl', label: 'MOVED', curve: 45, dashed: true, tone: 'warn' },
          { from: 'cl', to: 'nc', label: 'retry', tone: 'good' },
          { from: 'na', to: 'nb', dashed: true, arrow: false },
          { from: 'nb', to: 'nc', dashed: true, arrow: false },
        ],
      },
      steps: [
        {
          title: 'Hash the key to a slot',
          focus: ['cl'],
          text: 'The client library computes `CRC16("cart:9") mod 16384`. Suppose that gives slot 12000. Smart clients keep a map of which node owns which slot ranges, fetched with `CLUSTER SLOTS` or `CLUSTER SHARDS`.',
        },
        {
          title: 'Send it where it thinks the slot lives',
          focus: ['cl', 'cl>na', 'na'],
          text: 'This client\'s map is stale (or it\'s a naive client that just picked a node), so it sends `GET cart:9` to Node A.',
        },
        {
          title: 'MOVED: go ask someone else',
          focus: ['na>cl', 'na'],
          text: 'Node A doesn\'t own slot 12000, and Redis Cluster nodes **never proxy** requests for you. A replies `MOVED 12000` with Node C\'s address.',
        },
        {
          title: 'Retry on the owner',
          focus: ['cl>nc', 'nc'],
          text: 'The client updates its slot map and retries on Node C, which owns 10923–16383. From now on, requests for this slot go straight to C in a single hop.',
        },
        {
          title: 'Gossip and failover',
          focus: ['na>nb', 'nb>nc', 'na', 'nb', 'nc'],
          text: 'Nodes talk over a separate cluster bus, exchanging heartbeats that carry a bitmap of the slots each node owns. 16,384 bits is 2 KB, small enough to send constantly, which is a big reason for the number. If a primary stops answering, the other primaries agree it has failed and promote one of its replicas.',
        },
      ],
    },
    {
      type: 'code',
      title: 'Hash tags: keeping related keys on one shard',
      lang: 'text',
      code: `# multi-key commands need every key in the same slot
MSET user:42:name Ada user:42:plan pro
# → (error) CROSSSLOT Keys in request don't hash to the same slot

# only the part inside {braces} is hashed, so these share a slot
MSET {user:42}:name Ada {user:42}:plan pro
# → OK`,
      caption: 'Hash tags let you use multi-key commands, transactions and Lua scripts across related keys. Overuse them and one slot (and one node) gets all the traffic.',
    },
    {
      type: 'deep',
      title: 'Go deeper: resharding and the ASK redirect',
      blocks: [
        {
          type: 'text',
          md: `When you add a node, slots move to it one at a time, and the keys inside a slot migrate in batches. During that window, a key might already be on the new node or still on the old one. The old node answers requests for keys it has already moved with **ASK** instead of MOVED.

The difference matters: MOVED means "this slot lives elsewhere now, update your map". ASK means "for this one request, try the other node", and the client sends an \`ASKING\` command first so the importing node accepts it. The client doesn't update its slot map until migration finishes and MOVED replies start arriving.`,
        },
      ],
    },
    {
      type: 'yourturn',
      prompt: 'Interviewer: "Can we use Redis as the system of record for user wallet balances?"',
      answer: 'Only with eyes open, and usually no. With `appendfsync everysec` you can lose about a second of acknowledged writes in a crash; `always` fixes that but costs a disk sync per write. Replication is asynchronous, so a failover can also drop acknowledged writes, and `WAIT` narrows that window without providing true consensus. For money, keep a durable, transactional database as the source of truth, and use Redis for caching balances, rate limiting or idempotency keys around it.',
    },
    {
      type: 'quiz',
      q: 'In Redis Cluster, how is a key assigned to a node?',
      options: ['Round robin across nodes', 'CRC16 of the key mod 16384 gives a slot, and each primary owns a range of slots', 'The client picks any node at random', 'By the first letter of the key'],
      answer: 1,
      explain: 'Every key maps to one of **16,384 slots**. Slots, not keys, are assigned to primaries, so resharding moves whole slots between nodes.',
    },
    {
      type: 'quiz',
      q: 'Redis acknowledges a write, then the primary crashes before replicating it, and a replica is promoted. What happened to the write?',
      options: ['It was lost, because replication is asynchronous', 'Sentinel replays it from its own log', 'The new primary fetches it from the client', 'It is safe: acknowledged writes always survive failover'],
      answer: 0,
      explain: 'The primary acknowledges before replicas receive the write. If it dies in between, the promoted replica never saw it.',
    },
  ],
});

deepSection('caching-in-depth', {
  id: 'stampedes',
  nav: 'Stampedes & hot keys',
  title: 'Stampedes and hot keys: when popularity is the problem',
  goal: 'Stop a single key expiry from flattening your database, and stop one viral key from melting a shard.',
  card: {
    emoji: '🐃',
    text: `A **cache stampede** happens when a popular key expires and thousands of requests miss at once, all racing to rebuild it from the database. Fixes: let one request rebuild while the others wait (**request coalescing** or a short lock), serve the stale value while one worker refreshes, add **jitter** to TTLs, or refresh early with a probability that rises as expiry nears. A **hot key** is a different problem: one key so popular that its single Redis shard melts. Fixes: cache it in each app server's memory, or copy it to several keys.`,
  },
  blocks: [
    {
      type: 'text',
      md: `Picture the homepage key: read 20,000 times a second, rebuilt by a query that takes 300 ms. At the instant it expires, every request misses. Over the next 300 ms, roughly 6,000 requests each fire the same expensive query. The database, which normally sees almost none of this traffic, suddenly gets a wall of identical work, slows down, which makes each rebuild take longer, which lets even more requests pile in. That feedback loop is a **cache stampede** (also called the thundering herd or dog-piling).

The fixes all do one of three things: make sure **only one** request rebuilds, keep **serving something** while it does, or make sure keys **don't all expire at once**.`,
    },
    {
      type: 'tabs',
      title: 'Four ways to stop a stampede',
      tabs: [
        {
          label: 'Lock',
          blocks: [
            {
              type: 'code',
              title: 'Rebuild under a short Redis lock',
              lang: 'python',
              code: `import time

def get_with_lock(key, load, ttl=300):
    val = r.get(key)
    if val is not None:
        return val
    # only one caller wins; the lock expires on its own if that caller dies
    if r.set(f"lock:{key}", "1", nx=True, px=5000):
        try:
            val = load()
            r.set(key, val, ex=ttl)
        finally:
            r.delete(f"lock:{key}")
        return val
    time.sleep(0.05)          # someone else is rebuilding: wait, then retry
    return get_with_lock(key, load, ttl)`,
              caption: 'Production versions store a random token in the lock and delete it only if they still hold it, so a slow worker can\'t release a lock that already expired and was taken by someone else.',
            },
          ],
        },
        {
          label: 'Coalesce',
          blocks: [
            {
              type: 'text',
              md: `**Request coalescing** (often called *single-flight*, after Go's \`singleflight\` package) works inside one process: the first request for a missing key starts the load, and every concurrent request for the same key waits on that same in-flight result instead of starting its own.

It costs nothing in Redis and removes duplicate work per server. With 50 app servers you still get up to 50 rebuilds, which is usually fine. Combine it with a lock if even that is too many. Read-through caches often coalesce for you.`,
            },
          ],
        },
        {
          label: 'Serve stale',
          blocks: [
            {
              type: 'text',
              md: `Keep two times per entry: a **soft** expiry and a **hard** expiry. After the soft expiry, the first request triggers a background refresh while everyone, including that request, keeps getting the slightly old value. Only after the hard expiry does a request have to wait.

HTTP has this built in: \`Cache-Control: max-age=60, stale-while-revalidate=30\` tells browsers and CDNs to serve a stale copy for up to 30 seconds while fetching a fresh one. NGINX and Varnish support similar "serve stale while updating" modes.`,
            },
          ],
        },
        {
          label: 'XFetch',
          blocks: [
            {
              type: 'code',
              title: 'Probabilistic early expiration ("XFetch")',
              lang: 'python',
              code: `import math, random, time

def fetch(key, recompute, ttl, beta=1.0):
    value, delta, expiry = cache_read(key)  # delta: seconds the last rebuild took
    now = time.time()
    # Rebuild early with a probability that rises as expiry approaches.
    if value is None or now - delta * beta * math.log(random.random()) >= expiry:
        start = time.time()
        value = recompute()
        delta = time.time() - start
        cache_write(key, (value, delta), ttl)  # stores expiry = now + ttl
    return value`,
              caption: 'From the 2015 paper "Optimal Probabilistic Cache Stampede Prevention" (Vattani, Chierichetti, Lowenstein). log(random) is negative, so each request "looks ahead" a random amount. Expensive rebuilds (large delta) start earlier, and usually exactly one request refreshes before anyone sees a miss.',
            },
          ],
        },
      ],
    },
    {
      type: 'callout',
      tone: 'key',
      title: 'Leases: Facebook\'s two-for-one fix',
      text: 'Facebook\'s memcache **leases** fix stampedes and the stale-set race with one mechanism. On a miss, the server hands the client a **lease token**, and only a SET carrying a valid token is accepted. For stampede control, the server issues a token for a given key at most once every 10 seconds: other clients that miss in that window are told to wait briefly and retry, and by then the value is usually back. One client hits the database instead of thousands.',
    },
    {
      type: 'callout',
      tone: 'tip',
      title: 'Jitter: the one-line fix for synchronized expiry',
      text: 'If a deploy, a cache warm-up script or a nightly job writes thousands of keys with the same TTL, they all expire in the same second. Add randomness: `ttl = 3600 + random.randint(-300, 300)`. The database sees a gentle trickle of misses instead of a cliff.',
    },
    {
      type: 'text',
      md: `**Hot keys** are a different beast. In a sharded cache, every key lives on exactly one node. If one key (a celebrity's profile, a flash-sale product, the World Cup final's score) gets hundreds of thousands of reads per second, that one node's CPU and network max out while the others sit idle. Adding more shards doesn't help at all: the key still lives on one of them.

The fixes all **spread one key's reads** across more machines:

- **Local caching:** keep hot keys in each app server's memory for a few seconds. Thousands of reads per second per server turn into one Redis read per server every few seconds. Redis 6.0 added server-assisted **client-side caching** (\`CLIENT TRACKING\`), where Redis tells clients when a key they cached has changed.
- **Key splitting:** store copies under \`product:99#1\` through \`product:99#8\`, which land on different shards, and read a random copy. Writes must update all copies.
- **Read replicas:** let replicas serve reads for the hot shard, accepting slightly stale data.

To find hot keys, Redis can report them with \`redis-cli --hotkeys\`, which requires an LFU eviction policy, and managed services often expose per-key metrics.`,
    },
    {
      type: 'callout',
      tone: 'warn',
      title: 'Cache penetration: misses that never become hits',
      text: 'Requests for IDs that don\'t exist always miss, so every one of them reaches the database, and an attacker can generate infinitely many. Cache the "not found" result too, with a short TTL (**negative caching**), or check a **Bloom filter** of valid IDs before touching the database.',
    },
    {
      type: 'quiz',
      q: 'A hot key expires and 5,000 requests try to rebuild it at once. Which fix lets just one request hit the database?',
      options: ['Request coalescing or a rebuild lock', 'A longer database timeout', 'Switching eviction from LRU to LFU', 'More Redis shards'],
      answer: 0,
      explain: 'Coalescing or a lock makes one request do the rebuild while the others wait for its result. The other options don\'t change how many rebuilds start.',
    },
    {
      type: 'quiz',
      q: 'One celebrity\'s profile key gets 500K reads/s. Its Redis shard is at 100% CPU while the other shards idle. Best fix?',
      options: ['Add more shards to the cluster', 'Cache it in app-server memory briefly, or copy it to several keys', 'Switch to write-through caching', 'Lower the key\'s TTL'],
      answer: 1,
      explain: 'A single key always lives on one shard, so more shards don\'t help. Spread its reads: a short-lived **local copy** on each app server, or split it into several keys on different shards.',
    },
  ],
});

deepSection('caching-in-depth', {
  id: 'in-the-wild',
  nav: 'In the wild',
  title: 'How real companies cache',
  goal: 'Connect every idea so far to systems running in production today.',
  card: {
    emoji: '🌍',
    text: `The biggest caching systems share the same ideas. **Facebook** described one of the largest memcached deployments ever in a 2013 paper: over a billion requests per second, leases to stop stale sets and stampedes, and invalidations streamed from the database's commit log. **Netflix** built **EVCache** on memcached and replicates it across AWS availability zones. **Twitter** keeps home timelines in Redis. **Stack Overflow** pairs an in-memory cache on each web server with a shared Redis. And when Redis changed its license in 2024, the community fork **Valkey** was born.`,
  },
  blocks: [
    {
      type: 'text',
      md: `Swipe through how the companies you use every day cache. Watch for the ideas from earlier parts: look-aside caching with **delete on write**, **leases**, **commit-log invalidation**, **two-level caches** (local plus shared), and an obsession with protecting the database.`,
    },
    {
      type: 'wild',
      title: 'In the wild: caching at real companies',
      items: [
        {
          emoji: '📘',
          who: 'Facebook',
          what: 'memcache at planet scale',
          tags: ['memcached', 'NSDI 2013', 'look-aside'],
          text: `The paper **"Scaling Memcache at Facebook"** (NSDI 2013) describes a memcached deployment that processed over a billion requests per second and stored trillions of items. It's a demand-filled look-aside cache in front of MySQL: reads fill on miss, writes go to MySQL and then delete the key.

The famous pieces: **leases** to prevent stale sets and stampedes, **mcrouter** to route requests across pools of servers, **McSqueal** daemons that tail the MySQL commit log and broadcast deletes, and a small **Gutter** pool of spare servers that takes over for failed ones so their misses don't all land on the database.`,
        },
        {
          emoji: '🕸️',
          who: 'Meta',
          what: 'TAO, a cache for the social graph',
          tags: ['graph cache', 'USENIX ATC 2013'],
          text: `Facebook's social graph (people, posts, likes, friendships) is read far more than it's written. **TAO**, described at USENIX ATC 2013, is a geographically distributed cache that understands that graph: it stores **objects** and **associations** between them, sits in front of sharded MySQL, and handles writes by writing through to the database.

It replaced a lot of hand-written memcache logic in application code with one service that knows how to cache graph queries.`,
        },
        {
          emoji: '🎬',
          who: 'Netflix',
          what: 'EVCache',
          tags: ['memcached', 'multi-zone', 'open source'],
          text: `**EVCache** ("Ephemeral Volatile Cache") is Netflix's open-source caching layer built on memcached. Its client library writes each value to copies in multiple AWS availability zones and reads from the local zone, so losing a whole zone doesn't mean a cold cache and a stampede on the databases behind it.

It's a good example of replicating a cache not for durability but for **availability of the hit ratio**.`,
        },
        {
          emoji: '🐦',
          who: 'Twitter',
          what: 'Timelines in Redis, Twemcache, Pelikan',
          tags: ['Redis', 'fan-out on write'],
          text: `Twitter famously kept users' **home timelines** in Redis: when you tweet, your tweet's ID is pushed into the cached timeline list of each follower (fan-out on write), so reading a timeline is a fast list read instead of a giant query. Celebrity accounts with huge follower counts get special handling.

Twitter also built **Twemcache** (a memcached fork), **Twemproxy** (a sharding proxy for memcached and Redis), and later **Pelikan**, a framework for building cache servers.`,
        },
        {
          emoji: '📸',
          who: 'Instagram',
          what: 'Hundreds of millions of keys, small RAM',
          tags: ['Redis hashes', 'memory tuning'],
          text: `Early on, Instagram needed to map hundreds of millions of photo IDs to the user IDs that posted them. Storing each mapping as its own Redis key would have used a lot of memory.

Their engineering blog described bucketing the IDs into Redis **hashes** small enough to stay in Redis's compact encoding, which cut memory several-fold. It's the compact-encoding detail from Part 5, applied at scale.`,
        },
        {
          emoji: '🥞',
          who: 'Stack Overflow',
          what: 'Local cache + Redis',
          tags: ['two-level cache', 'pub/sub'],
          text: `Stack Overflow is known for running a huge site on a surprisingly small number of servers. Its engineers have described a **two-level cache**: an in-memory cache inside each web server (L1) and a shared Redis (L2).

When a value changes, a message on **Redis pub/sub** tells every web server to drop its local copy, solving the "every server has its own copy" problem from Part 1.`,
        },
        {
          emoji: '🔱',
          who: 'Valkey & the clouds',
          what: 'The 2024 Redis fork',
          tags: ['open source', 'Linux Foundation'],
          text: `In 2024 Redis moved from the permissive BSD license to source-available licenses. The community responded with **Valkey**, a fork hosted by the Linux Foundation and backed by several large cloud providers. AWS ElastiCache and Google Cloud Memorystore now offer Valkey, and Redis itself added an AGPLv3 open-source option with Redis 8 in 2025.

For system design purposes the ideas are the same: same protocol, same data structures, same trade-offs.`,
        },
        {
          emoji: '⚡',
          who: 'Fastly & Varnish',
          what: 'HTTP caching at the edge',
          tags: ['reverse proxy', 'CDN'],
          text: `**Varnish** is an HTTP reverse-proxy cache designed to sit in front of web servers, configured with its own language (VCL) for deciding what to cache and for how long.

The CDN **Fastly** built its edge caching on a heavily modified Varnish, and supports purging content worldwide in a fraction of a second, which turns "cache invalidation is hard" into an API call for HTTP responses.`,
        },
      ],
    },
    {
      type: 'text',
      md: `Step back and the pattern is consistent. The companies with the most traffic don't trust a single cache layer: they combine **local and shared** caches, **replicate** caches so a failure doesn't empty them, drive invalidation from the **database's own log** so nothing is forgotten, and build explicit protection (**leases, Gutter pools, coalescing**) against the moments when the cache stops absorbing load. The cache is not an optimization for them. It's load-bearing.`,
    },
    {
      type: 'quiz',
      q: 'In Facebook\'s memcache design, what happens when data changes?',
      options: ['The new value is written into memcache first', 'The entire cache is flushed', 'MySQL is updated, then the key is deleted, with invalidations also streamed from the commit log', 'Nothing until the TTL expires'],
      answer: 2,
      explain: 'Writes go to MySQL and delete the cached key. **McSqueal** daemons tail the MySQL commit log and broadcast deletes, so every committed change invalidates.',
    },
    {
      type: 'quiz',
      q: 'Why does Facebook keep a small "Gutter" pool of spare memcached servers?',
      options: ['To take over for failed servers so their misses don\'t all hit the database', 'To store write-behind data', 'To run batch analytics', 'To hold encrypted keys'],
      answer: 0,
      explain: 'When a cache server fails, clients redirect its requests to **Gutter** servers. The keys refill there instead of every miss falling through to MySQL.',
    },
  ],
});

deepSection('caching-in-depth', {
  id: 'recap',
  nav: 'Diagnose & explain',
  title: 'When it breaks, then explain it back',
  goal: 'Diagnose common caching incidents from their symptoms, then prove you can explain every idea from memory.',
  card: {
    emoji: '🩺',
    text: `Caches fail in recognizable ways. The database spikes the moment a hot key expires: a **stampede**. A rename shows the old name for minutes: a **stale set** or a missed invalidation. Redis latency jumps for every client at once: a **slow command** like KEYS or a huge DEL, or a fork for snapshots. Writes fail with "OOM command not allowed": **maxmemory** reached with the default noeviction policy. Requests for IDs that don't exist hammer the database: **cache penetration**. Learn the symptoms, then test yourself on the flashcards below.`,
  },
  blocks: [
    {
      type: 'text',
      md: `Each incident below starts with a symptom, the way you'd meet it on call. Diagnose it out loud before you tap to reveal the answer.`,
    },
    {
      type: 'yourturn',
      prompt: '💥 Every day at exactly 09:00, database CPU jumps from 20% to 100% for about a minute. Nothing is deployed then.',
      answer: `**Synchronized expiry causing a stampede.** Something (a warm-up job, a nightly import) writes many hot keys at the same time with the same TTL, so they all expire together and every request misses at once.

**Fix:** add jitter to TTLs, rebuild hot keys behind a lock or with request coalescing, and serve stale values while one worker refreshes.`,
    },
    {
      type: 'yourturn',
      prompt: '💥 Once an hour, every Redis client sees latency spikes of hundreds of milliseconds at the same moment.',
      answer: `**Something is blocking the single thread.** Usual suspects: a cron job running \`KEYS *\`, a \`DEL\` of a huge collection, or an RDB snapshot whose \`fork()\` pauses a large instance.

**Fix:** check \`SLOWLOG GET\` and the \`latest_fork_usec\` field in \`INFO\`. Replace \`KEYS\` with \`SCAN\` and \`DEL\` with \`UNLINK\`, keep instances smaller, or move snapshots to a replica.`,
    },
    {
      type: 'yourturn',
      prompt: '💥 Writes to Redis start failing with "OOM command not allowed when used memory > \'maxmemory\'". Reads still work.',
      answer: `**Memory is full and the policy is \`noeviction\`**, the default, so Redis refuses writes instead of evicting.

**Fix:** for a cache, set \`maxmemory-policy allkeys-lru\` (or \`allkeys-lfu\`). Also check for keys without TTLs piling up, or for a \`volatile-*\` policy with no TTL keys left to evict.`,
    },
    {
      type: 'yourturn',
      prompt: '💥 A bot requests random, non-existent product IDs. Your cache hit ratio collapses and the database melts.',
      answer: `**Cache penetration.** Keys that don't exist are never cached, so every request misses and queries the database.

**Fix:** cache "not found" with a short TTL (negative caching), check a Bloom filter of valid IDs before querying, and rate-limit the client.`,
    },
    {
      type: 'yourturn',
      prompt: '💥 One of ten cache servers dies. Within seconds the database is overloaded, even though that server held only a tenth of the keys.',
      answer: `**The client maps keys with \`hash(key) % N\`.** When N drops from 10 to 9, roughly 90% of keys suddenly map to a different server, so almost every request misses at once.

**Fix:** use consistent hashing (only about a tenth of keys move), keep spare capacity like Facebook's Gutter pool, replicate hot data, and shed load at the database when the miss rate spikes.`,
    },
    {
      type: 'yourturn',
      prompt: '💥 During a nightly RDB snapshot, memory on the Redis host nearly doubles and the Linux OOM killer terminates Redis.',
      answer: `**Copy-on-write under heavy writes.** After \`fork()\`, every page the parent modifies is copied. On a write-heavy instance, much of the dataset gets duplicated while the child writes the snapshot.

**Fix:** leave plenty of memory headroom, set \`vm.overcommit_memory = 1\` and disable transparent huge pages as Redis recommends, snapshot from a replica, or split the data across smaller instances.`,
    },
    {
      type: 'flashcards',
      title: 'Explain it back',
      text: 'Answer each card out loud, in full sentences, before you flip it. If you can explain it to an imaginary interviewer, you know it.',
      cards: [
        { q: 'Walk through cache-aside on a read and on a write.', a: 'Read: check the cache; on a hit return it; on a miss read the database, store the result with a TTL, return it. Write: update the database first, then delete the cache key so the next read reloads fresh data.' },
        { q: 'What is the difference between expiry and eviction?', a: 'Expiry removes a key when its TTL runs out, to bound staleness. Eviction removes keys when memory is full, chosen by a policy like LRU or LFU, to make room.' },
        { q: 'Why delete a key on write instead of updating it?', a: 'Concurrent writers can apply cache updates out of order and leave an old value cached. A delete is idempotent: the next read simply loads the current value from the database.' },
        { q: 'Describe the stale-set race and two fixes.', a: 'A reader misses and reads the old row, a writer commits and deletes the key, then the reader writes the old value into the cache. Fixes: a TTL as a safety net, leases that reject SETs after a delete, or version checks.' },
        { q: 'Why is single-threaded Redis fast, and what is the danger?', a: 'Commands run on in-memory data with no locks or context switches, so most take microseconds and each is atomic. The danger: one slow command (KEYS, a huge DEL, a long script) blocks every client.' },
        { q: 'RDB vs AOF?', a: 'RDB forks and writes periodic compact snapshots: fast restarts, but you lose writes since the last one. AOF logs every write, synced about once a second by default: less loss, bigger files, slower restarts. Many use both.' },
        { q: 'How does Redis Cluster place keys, and what are hash tags?', a: 'CRC16(key) mod 16384 gives a slot; each primary owns slot ranges and redirects wrong requests with MOVED. Hash tags like {user:42} hash only the braces part, so related keys share a slot.' },
        { q: 'Name four ways to prevent a cache stampede.', a: 'A rebuild lock or request coalescing so only one request reloads; serving stale data while refreshing; TTL jitter so keys don\'t expire together; probabilistic early refresh; or leases.' },
        { q: 'How do you handle a hot key?', a: 'Spread its reads: cache it briefly in each app server\'s memory (or use Redis client-side caching), split it into several copies on different shards, or serve it from replicas. More shards alone don\'t help.' },
        { q: 'Name three ideas from Facebook\'s memcache paper.', a: 'Leases to stop stale sets and stampedes; McSqueal tailing the MySQL commit log to broadcast deletes; a Gutter pool that takes over for failed servers. Also mcrouter for routing across pools.' },
      ],
    },
    {
      type: 'quiz',
      q: 'Writes to Redis fail with "OOM command not allowed" while reads still work. What is the most likely setup?',
      options: ['maxmemory reached with the default noeviction policy', 'An expired TLS certificate', 'Too many read replicas', 'LFU eviction is enabled'],
      answer: 0,
      explain: 'With **noeviction**, a full Redis refuses writes that need memory but keeps serving reads. A cache should use an `allkeys-*` eviction policy.',
    },
    {
      type: 'quiz',
      q: 'A client maps keys to 10 cache servers with hash(key) % 10. One server dies. Roughly what share of keys now map to a different server?',
      options: ['About 10%', 'About 50%', 'About 90%', 'None'],
      answer: 2,
      explain: 'Going from % 10 to % 9 moves about **90%** of keys, so nearly every request misses at once. Consistent hashing would move only about a tenth.',
    },
  ],
});
