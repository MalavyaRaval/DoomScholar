/*
 * Diagram renderer: turns a tiny JSON spec into an animated SVG.
 * Shared by the app (browser) and tools/validate.js (node).
 *
 * Spec (x/y are node CENTERS, canvas is 360 wide):
 * {
 *   h: 280,
 *   nodes:  [{ id, x, y, label, icon?, shape?: "box"|"db"|"pill", tone?: "accent"|"good"|"warn"|"bad"|"muted", w?, h? }],
 *   edges:  [{ from, to, label?, flow?: true, dashed?: true, curve?: 30, bi?: true, arrow?: false, lx?, ly? }],
 *   groups: [{ x, y, w, h, label?, tone? }],     // x/y = TOP-LEFT corner
 *   notes:  [{ x, y, text, anchor?: "start"|"middle"|"end" }]
 * }
 */
(function (root) {
  'use strict';
  const W = 360;
  const CH = 7;    // approx px per character, 12px semibold label
  const LCH = 6.2; // approx px per character, 11px edge label
  const LH = 14;   // label line height

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const len = (s) => [...String(s ?? '')].length;
  const lines = (n) => String(n.label ?? '').split('\n');
  const r1 = (v) => Math.round(v * 10) / 10;

  function box(n) {
    const ls = lines(n);
    const longest = Math.max(0, ...ls.map(len));
    const w = n.w || Math.max(n.icon ? 72 : 60, Math.round(longest * CH + 24));
    const iconH = n.icon ? 24 : 0;
    const h = n.h || Math.round(iconH + ls.length * LH + 20 + (n.shape === 'db' ? 8 : 0));
    return { x: n.x - w / 2, y: n.y - h / 2, w, h, cx: n.x, cy: n.y };
  }

  function clip(b, tx, ty, pad = 3) {
    const dx = tx - b.cx, dy = ty - b.cy;
    if (!dx && !dy) return { x: b.cx, y: b.cy };
    const sx = dx ? (b.w / 2 + pad) / Math.abs(dx) : Infinity;
    const sy = dy ? (b.h / 2 + pad) / Math.abs(dy) : Infinity;
    const s = Math.min(sx, sy);
    return { x: b.cx + dx * s, y: b.cy + dy * s };
  }

  function unit(x, y) { const l = Math.hypot(x, y) || 1; return { x: x / l, y: y / l }; }

  function edgeGeom(a, b, e) {
    const curve = e.curve || 0;
    const mx = (a.cx + b.cx) / 2, my = (a.cy + b.cy) / 2;
    const dx = b.cx - a.cx, dy = b.cy - a.cy, L = Math.hypot(dx, dy) || 1;
    const c = { x: mx + (-dy / L) * curve, y: my + (dx / L) * curve };
    const p1 = clip(a, c.x, c.y), p2 = clip(b, c.x, c.y);
    let d, mid, endDir, startDir, length;
    if (curve) {
      d = `M${r1(p1.x)},${r1(p1.y)} Q${r1(c.x)},${r1(c.y)} ${r1(p2.x)},${r1(p2.y)}`;
      mid = { x: 0.25 * p1.x + 0.5 * c.x + 0.25 * p2.x, y: 0.25 * p1.y + 0.5 * c.y + 0.25 * p2.y };
      endDir = unit(p2.x - c.x, p2.y - c.y);
      startDir = unit(p1.x - c.x, p1.y - c.y);
      length = Math.hypot(c.x - p1.x, c.y - p1.y) + Math.hypot(p2.x - c.x, p2.y - c.y);
    } else {
      d = `M${r1(p1.x)},${r1(p1.y)} L${r1(p2.x)},${r1(p2.y)}`;
      mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      endDir = unit(p2.x - p1.x, p2.y - p1.y);
      startDir = unit(p1.x - p2.x, p1.y - p2.y);
      length = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    }
    mid = { x: mid.x + (e.lx || 0), y: mid.y + (e.ly || 0) };
    const at = (t) => curve
      ? { x: (1 - t) * (1 - t) * p1.x + 2 * (1 - t) * t * c.x + t * t * p2.x, y: (1 - t) * (1 - t) * p1.y + 2 * (1 - t) * t * c.y + t * t * p2.y }
      : { x: p1.x + (p2.x - p1.x) * t, y: p1.y + (p2.y - p1.y) * t };
    return { d, p1, p2, mid, endDir, startDir, length, at };
  }

  function arrowHead(p, u) {
    const n = { x: -u.y, y: u.x };
    const bx = p.x - u.x * 9, by = p.y - u.y * 9;
    return `<polygon class="e-head" points="${r1(p.x)},${r1(p.y)} ${r1(bx + n.x * 4.5)},${r1(by + n.y * 4.5)} ${r1(bx - n.x * 4.5)},${r1(by - n.y * 4.5)}"/>`;
  }

  function layout(spec) {
    const H = spec.h || 280;
    const nodes = {};
    (spec.nodes || []).forEach((n) => { nodes[n.id] = { n, b: box(n) }; });
    const edges = (spec.edges || []).map((e) => {
      const A = nodes[e.from], B = nodes[e.to];
      if (!A || !B) return { e, missing: true };
      const g = edgeGeom(A.b, B.b, e);
      let lb = null;
      if (e.label) {
        const w = Math.round(len(e.label) * LCH + 12);
        lb = { x: g.mid.x - w / 2, y: g.mid.y - 9, w, h: 18 };
      }
      return { e, g, lb };
    });
    return { W, H, nodes, edges };
  }

  function nodeSvg(n, b) {
    const ls = lines(n);
    const tone = n.tone ? ` tone-${esc(n.tone)}` : '';
    let shape;
    if (n.shape === 'db') {
      const ry = 7;
      shape = `<path class="n-shape" d="M${r1(b.x)},${r1(b.y + ry)} a${r1(b.w / 2)},${ry} 0 0 1 ${r1(b.w)},0 v${r1(b.h - 2 * ry)} a${r1(b.w / 2)},${ry} 0 0 1 ${r1(-b.w)},0 z"/>` +
        `<path class="n-rim" d="M${r1(b.x)},${r1(b.y + ry)} a${r1(b.w / 2)},${ry} 0 0 0 ${r1(b.w)},0"/>`;
    } else {
      const rx = n.shape === 'pill' ? b.h / 2 : 12;
      shape = `<rect class="n-shape" x="${r1(b.x)}" y="${r1(b.y)}" width="${r1(b.w)}" height="${r1(b.h)}" rx="${r1(rx)}"/>`;
    }
    const iconH = n.icon ? 24 : 0;
    const contentH = iconH + ls.length * LH;
    const top = b.cy - contentH / 2 + (n.shape === 'db' ? 4 : 0);
    let inner = '';
    if (n.icon) inner += `<text class="n-icon" x="${r1(b.cx)}" y="${r1(top + 11)}">${esc(n.icon)}</text>`;
    ls.forEach((l, i) => {
      inner += `<text class="n-label" x="${r1(b.cx)}" y="${r1(top + iconH + LH / 2 + i * LH)}">${esc(l)}</text>`;
    });
    return `<g class="node${tone}">${shape}${inner}</g>`;
  }

  function render(spec) {
    const L = layout(spec);
    let s = `<svg class="dia" viewBox="0 0 ${L.W} ${L.H}" xmlns="http://www.w3.org/2000/svg" role="img">`;

    (spec.groups || []).forEach((g) => {
      s += `<g class="group${g.tone ? ' tone-' + esc(g.tone) : ''}"><rect x="${g.x}" y="${g.y}" width="${g.w}" height="${g.h}" rx="14"/>` +
        (g.label ? `<text class="g-label" x="${g.x + 10}" y="${g.y + 14}">${esc(g.label)}</text>` : '') + '</g>';
    });

    L.edges.forEach(({ e, g, missing }) => {
      if (missing) return;
      const cls = 'edge' + (e.dashed ? ' dashed' : '') + (e.tone ? ' tone-' + esc(e.tone) : '');
      s += `<g class="${cls}"><path class="e-line" d="${g.d}"/>`;
      if (e.arrow !== false) s += arrowHead(g.p2, g.endDir);
      if (e.bi) s += arrowHead(g.p1, g.startDir);
      if (e.flow) {
        const dur = Math.max(1.1, Math.min(3.2, g.length / 70)).toFixed(2);
        const back = e.flow === 'back';
        const path = back ? reversePath(g) : g.d;
        s += `<circle class="e-dot" r="3.4"><animateMotion dur="${dur}s" repeatCount="indefinite" begin="0s" path="${path}"/></circle>`;
        s += `<circle class="e-dot" r="3.4"><animateMotion dur="${dur}s" repeatCount="indefinite" begin="-${(dur / 2).toFixed(2)}s" path="${path}"/></circle>`;
      }
      s += '</g>';
    });

    L.edges.forEach(({ e, lb }) => {
      if (!lb) return;
      s += `<g class="e-label"><rect x="${r1(lb.x)}" y="${r1(lb.y)}" width="${lb.w}" height="${lb.h}" rx="9"/>` +
        `<text x="${r1(lb.x + lb.w / 2)}" y="${r1(lb.y + lb.h / 2)}">${esc(e.label)}</text></g>`;
    });

    Object.values(L.nodes).forEach(({ n, b }) => { s += nodeSvg(n, b); });

    (spec.notes || []).forEach((t) => {
      s += `<text class="d-note" x="${t.x}" y="${t.y}" text-anchor="${esc(t.anchor || 'middle')}">${esc(t.text)}</text>`;
    });

    return s + '</svg>';
  }

  function reversePath(g) {
    // Swap start/end of a straight or quadratic path.
    const m = g.d.match(/^M([\d.,-]+) (?:Q([\d.,-]+) )?L?([\d.,-]+)$/);
    if (!m) return g.d;
    return m[2] ? `M${m[3]} Q${m[2]} ${m[1]}` : `M${m[3]} L${m[1]}`;
  }

  // Geometry lint used by tools/validate.js and the in-app audit.
  function check(spec) {
    const issues = [];
    if (!spec || !Array.isArray(spec.nodes)) return ['diagram has no nodes[]'];
    const L = layout(spec);
    const ids = new Set();
    spec.nodes.forEach((n) => {
      if (!n.id) issues.push('node without id');
      if (ids.has(n.id)) issues.push(`duplicate node id "${n.id}"`);
      ids.add(n.id);
      if (typeof n.x !== 'number' || typeof n.y !== 'number') issues.push(`node "${n.id}" needs numeric x,y`);
    });
    const list = Object.values(L.nodes);
    list.forEach(({ n, b }) => {
      if (b.x < 2 || b.y < 2 || b.x + b.w > L.W - 2 || b.y + b.h > L.H - 2)
        issues.push(`node "${n.id}" (${Math.round(b.w)}x${Math.round(b.h)} centered at ${n.x},${n.y}) sticks out of the ${L.W}x${L.H} canvas`);
    });
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (overlap(list[i].b, list[j].b, 6)) issues.push(`nodes "${list[i].n.id}" and "${list[j].n.id}" overlap (keep >= 6px gap)`);
      }
    }
    L.edges.forEach(({ e, missing, g }) => {
      if (missing) return;
      // An edge that runs underneath an unrelated node looks like it connects to it.
      list.forEach(({ n, b }) => {
        if (n.id === e.from || n.id === e.to) return;
        const inner = { x: b.x + 3, y: b.y + 3, w: b.w - 6, h: b.h - 6 };
        for (let t = 0.02; t < 1; t += 0.02) {
          const p = g.at(t);
          if (p.x > inner.x && p.x < inner.x + inner.w && p.y > inner.y && p.y < inner.y + inner.h) {
            issues.push(`edge ${e.from}->${e.to} passes through node "${n.id}" (reroute with curve, or move nodes)`);
            break;
          }
        }
      });
    });
    const labels = L.edges.filter((x) => x.lb);
    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) {
        if (overlap(labels[i].lb, labels[j].lb, 2)) issues.push(`edge labels "${labels[i].e.label}" and "${labels[j].e.label}" overlap (nudge with lx/ly)`);
      }
    }
    L.edges.forEach(({ e, missing, lb, g }) => {
      if (missing) { issues.push(`edge ${e.from}->${e.to} references an unknown node`); return; }
      if (!lb) return;
      const u = unit(g.p2.x - g.p1.x, g.p2.y - g.p1.y);
      const along = Math.abs(u.x) * lb.w + Math.abs(u.y) * lb.h; // how much of the line the label covers
      if (g.length < along - 4 && !e.lx && !e.ly) issues.push(`edge label "${e.label}" is wider than its ${Math.round(g.length)}px edge and hides it (move nodes apart, shorten, or nudge with lx/ly)`);
      if (lb.x < 0 || lb.x + lb.w > L.W || lb.y < 0 || lb.y + lb.h > L.H) issues.push(`edge label "${e.label}" is outside the canvas`);
      list.forEach(({ n, b }) => { if (overlap(lb, b, 0)) issues.push(`edge label "${e.label}" covers node "${n.id}" (move nodes apart or nudge with lx/ly)`); });
    });
    (spec.groups || []).forEach((g) => {
      if (g.x < 0 || g.y < 0 || g.x + g.w > L.W || g.y + g.h > L.H) issues.push(`group "${g.label || ''}" is outside the canvas`);
    });
    return issues;
  }

  function overlap(a, b, gap) {
    return a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;
  }

  const api = { render, check, layout, W };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Diagram = api;
})(typeof window !== 'undefined' ? window : globalThis);
