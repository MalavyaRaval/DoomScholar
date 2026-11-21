registerDeepDive({
  id: 'storage-engines',
  title: 'B-Trees vs LSM Trees: How Databases Store Data',
  short: 'Storage engines',
  emoji: '💽',
  color: '#d97706',
  related: 'databases',
  tagline: 'How databases lay out bytes, survive crashes, and why some never update a file in place',
  hook: 'Under almost every database sits a B-tree or an LSM tree. See how each stores rows, survives crashes, and where Postgres, Cassandra and RocksDB fit.',
  intro: `You already know that indexes speed up reads and slow down writes. This deep dive opens the box underneath: how a database actually lays bytes on disk, finds one row among a billion in about four page reads, survives a power cut in the middle of a transaction, and why some databases refuse to ever update a file in place.

Nearly every database you'll meet is built on one of two data structures. **B-trees** (PostgreSQL, MySQL's InnoDB, SQLite, MongoDB's WiredTiger) keep data sorted in pages and update those pages in place. **LSM trees** (RocksDB, Cassandra, ScyllaDB, CockroachDB's Pebble) buffer writes in memory and only ever write immutable files. Knowing how each works tells you why your database is fast or slow, what its background jobs are doing, and what is most likely to page you at 3 a.m.

Each part ends with checkpoints, and each part's opening paragraph also plays in your feed, so these ideas will come back around. That's the point: repetition is what makes it stick.`,
  recap: [
    'Databases read and write whole pages; random I/O is the enemy',
    'B+trees: wide, shallow, sorted, updated in place; great reads and range scans',
    'WAL first, data pages later: a commit is one sequential log flush',
    'LSM trees: memtable, immutable SSTables, compaction; built for heavy writes',
    'Every engine trades read, write and space amplification against each other',
  ],
});

deepSection('storage-engines', {
  id: 'pages',
  nav: 'Disks and pages',
  title: 'Disks, pages, and why databases think in pages',
  goal: 'Understand the physical constraint every storage engine is designed around.',
  card: {
    emoji: '💾',
    text: `A database can't fetch one row from disk. Storage is read and written in blocks, so engines organize everything into fixed-size **pages**: 8 KB in PostgreSQL, 16 KB in MySQL's InnoDB. Ask for a 100-byte row and the whole page comes into memory. Random reads are the expensive part: milliseconds on a spinning disk, tens of microseconds on an SSD, versus about 100 nanoseconds for RAM. So every storage engine is built around one goal: touch as few pages as possible, and turn scattered writes into sequential ones whenever it can.`,
  },
  blocks: [
    {
      type: 'text',
      md: `Every design decision in a storage engine traces back to one physical fact: **storage is slow and block-shaped**. A CPU can read a value from RAM in roughly 100 nanoseconds. A random read from an SSD takes tens of microseconds, hundreds of times slower. A spinning hard disk has to move its arm and wait for the platter to rotate, which costs milliseconds, around 100,000 times slower than RAM.

Storage devices also don't hand out single bytes. They transfer whole blocks, and the operating system caches files in pages, usually 4 KB each. So databases lean into it: they split every table and index into fixed-size **pages** (PostgreSQL uses 8 KB, InnoDB 16 KB, SQLite 4 KB by default) and always read and write whole pages. A page is the unit of I/O, the unit of caching, and often the unit of locking.`,
    },
    {
      type: 'stats',
      title: 'Orders of magnitude worth memorizing',
      stats: [
        { value: '~100 ns', label: 'read a value from RAM' },
        { value: '10–100 µs', label: 'random read from an SSD' },
        { value: '~5–10 ms', label: 'random read from a spinning disk (seek + rotation)' },
        { value: '8–16 KB', label: 'a typical database page (PostgreSQL 8, InnoDB 16)' },
      ],
      caption: 'Rough figures that vary by hardware, but the ratios are what matter: each step down is hundreds to thousands of times slower.',
    },
    {
      type: 'layers',
      title: 'Where one row actually lives in PostgreSQL. Pick a reader.',
      layers: [
        { tag: 'FILE', name: 'Table file on disk', fields: ['`base/16384/24576`', 'a sequence of 8 KB pages', 'page 0, 1, 2 … 9,341'] },
        { tag: 'PAGE', name: 'Page 7 (8 KB)', fields: ['header: LSN, free-space pointers', 'slot array grows forward →', '← free space →', 'rows packed from the end'] },
        { tag: 'SLOT', name: 'Line pointer #3', fields: ['offset 7,912', 'length 96 bytes', 'state: normal'] },
        { tag: 'ROW', name: 'Row at ctid (7,3)', fields: ['header: `xmin`, `xmax`, …', 'id = 42', 'email = `ada@example.com`', 'created_at = …'] },
      ],
      views: [
        {
          label: '💾 OS and disk',
          sees: ['FILE'],
          text: 'The operating system and the disk see a **file of bytes**, read and written in blocks. They have no idea where one row ends and the next begins, which rows are live, or what a column is.',
        },
        {
          label: '🐘 Database',
          sees: ['FILE', 'PAGE', 'SLOT', 'ROW'],
          text: 'The database understands the **page layout**: a header, an array of slots, and rows packed from the end. Indexes point to a row by `(page, slot)`, here `(7,3)`, so the engine can move bytes within the page without breaking any pointer to it.',
        },
      ],
    },
    {
      type: 'text',
      md: `Inside a page, most engines use a **slotted page** layout. A small header at the start records things like the free space and the log position of the page's last change. After it comes an array of **slots** (PostgreSQL calls them line pointers), each holding the offset and length of one row. The rows themselves are packed from the end of the page backwards, and the free space sits in the middle, shrinking from both sides.

The indirection is the clever bit. Other structures point at a row by **(page, slot)**, which PostgreSQL exposes as the hidden \`ctid\` column. If a row is rewritten or the page is tidied up, the engine moves the bytes and updates the slot, and every pointer to "page 7, slot 3" stays valid.`,
    },
    {
      type: 'text',
      md: `The second fact is that **sequential beats random**. Reading or writing a long run of adjacent blocks lets the device stream at full speed. On a hard disk the gap is enormous. SSDs narrow it, but flash has its own quirk: it can't overwrite data in place. It writes to fresh, already-erased locations and erases much larger blocks later, so lots of small scattered overwrites force the drive to shuffle data around internally. That hidden copying is the drive's own write amplification, and it also wears the flash out faster.

Keep both facts in mind, **touch few pages** and **prefer sequential I/O**, because the two big families of storage engines are two different answers to them. B-trees are built to find any page in very few reads. LSM trees are built to write in big sequential chunks.`,
    },
    {
      type: 'callout',
      tone: 'key',
      title: 'The mental model',
      text: 'A storage engine is a strategy for arranging **pages** so the common operations touch as few of them as possible, as sequentially as possible. When you hear "B-tree vs LSM", translate it to "optimize for reading pages vs optimize for writing them".',
    },
    {
      type: 'quiz',
      q: 'You ask PostgreSQL for one 100-byte row that isn\'t cached. What does it read from disk?',
      options: ['Exactly those 100 bytes', 'The whole 8 KB page that contains the row', 'The entire table file', 'Only the index entry for the row'],
      answer: 1,
      explain: 'Engines do I/O in whole pages. PostgreSQL reads the full 8 KB page into memory, which is why locality (related rows sharing a page) matters so much.',
    },
    {
      type: 'quiz',
      q: 'Why do SSDs handle lots of small random overwrites worse than large sequential writes?',
      options: ['SSDs have a moving head that must seek', 'SSDs can only store files up to 4 KB', 'Flash can\'t overwrite in place, so scattered updates force internal copying and erasing', 'The operating system disables caching on SSDs'],
      answer: 2,
      explain: 'Flash writes to fresh pages and erases in much larger blocks. Small scattered updates make the drive relocate live data internally: hidden write amplification and extra wear.',
    },
  ],
});

deepSection('storage-engines', {
  id: 'btree',
  nav: 'B+tree lookups',
  title: 'Inside a B+tree: structure, lookups and page splits',
  goal: 'Walk a lookup and an insert through a B+tree, page by page.',
  card: {
    emoji: '🌳',
    text: `A **B+tree** is the default index in almost every relational database. Each node is one page holding hundreds of sorted keys, so the tree is extremely wide and shallow: four levels can index billions of rows. A lookup starts at the root, binary-searches each page and follows one pointer per level down to a leaf. The leaves hold every key in order and link to their neighbors, so range scans just walk sideways. Inserts go into the right leaf, and when a leaf is full it splits in two, which is how the tree stays balanced.`,
  },
  blocks: [
    {
      type: 'text',
      md: `Rudolf Bayer and Edward McCreight invented the B-tree at Boeing's research labs around 1970, and more than fifty years later it's still the index behind PostgreSQL, MySQL, SQL Server, Oracle, SQLite and MongoDB's WiredTiger. What almost everyone actually uses is the **B+tree** variant, and the difference matters.

In a B+tree, **internal pages** hold only separator keys and child pointers: "keys below 500 are down this pointer, 500 and up are down that one". All the real entries live in the **leaf pages**, kept in sorted order, and each leaf links to the next. Because an internal entry is just a key and a page number, one 8 KB page can hold hundreds of them. That **fanout** is the whole trick. With a few hundred children per page, three levels of internal pages above the leaves reach billions of entries, and those upper levels are small enough to stay in memory.`,
    },
    {
      type: 'stepper',
      title: 'Step through a lookup: WHERE id = 42',
      diagram: {
        h: 330,
        nodes: [
          { id: 'root', x: 180, y: 38, label: 'Root', icon: '🌳', tone: 'accent' },
          { id: 'i1', x: 95, y: 128, label: 'Keys 1–499', icon: '📑' },
          { id: 'i2', x: 265, y: 128, label: 'Keys 500+', icon: '📑' },
          { id: 'l1', x: 50, y: 222, label: 'Leaf 1–40', icon: '🍃' },
          { id: 'l2', x: 165, y: 222, label: 'Leaf 41–80', icon: '🍃' },
          { id: 'l3', x: 300, y: 222, label: 'Leaf 500+', icon: '🍃' },
          { id: 'row', x: 165, y: 298, label: 'Row id=42', icon: '📄', tone: 'good' },
        ],
        edges: [
          { from: 'root', to: 'i1' },
          { from: 'root', to: 'i2' },
          { from: 'i1', to: 'l1' },
          { from: 'i1', to: 'l2' },
          { from: 'i2', to: 'l3' },
          { from: 'l1', to: 'l2', dashed: true },
          { from: 'l2', to: 'l3', dashed: true },
          { from: 'l2', to: 'row', tone: 'good' },
        ],
      },
      steps: [
        {
          title: 'Start at the root',
          text: 'Looking up `id = 42`. The root page is almost always cached in memory. It holds a few separator keys and child pointers: keys below 500 go left, 500 and up go right.',
          focus: ['root'],
        },
        {
          title: 'Binary search inside the page',
          text: 'Keys inside a page are sorted, so the engine binary-searches them instead of scanning. 42 is below 500, so it follows the pointer to the internal page covering 1 to 499.',
          focus: ['root', 'root>i1', 'i1'],
        },
        {
          title: 'Descend one more level',
          text: 'The internal page repeats the trick with finer ranges. 42 falls between 41 and 80, so the next pointer leads to a leaf. Each level costs one page visit, and these upper pages are usually already in memory.',
          focus: ['i1', 'i1>l2', 'l2'],
        },
        {
          title: 'Find the key in the leaf',
          text: 'Leaves hold every key in sorted order. In a PostgreSQL index, the entry for 42 stores a tuple ID like `(7,3)`: page 7, slot 3 of the table\'s heap file. In InnoDB\'s clustered index, the leaf holds the entire row.',
          focus: ['l2'],
        },
        {
          title: 'Fetch the row',
          text: 'One more page read fetches heap page 7 and reads slot 3. Total: about four page visits for a table of millions or billions of rows, most of them served from memory.',
          focus: ['l2', 'l2>row', 'row'],
        },
        {
          title: 'Range scans walk the leaves',
          text: 'For `WHERE id BETWEEN 41 AND 600`, the tree is used once to find 41. Then the scan walks sideways along the linked leaves, in key order, without climbing back up. That\'s why B+trees are so good at ranges and `ORDER BY`.',
          focus: ['l1', 'l2', 'l3', 'l1>l2', 'l2>l3'],
        },
      ],
    },
    {
      type: 'text',
      md: `What a leaf entry points to depends on the engine. **PostgreSQL** stores table rows in a separate, unordered **heap** file, and every index, including the primary key, maps keys to a tuple ID \`(page, slot)\`. **InnoDB** stores the table itself inside the primary-key B+tree: the leaves of this **clustered index** hold entire rows. Its secondary indexes store the primary key instead of a physical location, so a lookup by email finds the primary key first, then walks the clustered index a second time.

Both designs have a shortcut. If an index already contains every column a query needs, a **covering index**, the engine can answer from the index alone. PostgreSQL calls this an index-only scan, and it uses a visibility map to know when it can skip checking the heap.`,
    },
    {
      type: 'code',
      title: 'Watching PostgreSQL choose the B-tree',
      lang: 'sql',
      code: `CREATE INDEX users_email_idx ON users (email);

EXPLAIN (COSTS OFF)
SELECT * FROM users WHERE email = 'ada@example.com';

--  Index Scan using users_email_idx on users
--    Index Cond: (email = 'ada@example.com'::text)`,
      caption: '`EXPLAIN` shows the plan: descend the email B-tree, then fetch the matching row from the heap. Without the index, the plan would be a sequential scan of every page.',
    },
    {
      type: 'text',
      md: `**Inserting** follows the same path as a lookup. The engine finds the leaf where the key belongs and slots it into sorted position. If the leaf has room, that's it: one page changed in memory, plus a log record.

If the leaf is **full**, it **splits**. The engine allocates a new page, moves roughly the upper half of the keys into it, and inserts a new separator key into the parent so searches know which half to visit. If the parent is also full, it splits too, and so on upward. When the root itself splits, a new root is created above it and the tree grows one level taller. B-trees grow at the top, never at the bottom, so every leaf is always the same distance from the root and every lookup costs the same number of steps.

Splits leave pages about half full, which wastes space and cache. Engines let you keep deliberate headroom instead: PostgreSQL's \`fillfactor\` defaults to 90% for B-tree indexes, so a few later inserts can land without an immediate split.`,
    },
    {
      type: 'diagram',
      title: 'A leaf split',
      diagram: {
        h: 300,
        nodes: [
          { id: 'p', x: 255, y: 45, label: 'Parent page', icon: '📑', tone: 'accent' },
          { id: 'full', x: 62, y: 190, label: 'Leaf 41–80\n(full)', icon: '🍃', tone: 'bad' },
          { id: 'a', x: 205, y: 200, label: 'Leaf 41–60', icon: '🍃', tone: 'good' },
          { id: 'b', x: 310, y: 200, label: 'Leaf 61–80', icon: '🍃', tone: 'good' },
        ],
        edges: [
          { from: 'full', to: 'a', dashed: true },
          { from: 'full', to: 'b', dashed: true, curve: -110 },
          { from: 'p', to: 'a' },
          { from: 'p', to: 'b' },
        ],
        notes: [{ x: 180, y: 284, text: 'one full page becomes two half-full pages' }],
      },
      caption: 'The full leaf splits into two, and the parent gains a new separator key (61) pointing at the new page. If the parent is full too, the split ripples upward.',
    },
    {
      type: 'callout',
      tone: 'warn',
      title: 'Random keys are expensive',
      text: 'With an auto-increment or time-ordered key, new entries always land in the **rightmost leaf**: splits are rare and predictable, and the hot pages stay in memory. With a random key like UUIDv4, every insert lands on a random leaf somewhere in the tree. Pages split all over the place, sit half empty, and the working set stops fitting in memory. In InnoDB it\'s worse, because the **table itself** is the clustered index. Time-ordered IDs such as UUIDv7 (standardized in RFC 9562 in 2024) keep global uniqueness without the scatter.',
    },
    {
      type: 'quiz',
      q: 'Why can a B+tree find one key among billions with only about four page reads?',
      options: ['It keeps every key in RAM', 'It hashes keys straight to their page', 'It scans all the leaves in parallel', 'Each page holds hundreds of keys, so the tree is wide and shallow'],
      answer: 3,
      explain: 'High fanout keeps the height tiny: a few hundred children per page means about four levels reach billions of entries, and the top levels are usually cached.',
    },
    {
      type: 'quiz',
      q: 'An InnoDB table uses random UUIDv4 primary keys, and inserts slow down as it grows. Why?',
      options: ['UUIDs are too long to compare quickly', 'Inserts land on random leaves of the clustered index, causing splits and cache misses', 'InnoDB doesn\'t allow string primary keys', 'The redo log can\'t record UUIDs'],
      answer: 1,
      explain: 'The table lives in the primary-key B+tree, so random keys scatter writes across the whole tree: frequent page splits, half-empty pages and a working set bigger than memory.',
    },
  ],
});

deepSection('storage-engines', {
  id: 'wal',
  nav: 'WAL and recovery',
  title: 'The write-ahead log, the buffer pool and crash recovery',
  goal: 'Know exactly what happens between UPDATE and OK, and how a database survives a power cut.',
  card: {
    emoji: '📜',
    text: `Writing changed pages straight to their places on disk would be slow and unsafe: a crash halfway through leaves a mix of old and new. So databases change pages in an in-memory **buffer pool** and describe every change in a **write-ahead log (WAL)** first. On COMMIT, only the log has to be flushed to disk, which is one sequential write. The changed data pages are written later, in the background. After a crash, the database replays the log from the last **checkpoint** and every committed change reappears. The log is the truth; data files catch up.`,
  },
  blocks: [
    {
      type: 'text',
      md: `Databases never work on disk directly. They keep a **buffer pool**: a large region of memory holding copies of recently used pages. Reads check the pool first and go to disk only on a miss. Writes modify the page in the pool and mark it **dirty**. When the pool is full, the engine evicts pages it hasn't used recently, writing them out first if they're dirty.

PostgreSQL uses a clock-sweep approximation of LRU for its shared buffers and also leans on the operating system's file cache. InnoDB manages its own pool with an LRU list split into "young" and "old" sections, so one big table scan can't flush out the hot pages. Both ship with a small 128 MB default, and sizing it is usually the first tuning step: \`shared_buffers\` in PostgreSQL, \`innodb_buffer_pool_size\` in MySQL.`,
    },
    {
      type: 'text',
      md: `The problem: if dirty pages only live in memory, a crash loses them. Writing every changed page to disk at commit would be slow (many random writes, a whole 8 or 16 KB page for a one-byte change) and still unsafe (a crash while writing several pages leaves some old and some new).

The answer is the **write-ahead log**, one of the oldest ideas in databases. Every change is first described in a compact log record and appended to the end of a sequential log file. Then two rules apply. A dirty page may not be written to disk until the log records describing its changes are on disk. And a transaction is not committed until its commit record is on disk. That's all. A commit becomes one sequential flush of a few small records instead of many random page writes.`,
    },
    {
      type: 'stepper',
      title: 'Step through UPDATE … COMMIT',
      diagram: {
        h: 310,
        nodes: [
          { id: 'c', x: 60, y: 50, label: 'Client', icon: '💻', shape: 'pill' },
          { id: 'bp', x: 270, y: 60, label: 'Buffer pool\n(RAM)', icon: '🧠', tone: 'accent' },
          { id: 'wal', x: 60, y: 250, label: 'WAL file', icon: '📜', shape: 'db' },
          { id: 'data', x: 270, y: 250, label: 'Data files', icon: '🗄️', shape: 'db' },
        ],
        edges: [
          { from: 'c', to: 'bp', label: 'UPDATE' },
          { from: 'bp', to: 'wal', label: 'log record' },
          { from: 'wal', to: 'c', label: 'COMMIT OK', tone: 'good' },
          { from: 'bp', to: 'data', label: 'later', dashed: true },
          { from: 'wal', to: 'data', label: 'replay', dashed: true, tone: 'warn' },
        ],
      },
      steps: [
        {
          title: 'Change the page in memory',
          text: 'Your UPDATE finds the page in the buffer pool (reading it from disk first if needed) and changes it in memory. The page is now **dirty**: newer in RAM than on disk.',
          focus: ['c', 'c>bp', 'bp'],
        },
        {
          title: 'Describe the change in the log',
          text: 'The same change is written as a compact WAL record, roughly "page 7, slot 3: set balance to 900". Records are appended to the end of the log, so this is sequential I/O.',
          focus: ['bp', 'bp>wal', 'wal'],
        },
        {
          title: 'COMMIT means: flush the log',
          text: 'On COMMIT, the database forces the log to stable storage with `fsync`, up to and including your commit record, and only then answers OK. The data page itself still hasn\'t been written. That\'s fine: the log is enough to rebuild it.',
          focus: ['wal', 'wal>c', 'c'],
        },
        {
          title: 'Write data pages later',
          text: 'In the background, dirty pages are written to the data files, often many changes per page write. A **checkpoint** guarantees everything up to a point in the log is on disk, so older log can be recycled.',
          focus: ['bp', 'bp>data', 'data'],
        },
        {
          title: 'Crash? Replay the log',
          text: 'After a crash, the database starts from the last checkpoint and re-applies every logged change since (**redo**), so committed work comes back. InnoDB then uses its undo logs to roll back transactions that never committed.',
          focus: ['wal', 'wal>data', 'data'],
        },
      ],
    },
    {
      type: 'text',
      md: `If the database only ever appended to the log, recovery would mean replaying it from the beginning of time. **Checkpoints** bound that. Periodically the engine writes out all dirty pages and records the log position it has reached. After a crash, recovery starts from the last checkpoint and replays forward, and log older than the checkpoint can be recycled or archived. Frequent checkpoints mean faster recovery but more page writes; rare ones mean the opposite.

The classic recovery algorithm is **ARIES**, published by IBM Research in 1992: analyze the log, **redo** everything to restore the exact state at the moment of the crash, then **undo** transactions that never committed. InnoDB follows that pattern with its redo log and undo logs. PostgreSQL only needs the redo half: an uncommitted transaction's row versions are simply never visible to anyone, so there's nothing to undo.`,
    },
    {
      type: 'tabs',
      title: 'Three details that matter in production',
      tabs: [
        {
          label: 'Torn pages',
          blocks: [
            {
              type: 'text',
              md: `A database page is bigger than what the disk guarantees to write atomically, so a crash mid-write can leave a **torn page**: half new, half old. Replaying a small log record onto a torn page doesn't fix it.

PostgreSQL's answer is \`full_page_writes\` (on by default): the first time a page changes after a checkpoint, the whole page image goes into the WAL, so recovery can restore it. InnoDB uses a **doublewrite buffer**: pages are written to a separate area first and then to their real location, so one intact copy always exists.`,
            },
          ],
        },
        {
          label: 'Group commit',
          blocks: [
            {
              type: 'text',
              md: `An \`fsync\` takes real time, especially on hard disks and network-attached cloud volumes. If 500 transactions commit in the same moment, flushing the log 500 times would cap throughput.

**Group commit** batches them: one flush makes all their commit records durable at once, and all 500 get their OK together. That's why a database can often handle more commits per second than the disk could fsync one at a time.`,
            },
          ],
        },
        {
          label: 'Trading durability',
          blocks: [
            {
              type: 'text',
              md: `Both big open-source databases let you relax the rule. PostgreSQL's \`synchronous_commit = off\` returns OK before the WAL is flushed: a crash can lose the last fraction of a second of commits, but it never corrupts data.

MySQL's \`innodb_flush_log_at_trx_commit\` defaults to 1, a flush at every commit. Setting it to 2 writes the log to the OS at commit and flushes roughly once per second. Fine for metrics or logs, risky for money.`,
            },
          ],
        },
      ],
    },
    {
      type: 'callout',
      tone: 'key',
      title: 'The log is the database',
      text: 'The WAL is more than a crash-recovery tool. PostgreSQL streams it to replicas for **physical replication**, archives it for **point-in-time recovery**, and decodes it into a change stream for tools like Debezium. Once you think of the log as the source of truth and the tables as a cache of its latest state, LSM trees in the next part will feel natural.',
    },
    {
      type: 'deep',
      title: 'Go deeper: fsync is harder than it looks',
      blocks: [
        {
          type: 'text',
          md: `Durability depends on \`fsync\` really meaning "this is on stable storage". Several layers can quietly break that promise: a disk with a volatile write cache and no power-loss protection, a virtualization layer, or the kernel itself.

In 2018, PostgreSQL developers discovered that on Linux, when a background write-back failed, \`fsync\` could report the error once and then treat the pages as clean, so a retried \`fsync\` would "succeed" even though the data never reached the disk. PostgreSQL's response was to treat an fsync failure as fatal: it now panics and recovers from the WAL instead of retrying. The episode, nicknamed "fsyncgate", is a good reminder that a WAL is only as durable as the flush underneath it.`,
        },
      ],
    },
    {
      type: 'quiz',
      q: 'When you COMMIT, what must be on disk before the database replies OK?',
      options: ['The log records up to and including the commit record', 'Every data page the transaction changed', 'A fresh checkpoint of the whole database', 'Nothing: commits live only in memory'],
      answer: 0,
      explain: 'Only the WAL must be flushed. Changed data pages stay dirty in the buffer pool and are written later, because the log is enough to rebuild them after a crash.',
    },
    {
      type: 'quiz',
      q: 'Why does PostgreSQL write a full page image into the WAL the first time a page changes after a checkpoint?',
      options: ['To make the log compress better', 'To speed up streaming replication', 'So recovery can repair a torn page left by a crash mid-write', 'To support undo of aborted transactions'],
      answer: 2,
      explain: 'A crash can tear an 8 KB page write. With the full image in the WAL, recovery restores the whole page and then replays later changes on top of it.',
    },
  ],
});

deepSection('storage-engines', {
  id: 'lsm',
  nav: 'LSM write path',
  title: 'LSM trees: turn every write into an append',
  goal: 'Follow a write and a read through an LSM tree, and see why it ingests data so fast.',
  card: {
    emoji: '🪵',
    text: `An **LSM tree** never updates data in place. A write is appended to a log for durability and inserted into a sorted in-memory table, the **memtable**, and that's it: no page to find, read or rewrite. When the memtable fills up, it's written to disk in one sequential pass as an **SSTable**, a sorted, immutable file. Updates simply write a newer version; deletes write a marker called a **tombstone**. Reads check the memtable first, then SSTables from newest to oldest. LevelDB, RocksDB, Cassandra and ScyllaDB all work this way.`,
  },
  blocks: [
    {
      type: 'text',
      md: `The **log-structured merge-tree** comes from a 1996 paper by Patrick O'Neil and colleagues, but it went mainstream through Google. Bigtable, described in a 2006 paper, organized data as in-memory **memtables** and on-disk **SSTables**. In 2011 Jeff Dean and Sanjay Ghemawat open-sourced **LevelDB**, a small embeddable LSM library, and Facebook forked it into **RocksDB**, open-sourced in 2013, which now sits underneath a remarkable amount of infrastructure.

The core idea follows straight from part 1. Random writes are expensive and sequential writes are cheap, so never do random writes. Buffer changes in memory, keep them sorted, and write them out in big sorted batches. Never modify a file once it's written. Clean up later, in the background.`,
    },
    {
      type: 'stepper',
      title: 'Step through an LSM write, then a read',
      diagram: {
        h: 320,
        nodes: [
          { id: 'c', x: 50, y: 60, label: 'Client', icon: '💻', shape: 'pill' },
          { id: 'mem', x: 190, y: 60, label: 'Memtable\n(RAM)', icon: '🧠', tone: 'accent' },
          { id: 'imm', x: 305, y: 60, label: 'Frozen\nmemtable', icon: '❄️' },
          { id: 'wal', x: 50, y: 185, label: 'WAL', icon: '📜', shape: 'db' },
          { id: 'l0', x: 305, y: 180, label: 'L0 SSTables', icon: '📦', shape: 'db' },
          { id: 'l1', x: 305, y: 280, label: 'L1 … Ln', icon: '📚', shape: 'db' },
        ],
        edges: [
          { from: 'c', to: 'wal', label: 'append' },
          { from: 'c', to: 'mem', label: 'insert' },
          { from: 'mem', to: 'imm' },
          { from: 'imm', to: 'l0', label: 'flush' },
          { from: 'l0', to: 'l1', label: 'compact' },
        ],
      },
      steps: [
        {
          title: 'Append to the log',
          text: 'A write such as `put user:42 → {...}` is first appended to the write-ahead log. It\'s a sequential append, so it\'s fast, and it\'s what makes the write survive a crash.',
          focus: ['c', 'c>wal', 'wal'],
        },
        {
          title: 'Insert into the memtable',
          text: 'Then it goes into the **memtable**, a sorted in-memory structure (a skip list in LevelDB and RocksDB). The write is acknowledged. No data page was read, and nothing on disk was rewritten.',
          focus: ['c', 'c>mem', 'mem'],
        },
        {
          title: 'The memtable fills up and freezes',
          text: 'When the memtable reaches its size limit (64 MB by default in RocksDB), it becomes immutable and a fresh memtable takes new writes, so writers never wait for the flush.',
          focus: ['mem', 'mem>imm', 'imm'],
        },
        {
          title: 'Flush to an SSTable',
          text: 'The frozen memtable is written out in key order as an **SSTable**: an immutable, sorted file with a block index and usually a bloom filter. One big sequential write. The log segment covering it can now be deleted.',
          focus: ['imm', 'imm>l0', 'l0'],
        },
        {
          title: 'Compaction merges in the background',
          text: 'SSTables pile up, so background **compaction** merges them into larger sorted files in deeper levels, keeping only the newest version of each key and eventually dropping deleted ones.',
          focus: ['l0', 'l0>l1', 'l1'],
        },
        {
          title: 'Reading: newest first',
          text: 'A read checks the memtable, then any frozen memtables, then SSTables from newest to oldest, and stops at the first match, because the newest version wins. Bloom filters let it skip files that definitely don\'t contain the key.',
          focus: ['c', 'c>mem', 'mem', 'imm', 'l0', 'l1'],
        },
      ],
    },
    {
      type: 'text',
      md: `An **SSTable** (sorted string table) is a file of key-value pairs sorted by key and split into blocks of a few kilobytes. At the end of the file sits an **index** holding the first key of each block, and usually a **bloom filter** over every key in the file. To find a key, the engine asks the filter whether the key could possibly be there, binary-searches the small index for the one block that could hold it, and reads just that block.

Because SSTables are immutable, they compress well, can be cached and shared freely without locks, and are easy to back up or ship to another machine: you copy files that will never change.`,
    },
    {
      type: 'table',
      title: 'The same operations, two engines',
      head: ['Operation', 'B+tree', 'LSM tree'],
      rows: [
        ['Insert', 'Find the leaf, modify the page in place (split if full)', 'Append to the log, insert into the memtable'],
        ['Update', 'Overwrite the value in its page', 'Write a newer version; the old one lingers until compaction'],
        ['Delete', 'Remove the entry from its page', 'Write a tombstone that hides older versions'],
        ['Point read', 'One root-to-leaf path', 'Memtable, then SSTables newest to oldest, skipping most via bloom filters'],
        ['Disk writes', 'Random page writes, buffered, plus the WAL', 'Sequential flushes and compactions'],
      ],
    },
    {
      type: 'callout',
      tone: 'tip',
      title: 'Why LSM writes are so cheap',
      text: 'A B-tree insert may have to **read** a leaf page from disk before it can modify it. An LSM write never reads anything: it doesn\'t care what is already stored for that key. That "blind write" is why LSM engines shine at ingesting events, metrics, messages and logs. It\'s also why "increment this counter" is subtle in an LSM: RocksDB offers **merge operators** so you can record the increment now and combine it with the old value later, during reads and compaction.',
    },
    {
      type: 'quiz',
      q: 'In an LSM tree, what happens on disk when you update an existing key?',
      options: ['The old value is overwritten inside its file', 'A newer version is written; existing SSTables are never modified', 'The whole SSTable is rewritten immediately', 'The update waits until the next backup'],
      answer: 1,
      explain: 'SSTables are immutable. The update lands in the memtable and later in a new SSTable. Reads find the newest version first, and compaction eventually discards the old one.',
    },
    {
      type: 'quiz',
      q: 'Why does an LSM read check the memtable before any SSTable?',
      options: ['The memtable is always smaller', 'SSTables are encrypted at rest', 'Bloom filters only work in memory', 'It holds the newest writes, and the newest version of a key wins'],
      answer: 3,
      explain: 'Versions are searched from newest to oldest and the first match wins. The memtable has the most recent writes, then the newest SSTables, then older levels.',
    },
  ],
});

deepSection('storage-engines', {
  id: 'compaction',
  nav: 'Compaction and blooms',
  title: 'Compaction, bloom filters and tombstones',
  goal: 'Understand the background work that keeps LSM reads fast, and what it costs.',
  card: {
    emoji: '🧹',
    text: `Without cleanup, an LSM tree would pile up thousands of SSTables, and every read would check them all. **Compaction** merges files in the background, keeping only the newest version of each key and dropping deleted data. **Leveled** compaction (RocksDB's default) keeps each level's files non-overlapping, so a read checks about one file per level, at the cost of rewriting data more often. **Size-tiered** merges similar-sized files, writing less but using more space. **Bloom filters** let reads skip files that definitely lack a key. And **tombstones** must survive until compaction is sure nothing older remains.`,
  },
  blocks: [
    {
      type: 'text',
      md: `Every memtable flush adds a new SSTable. Left alone, the files multiply, and three problems grow with them. Reads slow down, because a key could be in any file. Space is wasted, because overwritten values and deleted keys still sit in old files. And the number of files to track keeps climbing.

**Compaction** is the fix: a background process that reads several SSTables, merge-sorts them (cheap, since each is already sorted), keeps only the newest version of each key, and writes the result out as new SSTables. Then it deletes the inputs. It's the "merge" in log-structured merge-tree, and how you configure it decides most of an LSM engine's personality.`,
    },
    {
      type: 'diagram',
      title: 'Leveled layout',
      diagram: {
        h: 330,
        nodes: [
          { id: 'mem', x: 150, y: 40, label: 'Memtable', icon: '🧠', tone: 'accent' },
          { id: 'l0', x: 150, y: 125, label: 'L0 (overlap)', icon: '📦' },
          { id: 'l1', x: 150, y: 210, label: 'L1 (sorted)', icon: '📚' },
          { id: 'l2', x: 150, y: 295, label: 'L2 (10× L1)', icon: '📚' },
        ],
        edges: [
          { from: 'mem', to: 'l0', label: 'flush' },
          { from: 'l0', to: 'l1', label: 'compact' },
          { from: 'l1', to: 'l2', label: 'compact' },
        ],
        notes: [
          { x: 292, y: 129, text: 'key ranges overlap' },
          { x: 292, y: 214, text: 'no overlaps' },
          { x: 292, y: 299, text: '~10× bigger' },
        ],
      },
      caption: 'Fresh flushes land in L0, where files can overlap. From L1 down, each level is split into non-overlapping files and is about 10 times bigger than the level above.',
    },
    {
      type: 'tabs',
      title: 'Three compaction strategies',
      tabs: [
        {
          label: 'Leveled',
          blocks: [
            {
              type: 'text',
              md: `Data is organized into levels. L0 holds fresh flushes, whose key ranges can overlap. From L1 down, each level is about 10 times larger than the one above (RocksDB's default multiplier), and the files **within** a level have non-overlapping key ranges. When a level grows past its target size, one of its files is merged into the overlapping files of the next level.

**Good:** a point read checks at most one file per level below L0, and space overhead stays low because each key mostly lives in one place. **Cost:** data is rewritten every time it moves down a level, so write amplification is high. It's the default in LevelDB and RocksDB and an option in Cassandra.`,
            },
          ],
        },
        {
          label: 'Size-tiered',
          blocks: [
            {
              type: 'text',
              md: `When several SSTables of similar size accumulate (say four), merge them into one bigger file. Those bigger files later merge with their own size peers, and so on. It was long the default in Cassandra, and RocksDB's version is called universal compaction.

**Good:** each byte is rewritten fewer times, so it absorbs heavy write loads well. **Cost:** a key can exist in many files at once, so reads may check more of them, and space amplification is higher: overwritten data lingers in big files, and merging the largest tier temporarily needs room for both the inputs and the output.`,
            },
          ],
        },
        {
          label: 'Time-window',
          blocks: [
            {
              type: 'text',
              md: `For time-series data that is written once and expires, Cassandra's time-window strategy groups SSTables by the time window their data was written in, and only compacts within a window. When every row in a window's files has expired through its TTL, the whole file is dropped, with no merging at all.

Cheap and elegant, as long as you don't update or delete old data out of order, which would drag old windows back into compaction.`,
            },
          ],
        },
      ],
    },
    {
      type: 'text',
      md: `Even with compaction, a key that doesn't exist could send a read through every level. **Bloom filters** prevent that. A bloom filter is a compact bit array built from all the keys in an SSTable. Ask it "could key X be in this file?" and it answers either "definitely not" or "maybe". It never says no for a key that is present, but occasionally says maybe for one that isn't.

The math is friendly: about **10 bits per key** gives roughly a 1% false-positive rate, so a filter covering 100 million keys costs about 125 MB, small enough to keep in memory. With filters, a lookup for a missing key usually touches no data blocks at all. The catch: a bloom filter only answers exact-key questions, so it can't help a range scan. RocksDB adds prefix bloom filters for scans within a shared key prefix.`,
    },
    {
      type: 'code',
      title: 'A toy bloom filter',
      lang: 'python',
      code: `import hashlib

class Bloom:
    # ~10 bits per key and 7 probes ≈ 1% false positives
    def __init__(self, m_bits=10_000, k=7):
        self.m, self.k = m_bits, k
        self.bits = bytearray(m_bits)   # one byte per bit, for clarity

    def _spots(self, key):
        for i in range(self.k):
            h = hashlib.sha256(f"{i}:{key}".encode()).digest()
            yield int.from_bytes(h[:8], "big") % self.m

    def add(self, key):
        for s in self._spots(key):
            self.bits[s] = 1

    def might_contain(self, key):   # False means "definitely not"
        return all(self.bits[s] for s in self._spots(key))`,
      caption: 'Real engines derive the k probes from one fast hash and pack the bits tightly, but the logic is the same: set k bits per key, and answer "maybe" only if all k are set.',
    },
    {
      type: 'text',
      md: `Deletes are the strangest part of an LSM tree. You can't remove a key from an immutable file, so a delete writes a **tombstone**: a marker saying "this key is deleted as of now". Reads that reach the tombstone stop and report "not found", even though older values for that key still exist in deeper files.

The tombstone can only be discarded once compaction is sure **no older version remains anywhere below it**, usually when it reaches the bottom level. Drop it too early and the old value reappears. Distributed databases add another wrinkle: Cassandra keeps tombstones for \`gc_grace_seconds\` (10 days by default) so that replicas which missed the delete can learn about it during repair, instead of resurrecting the data as a "zombie".`,
    },
    {
      type: 'quiz',
      q: 'A bloom filter on an SSTable says "no" for key X. What do you know?',
      options: ['X is definitely not in that file', 'X might still be in the file', 'X was deleted with a tombstone', 'The file needs compaction'],
      answer: 0,
      explain: 'Bloom filters have no false negatives. "No" means skip the file entirely; only a "maybe" costs a block read, and at 10 bits per key about 1% of those are false alarms.',
    },
    {
      type: 'quiz',
      q: 'Why can\'t compaction drop a tombstone the first time it sees it?',
      options: ['Tombstones are needed for backups', 'Older versions of the key may still exist in deeper levels and would reappear', 'Tombstones store the deleted value', 'Bloom filters depend on them'],
      answer: 1,
      explain: 'The tombstone is what hides older versions below it. It can only go once compaction has merged it with everything older, typically at the bottom level.',
    },
  ],
});

deepSection('storage-engines', {
  id: 'mvcc',
  nav: 'MVCC and versions',
  title: 'MVCC: many versions of the same row',
  goal: 'See where old row versions live in PostgreSQL, InnoDB and RocksDB, and what cleans them up.',
  card: {
    emoji: '🗂️',
    text: `Databases let readers and writers work at the same time by keeping **multiple versions** of rows (MVCC). Each transaction sees a consistent snapshot, so a long report doesn't block updates. Engines differ in where old versions live. **PostgreSQL** writes every update as a brand-new row version in the table and marks the old one dead; **VACUUM** removes dead versions later. **InnoDB** updates the row in place and copies the old version into an **undo log**, which a purge thread trims. LSM engines keep versions tagged with sequence numbers until compaction. Long transactions block cleanup everywhere.`,
  },
  blocks: [
    {
      type: 'text',
      md: `Imagine a reporting query that scans a 50-million-row table for ten minutes while customers keep updating it. With locks alone, the report would either block every writer or read a mix of before and after. **Multi-version concurrency control (MVCC)** avoids both: when a row changes, the old version is kept for as long as some transaction might still need it. Each transaction reads from a **snapshot**, the database as of one moment, so readers never block writers and writers never block readers.

Every MVCC engine has to answer the same three questions. Where do old versions live? How does a reader find the right one? Who throws them away? The answers are very different, and they explain some of the most famous operational headaches in databases.`,
    },
    {
      type: 'tabs',
      title: 'Three engines, three answers',
      tabs: [
        {
          label: '🐘 PostgreSQL',
          blocks: [
            {
              type: 'text',
              md: `PostgreSQL keeps versions **in the table itself**. Each row version (a tuple) carries \`xmin\`, the transaction that created it, and \`xmax\`, the transaction that deleted or replaced it. An UPDATE never modifies a row in place: it sets \`xmax\` on the old version and inserts a complete new version, sometimes on a different page. A reader compares \`xmin\` and \`xmax\` against its snapshot to decide which version it can see.

Dead versions stay in the table until **VACUUM** (normally autovacuum) marks their space reusable. Indexes point at specific versions, so an update usually means new index entries too, except for **HOT** (heap-only tuple) updates: if no indexed column changed and the new version fits on the same page, the indexes are left alone. A lower table \`fillfactor\` leaves room on each page and makes HOT updates more likely.`,
            },
          ],
        },
        {
          label: '🐬 InnoDB',
          blocks: [
            {
              type: 'text',
              md: `InnoDB keeps the **latest** version in the clustered index and updates it **in place**. Before changing a row, it copies the old values into the **undo log**. Every row has hidden fields: the ID of the transaction that last changed it, and a roll pointer to its previous version in the undo log. A reader whose snapshot is older follows that chain backwards, rebuilding the version it should see.

A background **purge** thread deletes undo records once no active snapshot can need them. The table stays compact, but long version chains make old snapshots slow to read, and the undo history (reported as the "history list length") keeps growing while any old transaction stays open.`,
            },
          ],
        },
        {
          label: '🪨 RocksDB',
          blocks: [
            {
              type: 'text',
              md: `In an LSM engine, every write already creates a new version, so MVCC comes almost for free. RocksDB stamps each write with a monotonically increasing **sequence number**, and a snapshot is just a sequence number: reads ignore anything newer.

Compaction normally keeps only the newest version of each key, but it must preserve any older version that a live snapshot can still see. Distributed systems built on LSM engines, such as TiKV and CockroachDB, add their own timestamped versions on top for cross-node transactions.`,
            },
          ],
        },
      ],
    },
    {
      type: 'table',
      title: 'MVCC side by side',
      head: ['', 'PostgreSQL', 'InnoDB', 'LSM (RocksDB)'],
      rows: [
        ['Old versions live', 'In the table, beside current rows', 'In the undo log', 'In older memtable and SSTable entries'],
        ['An UPDATE writes', 'A whole new row version', 'In place, plus an undo record', 'A new version of the key'],
        ['Cleanup', 'VACUUM / autovacuum', 'Purge threads', 'Compaction'],
        ['Classic pain', 'Table and index bloat; XID wraparound', 'Undo growth; slow old snapshots', 'Space held by old versions'],
        ['Long transactions', 'Stop VACUUM removing dead rows', 'Stop purge; history list grows', 'Pin snapshots, so old versions survive compaction'],
      ],
    },
    {
      type: 'callout',
      tone: 'trap',
      title: 'Transaction ID wraparound',
      text: 'PostgreSQL transaction IDs are 32-bit counters, and visibility comparisons only work within a window of about 2 billion transactions. To keep old rows from suddenly looking like they come from "the future", VACUUM periodically **freezes** old tuples, marking them visible to everyone. If freezing falls too far behind (autovacuum disabled, or blocked by a transaction left open for days), PostgreSQL protects your data by refusing new writes until a VACUUM catches up. Monitor `age(datfrozenxid)` and never leave transactions idle for hours.',
    },
    {
      type: 'quiz',
      q: 'In PostgreSQL, what does an UPDATE do to the row on disk?',
      options: ['Overwrites the row in place', 'Moves the old row into an undo log', 'Writes a new row version and marks the old one dead for VACUUM', 'Deletes the row without logging it'],
      answer: 2,
      explain: 'PostgreSQL never updates a tuple in place. It inserts a complete new version and sets xmax on the old one; VACUUM later reclaims it. The undo log belongs to InnoDB.',
    },
    {
      type: 'quiz',
      q: 'A forgotten transaction has been open for 8 hours on a busy database. What happens?',
      options: ['Nothing: idle transactions cost nothing', 'Old row versions can\'t be cleaned up, so tables or undo logs keep growing', 'The database restarts automatically', 'All writes are blocked immediately'],
      answer: 1,
      explain: 'Its snapshot might still need old versions, so VACUUM (PostgreSQL), purge (InnoDB) or compaction (RocksDB snapshots) must keep them. Bloat and slow reads follow.',
    },
  ],
});

deepSection('storage-engines', {
  id: 'tradeoffs',
  nav: 'Trade-offs + in the wild',
  title: 'Read, write and space amplification, and who picked what',
  goal: 'Compare the engines with the three numbers that matter, then see which real databases chose which.',
  card: {
    emoji: '⚖️',
    text: `Storage engines are judged on three kinds of amplification. **Write amplification**: bytes the disk writes per byte you wrote. **Read amplification**: how much I/O one lookup costs. **Space amplification**: bytes on disk per byte of live data. B-trees read predictably and excel at range queries, but rewrite whole pages for small changes. LSM trees ingest writes in big sequential batches and compress well, but reads may check several files and compaction competes for disk. You can't win all three. Facebook moved its main MySQL database from InnoDB to RocksDB-based MyRocks, largely to save space.`,
  },
  blocks: [
    {
      type: 'text',
      md: `A useful way to compare engines is to ask how much extra work each one does. **Write amplification** is the bytes actually written to storage divided by the bytes the application wrote. **Read amplification** is how many pages or files one logical read has to touch. **Space amplification** is the size on disk divided by the size of the live data.

Researchers named the tension in 2016 as the **RUM conjecture**: an access method can optimize two of read overhead, update overhead and memory (space) overhead, but not all three at once. B-trees and LSM trees sit at different points of that triangle, and every tuning knob, from fill factor to compaction style to bloom filter size, moves you around inside it.`,
    },
    {
      type: 'table',
      title: 'B+tree vs LSM tree',
      head: ['', 'B+tree', 'LSM tree'],
      rows: [
        ['Write path', 'Modify pages in place in the buffer pool, plus the WAL', 'Append to the WAL and memtable; sequential flushes'],
        ['Write amplification', 'A small change dirties a whole 8–16 KB page, plus the WAL', 'Data is rewritten as compaction moves it down the levels'],
        ['Point reads', 'One root-to-leaf path, very predictable', 'Memtable plus several files; bloom filters skip most'],
        ['Range scans', 'Excellent: walk linked leaves in order', 'Good, but results must be merged across files and levels'],
        ['Space', 'Half-empty pages after splits; MVCC bloat', 'Compresses well; dead versions linger until compaction'],
        ['Latency', 'Steady; checkpoints and vacuum cause mild bumps', 'Compaction can cause spikes and, at worst, write stalls'],
        ['Sweet spot', 'Read-heavy and mixed OLTP, range queries, many indexes', 'Write-heavy ingest, huge datasets on SSD, time series'],
      ],
    },
    {
      type: 'tabs',
      title: 'So which one?',
      tabs: [
        {
          label: 'B-tree when…',
          blocks: [
            {
              type: 'list',
              items: [
                'Reads dominate, and you want steady, predictable latency.',
                'You rely on range scans, sorting and several secondary indexes.',
                'You want a mature relational database with rich transactions (PostgreSQL, MySQL with InnoDB).',
                'Updates keep touching the same hot rows, which stay cached in the buffer pool.',
              ],
            },
          ],
        },
        {
          label: 'LSM when…',
          blocks: [
            {
              type: 'list',
              items: [
                'Writes dominate: events, metrics, logs, messages, sensor readings.',
                'The dataset is huge and storage cost matters: immutable files compress well.',
                'You mostly write new keys and read recent data, like time series or chat history.',
                'You\'re building a distributed store and want simple immutable files to ship, repair and back up.',
              ],
            },
          ],
        },
        {
          label: 'It depends',
          blocks: [
            {
              type: 'text',
              md: `Real workloads blur the line. A well-cached B-tree can absorb a lot of writes, and a well-tuned LSM with bloom filters serves point reads quickly. The honest interview answer names the workload first ("80% writes, mostly appends, read back by recent time range"), then picks the engine, then names the cost you're accepting ("compaction needs disk headroom and monitoring").`,
            },
          ],
        },
      ],
    },
    {
      type: 'text',
      md: `Swipe through the real systems below. Notice how relational databases cluster on B-trees, while write-heavy and distributed systems cluster on LSM trees, very often on RocksDB itself.`,
    },
    {
      type: 'wild',
      title: 'In the wild: who chose what',
      items: [
        {
          emoji: '🐘',
          who: 'PostgreSQL',
          what: 'Heap tables + B-tree indexes',
          tags: ['B-tree', '8 KB pages', 'MVCC + VACUUM'],
          text: `PostgreSQL stores tables as unordered **heap** files and indexes them with B-trees by default, plus GIN, GiST, BRIN and hash indexes for special cases. Every change goes through the WAL, which also drives streaming replication and point-in-time recovery.

Its MVCC keeps old row versions in the table, which makes rollback instant and readers lock-free, at the price of needing VACUUM to clean up.`,
        },
        {
          emoji: '🐬',
          who: 'MySQL InnoDB',
          what: 'Clustered B+tree',
          tags: ['B+tree', '16 KB pages', 'undo logs'],
          text: `InnoDB, MySQL's default engine since version 5.5, stores each table **inside** its primary-key B+tree, so primary-key lookups and range scans read rows straight from the leaves. Secondary indexes point to the primary key.

It uses a redo log for durability, undo logs for MVCC and rollback, and a doublewrite buffer against torn pages. Choosing a compact, sequential primary key matters more here than almost anywhere else.`,
        },
        {
          emoji: '🪶',
          who: 'SQLite',
          what: 'B-trees in a single file',
          tags: ['B-tree', 'embedded', 'everywhere'],
          text: `SQLite keeps the entire database, every table and every index, as B-trees inside **one file**. It's linked directly into the application instead of running as a server, and it ships inside essentially every smartphone, web browser and major operating system.

By default it protects writes with a rollback journal; its **WAL mode**, added in 2010, lets readers keep reading while a writer commits.`,
        },
        {
          emoji: '🪨',
          who: 'LevelDB & RocksDB',
          what: 'Embeddable LSM libraries',
          tags: ['LSM', 'Google 2011', 'Facebook 2013'],
          text: `**LevelDB** (Google, 2011) packaged the Bigtable-style memtable and SSTable design as a small C++ library. **RocksDB**, Facebook's fork open-sourced in 2013, added multi-threaded compaction, column families, transactions, merge operators and a huge set of tuning options for flash storage.

RocksDB is now a building block: it runs under MyRocks for MySQL, Kafka Streams state stores, TiKV, and many other systems.`,
        },
        {
          emoji: '👁️',
          who: 'Cassandra & ScyllaDB',
          what: 'An LSM tree on every node',
          tags: ['LSM', 'distributed', 'wide-column'],
          text: `Each **Cassandra** node writes to a commit log and a memtable, flushes SSTables, and compacts them with a strategy you choose per table: size-tiered, leveled, time-window, or the Unified Compaction Strategy added in Cassandra 5.0. Handling tombstones and tuning compaction are a big part of running it well.

**ScyllaDB** reimplements the Cassandra model in C++ with a shard-per-core architecture, keeping the same LSM storage ideas.`,
        },
        {
          emoji: '🪳',
          who: 'CockroachDB',
          what: 'Pebble, an LSM written in Go',
          tags: ['LSM', 'distributed SQL'],
          text: `CockroachDB is distributed SQL, but each node stores its data in an LSM key-value engine. It originally used RocksDB, then built **Pebble**, a RocksDB-inspired engine written in Go, which became its default storage engine in 2020.

Owning the engine let the team simplify the code, avoid the cost of calling between Go and C++, and tune it for their exact workload.`,
        },
        {
          emoji: '🧬',
          who: 'TiKV (TiDB)',
          what: 'Raft + RocksDB',
          tags: ['LSM', 'distributed KV'],
          text: `TiKV, the storage layer under the TiDB database, splits data into ranges replicated with **Raft**, and stores each replica in **RocksDB**.

On top it implements distributed transactions using timestamped MVCC versions, an approach inspired by Google's Percolator system.`,
        },
        {
          emoji: '🍃',
          who: 'MongoDB',
          what: 'WiredTiger (B-tree)',
          tags: ['B-tree', 'document store'],
          text: `MongoDB's default storage engine since version 3.2 is **WiredTiger**, which MongoDB acquired in 2014. It stores collections and indexes in B-trees with compression, document-level concurrency and snapshot isolation.

It writes consistent checkpoints of the data periodically, and uses a journal, its write-ahead log, to recover changes made since the last checkpoint.`,
        },
      ],
    },
    {
      type: 'quiz',
      q: 'Which metric is "bytes written to storage divided by bytes the application wrote"?',
      options: ['Write amplification', 'Read amplification', 'Space amplification', 'Fill factor'],
      answer: 0,
      explain: 'That\'s **write amplification**. B-trees pay it by rewriting whole pages for small changes; LSM trees pay it by rewriting data during compaction.',
    },
    {
      type: 'quiz',
      q: 'An IoT platform writes 2 million small readings per second and mostly queries the last hour. Which engine fits, and what must you watch?',
      options: ['A B-tree; watch for page splits', 'A hash index; watch for collisions', 'A B-tree; watch VACUUM', 'An LSM tree; watch that compaction keeps up'],
      answer: 3,
      explain: 'Write-heavy, append-mostly, recent-data reads is the LSM sweet spot. The operational risk is compaction falling behind ingest, which slows reads and can stall writes.',
    },
  ],
});

deepSection('storage-engines', {
  id: 'failures',
  nav: 'When it breaks',
  title: 'When it breaks: diagnosing storage engine incidents',
  goal: 'Recognize the classic storage failures from their symptoms.',
  card: {
    emoji: '🚨',
    text: `Storage engines fail in recognizable ways. Writes to an LSM store slowing, then **stalling** during a big import? Compaction can't keep up, and the engine is throttling you on purpose. A PostgreSQL table using ten times more disk than its data? **Bloat** from dead row versions that VACUUM couldn't remove, often because a transaction was left open. Cassandra reads crawling on a queue-like table? Scanning thousands of **tombstones**. InnoDB inserts slowing as a table grows? **Random primary keys** scattering page splits. Learn these symptoms and you'll recognize them in minutes.`,
  },
  blocks: [
    {
      type: 'text',
      md: `Each case below starts with a symptom, the way it shows up on a dashboard or in a page at 3 a.m. Diagnose it out loud before you tap to reveal the answer.`,
    },
    {
      type: 'yourturn',
      prompt: '💥 During a bulk import into a RocksDB-backed service, write latency climbs, then writes **stop entirely** for seconds at a time. Disk throughput is pinned at 100%.',
      answer: `**Compaction debt.** Flushes are creating L0 files faster than compaction can merge them. RocksDB protects read performance by throttling on purpose: by default it starts slowing writes when L0 reaches 20 files and stops them at 36, and it also throttles when the backlog of pending compaction bytes grows too large.

**Fix:** give compaction more background threads and I/O headroom, use bigger memtables so flushes are larger and rarer, rate-limit the import, or for bulk loads, build SSTables offline and ingest them directly. Watch L0 file counts and pending compaction bytes before they become an incident.`,
    },
    {
      type: 'yourturn',
      prompt: '💥 A PostgreSQL `orders` table holds about 2 GB of live rows but takes **25 GB** on disk. Queries that took 5 ms now take 80 ms. Autovacuum is enabled.',
      answer: `**Table and index bloat.** Every UPDATE left a dead row version behind. Autovacuum either couldn't keep up with the update rate, or it ran but couldn't remove anything because an old transaction, an idle-in-transaction session or a stale replication slot held back the cleanup horizon.

**Fix:** find long-running and idle-in-transaction sessions in \`pg_stat_activity\` and end them, check replication slots, and make autovacuum more aggressive for this table (a lower \`autovacuum_vacuum_scale_factor\` than the default 0.2). Plain VACUUM makes space reusable but rarely shrinks the file. To give space back, use \`VACUUM FULL\` (which takes an exclusive lock) or an online tool such as pg_repack.`,
    },
    {
      type: 'yourturn',
      prompt: '💥 A team uses a Cassandra table as a job queue: insert jobs, read the oldest, delete it when done. After a few days reads take seconds, the logs warn about **tombstones**, and then queries start failing.',
      answer: `**Tombstone-heavy reads.** Every finished job left a tombstone at the front of the partition. To find the oldest live job, each read scans past thousands of tombstones, which are kept for \`gc_grace_seconds\` (10 days by default). Cassandra warns when one query scans 1,000 tombstones and aborts it at 100,000.

**Fix:** don't build queues on an LSM store with deletes; use a real queue (Kafka, SQS, RabbitMQ). If you must, bucket jobs into time-based partitions and drop whole partitions, or let rows expire with TTLs under time-window compaction so whole files are discarded instead of scanned.`,
    },
    {
      type: 'yourturn',
      prompt: '💥 An InnoDB table keyed by **random UUIDv4** inserted fast at first. At 200 million rows, inserts are 5× slower, the buffer pool hit rate has dropped, and the table is much bigger than the raw data.',
      answer: `**Random primary keys in a clustered index.** Each insert lands on a random leaf of the primary-key B+tree, which is the table itself. Leaves split everywhere and sit half empty, and since any page could be next, the working set is the whole table. Once that outgrows the buffer pool, most inserts need a disk read first.

**Fix:** use a sequential or time-ordered key: an auto-increment BIGINT (keeping the UUID as a secondary unique column if clients need it), or UUIDv7, whose leading bits are a timestamp. New rows then append at the right edge of the tree.`,
    },
    {
      type: 'yourturn',
      prompt: '💥 PostgreSQL suddenly starts **rejecting writes** with an error about avoiding transaction ID wraparound data loss. Reads still work.',
      answer: `**Wraparound protection.** VACUUM hasn't been able to freeze old rows for a very long time, usually because autovacuum was disabled or too weak for a huge table, or because a transaction, prepared transaction or replication slot stayed open for days. PostgreSQL stops handing out new transaction IDs rather than risk old rows becoming invisible.

**Fix:** remove whatever blocks vacuum (old transactions, abandoned prepared transactions, stale replication slots), then VACUUM the oldest tables. Prevent it by monitoring \`age(datfrozenxid)\` and alerting long before the limit.`,
    },
    {
      type: 'yourturn',
      prompt: '💥 After a power failure, the database restarts cleanly, but the **last second of transactions** that clients were told had committed is gone.',
      answer: `**Relaxed durability.** Someone set PostgreSQL's \`synchronous_commit = off\` or MySQL's \`innodb_flush_log_at_trx_commit\` to 2 (or 0) for speed. Commits returned OK before the log reached the disk, so the crash lost the newest ones. Nothing is corrupt: the database did exactly what it was configured to do. A disk with a volatile write cache that ignores flushes causes the same symptom.

**Fix:** keep full durability for anything that matters (money, orders) and relax it only per session for data you can afford to lose. Use storage with power-loss protection.`,
    },
    {
      type: 'callout',
      tone: 'key',
      title: 'The pattern behind most of these',
      text: 'Most storage incidents are **background work falling behind foreground work**: compaction behind ingest, VACUUM behind updates, purge behind long transactions, checkpoints behind writes. Graph the background work (pending compaction bytes, dead tuples, history list length, checkpoint timing) next to your request rate and you\'ll see most of these coming days in advance.',
    },
    {
      type: 'quiz',
      q: 'Writes to a RocksDB store slow down and then stall during a large import. What\'s the usual cause?',
      options: ['The bloom filters are full', 'Compaction can\'t keep up, so the engine throttles writes on purpose', 'The memtable is corrupted', 'VACUUM is running'],
      answer: 1,
      explain: 'Flushes pile up L0 files faster than compaction merges them. RocksDB slows and then stops writes so read amplification doesn\'t explode.',
    },
    {
      type: 'quiz',
      q: 'A PostgreSQL table holds 2 GB of live rows but uses 25 GB on disk. What\'s the most likely cause?',
      options: ['The WAL is stored inside the table', 'A misconfigured bloom filter', 'Dead row versions that VACUUM couldn\'t clean up', 'The page size is set too large'],
      answer: 2,
      explain: 'Updates leave dead versions behind. If autovacuum lags or a long transaction blocks it, they accumulate as bloat, and scans read far more pages than the live data needs.',
    },
  ],
});

deepSection('storage-engines', {
  id: 'recap',
  nav: 'Explain it back',
  title: 'Explain it back',
  goal: 'Turn what you read into answers you can say out loud in an interview.',
  card: {
    emoji: '🎙️',
    text: `The whole story in one breath. Storage is slow and block-shaped, so engines work in pages and avoid random I/O. **B+trees** keep sorted keys in wide, shallow trees, update pages in place, and protect them with a write-ahead log and checkpoints. **LSM trees** append to a log and a memtable, flush immutable SSTables, and compact them in the background, using bloom filters and tombstones. **MVCC** keeps old row versions for snapshots. Every engine trades read, write and space amplification. Now flip each card only after answering out loud.`,
  },
  blocks: [
    {
      type: 'text',
      md: `Reading gives you familiarity. **Recall** gives you memory. Answer each card out loud, in full sentences, as if an interviewer just asked. Only then flip it and compare. The ones you fumble are the parts worth rereading.`,
    },
    {
      type: 'flashcards',
      title: 'Explain it back',
      cards: [
        { q: 'Why do databases organize data into pages?', a: 'Storage moves whole blocks and random I/O is expensive, so engines read, write and cache fixed-size pages (8 KB in PostgreSQL, 16 KB in InnoDB). Fewer pages touched means faster queries.' },
        { q: 'Why is a B+tree so shallow?', a: 'Internal pages hold only separator keys and child pointers, so each page has hundreds of children. With that fanout, about four levels reach billions of entries, and the top levels stay cached.' },
        { q: 'What happens when you insert into a full B+tree leaf?', a: 'It splits: a new page takes about half the keys and a separator key goes into the parent. Splits can ripple upward; when the root splits, the tree grows one level taller, so all leaves stay at the same depth.' },
        { q: 'What are the two rules of write-ahead logging?', a: 'A dirty page can\'t be written to disk before the log records describing its changes, and a transaction isn\'t committed until its commit record is flushed. A commit becomes one sequential log flush.' },
        { q: 'How does a database recover after a crash?', a: 'It starts from the last checkpoint and replays the WAL (redo), restoring every committed change. Engines like InnoDB then roll back uncommitted transactions with undo logs, the ARIES pattern.' },
        { q: 'Walk through an LSM write and an LSM read.', a: 'Write: append to the WAL, insert into the memtable, acknowledge; full memtables are flushed as immutable SSTables. Read: memtable, frozen memtables, then SSTables newest to oldest, skipping files via bloom filters.' },
        { q: 'Leveled vs size-tiered compaction?', a: 'Leveled keeps non-overlapping files per level, each level about 10× bigger: fewer files per read and low space overhead, but more rewriting. Size-tiered merges similar-sized files: less rewriting, but more space and more files per read.' },
        { q: 'What is a tombstone, and when can it be dropped?', a: 'A delete marker, needed because immutable files can\'t be edited. It can only be removed once compaction is sure no older version of the key remains below it, and in Cassandra only after gc_grace_seconds.' },
        { q: 'How do PostgreSQL and InnoDB implement MVCC differently?', a: 'PostgreSQL writes a new row version in the table and VACUUM removes dead versions. InnoDB updates rows in place, keeps old versions in the undo log, and purge threads trim it. Long transactions block cleanup in both.' },
        { q: 'When would you pick an LSM engine over a B-tree?', a: 'For write-heavy, append-mostly workloads with lots of data on SSDs (events, metrics, messages, time series), accepting more complex reads and the need to watch compaction. B-trees win for read-heavy, range-heavy OLTP.' },
      ],
    },
    {
      type: 'quiz',
      q: 'Which pairing is correct?',
      options: ['B+tree: immutable files merged by compaction', 'LSM tree: pages updated in place with a fill factor', 'Both engines skip the write-ahead log', 'B+tree updates pages in place; LSM writes immutable SSTables'],
      answer: 3,
      explain: 'B-trees modify pages in place, protected by the WAL. LSM trees never modify files: they flush immutable SSTables and merge them with compaction. Both use a write-ahead log.',
    },
    {
      type: 'quiz',
      q: 'An interviewer asks why Cassandra handles very high write throughput. Best answer?',
      options: ['It skips durability entirely', 'Each write is just a log append plus a memtable insert', 'It keeps all data in RAM', 'It uses B-trees with very large pages'],
      answer: 1,
      explain: 'An LSM write never reads or rewrites existing pages. Cassandra appends to its commit log, updates the memtable, and later flushes and compacts in big sequential writes.',
    },
  ],
});
