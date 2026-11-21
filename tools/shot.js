#!/usr/bin/env node
// Screenshots cards as they look on a phone.
// Usage: node tools/shot.js <topicId> [cardIndex ...] [--size=390x844] [--scale=1] [--out=shots]
//        node tools/shot.js --page=topics|quiz|saved      (screenshot a tab instead)
// With no indices, shoots every card in the topic.
const fs = require('fs');
const path = require('path');
const { start } = require('./serve');
const { launch } = require('./chrome');

(async () => {
  const args = process.argv.slice(2);
  const opt = (k, d) => (args.find((a) => a.startsWith(`--${k}=`)) || `--${k}=${d}`).split('=')[1];
  const [topic, ...rest] = args.filter((a) => !a.startsWith('--'));
  const pageTab = opt('page', '');
  if (!topic && !pageTab) { console.log('Usage: node tools/shot.js <topicId> [cardIndex ...]'); return; }
  const [width, height] = opt('size', '390x844').split('x').map(Number);
  const outDir = path.resolve(opt('out', 'shots'));
  fs.mkdirSync(outDir, { recursive: true });

  const server = await start(0);
  const chrome = await launch({ width, height, scale: +opt('scale', 1) });
  const base = `http://127.0.0.1:${server.address().port}/`;
  try {
    await chrome.goto(base);
    await chrome.waitFor('!!document.querySelector("#view-feed .card")');
    if (pageTab) {
      // --at=<css selector> scrolls that element to the top; --js=<code> runs first (e.g. a click).
      const at = opt('at', ''), js = args.find((a) => a.startsWith('--js='))?.slice(5) || '';
      await chrome.eval(`location.hash = '#/${pageTab}'`);
      await chrome.sleep(900);
      if (js) { await chrome.eval(js); await chrome.sleep(500); }
      if (at) {
        await chrome.eval(`(() => { const el = document.querySelector(${JSON.stringify(at)}); const v = el && el.closest('.view');
          if (v) v.scrollTop = el.getBoundingClientRect().top - v.getBoundingClientRect().top + v.scrollTop - 120; })()`);
        await chrome.sleep(700);
      }
      const name = (pageTab + (at ? '-' + at : '')).replace(/[^\w-]+/g, '_');
      const file = path.join(outDir, `page-${name}.png`);
      await chrome.screenshot(file);
      console.log(file);
      return;
    }
    const count = await chrome.eval(`(() => { const c = document.querySelectorAll('.card[data-t=${JSON.stringify(topic)}]'); return c.length; })()`);
    await chrome.eval(`location.hash = '#/feed/${topic}/0'`);
    await chrome.sleep(400);
    const total = await chrome.eval(`document.querySelectorAll('.card[data-t=${JSON.stringify(topic)}]').length`) || count;
    if (!total) throw new Error(`Unknown topic "${topic}"`);
    const indices = rest.length ? rest.map(Number) : [...Array(total).keys()];
    for (const i of indices) {
      await chrome.eval(`location.hash = '#/feed/${topic}/${i}'`);
      const isChat = await chrome.eval(`!!document.querySelector('.card[data-t=${JSON.stringify(topic)}][data-i="${i}"].ty-chat')`);
      await chrome.sleep(isChat ? 2600 : 1400);
      const file = path.join(outDir, `${topic}-${String(i).padStart(2, '0')}.png`);
      await chrome.screenshot(file);
      console.log(file);
    }
    if (chrome.errors.length) { console.log('JavaScript errors:'); chrome.errors.forEach((e) => console.log('  ' + e)); }
  } finally {
    await chrome.close();
    server.close();
  }
})().catch((e) => { console.error(e.message); process.exitCode = 1; });
