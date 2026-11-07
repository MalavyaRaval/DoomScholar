#!/usr/bin/env node
// Tiny zero-dependency static server.  Usage: node tools/serve.js [port]
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.md': 'text/plain; charset=utf-8',
};

function start(port = 0, host = '127.0.0.1') {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
}

if (require.main === module) {
  // Listens on your Wi-Fi too, so you can open it on your phone before deploying.
  const port = +process.argv[2] || 8080;
  start(port, '0.0.0.0').then(() => {
    console.log(`DoomScholar running at http://localhost:${port}`);
    // Skip virtual adapters (WSL, Hyper-V, Docker, VMs): phones can't reach those addresses.
    const VIRTUAL = /vEthernet|WSL|Hyper-V|VirtualBox|VMware|Docker|vbox|veth|br-|utun|awdl|llw|Loopback/i;
    const lan = Object.entries(require('os').networkInterfaces())
      .filter(([name]) => !VIRTUAL.test(name))
      .flatMap(([name, addrs]) => addrs.filter((a) => a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254')).map((a) => [name, a.address]));
    lan.forEach(([name, ip]) => console.log(`On your phone (same Wi-Fi): http://${ip}:${port}   (${name})`));
    if (!lan.length) console.log('No Wi-Fi/Ethernet address found, so your phone can\'t reach this computer.');
  });
}

module.exports = { start };
