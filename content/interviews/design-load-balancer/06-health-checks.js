interviewPhase('design-load-balancer', {
  id: 'health',
  nav: 'Health checks',
  time: '27–32',
  start: 27,
  end: 32,
  title: 'Health checks and failure detection',
  goal: 'Detect failures fast, without false alarms, and without the health checks themselves causing the outage.',
  blocks: [
    { type: 'say', who: 'them', text: 'How does the LB know a backend is dead?' },
    {
      type: 'say',
      who: 'me',
      text: "Two complementary signals.\n\n**Active checks:** the LB probes each backend on a schedule, e.g. a TCP connect or `GET /healthz` every 2 s. They catch dead machines even when no traffic is flowing.\n\n**Passive checks**, also called outlier detection: watch real traffic, and if a backend returns, say, 5 consecutive 5xx errors or timeouts, eject it for a while. They catch \"up but broken\" backends within a handful of requests.",
    },
    {
      type: 'list',
      title: 'Tuning knobs, with sane defaults',
      items: [
        { title: 'Interval:', text: '2–5 s, **with jitter**, so 1,000 backends are not all probed in the same millisecond.' },
        { title: 'Timeout:', text: 'shorter than the interval, e.g. 1 s.' },
        { title: 'Unhealthy threshold:', text: '2–3 consecutive failures, so one lost packet doesn\'t cause flapping.' },
        { title: 'Healthy threshold:', text: '2+ consecutive passes before traffic returns.' },
        { title: 'Detection time:', text: '≈ interval × unhealthy threshold, e.g. 2 s × 3 ≈ 6 s. Passive checks react much faster.' },
      ],
    },
    {
      type: 'code',
      title: 'An active health checker (asyncio)',
      lang: 'python',
      code: `import asyncio, random
import aiohttp

class HealthChecker:
    def __init__(self, pool, path="/healthz", interval=2.0,
                 timeout=1.0, rise=2, fall=3):
        self.pool, self.path = pool, path
        self.interval, self.timeout = interval, timeout
        self.rise, self.fall = rise, fall
        self.ok = {b: 0 for b in pool.backends}     # consecutive passes
        self.bad = {b: 0 for b in pool.backends}    # consecutive failures

    async def probe(self, session, backend):
        try:
            t = aiohttp.ClientTimeout(total=self.timeout)
            async with session.get(f"http://{backend}{self.path}", timeout=t) as r:
                return r.status == 200
        except Exception:                           # refused, reset, timeout…
            return False

    async def watch(self, backend):
        async with aiohttp.ClientSession() as session:
            while True:
                if await self.probe(session, backend):
                    self.ok[backend] += 1
                    self.bad[backend] = 0
                    if self.ok[backend] >= self.rise:
                        self.pool.mark_healthy(backend)
                else:
                    self.bad[backend] += 1
                    self.ok[backend] = 0
                    if self.bad[backend] >= self.fall:
                        self.pool.mark_unhealthy(backend)
                # jitter: spread probes so backends aren't hit in lockstep
                await asyncio.sleep(self.interval * random.uniform(0.8, 1.2))

    async def run(self):
        await asyncio.gather(*(self.watch(b) for b in self.pool.backends))`,
      caption: '`rise` / `fall` are hysteresis: a backend needs a streak to change state, so a single dropped probe never flips it.',
    },
    {
      type: 'code',
      title: 'Passive outlier detection on real responses',
      lang: 'python',
      code: `import time

class OutlierDetector:
    def __init__(self, pool, consecutive_errors=5, base_eject_s=30, max_eject_pct=50):
        self.pool = pool
        self.limit = consecutive_errors
        self.base = base_eject_s
        self.max_pct = max_eject_pct
        self.errors = {}         # backend -> consecutive 5xx / timeouts
        self.times = {}          # backend -> how often it has been ejected

    def on_response(self, backend, status, timed_out=False):
        if timed_out or status >= 500:
            self.errors[backend] = self.errors.get(backend, 0) + 1
            if self.errors[backend] >= self.limit:
                self.eject(backend)
        else:
            self.errors[backend] = 0

    def eject(self, backend):
        # never eject more than half the pool: errors that widespread
        # point at a shared cause, not at this one backend
        if self.pool.ejected_pct() >= self.max_pct:
            return
        n = self.times[backend] = self.times.get(backend, 0) + 1
        self.pool.eject(backend, until=time.time() + self.base * n)  # repeat offenders sit out longer
        self.errors[backend] = 0`,
      caption: 'This mirrors Envoy\'s outlier detection: consecutive-5xx ejection, ejection time that grows with each repeat, and a cap on the ejected percentage.',
    },
    { type: 'say', who: 'them', text: "Your database goes down. Every backend's `/healthz` checks the database, so every backend fails its health check. What does your LB do?" },
    {
      type: 'think',
      text: 'Classic trap. The naive answer, "remove them all", turns a partial outage into a total one.',
    },
    {
      type: 'say',
      who: 'me',
      text: "If I eject everything, I've turned \"the database is down\" into \"the whole site returns 503 from the load balancer\", including pages that never touch the database.\n\nTwo fixes. First, **keep liveness separate from deep checks**: the LB's check should ask \"can this process serve requests?\", not \"are all my dependencies healthy?\". Second, **fail open**: if more than, say, half of a pool is unhealthy at once, assume the checks are lying and keep routing to everyone. Envoy calls this the **panic threshold**, 50% by default.",
    },
    {
      type: 'callout',
      tone: 'trap',
      text: 'Deep health checks (database, cache, downstream APIs) wired into LB routing cause **cascading ejections**: one shared dependency hiccups and every backend is pulled at the same moment. Put deep checks on dashboards and alerts, not in the routing decision.',
    },
    {
      type: 'deep',
      title: 'Go deeper: health checks at fleet scale',
      blocks: [
        {
          type: 'text',
          md: '100 L7 nodes × 5,000 backends × one probe every 2 s = **250,000 health-check requests per second**, all of it pure overhead on the backends. At that scale:',
        },
        {
          type: 'list',
          items: [
            'Each LB node checks only a **subset** of backends (subsetting), or',
            'a central **health service** probes once and publishes status to every LB node through the control plane, and',
            'every node still runs **passive** outlier detection locally, so it reacts within milliseconds to what it sees itself.',
          ],
        },
      ],
    },
    {
      type: 'deep',
      title: 'Go deeper: slow start and connection draining',
      blocks: [
        {
          type: 'text',
          md: '**Slow start:** a freshly started backend has cold caches, empty connection pools and an unwarmed JIT. Ramp its effective weight from ~10% to 100% over 30–60 s instead of hitting it with full load at once. Envoy, HAProxy (`slowstart`) and AWS target groups all support it.\n\n**Connection draining** (deregistration delay): on deploy, the backend is marked *draining*. It gets no new requests, but in-flight ones may finish, up to a deadline such as 30 s. Only then does it stop. Without draining, every deploy cuts users off mid-request.',
        },
        {
          type: 'code',
          title: 'Draining a backend before shutdown',
          lang: 'python',
          code: `async def drain(pool, backend, deadline_s=30):
    pool.stop_new_requests(backend)          # pick() no longer returns it
    for _ in range(deadline_s * 10):
        if pool.in_flight(backend) == 0:
            break                            # everyone finished early
        await asyncio.sleep(0.1)
    pool.remove(backend)                     # now safe to stop the process`,
        },
      ],
    },
    {
      type: 'quiz',
      q: 'Interval 2 s, unhealthy threshold 3. Roughly how long until active checks alone pull a dead backend?',
      options: ['~2 s', '~6 s', '~60 s', 'Instantly'],
      answer: 1,
      explain: '3 consecutive failed probes × 2 s ≈ **6 s**. Passive outlier detection usually catches it sooner, from real traffic failing.',
    },
    {
      type: 'quiz',
      q: '60% of a pool fails its health checks at the same moment. Safest default behavior?',
      options: [
        'Eject all of them immediately',
        'Fail open: keep routing to the whole pool, since a shared cause or broken checks is more likely',
        'Shut down the load balancer',
        'Send everything to the one healthiest backend',
      ],
      answer: 1,
      explain: "Mass failure at once usually means a shared dependency or bad checks. Below the panic threshold (Envoy's default: 50% healthy), balance across all hosts rather than overloading the few left.",
    },
  ],
});
