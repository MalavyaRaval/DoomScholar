/*
 * The feed plays topics in this order. To add a topic:
 *   1. create content/<folder>/<id>.js   (copy an existing one)
 *   2. add its path below
 */
window.CONTENT_FILES = [
  // Fundamentals
  'fundamentals/system-design-101.js',
  'fundamentals/scalability.js',
  'fundamentals/how-the-web-works.js',
  'fundamentals/back-of-envelope.js',
  'fundamentals/cap-theorem.js',

  // Building blocks
  'concepts/load-balancer.js',
  'concepts/caching-redis.js',
  'concepts/cdn.js',
  'concepts/databases.js',
  'concepts/replication-sharding.js',
  'concepts/consistent-hashing.js',
  'concepts/message-queues.js',
  'concepts/rate-limiting.js',
  'concepts/api-gateway-microservices.js',
  'concepts/realtime.js',

  // Design problems
  'designs/url-shortener.js',
  'designs/youtube.js',
  'designs/twitter-feed.js',
  'designs/whatsapp.js',
  'designs/uber.js',
];
