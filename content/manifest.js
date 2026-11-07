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

  // Mock interviews (long-form, one file per phase, in order)
  'interviews/design-load-balancer/00-intro.js',
  'interviews/design-load-balancer/01-requirements.js',
  'interviews/design-load-balancer/02-estimates.js',
  'interviews/design-load-balancer/03-high-level.js',
  'interviews/design-load-balancer/04-lb-types.js',
  'interviews/design-load-balancer/05-algorithms.js',
  'interviews/design-load-balancer/06-health-checks.js',
  'interviews/design-load-balancer/07-ha-scaling.js',
  'interviews/design-load-balancer/08-deep-dives.js',
  'interviews/design-load-balancer/09-wrap-up.js',
  'interviews/design-load-balancer/10-curveballs.js',
  'interviews/design-load-balancer/11-cheatsheet.js',
];
