#!/usr/bin/env node
// Renders every card at phone size in headless Chrome and reports cards whose content doesn't fit.
// Usage: node tools/audit.js [topicId ...] [--size=390x720]
// 390x720 ≈ an iPhone 14 viewport with Safari's address bar showing (the strictest common case).
const { start } = require('./serve');
const { launch } = require('./chrome');

(async () => {
  const args = process.argv.slice(2);
  const [width, height] = (args.find((a) => a.startsWith('--size=')) || '--size=390x720').slice(7).split('x').map(Number);
  const only = args.filter((a) => !a.startsWith('--'));
  const server = await start(0);
  const chrome = await launch({ width, height });
  try {
    await chrome.goto(`http://127.0.0.1:${server.address().port}/?audit=1`);
    await chrome.waitFor('!!document.getElementById("audit")');
    const out = JSON.parse(await chrome.eval('document.getElementById("audit").textContent'));
    const keep = (x) => !only.length || only.includes(x.topic);
    const overflow = out.overflow.filter(keep), diagrams = out.diagrams.filter(keep);
    console.log(`Rendered ${out.cards} cards at ${out.viewport.join('x')}.`);
    if (chrome.errors.length) { console.log('✖ JavaScript errors:'); chrome.errors.forEach((e) => console.log('  ' + e)); }
    if (!overflow.length) console.log('✔ No card overflows the screen.');
    else {
      console.log(`✖ ${overflow.length} card(s) overflow. Shorten or split them:`);
      overflow.forEach((o) => console.log(`  ${o.topic} #${o.card} (${o.type}) is ${o.overflowPx}px too tall`));
    }
    diagrams.forEach((d) => console.log(`  diagram ${d.topic} #${d.card}: ${d.issue}`));
    if (overflow.length || diagrams.length || chrome.errors.length) process.exitCode = 1;
  } finally {
    await chrome.close();
    server.close();
  }
})().catch((e) => { console.error(e.message); process.exitCode = 1; });
