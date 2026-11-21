registerDeepDive({
  id: 'kafka-in-depth',
  title: 'Kafka & Event Streaming, in Depth',
  short: 'Kafka deep',
  emoji: '📜',
  color: '#16a34a',
  related: 'message-queues',
  tagline: 'Logs, partitions, replication, consumer groups and exactly-once, from the inside',
  hook: 'The quick cards said "Kafka is a log, not a queue". Now see the log itself: partitions, ISR, rebalances, transactions, and why LinkedIn built it.',
  intro: `The quick cards gave you the shape: **topics, partitions, offsets**, and order only within a partition. That's enough to draw Kafka on a whiteboard. It isn't enough to explain why a write with \`acks=1\` can vanish, why your consumers keep rebalancing, or what "exactly-once" actually promises.

This deep dive opens the box. You'll follow a record from \`send()\` to a replicated log, watch a consumer group hand partitions around, see how transactions make a pipeline exactly-once, and learn how retention and compaction decide what stays on disk. Then you'll meet the companies that run Kafka at huge scale and the failure patterns they keep hitting.

The paragraph at the top of each part also appears in your feed, and some ideas come back more than once on purpose. Repetition is how it sticks.`,
  recap: [
    'Kafka stores events in partitioned, append-only logs; reading never deletes',
    'Keys pick partitions; acks and min.insync.replicas decide durability',
    'Consumer groups split partitions and commit offsets; rebalances can replay work',
    'Exactly-once = idempotent producer + transactions, inside Kafka only',
    'Watch lag, hot partitions, poison messages and rebalance storms',
  ],
});

deepSection('kafka-in-depth', {
  id: 'log',
  nav: 'The log',
  title: 'The log: topics, partitions and offsets',
  goal: 'Picture exactly what a topic is on disk, and why "reading never deletes" changes everything.',
  card: {
    emoji: '📜',
    text: `Kafka's core idea is the **log**: an append-only, ordered sequence of records where each record gets a number called its **offset**. Producers only ever add to the end. Reading never deletes anything; each consumer group just remembers the offset it reached, so many groups can read the same data at their own pace, and anyone can rewind and **replay**. A **topic** is split into **partitions**, each its own log stored on disk across brokers. Order is guaranteed inside a partition, not across the whole topic, and partitions are how Kafka scales.`,
  },
  blocks: [
    {
      type: 'text',
      md: `Most messaging systems are built around a **queue**: a message arrives, one consumer takes it, and once it's acknowledged it's gone. Kafka is built around a different data structure, the **log**. Not a log file full of debug lines, but a strictly ordered, append-only sequence of records. Every new record goes on the end and gets the next number, its **offset**. Records are never edited in place.

That one choice has big consequences. Because a read doesn't remove anything, the broker doesn't have to track who has seen what. Each reader just remembers a single number: "I've processed everything before offset 2." Ten different services can read the same stream, each at its own speed, and a brand-new service can start at offset 0 and replay history. Jay Kreps, one of Kafka's creators, wrote a well-known 2013 essay arguing that this log is the unifying abstraction behind databases, replication and data pipelines. Kafka is that idea turned into infrastructure.`,
    },
    {
      type: 'diagram',
      title: 'One partition: an append-only log',
      diagram: {
        h: 300,
        nodes: [
          { id: 'prod', x: 290, y: 50, label: 'Producer', icon: '📤' },
          { id: 'o0', x: 35, y: 150, label: '0', w: 42, h: 40 },
          { id: 'o1', x: 85, y: 150, label: '1', w: 42, h: 40 },
          { id: 'o2', x: 135, y: 150, label: '2', w: 42, h: 40 },
          { id: 'o3', x: 185, y: 150, label: '3', w: 42, h: 40 },
          { id: 'o4', x: 235, y: 150, label: '4', w: 42, h: 40 },
          { id: 'o5', x: 285, y: 150, label: '5', w: 42, h: 40 },
          { id: 'o6', x: 335, y: 150, label: '6', w: 42, h: 40, tone: 'accent' },
          { id: 'ga', x: 135, y: 255, label: 'Group A\nnext: 2', icon: '📥' },
          { id: 'gb', x: 285, y: 255, label: 'Group B\nnext: 5', icon: '📥' },
        ],
        edges: [
          { from: 'prod', to: 'o6', flow: true, label: 'append' },
          { from: 'o2', to: 'ga', flow: true },
          { from: 'o5', to: 'gb', flow: true },
        ],
        notes: [
          { x: 110, y: 45, text: 'partition 0 of topic "orders"' },
          { x: 210, y: 202, text: 'reading never deletes' },
        ],
      },
      caption: 'New records always land at the end. Each consumer group only stores the **next offset** it will read, so two groups can be at completely different places in the same log.',
    },
    {
      type: 'text',
      md: `A single log on a single machine wouldn't scale, so a **topic** (a named stream like \`orders\`) is split into **partitions**. Each partition is an independent log with its own offsets, starting at 0. A topic with 6 partitions is really 6 logs, spread across the **brokers** (the Kafka servers) in the cluster, and each partition is also copied to other brokers for safety, which Part 3 covers.

Partitions are the unit of everything in Kafka. They are the unit of **parallelism**: within one consumer group, each partition is read by exactly one consumer, so 6 partitions means at most 6 busy consumers. They are the unit of **ordering**: offsets are only comparable inside one partition, so Kafka promises order per partition and nothing across the topic. And they are the unit of **storage and replication**: a partition lives on disk as a series of files on each broker that holds a copy.`,
    },
    {
      type: 'list',
      title: 'Why a disk-based log is fast',
      items: [
        { title: 'Sequential writes:', text: 'appending to the end of a file is the access pattern disks and SSDs handle best, far faster than random writes into a B-tree.' },
        { title: 'The page cache does the caching:', text: 'Kafka leans on the operating system\'s page cache instead of its own heap cache, so consumers reading recent data are usually served from memory.' },
        { title: 'Batches all the way down:', text: 'producers send records in compressed batches, brokers store the batches as they arrived, and consumers fetch whole batches back.' },
        { title: 'Zero-copy reads:', text: 'when TLS isn\'t in the way, a broker can hand file bytes straight to the network socket with the `sendfile` system call, skipping copies through user space.' },
      ],
    },
    {
      type: 'code',
      title: 'Create a topic and see where its partitions live',
      lang: 'text',
      code: `# 6 partitions, each stored on 3 brokers
kafka-topics.sh --bootstrap-server localhost:9092 \\
  --create --topic orders --partitions 6 --replication-factor 3

kafka-topics.sh --bootstrap-server localhost:9092 --describe --topic orders
# Topic: orders  Partition: 0  Leader: 2  Replicas: 2,3,1  Isr: 2,3,1
# Topic: orders  Partition: 1  Leader: 3  Replicas: 3,1,2  Isr: 3,1,2
# ...`,
      caption: 'Each partition has a leader broker and a replica list. `Isr` is the set of replicas that are caught up, which decides who can take over if the leader dies.',
    },
    {
      type: 'callout',
      tone: 'tip',
      title: 'Choosing a partition count',
      text: 'You can **add** partitions to a topic later, but you can never remove them, and adding them changes which partition each key maps to. So pick a count with headroom: enough partitions for the consumer parallelism you expect in a year or two. Too many has costs too: more files, more leader elections and slower recovery.',
    },
    {
      type: 'deep',
      title: 'Go deeper: what a partition looks like on disk',
      blocks: [
        {
          type: 'text',
          md: `On each broker, a partition is a directory such as \`orders-0/\`. Inside, the log is cut into **segments** (1 GB each by default). Each segment is a set of files named after the first offset it contains:

\`00000000000000000000.log\` holds the record batches themselves. \`00000000000000000000.index\` maps offsets to byte positions in the \`.log\` file, sparsely, so a broker can jump close to any offset and scan forward. \`00000000000000000000.timeindex\` maps timestamps to offsets, which powers "start reading from 9:00 this morning".

Only the newest segment, the **active** one, is written to. Older segments are immutable, which is what makes retention cheap: deleting old data means deleting whole files, not rewriting anything.`,
        },
      ],
    },
    {
      type: 'quiz',
      q: 'Group A has read a whole topic; Group B is a day behind. What happens to the messages Group A already read?',
      options: ['They are deleted once Group A commits', 'They stay; Group B reads them at its own pace', 'They move to a dead-letter topic', 'Group B skips ahead to match Group A'],
      answer: 1,
      explain: 'Reading never deletes. Each group only tracks its own offset. Messages leave the log when the retention policy says so, not when someone reads them.',
    },
    {
      type: 'quiz',
      q: 'A topic has 6 partitions. What does Kafka guarantee about message order?',
      options: ['Total order across all 6 partitions', 'No ordering at all', 'Order by timestamp across the topic', 'Order within each partition only'],
      answer: 3,
      explain: 'Offsets only mean something inside one partition. If records must stay in sequence, they must go to the same partition, which is what message keys are for.',
    },
  ],
});

deepSection('kafka-in-depth', {
  id: 'producers',
  nav: 'Producers & acks',
  title: 'Producers: keys, batching, acks and idempotence',
  goal: 'Know where each record goes, when a write counts as done, and how retries stay safe.',
  card: {
    emoji: '📤',
    text: `A producer decides **which partition** each record goes to. With a key, the default partitioner hashes it, so the same key (say, an order ID) always lands in the same partition and stays in order. Records are grouped into **batches** per partition and compressed, trading a few milliseconds of latency for much higher throughput. The **acks** setting decides when a write counts: \`0\` means fire and forget, \`1\` means the leader wrote it, and \`all\` means every in-sync replica has it. The **idempotent producer** lets retries happen without creating duplicates.`,
  },
  blocks: [
    {
      type: 'text',
      md: `The producer client does a surprising amount of work before a record ever reaches a broker. When your code calls \`send(key, value)\`, the call returns almost immediately. The record is serialized, assigned to a partition, and dropped into an in-memory buffer. A background **sender thread** ships buffered records to brokers in batches and later reports success or failure through a callback or future.

That design is why Kafka producers are fast, and also why "I called send() and it returned" does **not** mean your data is safe. Durability is decided later, by the acks setting and the cluster's replication.`,
    },
    {
      type: 'stepper',
      title: 'The life of one send()',
      diagram: {
        h: 290,
        nodes: [
          { id: 'app', x: 55, y: 70, label: 'Your app', icon: '💻' },
          { id: 'acc', x: 180, y: 70, label: 'Batches per\npartition', icon: '📦', tone: 'accent' },
          { id: 'snd', x: 305, y: 70, label: 'Sender\nthread', icon: '🚚' },
          { id: 'ldr', x: 305, y: 225, label: 'Leader\nbroker', icon: '🗄️' },
          { id: 'cbk', x: 55, y: 225, label: 'Callback', icon: '✅' },
        ],
        edges: [
          { from: 'app', to: 'acc', flow: true },
          { from: 'acc', to: 'snd', flow: true },
          { from: 'snd', to: 'ldr', flow: true, label: 'produce' },
          { from: 'ldr', to: 'cbk', flow: true, label: 'ack / error' },
          { from: 'ldr', to: 'acc', dashed: true, tone: 'warn', label: 'retry' },
        ],
      },
      steps: [
        {
          title: 'Serialize',
          focus: ['app'],
          text: 'Your code calls `send("order-913", orderJson)`. The key and value are turned into bytes by the configured serializers (strings, JSON, Avro, Protobuf). Kafka itself only ever sees bytes.',
        },
        {
          title: 'Pick a partition',
          focus: ['app', 'app>acc', 'acc'],
          text: 'With a key, the default partitioner computes a murmur2 hash of the key bytes modulo the partition count, so `order-913` maps to the same partition every time (while the count stays the same). With no key, the producer fills a batch for one partition, then moves on to another, which keeps batches large.',
        },
        {
          title: 'Wait in a batch',
          focus: ['acc'],
          text: 'The record joins an in-memory batch for that partition. A batch is sent when it reaches `batch.size` bytes or when `linger.ms` has passed, whichever comes first. Batches can be compressed (gzip, snappy, lz4 or zstd), and brokers store them compressed.',
        },
        {
          title: 'Ship it to the leader',
          focus: ['acc>snd', 'snd', 'snd>ldr', 'ldr'],
          text: 'The sender thread groups ready batches by destination broker and sends one produce request per broker. Only the partition\'s **leader** accepts writes.',
        },
        {
          title: 'Ack, or retry',
          focus: ['ldr>cbk', 'cbk', 'ldr>acc'],
          text: 'Depending on `acks`, the leader replies once it has written the batch, or once every in-sync replica has it. The reply carries the record\'s offset. On a retriable error (a leader change, a timeout) the batch goes back into the queue and is sent again until `delivery.timeout.ms` runs out.',
        },
      ],
    },
    {
      type: 'tabs',
      title: 'The three acks settings',
      tabs: [
        {
          label: 'acks=0',
          blocks: [
            { type: 'text', md: `The producer doesn't wait for any response. It's the fastest option and the least safe: if the broker never received the batch, nobody finds out, and retries can't help because the producer never learns about failures.

Use it only for data you can afford to lose, like high-volume metrics where a missing sample doesn't matter.` },
          ],
        },
        {
          label: 'acks=1',
          blocks: [
            { type: 'text', md: `The leader replies as soon as it has appended the batch to its own log. Followers haven't copied it yet.

The trap: if the leader's broker dies right after acknowledging, before any follower fetched the data, a follower becomes the new leader **without those records**. The producer was told "success" and the data is gone. This was the producer default for years.` },
          ],
        },
        {
          label: 'acks=all',
          blocks: [
            { type: 'text', md: `The leader waits until every replica in the current **in-sync replica set** has the batch, then replies. Since Kafka 3.0 this is the producer default (\`acks=all\`, also written \`acks=-1\`).

On its own it can still be weak: if the ISR has shrunk to just the leader, "all in-sync replicas" means one copy. That's why it's paired with the topic setting \`min.insync.replicas=2\`, which makes the leader **reject** acks=all writes when fewer than 2 replicas are in sync.` },
            { type: 'callout', tone: 'key', title: 'The durable combo', text: 'Replication factor **3**, `min.insync.replicas=2`, producer `acks=all`. You can lose one broker and keep writing, and every acknowledged write exists on at least two brokers.' },
          ],
        },
      ],
    },
    {
      type: 'text',
      md: `**Retries create a duplicate problem.** Imagine the leader writes your batch, but its reply is lost on the network. The producer times out and retries, and the leader appends the same records again. Without help, retries turn "at least once" into "sometimes twice".

The **idempotent producer** fixes this inside Kafka. Each producer gets a **producer ID**, and every batch it sends to a partition carries a **sequence number**. The broker remembers the last sequence numbers it accepted from each producer for each partition. A retried batch with a sequence number it has already seen is acknowledged but not written again, and a gap in the numbers is rejected, so ordering survives retries too, even with up to 5 requests in flight per connection.

Idempotence arrived in Kafka 0.11 (2017), together with transactions, and since Kafka 3.0 it is on by default (\`enable.idempotence=true\`). Its scope is one producer session writing to Kafka: it doesn't dedupe two different producers sending the same business event.`,
    },
    {
      type: 'code',
      title: 'A durable producer in Python (confluent-kafka)',
      lang: 'python',
      code: `from confluent_kafka import Producer

p = Producer({
    "bootstrap.servers": "kafka:9092",
    "acks": "all",                # wait for every in-sync replica
    "enable.idempotence": True,   # retries can't create duplicates
    "compression.type": "zstd",
    "linger.ms": 10,              # wait up to 10 ms to fill a batch
})

def on_delivery(err, msg):
    if err:
        print("failed:", err)     # retries were exhausted
    else:
        print("stored at", msg.partition(), msg.offset())

p.produce("orders", key="order-913", value=order_json, callback=on_delivery)
p.poll(0)      # serve delivery callbacks
p.flush()      # block until everything buffered is delivered`,
      caption: '`produce()` only buffers the record. Success is reported later through the callback, once the broker has acknowledged according to `acks`.',
    },
    {
      type: 'callout',
      tone: 'trap',
      title: 'Keys only keep order while the partition count stays the same',
      text: 'The key-to-partition mapping is `hash(key) mod partitionCount`. Grow a topic from 6 to 12 partitions and many keys suddenly map elsewhere. New events for an order can land on a different partition than its older, still-unprocessed events, and different partitions are consumed independently. Plan partition counts up front, or migrate to a new topic deliberately.',
    },
    {
      type: 'quiz',
      q: 'With acks=all, when does the producer get a success response?',
      options: ['As soon as the record leaves the producer', 'When the leader has written it', 'When every in-sync replica has it', 'When a consumer has read it'],
      answer: 2,
      explain: '**acks=all** waits for the whole in-sync replica set. acks=1 waits only for the leader, and acks=0 doesn\'t wait at all.',
    },
    {
      type: 'quiz',
      q: 'Your producer retries after a timeout, but the first attempt actually succeeded. What stops a duplicate record?',
      options: [
        'The idempotent producer: the broker drops a batch whose sequence number it already accepted',
        'Setting acks=0',
        'Log compaction on the topic',
        'The consumer group coordinator',
      ],
      answer: 0,
      explain: 'Each batch carries a producer ID and per-partition sequence number. The broker recognizes the retry and acknowledges it without appending it twice.',
    },
  ],
});

deepSection('kafka-in-depth', {
  id: 'replication',
  nav: 'Replication & ISR',
  title: 'Brokers, replication, the ISR and KRaft',
  goal: 'Follow an acks=all write through the replicas, and know exactly what survives a broker crash.',
  card: {
    emoji: '🗄️',
    text: `Every partition is copied to several brokers, set by the **replication factor** (3 is typical). One copy is the **leader** and handles all writes; the **followers** fetch from it to stay current. The leader plus every caught-up follower form the **in-sync replicas (ISR)**. If the leader's broker dies, a new leader is picked from the ISR, so writes acknowledged with \`acks=all\` survive. Add \`min.insync.replicas=2\` and a write is only confirmed once at least two brokers hold it. Cluster metadata now lives inside Kafka itself, managed by **KRaft**.`,
  },
  blocks: [
    {
      type: 'text',
      md: `A Kafka cluster is a set of **brokers**, usually spread across racks or availability zones. Each partition has a **replication factor**: with 3, three brokers each hold a full copy of that partition's log. One copy is the **leader**. Producers write to the leader and, by default, consumers read from it too. The other copies are **followers**.

Followers don't wait for the leader to push data to them. They **pull**: each follower sends fetch requests to the leader, exactly like a consumer does, asking for everything after its own last offset, then appends what it gets to its local log. That keeps the leader simple and lets a slow follower catch up at its own pace.

Two offsets matter on the leader. The **log end offset** is where the next record will be written. The **high watermark** is the offset up to which every in-sync replica has the data. Consumers can only read below the high watermark, so they never see a record that could disappear in a failover.`,
    },
    {
      type: 'stepper',
      title: 'One write with acks=all (RF 3, min.insync.replicas 2)',
      diagram: {
        h: 320,
        nodes: [
          { id: 'prod', x: 50, y: 50, label: 'Producer', icon: '📤' },
          { id: 'cons', x: 50, y: 285, label: 'Consumer', icon: '📥' },
          { id: 'ldr', x: 180, y: 170, label: 'Leader\nbroker 1', icon: '👑', tone: 'accent' },
          { id: 'f2', x: 305, y: 80, label: 'Follower\nbroker 2', icon: '📜' },
          { id: 'f3', x: 305, y: 260, label: 'Follower\nbroker 3', icon: '📜' },
        ],
        edges: [
          { from: 'prod', to: 'ldr', flow: true, curve: 20, label: 'write' },
          { from: 'ldr', to: 'prod', flow: true, curve: 20, tone: 'good', label: 'ack' },
          { from: 'ldr', to: 'f2', flow: true, label: 'fetch' },
          { from: 'ldr', to: 'f3', flow: true, label: 'fetch' },
          { from: 'ldr', to: 'cons', flow: true, label: 'read' },
        ],
      },
      steps: [
        {
          title: 'The producer sends a batch to the leader',
          focus: ['prod', 'prod>ldr', 'ldr'],
          text: 'The producer looked up which broker leads this partition and sends the batch there. Followers never accept writes from clients.',
        },
        {
          title: 'The leader appends it locally',
          focus: ['ldr'],
          text: 'The leader writes the batch to its log, which advances its log end offset. Kafka doesn\'t force every write to disk with fsync by default; it relies on the OS to flush, and gets durability from **replication** across machines instead.',
        },
        {
          title: 'Followers fetch and append',
          focus: ['ldr>f2', 'ldr>f3', 'f2', 'f3'],
          text: 'Brokers 2 and 3 are already sitting in fetch requests to the leader. They receive the new batch, append it to their own copies, and their next fetch tells the leader how far they\'ve got.',
        },
        {
          title: 'The high watermark moves forward',
          focus: ['ldr', 'f2', 'f3'],
          text: 'Once every replica in the ISR has the batch, the leader advances the **high watermark** past it. The record is now "committed" in Kafka\'s sense: it exists on every in-sync copy.',
        },
        {
          title: 'The leader acknowledges',
          focus: ['ldr>prod', 'prod'],
          text: 'With `acks=all`, the success response goes out now, carrying the record\'s offset. If the ISR had shrunk below `min.insync.replicas`, the leader would have refused the write with a NotEnoughReplicas error instead of accepting a weaker copy.',
        },
        {
          title: 'Consumers can now read it',
          focus: ['ldr>cons', 'cons'],
          text: 'Consumers fetch up to the high watermark, so this record becomes visible only after it is safely replicated. A reader never sees data that a leader failover could take back.',
        },
      ],
    },
    {
      type: 'text',
      md: `**The ISR is dynamic.** A follower that stops fetching, or falls too far behind for longer than \`replica.lag.time.max.ms\`, is dropped from the ISR, and acks=all writes stop waiting for it. When it catches up, it rejoins. This is how Kafka stays available when one broker is slow without pretending that broker has data it doesn't.

**Failover picks from the ISR.** When a leader's broker dies, the cluster's **controller** notices and promotes one of the remaining in-sync replicas. Because every ISR member has everything up to the high watermark, no committed record is lost. Producers and consumers get a "not the leader" error, refresh their metadata, and carry on with the new leader, usually within seconds.

**Unclean leader election is the escape hatch.** If every in-sync replica is gone and only an out-of-sync follower survives, Kafka can either wait for an ISR member to come back (the partition is unavailable meanwhile) or promote the stale follower and lose whatever it was missing. \`unclean.leader.election.enable\` controls this, and it has defaulted to \`false\` since Kafka 0.11: consistency over availability.`,
    },
    {
      type: 'table',
      title: 'The settings that decide durability',
      head: ['Setting', 'Default', 'Durable choice'],
      rows: [
        ['Replication factor (`default.replication.factor`)', '1 on a plain broker', '3, on brokers in different racks or zones'],
        ['`min.insync.replicas` (topic or broker)', '1', '2 with a replication factor of 3'],
        ['`acks` (producer)', '`all` since Kafka 3.0', '`all`'],
        ['`enable.idempotence` (producer)', '`true` since Kafka 3.0', '`true`'],
        ['`unclean.leader.election.enable`', '`false`', '`false`, unless losing data beats downtime'],
      ],
    },
    {
      type: 'callout',
      tone: 'trap',
      title: 'acks=all with min.insync.replicas=1 is weaker than it looks',
      text: 'If two followers fall out of the ISR, "all in-sync replicas" is just the leader, and acks=all quietly behaves like acks=1. Lose that broker and acknowledged writes are gone. `min.insync.replicas=2` turns that silent risk into a visible error.',
    },
    {
      type: 'text',
      md: `**Who runs the cluster?** Some broker has to track which brokers are alive, which partitions exist, and who leads each one. For most of Kafka's life that metadata lived in **ZooKeeper**, a separate distributed coordination service you had to deploy, secure and monitor alongside Kafka.

**KRaft** (Kafka Raft) replaced it. A small quorum of **controller** nodes uses the Raft consensus algorithm to replicate the cluster metadata as a log, inside Kafka itself. Brokers follow that metadata log the way followers follow a partition. KRaft was declared production-ready in Kafka 3.3, ZooKeeper mode was deprecated in 3.5, and **Kafka 4.0 removed ZooKeeper entirely**: there is one system to run, controller failover is much faster, and a cluster can hold far more partitions.`,
    },
    {
      type: 'quiz',
      q: 'A partition\'s leader broker crashes. Where does the new leader come from?',
      options: ['Any broker in the cluster', 'The in-sync replicas (ISR)', 'The producer that wrote most recently', 'A backup restored from disk'],
      answer: 1,
      explain: 'The controller promotes a member of the **ISR**, which by definition has every committed record, so acknowledged acks=all writes survive.',
    },
    {
      type: 'quiz',
      q: 'Replication factor 3, min.insync.replicas=2, acks=all. Two of the three replicas go down. What happens to writes?',
      options: ['They succeed on the one remaining replica', 'They are buffered in the broker forever', 'Consumers take over writing', 'They fail with NotEnoughReplicas until a replica returns'],
      answer: 3,
      explain: 'With one in-sync replica left, the leader refuses acks=all writes rather than weaken durability silently. Reading existing data still works.',
    },
  ],
});

deepSection('kafka-in-depth', {
  id: 'consumers',
  nav: 'Consumer groups',
  title: 'Consumer groups, offsets and rebalances',
  goal: 'Know how a group splits the work, where progress is stored, and why rebalances cause duplicates.',
  card: {
    emoji: '📥',
    text: `Consumers **pull** records from brokers in batches. Consumers sharing a \`group.id\` form a **consumer group**, and Kafka assigns each partition to exactly one member, so the group splits the work and the partition count caps how many members can be busy. Each group commits its progress as offsets in an internal topic, \`__consumer_offsets\`. When a member joins, leaves or stalls, the group **rebalances** and partitions move. Anything a consumer processed but hadn't committed gets processed again by the new owner, which is why duplicates are normal.`,
  },
  blocks: [
    {
      type: 'text',
      md: `Kafka consumers **pull**. A consumer calls \`poll()\`, the broker returns a batch of records starting at the consumer's position, and the consumer asks again when it's ready. Pulling means a slow consumer is never flooded: it just falls behind, and the difference between the newest offset and its position is called **lag**.

Consumers with the same \`group.id\` cooperate. One broker acts as that group's **group coordinator**: it tracks who is in the group, and members send it heartbeats to prove they're alive. Partitions are divided among the members so that **each partition is owned by exactly one member** at a time. That's what preserves per-partition order, and it's why 4 partitions can keep at most 4 consumers in a group busy. A different group reading the same topic gets its own independent split and its own offsets.

Progress is stored as **committed offsets**: "group \`checkout\` has processed partition 3 up to offset 10,520". Commits are written to an internal compacted topic, \`__consumer_offsets\`, so when a partition moves to a new owner, that owner knows where to resume.`,
    },
    {
      type: 'stepper',
      title: 'A third consumer joins the group',
      diagram: {
        h: 320,
        nodes: [
          { id: 'p0', x: 60, y: 45, label: 'Partition 0', icon: '📜' },
          { id: 'p1', x: 60, y: 120, label: 'Partition 1', icon: '📜' },
          { id: 'p2', x: 60, y: 195, label: 'Partition 2', icon: '📜' },
          { id: 'p3', x: 60, y: 270, label: 'Partition 3', icon: '📜' },
          { id: 'c1', x: 290, y: 60, label: 'Consumer 1', icon: '⚙️' },
          { id: 'c3', x: 290, y: 155, label: 'Consumer 3', icon: '🆕', tone: 'accent' },
          { id: 'c2', x: 290, y: 250, label: 'Consumer 2', icon: '⚙️' },
        ],
        edges: [
          { from: 'p0', to: 'c1', flow: true },
          { from: 'p1', to: 'c1', flow: true },
          { from: 'p1', to: 'c3', flow: true, dashed: true, tone: 'accent' },
          { from: 'p2', to: 'c2', flow: true },
          { from: 'p3', to: 'c2', flow: true },
        ],
      },
      steps: [
        {
          title: 'Two consumers, four partitions',
          focus: ['p0', 'p1', 'p2', 'p3', 'c1', 'c2', 'p0>c1', 'p1>c1', 'p2>c2', 'p3>c2'],
          text: 'Consumer 1 owns partitions 0 and 1, consumer 2 owns 2 and 3. Each commits offsets for its own partitions as it goes.',
        },
        {
          title: 'Consumer 3 joins',
          focus: ['c3'],
          text: 'A new instance starts with the same `group.id`. It contacts the group coordinator, and the group must **rebalance** to give it some work.',
        },
        {
          title: 'The old way: stop the world',
          focus: ['c1', 'c2', 'c3'],
          text: 'With the classic **eager** protocol, every member revokes all of its partitions, everyone waits, and then the new assignment is handed out. For a few seconds (or much longer in big groups) nobody in the group consumes anything.',
        },
        {
          title: 'The better way: move only what must move',
          focus: ['p0>c1', 'p1>c3', 'p2>c2', 'p3>c2', 'c3'],
          text: 'With **cooperative incremental** rebalancing (the `CooperativeStickyAssignor`), only partition 1 is revoked from consumer 1 and given to consumer 3. Partitions 0, 2 and 3 never stop flowing.',
        },
        {
          title: 'The new owner resumes from the committed offset',
          focus: ['p1', 'p1>c3', 'c3'],
          text: 'Consumer 3 reads partition 1\'s last committed offset and starts there. Anything consumer 1 had processed **after** its last commit is processed again. That replay is normal, which is why consumers must be idempotent.',
        },
      ],
    },
    {
      type: 'text',
      md: `**When are offsets committed?** By default, \`enable.auto.commit=true\` commits the latest polled offsets every 5 seconds in the background. It's convenient but blurry: a crash can replay up to 5 seconds of work, and auto-commit can mark records as done that your code hadn't finished with. Production consumers that care usually turn it off and commit **after** processing, explicitly.

**What makes a consumer "dead"?** Two separate clocks. Heartbeats, sent from a background thread, prove the process is alive; miss them for \`session.timeout.ms\` and the coordinator removes it. And \`max.poll.interval.ms\` (5 minutes by default) is the longest allowed gap between \`poll()\` calls; exceed it, because one batch took too long to process, and the consumer leaves the group even though it's alive. That second clock is behind most "why do we keep rebalancing?" incidents.

Two features soften rebalances. **Static membership** (\`group.instance.id\`) lets a restarting instance rejoin under the same identity and get its old partitions back without a rebalance, as long as it returns before the session timeout, which is perfect for rolling deploys. And a newer rebalance protocol (KIP-848), generally available since Kafka 4.0, moves assignment logic to the broker and makes rebalances incremental by default.`,
    },
    {
      type: 'code',
      title: 'An at-least-once consumer loop (Python, confluent-kafka)',
      lang: 'python',
      code: `from confluent_kafka import Consumer

c = Consumer({
    "bootstrap.servers": "kafka:9092",
    "group.id": "checkout",
    "enable.auto.commit": False,      # commit only after the work is done
    "auto.offset.reset": "earliest",  # no committed offset yet? start at the beginning
})
c.subscribe(["orders"])

while True:
    msg = c.poll(1.0)
    if msg is None or msg.error():
        continue
    handle(msg.key(), msg.value())              # must be idempotent
    c.commit(message=msg, asynchronous=False)   # then record progress`,
      caption: 'Process first, commit second: a crash in between replays the message instead of losing it. Committing every message is slow; real consumers commit every N records or every few seconds.',
    },
    {
      type: 'code',
      title: 'Check a group\'s lag per partition',
      lang: 'text',
      code: `kafka-consumer-groups.sh --bootstrap-server localhost:9092 \\
  --describe --group checkout

GROUP     TOPIC   PARTITION  CURRENT-OFFSET  LOG-END-OFFSET  LAG
checkout  orders  0          10520           10524           4
checkout  orders  1          9980            31240           21260
checkout  orders  2          11873           11873           0`,
      caption: 'Output trimmed (the real one also shows consumer and host). Partition 1 is far behind while the others keep up: a hot key, a slow consumer, or a stuck message on that one partition.',
    },
    {
      type: 'quiz',
      q: 'A consumer processed 200 records but crashed before committing their offsets. What happens after the rebalance?',
      options: ['Those 200 records are lost forever', 'Kafka rolls back their side effects', 'The new owner reprocesses them from the last commit', 'The partition pauses until an operator steps in'],
      answer: 2,
      explain: 'The new owner starts at the **last committed offset**, so uncommitted work is done again. At-least-once processing means duplicates are expected.',
    },
    {
      type: 'quiz',
      q: 'Your consumer sometimes spends 8 minutes processing one batch between poll() calls. With default settings, what happens?',
      options: [
        'Nothing, Kafka waits as long as needed',
        'It exceeds max.poll.interval.ms (5 min), leaves the group and triggers a rebalance',
        'The broker deletes the partition',
        'Its offsets are committed twice',
      ],
      answer: 1,
      explain: 'Heartbeats keep flowing, but the poll interval is exceeded, so the consumer is removed and its partitions move. Smaller batches or faster processing fix it.',
    },
  ],
});

deepSection('kafka-in-depth', {
  id: 'semantics',
  nav: 'Exactly-once',
  title: 'Delivery semantics: at-most, at-least and exactly once',
  goal: 'Pick the right guarantee and know precisely what Kafka transactions do and don\'t cover.',
  card: {
    emoji: '💎',
    text: `Delivery guarantees come down to **when you commit** relative to when you do the work. Commit first, then process, and a crash loses messages: **at-most-once**. Process first, then commit, and a crash replays them: **at-least-once**, the common default, which needs idempotent consumers. **Exactly-once** in Kafka combines the idempotent producer with **transactions**: a consume-transform-produce step writes its output and its consumed offsets atomically, and \`read_committed\` consumers never see aborted writes. It covers Kafka-to-Kafka pipelines only. Charging a card or sending an email still needs your own idempotency.`,
  },
  blocks: [
    {
      type: 'text',
      md: `Every consumer does two things for each record: the **work** (update a database, call an API, write another record) and the **commit** (record that it's done). A crash can land between them. Which order you choose decides which way you fail.`,
    },
    {
      type: 'tabs',
      title: 'Three guarantees, one question: when do you commit?',
      tabs: [
        {
          label: 'At-most-once',
          blocks: [
            { type: 'text', md: `**Commit, then process.** If the consumer crashes after committing but before finishing the work, the new owner starts after that record, and the record is never processed. Nothing is ever done twice, and some things are never done at all.

It fits data where loss is cheaper than duplication or delay: sampling metrics, best-effort notifications, telemetry you aggregate anyway. On the producer side, \`acks=0\` with no retries is the matching mindset.` },
          ],
        },
        {
          label: 'At-least-once',
          blocks: [
            { type: 'text', md: `**Process, then commit.** A crash after the work but before the commit means the record is delivered again and the work is repeated. Nothing is lost; some things happen twice.

This is the default stance for most real systems, and it's safe as long as the work is **idempotent**: dedupe on an event ID, use upserts instead of increments, lean on unique constraints, and pass idempotency keys to payment APIs. A duplicate then becomes a harmless no-op.` },
          ],
        },
        {
          label: 'Exactly-once',
          blocks: [
            { type: 'text', md: `**Make the work and the commit one atomic step.** If your "work" is writing records to other Kafka topics, Kafka can do this: a **transaction** writes the output records **and** the consumed offsets together, and either all of it becomes visible or none of it does.

Kafka Streams turns this on with a single setting, \`processing.guarantee=exactly_once_v2\`. The guarantee is "effectively once" for state inside Kafka: records may be processed more than once internally after a failure, but the results appear exactly once.` },
            { type: 'callout', tone: 'warn', title: 'The boundary', text: 'Transactions cover reads and writes **inside Kafka**. An email, a card charge or a row in an external database written during processing is outside the transaction and can still happen twice.' },
          ],
        },
      ],
    },
    {
      type: 'text',
      md: `**How transactions work.** A transactional producer is configured with a stable \`transactional.id\`. When it starts, it registers with a **transaction coordinator** (a broker), which bumps an **epoch** for that ID. If an old instance of the same app is still alive somewhere, a "zombie" after a network partition, its writes now carry a stale epoch and are rejected. That fencing is what stops two copies of a service from both committing.

Inside a transaction, the producer writes output records to any number of partitions and adds the consumer's offsets with \`send_offsets_to_transaction\`. On commit, the coordinator records the decision in its internal \`__transaction_state\` log and writes **commit markers** into every partition involved. Consumers with \`isolation.level=read_committed\` only return records from committed transactions and skip aborted ones; the default, \`read_uncommitted\`, shows everything.`,
    },
    {
      type: 'code',
      title: 'Consume, transform, produce: atomically',
      lang: 'python',
      code: `from confluent_kafka import Producer

p = Producer({"bootstrap.servers": "kafka:9092",
              "transactional.id": "fraud-scorer-1"})
p.init_transactions()            # registers and fences older instances

while True:
    msg = c.poll(1.0)            # c: a consumer with isolation.level=read_committed
    if msg is None or msg.error():
        continue
    p.begin_transaction()
    p.produce("scores", key=msg.key(), value=score(msg.value()))
    # the consumed offset commits in the SAME transaction as the output
    p.send_offsets_to_transaction(
        c.position(c.assignment()), c.consumer_group_metadata())
    p.commit_transaction()       # all of it, or none of it`,
      caption: 'One transaction per message keeps the example short; real code wraps a batch of records in each transaction, because every commit costs a round trip to the coordinator.',
    },
    {
      type: 'callout',
      tone: 'tip',
      title: 'Bridging to a database: the outbox pattern',
      text: 'Need "update my database **and** publish an event" without a two-phase commit? Write the event into an **outbox table** in the same database transaction as the business change. A separate process (often a change-data-capture connector like Debezium) reads the outbox and publishes to Kafka. The database transaction makes the two writes atomic; consumers dedupe on the event ID.',
    },
    {
      type: 'quiz',
      q: 'Your consumer commits the offset first, then processes, and crashes in between. Which guarantee is that?',
      options: ['At-most-once', 'At-least-once', 'Exactly-once', 'Ordered-once'],
      answer: 0,
      explain: 'Committing before the work means a crash skips the record: **at-most-once**. Process first and commit after for at-least-once.',
    },
    {
      type: 'quiz',
      q: 'A Kafka transaction consumes from orders and writes to invoices. What does it NOT protect?',
      options: [
        'The output records and consumed offsets committing together',
        'An email the consumer sends while processing',
        'read_committed readers skipping aborted records',
        'Fencing a zombie instance with the same transactional.id',
      ],
      answer: 1,
      explain: 'The email is a side effect outside Kafka, so a retry can send it twice. Use an idempotency key or the outbox pattern for external effects.',
    },
  ],
});

deepSection('kafka-in-depth', {
  id: 'retention',
  nav: 'Retention & compaction',
  title: 'Retention, compaction and what stays on disk',
  goal: 'Know exactly when Kafka deletes data, and how a compacted topic becomes a table.',
  card: {
    emoji: '🧹',
    text: `Kafka doesn't delete messages when they're read. It deletes them by **policy**. With the default \`delete\` policy, whole log segments are dropped once they're older than \`retention.ms\` (7 days by default) or the partition grows past \`retention.bytes\`. With \`compact\`, Kafka keeps at least the **latest value for every key** and throws away older ones, so the topic becomes a durable table of current state. A record with a null value, a **tombstone**, deletes its key. Kafka's own consumer offsets live in a compacted topic.`,
  },
  blocks: [
    {
      type: 'text',
      md: `Because reading is decoupled from deleting, Kafka needs a separate rule for when data goes away. That rule is the topic's \`cleanup.policy\`, and there are two.

**\`delete\` (the default)** works on whole **segments**. The active segment is never deleted. Once a closed segment's newest record is older than \`retention.ms\` (7 days by default, from the broker's \`log.retention.hours=168\`), or the partition exceeds \`retention.bytes\` (unlimited by default), the broker deletes the segment files. Because deletion is per segment, data can stay a bit longer than the retention period, never shorter.

**\`compact\`** works on **keys**. A background log cleaner rewrites old segments and keeps only the newest record for each key. The history disappears, but the latest state of every key is kept forever, which turns a topic into something that behaves like a key-value table.`,
    },
    {
      type: 'table',
      title: 'Compaction in action (topic: user-plans)',
      head: ['Offset', 'Key', 'Value', 'After compaction'],
      rows: [
        ['0', 'user:1', 'plan=free', 'removed: newer value at offset 3'],
        ['1', 'user:2', 'plan=pro', 'kept: latest for user:2'],
        ['2', 'user:3', 'plan=free', 'removed: tombstone at offset 4'],
        ['3', 'user:1', 'plan=team', 'kept: latest for user:1'],
        ['4', 'user:3', 'null (tombstone)', 'kept for a while, then removed'],
      ],
    },
    {
      type: 'text',
      md: `Notice two things. Offsets are **never renumbered**: after compaction the partition might contain offsets 1, 3 and 4 with gaps in between, and consumers simply skip the gaps. And a **tombstone** (a record with a key and a null value) is how you delete a key: it wipes out the older values, then itself stays around for \`delete.retention.ms\` (1 day by default) so slow consumers get a chance to see the deletion before it disappears too.

Compaction is also not instant. The newest part of the log (the "dirty" head) isn't compacted until the cleaner gets to it, so a compacted topic always holds the latest value per key, **plus** some recent history. \`min.compaction.lag.ms\` lets you guarantee a minimum time before records become eligible.`,
    },
    {
      type: 'list',
      title: 'Where compacted topics shine',
      items: [
        { title: 'Kafka itself:', text: 'committed offsets live in `__consumer_offsets`, a compacted topic, so only the latest offset per group and partition is kept.' },
        { title: 'State for stream processing:', text: 'Kafka Streams backs its local state stores with compacted changelog topics, so a crashed instance rebuilds its state by replaying them.' },
        { title: 'Change data capture:', text: 'tools like Debezium publish row changes keyed by primary key, so a compacted topic holds the current version of every row.' },
        { title: 'Reference data:', text: 'product catalogs, feature flags or user profiles that services load on startup and keep updated in real time.' },
      ],
    },
    {
      type: 'code',
      title: 'Make a topic compacted',
      lang: 'text',
      code: `kafka-configs.sh --bootstrap-server localhost:9092 --alter \\
  --entity-type topics --entity-name user-plans \\
  --add-config cleanup.policy=compact,min.compaction.lag.ms=3600000`,
      caption: 'Commas separate settings here. A topic can also use both policies at once, written `cleanup.policy=[compact,delete]` in this command: compact by key, and drop anything older than the retention period.',
    },
    {
      type: 'deep',
      title: 'Go deeper: tiered storage',
      blocks: [
        {
          type: 'text',
          md: `Classic Kafka keeps every retained byte on the brokers' local disks. Long retention therefore means big, expensive disks, and moving a partition to a new broker means copying all of it.

**Tiered storage** splits the log in two: recent segments stay on local disk, and older, closed segments are uploaded to cheaper remote storage such as Amazon S3. Consumers reading old data are served from the remote tier transparently. Retention of months or years becomes affordable, and brokers become lighter to replace. Several Kafka-compatible systems and managed services push this idea further and keep almost everything in object storage.`,
        },
      ],
    },
    {
      type: 'quiz',
      q: 'A topic uses cleanup.policy=compact. Key user:42 was written 5 times. What does compaction eventually keep?',
      options: ['All 5 records', 'Only the first record', 'Nothing, old keys get deleted', 'The latest record for user:42'],
      answer: 3,
      explain: 'Compaction keeps at least the **newest value per key**. Only a tombstone (null value) removes the key entirely.',
    },
    {
      type: 'quiz',
      q: 'Retention is 7 days, and your consumer group was down for 9 days. What happens when it restarts?',
      options: [
        'It resumes exactly where it left off',
        'Its old position is gone; auto.offset.reset picks a start, and 2 days of data are lost to it',
        'Kafka restores the deleted data from replicas',
        'The broker refuses to let the group start',
      ],
      answer: 1,
      explain: 'Retention deletes segments whether or not anyone read them, on every replica. The group falls back to `auto.offset.reset` (earliest or latest) and never sees the deleted records.',
    },
  ],
});

deepSection('kafka-in-depth', {
  id: 'landscape',
  nav: 'Queues vs logs, users',
  title: 'Logs vs queues, and who runs Kafka',
  goal: 'Choose between Kafka, RabbitMQ and SQS with reasons, and know where Kafka runs today.',
  card: {
    emoji: '🌍',
    text: `Kafka is a log; RabbitMQ and SQS are queues, and the difference shapes everything. A queue hands each message to one worker and forgets it once it's acknowledged, which makes it ideal for task distribution with per-message retries. A log keeps everything for the retention period, lets any number of groups read independently, and supports replay, which makes it ideal for event streams many teams consume. Kafka was built at **LinkedIn** around 2010 and now underpins event pipelines at companies like **Netflix** and **Uber**, offered as a managed service by Confluent and the big clouds.`,
  },
  blocks: [
    {
      type: 'text',
      md: `"Should we use Kafka or a queue?" is one of the most common design questions, and the honest answer is that they solve different problems. A **queue** is a to-do list: each item is handed to one worker, the worker acknowledges it, and it's gone. Per-message retries, delays and dead-lettering are natural. A **log** is a history: everything stays for the retention period, readers track their own position, and parallelism comes from partitions rather than from handing out individual messages.`,
    },
    {
      type: 'table',
      title: 'Kafka vs RabbitMQ vs Amazon SQS',
      head: ['', 'Kafka', 'RabbitMQ', 'Amazon SQS'],
      rows: [
        ['Core model', 'Partitioned, replicated log; consumers track offsets', 'Broker routes messages through exchanges into queues', 'Fully managed queue'],
        ['After a read', 'Stays until retention or compaction removes it', 'Deleted once acknowledged (classic queues)', 'Deleted by the consumer after processing'],
        ['Replay', 'Yes: rewind offsets, or start a new group', 'Not for classic queues (Streams add a log-style type)', 'No'],
        ['Ordering', 'Per partition', 'Per queue, with one consumer', 'Best effort (standard); per message group (FIFO)'],
        ['Fan-out', 'Many consumer groups read the same topic', 'Fanout and topic exchanges copy messages to many queues', 'Pair with SNS to copy to several queues'],
        ['Scaling unit', 'Partitions', 'Queues and consumers', 'Automatic'],
        ['Per-message retry / DLQ', 'Build it yourself (retry and dead-letter topics)', 'Built in (dead-letter exchanges)', 'Built in (redrive policy)'],
        ['Best for', 'Event streams, pipelines, CDC, many readers, replay', 'Task queues, complex routing, request/reply', 'Simple decoupling on AWS with zero ops'],
      ],
    },
    {
      type: 'wild',
      title: 'In the wild: who runs Kafka, and how',
      items: [
        {
          emoji: '💼',
          who: 'LinkedIn',
          what: 'Where Kafka was born',
          tags: ['origin', 'open source 2011'],
          text: `Jay Kreps, Neha Narkhede and Jun Rao built Kafka at LinkedIn around 2010 to move activity data (page views, searches, clicks) and operational metrics between hundreds of systems through one pipeline instead of a tangle of point-to-point feeds. It was open-sourced in 2011 and became a top-level Apache project in 2012.

LinkedIn still runs it at enormous scale, with reported volumes in the trillions of messages per day.`,
        },
        {
          emoji: '🏢',
          who: 'Confluent',
          what: 'The company around Kafka',
          tags: ['managed', 'founded 2014'],
          text: `In 2014 Kafka's three creators left LinkedIn to found **Confluent**, which employs many of Kafka's core committers and sells Confluent Platform and Confluent Cloud, a fully managed Kafka service.

The surrounding ecosystem they popularized, **Kafka Connect** for moving data in and out, **Kafka Streams** for stream processing, and **Schema Registry** for Avro/Protobuf schemas, is how most companies actually use Kafka day to day.`,
        },
        {
          emoji: '🎬',
          who: 'Netflix',
          what: 'Keystone data pipeline',
          tags: ['event pipeline', 'stream processing'],
          text: `Netflix's **Keystone** pipeline carries events from its applications and devices (playback events, application logs, operational data) through Kafka to stream processing jobs and on to storage and search systems.

It's the textbook use of a log: producers publish once, and many independent consumers (analytics, monitoring, personalization) each read what they need at their own pace.`,
        },
        {
          emoji: '🚗',
          who: 'Uber',
          what: 'Real-time trip and marketplace data',
          tags: ['very large scale', 'multi-region'],
          text: `Uber runs one of the largest Kafka deployments in the world, carrying trip events, driver and rider app events, logs and data for real-time features like dynamic pricing.

Replicating topics between data centers was painful with Kafka's original MirrorMaker tool, so Uber built and open-sourced **uReplicator** in 2016 for more reliable cross-cluster replication.`,
        },
        {
          emoji: '📰',
          who: 'The New York Times',
          what: 'Kafka as the source of truth',
          tags: ['log as database', 'replay'],
          text: `The New York Times described a publishing architecture in which published content, going back to its earliest archives, is stored in Kafka and kept indefinitely, rather than in a traditional database.

Services that need the content (search, the website, personalization) build their own views by reading the log from the beginning. A new service doesn't need a bulk export: it just replays. It's the "log as the source of truth" idea taken literally.`,
        },
        {
          emoji: '☁️',
          who: 'Managed and compatible',
          what: 'MSK, Event Hubs, Redpanda…',
          tags: ['managed', 'Kafka protocol'],
          text: `The Kafka **protocol** has become a standard in its own right. Amazon MSK and Google Cloud offer managed Apache Kafka; Azure Event Hubs exposes a Kafka-compatible endpoint.

Other engines speak the same protocol with different internals: **Redpanda** is written in C++ and runs without a JVM, and several newer systems store data mostly in object storage. Your Kafka client code usually works against all of them unchanged.`,
        },
      ],
    },
    {
      type: 'callout',
      tone: 'key',
      title: 'The interview answer',
      text: '"If each message is a **job** for one worker, I want a queue: SQS or RabbitMQ, with per-message retries and a DLQ. If each message is an **event** that several teams need, possibly again later, I want a log: Kafka, keyed for per-entity order, with a consumer group per team." Plenty of real systems use both.',
    },
    {
      type: 'quiz',
      q: 'Ten teams each need every "OrderPlaced" event, and a new team wants last week\'s events too. Which fits best?',
      options: ['One SQS queue shared by all ten teams', 'A RabbitMQ queue with ten competing workers', 'Synchronous HTTP calls to each team', 'A Kafka topic with a consumer group per team'],
      answer: 3,
      explain: 'A log lets every team read independently with its own offsets, and replay lets the new team start from last week. A shared queue would split the events instead.',
    },
    {
      type: 'quiz',
      q: 'Which job suits a classic queue (SQS or RabbitMQ) better than Kafka?',
      options: [
        'Replaying a month of clickstream into a new model',
        'Independent "resize this image" jobs with per-message retries and a DLQ',
        'Feeding the same events to 12 teams',
        'Keeping the latest profile per user in a compacted topic',
      ],
      answer: 1,
      explain: 'Independent jobs with per-message acknowledgement, retries and dead-lettering are what queues do natively. The other three lean on a log\'s retention, fan-out or compaction.',
    },
  ],
});

deepSection('kafka-in-depth', {
  id: 'failures',
  nav: 'When it breaks',
  title: 'When it breaks: diagnose the incident',
  goal: 'Recognize the classic Kafka failure patterns from their symptoms.',
  card: {
    emoji: '🚨',
    text: `Kafka incidents follow patterns. **Consumer lag** that keeps growing means consumers are slower than producers, and if lag outlives retention, data is deleted before you read it. **Rebalance storms** happen when processing takes longer than \`max.poll.interval.ms\`, so consumers keep getting kicked out. A **hot partition** comes from a skewed key, like one giant customer. A **poison message** that always fails can block its partition unless you park it in a **dead-letter topic**. And adding partitions silently remaps keys, which can break the per-key ordering you relied on.`,
  },
  blocks: [
    {
      type: 'text',
      md: `Each case below starts with a symptom, the way you'd meet it on a dashboard or in an incident channel. Diagnose it out loud before you tap to reveal the answer. Nearly every Kafka incident is one of these, or two of them at once.`,
    },
    {
      type: 'yourturn',
      prompt: '📈 Consumer lag on the `payments` group has climbed steadily for three days, across **all** partitions. No errors in the logs.',
      answer: `**Consumers are simply slower than producers.** Traffic grew, or processing got slower (a new database call, a slower downstream API), and the group can't keep up. Lag on every partition, with no errors, points at throughput, not at one bad record.

**Fix:** add consumers, up to the partition count; beyond that, more partitions are needed. Speed up processing: batch database writes, make slow calls concurrently. And **alert on lag before it approaches retention**: if lag outlives the retention period, records are deleted before the group reads them.`,
    },
    {
      type: 'yourturn',
      prompt: '🔁 The logs show the group rebalancing every few minutes. Throughput is near zero and the same records are processed again and again.',
      answer: `**A rebalance storm.** Some batches take longer to process than \`max.poll.interval.ms\` (5 minutes by default). The consumer is evicted, its partitions move, the new owner reprocesses the same slow batch from the last commit, gets evicted too, and the cycle repeats.

**Fix:** lower \`max.poll.records\` so each poll is less work, make processing faster or hand it off to worker threads carefully, or raise \`max.poll.interval.ms\` if long processing is genuinely expected. Use the cooperative assignor and static membership so the rebalances that do happen are cheap.`,
    },
    {
      type: 'yourturn',
      prompt: '🔥 One partition of `events` gets 40% of all traffic. The consumer that owns it is pegged at 100% CPU while the others are mostly idle.',
      answer: `**A hot partition from a skewed key.** One key (a huge tenant, a celebrity account, a default value like \`"unknown"\`) carries a large share of events, and every record with that key hashes to the same partition. More consumers can't help: a partition is owned by one consumer.

**Fix:** choose a key with better spread. If one entity is simply huge, split it by **salting** the key (\`tenant-42#0\` … \`tenant-42#7\`), accepting that ordering then holds only within each salted sub-key, or give that entity its own topic. Also check for null or constant keys sneaking in.`,
    },
    {
      type: 'yourturn',
      prompt: '☠️ Lag on a single partition grows by thousands per minute. The consumer restarts every 30 seconds with the same deserialization exception.',
      answer: `**A poison message.** One malformed record (bad JSON, an unexpected schema) crashes the consumer every time. It never commits past it, so after each restart it reads the same record and dies again, and everything behind it on that partition is stuck.

**Fix:** catch processing and deserialization errors, publish the bad record to a **dead-letter topic** with the error in its headers, commit, and move on. Kafka has no built-in DLQ for plain consumers, but Kafka Connect (\`errors.deadletterqueue.topic.name\`) and frameworks like Spring Kafka provide one. Prevent it upstream with a schema registry that rejects incompatible producers.`,
    },
    {
      type: 'yourturn',
      prompt: '🔀 After increasing `orders` from 6 to 12 partitions, some customers see "Shipped" before "Paid" in their order history.',
      answer: `**Adding partitions remapped the keys.** The partition is \`hash(key) mod partitionCount\`, so going from 6 to 12 moved many order IDs to new partitions. Newer events for an order landed on a new partition while older events still sat unprocessed on the old one, and the two partitions are consumed independently.

**Fix:** size partition counts with headroom up front. If you must grow, pause producers and let consumers drain first, or create a new topic and migrate. Defensive consumers can also carry a version or sequence number per entity and ignore stale updates.`,
    },
    {
      type: 'yourturn',
      prompt: '💾 A broker crashed and came back. Producers had been told every write succeeded, yet about 2 seconds of orders are missing.',
      answer: `**Weak durability settings.** With \`acks=1\`, the leader acknowledged writes its followers hadn't copied yet; when it died, a follower became leader without them. The same happens with \`acks=all\` if the ISR had shrunk to just the leader (\`min.insync.replicas=1\`), or if unclean leader election promoted a stale replica.

**Fix:** replication factor 3, \`min.insync.replicas=2\`, producer \`acks=all\` with idempotence, unclean leader election disabled, and brokers spread across racks or zones.`,
    },
    {
      type: 'callout',
      tone: 'tip',
      title: 'The dashboard that catches most of these',
      text: 'Consumer **lag per partition** (not just the total), **under-replicated partitions** and **offline partitions** from the brokers, how often the ISR shrinks, consumer rebalance rate, produce and fetch latency, and disk usage against retention. Lag concentrated on one partition is almost always a hot key or a poison message.',
    },
    {
      type: 'quiz',
      q: 'One partition has 2 million records of lag; the other 11 have almost none. Most likely cause?',
      options: ['The broker disks are full', 'A hot key, or a poison message stuck there', 'Too many consumer groups', 'acks=all is too slow'],
      answer: 1,
      explain: 'Lag concentrated on one partition points at that partition: a skewed key sending it far more traffic, or a record its consumer keeps failing on.',
    },
    {
      type: 'quiz',
      q: 'Which change can silently break per-key ordering on an existing topic?',
      options: ['Adding a consumer group', 'Raising retention.ms', 'Increasing the partition count', 'Enabling compression'],
      answer: 2,
      explain: 'The key-to-partition mapping depends on the partition count. Change it and keys move, so one key\'s events can be split across two partitions.',
    },
  ],
});

deepSection('kafka-in-depth', {
  id: 'recap',
  nav: 'Explain it back',
  title: 'Explain it back',
  goal: 'Turn recognition into recall: answer each card out loud before you flip it.',
  card: {
    emoji: '🃏',
    text: `The whole story in one breath. Kafka stores events in partitioned, append-only logs; offsets mark positions, and reading never deletes. Producers pick partitions by key, batch for throughput, and choose durability with \`acks\`; idempotence makes retries safe. Each partition has a leader and followers, and the ISR plus \`min.insync.replicas\` decide what survives a crash. Consumer groups split partitions among members and commit offsets, so rebalances can cause duplicates. Exactly-once is real inside Kafka, thanks to transactions. Now explain each idea out loud before you flip the card.`,
  },
  blocks: [
    {
      type: 'text',
      md: `Reading builds familiarity. **Recalling** builds memory. Answer each card out loud, in full sentences, as if an interviewer just asked. If you can explain it without peeking, you know it. If you can't, scroll back to that part and read it once more.`,
    },
    {
      type: 'flashcards',
      cards: [
        { q: 'What is a Kafka topic, physically?', a: 'A set of partitions. Each partition is an append-only log, split into segment files on a broker\'s disk and copied to other brokers. Records in a partition are numbered by offset.' },
        { q: 'Why is Kafka fast even though it writes everything to disk?', a: 'Appends are sequential, recent data is served from the OS page cache, records move in compressed batches, and brokers can send file bytes straight to the socket with zero-copy (sendfile) when TLS isn\'t in the way.' },
        { q: 'How does a producer choose a partition?', a: 'With a key, the default partitioner hashes it (murmur2) modulo the partition count, so a key keeps mapping to the same partition while the count is unchanged. Without a key, it spreads batches across partitions.' },
        { q: 'Explain acks=0, acks=1 and acks=all.', a: '0: don\'t wait for any response. 1: wait for the leader, and lose the write if the leader dies before followers copy it. all: wait for every in-sync replica; combine with min.insync.replicas=2 for real durability.' },
        { q: 'What is the ISR, and why does it matter?', a: 'The in-sync replicas: the leader plus followers that are caught up. New leaders come only from the ISR, acks=all waits for the ISR, and min.insync.replicas sets how small it may get before writes are refused.' },
        { q: 'What is the high watermark?', a: 'The offset up to which every in-sync replica has the data. Consumers can only read below it, so they never see records that a leader failover could take back.' },
        { q: 'What happens during a consumer group rebalance?', a: 'Partitions are reassigned after a member joins, leaves or misses its deadlines. New owners resume from the last committed offsets, so work done but not committed is repeated. Cooperative rebalancing and static membership reduce the disruption.' },
        { q: 'How does Kafka achieve exactly-once?', a: 'The idempotent producer removes retry duplicates; transactions commit output records and consumed offsets atomically, with zombie fencing by epoch; read_committed consumers skip aborted data. It covers Kafka-to-Kafka processing, not external side effects.' },
        { q: 'Delete retention vs log compaction?', a: 'Delete drops whole segments older than retention.ms or beyond retention.bytes. Compaction keeps at least the latest record per key; null-value tombstones delete a key. A compacted topic behaves like a durable table.' },
        { q: 'What is KRaft?', a: 'Kafka\'s built-in, Raft-based metadata quorum that replaced ZooKeeper. Controller nodes keep cluster metadata in an internal log. Production-ready in 3.3; Kafka 4.0 removed ZooKeeper entirely.' },
      ],
    },
    {
      type: 'quiz',
      q: 'Which statement about Kafka is true?',
      options: [
        'Reading a message removes it from the topic',
        'Ordering is guaranteed across all partitions',
        'acks sets durability; idempotence makes retries safe',
        'Exactly-once covers emails your consumer sends',
      ],
      answer: 2,
      explain: 'Producers choose how many replicas must confirm a write with **acks**, and the idempotent producer stops retries from duplicating records. The other three are classic misconceptions.',
    },
    {
      type: 'quiz',
      q: 'You need per-customer ordering, high throughput and replay. Which design?',
      options: [
        'One partition for the whole topic',
        'customerId as the key, many partitions, idempotent at-least-once consumers',
        'Random keys and a single consumer',
        'An SQS standard queue',
      ],
      answer: 1,
      explain: 'Keying by customer keeps each customer\'s events in one partition, in order. Many partitions give parallelism, and Kafka\'s retention gives replay.',
    },
  ],
});
