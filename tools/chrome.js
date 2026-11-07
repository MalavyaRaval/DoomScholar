// Drives a local headless Chrome/Edge over the DevTools protocol with exact phone emulation.
// Needs Node 22+ (built-in WebSocket). Shared by audit.js and shot.js.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].filter(Boolean);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChrome() {
  const p = CANDIDATES.find((c) => fs.existsSync(c));
  if (!p) throw new Error('Chrome/Edge not found. Set CHROME_PATH.');
  return p;
}

async function launch({ width = 390, height = 844, scale = 1 } = {}) {
  if (typeof WebSocket === 'undefined') throw new Error('Node 22+ is required (global WebSocket).');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-chrome-'));
  const proc = spawn(findChrome(), [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  const wsUrl = await new Promise((resolve, reject) => {
    let buf = '';
    const t = setTimeout(() => reject(new Error('Chrome did not start')), 30000);
    proc.stderr.on('data', (d) => {
      buf += d;
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) { clearTimeout(t); resolve(m[1]); }
    });
    proc.on('exit', () => reject(new Error('Chrome exited early')));
  });

  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      errors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
    }
  };
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const page = (m, p) => send(m, p, sessionId);
  await page('Page.enable');
  await page('Runtime.enable');
  await page('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: true });

  const api = {
    errors,
    cdp: page, // raw DevTools protocol call: cdp(method, params)
    async eval(expression) {
      const r = await page('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    },
    async waitFor(expression, timeout = 30000) {
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        try { if (await api.eval(expression)) return true; } catch { /* page still loading */ }
        await sleep(100);
      }
      throw new Error('Timed out waiting for: ' + expression);
    },
    async goto(url) { await page('Page.navigate', { url }); await sleep(300); await api.waitFor('document.readyState === "complete"'); },
    async screenshot(file) {
      const { data } = await page('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(file, Buffer.from(data, 'base64'));
    },
    async close() {
      try { await send('Browser.close'); } catch { /* already gone */ }
      ws.close(); proc.kill();
      await sleep(300);
      try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* chrome may still hold files */ }
    },
    sleep,
  };
  return api;
}

module.exports = { launch };
