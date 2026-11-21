/* Renders a deep dive: long-form reading with interactive blocks. Event handling lives in app.js (DD).
   Reuses every mock-interview block (text, list, table, code, diagram, callout, quiz, yourturn, deep…)
   and adds: wild (real-world carousel), stepper, layers (packet inspector), tabs, flashcards, stats. */
window.DeepDive = (() => {
  'use strict';
  const { esc, md } = Cards;
  const { paras } = Interview;

  // Reading time: count the words a reader actually reads (skip diagrams, code and ids).
  const SKIP = new Set(['type', 'diagram', 'code', 'lang', 'tone', 'id', 'focus', 'sees', 'tag', 'color', 'key']);
  function collect(x, out = []) {
    if (typeof x === 'string') out.push(x);
    else if (Array.isArray(x)) x.forEach((v) => collect(v, out));
    else if (x && typeof x === 'object') Object.entries(x).forEach(([k, v]) => { if (!SKIP.has(k)) collect(v, out); });
    return out;
  }
  const words = (x) => collect(x).join(' ').replace(/[*`=#]/g, '').split(/\s+/).filter(Boolean).length;
  const minutes = (sec) => Math.max(1, Math.round(words(sec.blocks) / 210));
  const totalMinutes = (dd) => dd.sections.reduce((a, s) => a + minutes(s), 0);

  const LAYER_COLORS = ['#64748b', '#0ea5e9', '#22c55e', '#f59e0b', '#ec4899', '#a78bfa'];

  // Extra block types. Return null to fall through to the interview renderer.
  function ext(b, ctx) {
    switch (b.type) {
      case 'wild': {
        const items = b.items || [];
        return `<div class="dd-wild">
          ${b.title ? `<h4>${md(b.title)}</h4>` : ''}
          <div class="wild-track" data-dd-track>
            ${items.map((it) => `
              <article class="wild-card">
                <div class="wild-top"><span class="wild-emoji">${esc(it.emoji || '🏢')}</span>
                  <div><b>${md(it.who)}</b>${it.what ? `<span>${md(it.what)}</span>` : ''}</div></div>
                ${it.tags ? `<div class="wild-tags">${it.tags.map((t) => `<span>${md(t)}</span>`).join('')}</div>` : ''}
                <div class="wild-text">${paras(it.text)}</div>
              </article>`).join('')}
          </div>
          <div class="wild-hint">
            <button data-dd="wild" data-k="-1" aria-label="Previous">‹</button>
            <span><span class="wild-n">1</span> / ${items.length} · swipe sideways</span>
            <button data-dd="wild" data-k="1" aria-label="Next">›</button>
          </div>
        </div>`;
      }

      case 'stepper': {
        const steps = b.steps || [];
        const shared = b.diagram ? `<div class="dia-wrap st-dia">${Diagram.render(b.diagram)}</div>` : '';
        return `<div class="dd-step" data-dd-step data-i="0">
          <div class="st-head">${b.title ? `<h4>${md(b.title)}</h4>` : '<span></span>'}<span class="st-count">1 / ${steps.length}</span></div>
          ${shared}
          <div class="st-panels">
            ${steps.map((s, i) => `
              <div class="st-panel${i ? '' : ' on'}" data-focus="${esc((s.focus || []).join(','))}"${s.diagram ? ' data-own="1"' : ''}>
                ${s.diagram ? `<div class="dia-wrap">${Diagram.render(s.diagram)}</div>` : ''}
                <div class="st-t"><span class="st-n">${i + 1}</span>${md(s.title || '')}</div>
                ${paras(s.text)}
              </div>`).join('')}
          </div>
          <div class="st-ctrl">
            <button class="btn ghost" data-dd="prev" disabled>← Back</button>
            <div class="st-dots">${steps.map((_, i) => `<button data-dd="dot" data-k="${i}" class="${i ? '' : 'on'}" aria-label="Step ${i + 1}"></button>`).join('')}</div>
            <button class="btn primary" data-dd="next">Next →</button>
          </div>
        </div>`;
      }

      case 'layers': {
        const layers = b.layers || [];
        const views = b.views || [];
        const first = views[0] || { sees: layers.map((l) => l.tag) };
        // Nested boxes: the outermost layer wraps everything inside it, like envelopes.
        const box = (k) => {
          if (k >= layers.length) return '';
          const l = layers[k];
          const hid = !first.sees.includes(l.tag);
          return `<div class="ly-box${hid ? ' hid' : ''}" data-tag="${esc(l.tag)}" style="--ly:${l.color || LAYER_COLORS[k % LAYER_COLORS.length]}">
            <div class="ly-head"><span class="ly-tag">${esc(l.tag)}</span><b>${md(l.name)}</b><span class="ly-lock">🙈 can't see</span></div>
            ${l.fields ? `<div class="ly-fields">${l.fields.map((f) => `<span>${md(f)}</span>`).join('')}</div>` : ''}
            ${box(k + 1)}
          </div>`;
        };
        return `<div class="dd-layers" data-dd-layers>
          ${b.title ? `<h4>${md(b.title)}</h4>` : ''}
          ${views.length ? `<div class="ly-views">${views.map((v, i) => `<button class="${i ? '' : 'on'}" data-dd="view" data-k="${i}" data-sees="${esc(v.sees.join(','))}">${md(v.label)}</button>`).join('')}</div>` : ''}
          <div class="ly-stack">${box(0)}</div>
          ${views.map((v, i) => `<div class="ly-text${i ? '' : ' on'}">${paras(v.text)}</div>`).join('')}
        </div>`;
      }

      case 'tabs': {
        const tabs = b.tabs || [];
        return `<div class="dd-tabs" data-dd-tabs>
          ${b.title ? `<h4>${md(b.title)}</h4>` : ''}
          <div class="tb-bar">${tabs.map((t, i) => `<button class="${i ? '' : 'on'}" data-dd="tab" data-k="${i}">${md(t.label)}</button>`).join('')}</div>
          ${tabs.map((t, i) => `<div class="tb-panel${i ? '' : ' on'}">${(t.blocks || []).map((x) => Interview.block(x, ctx)).join('')}</div>`).join('')}
        </div>`;
      }

      case 'flashcards': {
        const cards = b.cards || [];
        return `<div class="dd-flash" data-dd-flash>
          <div class="label">🃏 ${md(b.title || 'Explain it back')}</div>
          ${b.text ? `<p class="fl-intro">${md(b.text)}</p>` : ''}
          <div class="fl-list">${cards.map((c, i) => `
            <button class="fl-card" data-dd="flip">
              <span class="fl-face fl-front"><small>Q${i + 1}</small>${md(c.q)}<em>tap to flip</em></span>
              <span class="fl-face fl-back"><small>A${i + 1}</small>${md(c.a)}</span>
            </button>`).join('')}</div>
          <div class="fl-meta"><span class="fl-n">0</span> / ${cards.length} flipped</div>
        </div>`;
      }

      case 'stats':
        return `<div class="dd-stats">${b.title ? `<h4>${md(b.title)}</h4>` : ''}
          <div class="stats">${(b.stats || []).map((s) => `<div class="stat"><div class="v">${esc(s.value)}</div><div class="k">${md(s.label)}</div></div>`).join('')}</div>
          ${b.caption ? `<p class="cap">${md(b.caption)}</p>` : ''}</div>`;

      default:
        return null;
    }
  }

  function sectionHtml(dd, s, i, ctx) {
    const read = !!ctx.state.read[s.id];
    return `
      <section class="iv-phase dd-sec" id="sec-${esc(s.id)}" data-s="${esc(s.id)}">
        <div class="iv-ph-head">
          <span class="iv-time">📖 Part ${i + 1} of ${dd.sections.length} · ~${minutes(s)} min</span>
          <h2>${md(s.title)}</h2>
          ${s.goal ? `<p class="iv-goal">🎯 ${md(s.goal)}</p>` : ''}
        </div>
        ${(s.blocks || []).map((b) => Interview.block(b, ctx)).join('')}
        <button class="btn ${read ? 'ghost' : 'primary'} wide iv-done" data-dd="read" data-s="${esc(s.id)}">${read ? '✅ Read (tap to undo)' : 'Mark as read ✓ +15 XP'}</button>
      </section>`;
  }

  function render(dd, state, opts = {}) {
    const ctx = { iv: dd, state, practice: true, ext };
    const read = dd.sections.filter((s) => state.read[s.id]).length;
    const last = dd.sections.find((s) => s.id === state.last);
    const others = (opts.others || []).filter((x) => x.id !== dd.id);
    return `
      <div class="iv-wrap dd-wrap" style="--accent:${dd.color}">
        <button class="iv-back" data-dd="back">← ${esc(opts.backLabel || 'Topics')}</button>
        <header class="iv-hero">
          <div class="hook-emoji">${esc(dd.emoji)}</div>
          <div class="kicker">Deep dive · ~${totalMinutes(dd)} min read · ${dd.sections.length} part${dd.sections.length === 1 ? '' : 's'}</div>
          <h1>${md(dd.title)}</h1>
          ${dd.intro ? `<div class="iv-intro">${paras(dd.intro)}</div>` : ''}
          <div class="bar"><i style="width:${Math.round((read / dd.sections.length) * 100)}%"></i></div>
          <div class="tile-m">${read}/${dd.sections.length} parts read · ${dd.questions.length} checkpoint questions</div>
          <div class="dd-hero-acts">
            ${last && last !== dd.sections[0] ? `<button class="btn primary" data-dd="jump" data-s="${esc(last.id)}">▶ Continue: ${md(last.nav || last.title)}</button>` : ''}
            ${opts.deck ? `<a class="btn ghost" href="#/feed/${esc(opts.deck)}/0">⚡ Swipe the 1-minute version</a>` : ''}
          </div>
        </header>
        <div class="iv-bar dd-bar">
          <div class="dd-prog"><i></i></div>
          <nav class="iv-nav">${dd.sections.map((s, i) => `<button class="${state.read[s.id] ? 'done' : ''}" data-dd="jump" data-s="${esc(s.id)}">${i + 1}. ${md(s.nav || s.title)}</button>`).join('')}</nav>
        </div>
        ${dd.sections.map((s, i) => sectionHtml(dd, s, i, ctx)).join('')}
        <div class="dd-end">
          <a class="btn primary wide" href="#/quiz/${esc(dd.id)}">🧠 Quiz me on all ${dd.questions.length} questions</a>
          ${opts.related ? `<a class="btn ghost wide" href="#/feed/${esc(opts.related.id)}/0">${esc(opts.related.emoji)} Swipe the quick cards: ${esc(opts.related.title)}</a>` : ''}
          ${others.length ? `<h3 class="sec">More deep dives</h3><div class="dd-more">${others.map((o) => `
            <a class="dd-more-i" href="#/deep/${esc(o.id)}" style="--accent:${o.color}"><span>${esc(o.emoji)}</span><b>${md(o.title)}</b></a>`).join('')}</div>` : ''}
        </div>
      </div>`;
  }

  return { render, minutes, totalMinutes, words };
})();
