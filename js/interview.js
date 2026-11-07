/* Renders a mock interview (long-form, phase by phase). Event handling lives in app.js (IV). */
window.Interview = (() => {
  'use strict';
  const { esc, md } = Cards;

  const CALLOUT = { tip: ['💡', 'Tip'], warn: ['⚠️', 'Careful'], trap: ['🪤', 'Trap'], key: ['🔑', 'Key insight'] };

  const KW = {
    python: 'def class return if elif else for while in import from as with async await try except finally raise yield lambda not and or is None True False pass break continue global self',
    go: 'func package import return if else for range switch case default go defer chan select struct interface map type var const nil true false break continue',
    nginx: 'upstream server location listen proxy_pass proxy_set_header proxy_http_version proxy_connect_timeout proxy_read_timeout proxy_next_upstream proxy_next_upstream_tries least_conn keepalive weight max_fails fail_timeout backup server_name ssl_certificate ssl_certificate_key http2 ssl on',
    haproxy: 'frontend backend mode bind default_backend balance option server check default-server inter rise fall tcp http tcp-check roundrobin leastconn',
    conf: 'vrrp_instance vrrp_script state interface virtual_router_id priority advert_int virtual_ipaddress track_script script interval weight MASTER BACKUP',
    json: 'true false null',
    http: 'GET POST PUT PATCH DELETE HTTP Host',
    text: '',
  };
  const KWSET = Object.fromEntries(Object.entries(KW).map(([k, v]) => [k, new Set(v.split(' ').filter(Boolean))]));

  // Tiny tokenizer: comments, strings, numbers, keywords. Everything else is escaped as-is.
  function highlight(code, lang) {
    const kw = KWSET[lang] || new Set();
    const re = /(#[^\n]*|\/\/[^\n]*)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')|(\b\d[\d_.]*\b)|([A-Za-z_][\w-]*)/g;
    let out = '', last = 0, m;
    while ((m = re.exec(code))) {
      out += esc(code.slice(last, m.index));
      const [tok, cm, str, num, word] = m;
      if (cm && lang !== 'json') out += `<span class="cm">${esc(cm)}</span>`;
      else if (str) out += `<span class="st">${esc(str)}</span>`;
      else if (num) out += `<span class="nu">${esc(num)}</span>`;
      else if (word && kw.has(word)) out += `<span class="kw">${esc(word)}</span>`;
      else out += esc(tok);
      last = re.lastIndex;
    }
    return out + esc(code.slice(last));
  }

  const paras = (s) => String(s || '').split(/\n{2,}/).map((p) => `<p>${md(p)}</p>`).join('');

  function reveal(inner, practice, cover, extraCls = '') {
    if (!practice) return `<div class="${extraCls}">${inner}</div>`;
    return `<div class="rv hide ${extraCls}" data-iv="reveal" role="button" tabindex="0">
      <div class="rv-cover">${cover}</div><div class="rv-body">${inner}</div></div>`;
  }

  function block(b, ctx) {
    switch (b.type) {
      case 'say': {
        const me = b.who === 'me';
        const who = me ? '🙋 You' : esc(ctx.iv.interviewer || '🧑‍💼 Interviewer');
        if (me) return `<div class="iv-say me"><div class="who">${who}</div>${reveal(paras(b.text), ctx.practice, '🙈 Answer out loud first, then tap to compare', 'bub me')}</div>`;
        return `<div class="iv-say them"><div class="who">${who}</div><div class="bub them">${paras(b.text)}</div></div>`;
      }
      case 'think':
        return `<div class="iv-think"><span>💭</span><div>${paras(b.text)}</div></div>`;
      case 'text':
        return `<div class="iv-text">${paras(b.md || b.text)}</div>`;
      case 'list': {
        const tag = b.ordered ? 'ol' : 'ul';
        const items = (b.items || []).map((it) => typeof it === 'string'
          ? `<li>${md(it)}</li>`
          : `<li><b>${md(it.title)}</b>${it.text ? ` ${md(it.text)}` : ''}</li>`).join('');
        return `<div class="iv-list">${b.title ? `<h4>${md(b.title)}</h4>` : ''}<${tag}>${items}</${tag}></div>`;
      }
      case 'table':
        return `<div class="iv-table">${b.title ? `<h4>${md(b.title)}</h4>` : ''}<div class="tbl-scroll"><table data-cols="${(b.head || []).length}">
          <thead><tr>${(b.head || []).map((h) => `<th>${md(h)}</th>`).join('')}</tr></thead>
          <tbody>${(b.rows || []).map((r) => `<tr>${r.map((c, i) => (i === 0 ? `<th scope="row">${md(c)}</th>` : `<td>${md(c)}</td>`)).join('')}</tr>`).join('')}</tbody>
        </table></div></div>`;
      case 'code':
        return `<figure class="iv-code">
          <figcaption><span class="t">${md(b.title || '')}</span><span class="lang">${esc(b.lang || '')}</span><button class="copy" data-iv="copy">Copy</button></figcaption>
          <pre><code>${highlight(String(b.code || ''), b.lang || 'text')}</code></pre>
          ${b.caption ? `<p class="cap">${md(b.caption)}</p>` : ''}</figure>`;
      case 'diagram':
        return `<figure class="iv-dia">${b.title ? `<h4>${md(b.title)}</h4>` : ''}
          <div class="dia-wrap">${Diagram.render(b.diagram || { nodes: [] })}</div>
          ${b.caption ? `<p class="cap">${md(b.caption)}</p>` : ''}</figure>`;
      case 'callout': {
        const [icon, label] = CALLOUT[b.tone] || CALLOUT.tip;
        return `<div class="iv-callout tone-${esc(b.tone || 'tip')}"><b>${icon} ${md(b.title || label)}</b>${paras(b.text)}</div>`;
      }
      case 'quiz':
        return `<div class="iv-quiz">${Cards.quizBlock(b.key, b, '🧠 Checkpoint', false)}</div>`;
      case 'yourturn': {
        const ans = paras(b.answer) + (b.points ? `<ul>${b.points.map((p) => `<li>${md(p)}</li>`).join('')}</ul>` : '');
        return `<div class="iv-yt"><div class="label">🎤 Your turn</div><p class="yt-q">${md(b.prompt)}</p>
          ${reveal(`<div class="yt-a">${ans}</div>`, ctx.practice, '🧠 Think it through, then tap for a model answer')}</div>`;
      }
      case 'deep':
        return `<details class="iv-deep"><summary>🔍 ${md(b.title || 'Go deeper')}</summary>
          <div class="iv-deep-body">${(b.blocks || []).map((x) => block(x, ctx)).join('')}</div></details>`;
      default:
        return `<div class="iv-text">${paras(b.text || '')}</div>`;
    }
  }

  function phaseHtml(ph, ctx) {
    const done = !!ctx.state.done[ph.id];
    return `
      <section class="iv-phase" id="ph-${esc(ph.id)}" data-p="${esc(ph.id)}">
        <div class="iv-ph-head">
          <span class="iv-time">${ph.time ? `⏱ ${esc(ph.time)} min` : '⭐ Bonus'}</span>
          <h2>${md(ph.title)}</h2>
          ${ph.goal ? `<p class="iv-goal">🎯 ${md(ph.goal)}</p>` : ''}
        </div>
        ${(ph.blocks || []).map((b) => block(b, ctx)).join('')}
        <button class="btn ${done ? 'ghost' : 'primary'} wide iv-done" data-iv="done" data-p="${esc(ph.id)}">${done ? '✅ Phase done (tap to undo)' : 'Mark phase done ✓'}</button>
      </section>`;
  }

  function render(iv, state) {
    const ctx = { iv, state, practice: state.mode !== 'read' };
    const done = iv.phases.filter((p) => state.done[p.id]).length;
    return `
      <div class="iv-wrap" style="--accent:${iv.color}">
        <a class="iv-back" href="#/topics">← Topics</a>
        <header class="iv-hero">
          <div class="hook-emoji">${esc(iv.emoji)}</div>
          <div class="kicker">Mock interview · ${esc(iv.duration || 45)} min · ${esc(iv.level || '')}</div>
          <h1>${md(iv.title)}</h1>
          ${iv.intro ? `<div class="iv-intro">${paras(iv.intro)}</div>` : ''}
          <div class="bar"><i style="width:${Math.round((done / iv.phases.length) * 100)}%"></i></div>
          <div class="tile-m">${done}/${iv.phases.length} phases done</div>
        </header>
        <div class="iv-bar">
          <div class="iv-bar-row">
            <div class="seg2">
              <button class="${ctx.practice ? 'on' : ''}" data-iv="mode" data-m="practice">🙈 Practice</button>
              <button class="${ctx.practice ? '' : 'on'}" data-iv="mode" data-m="read">👀 Read</button>
            </div>
            <button class="iv-timer" data-iv="timer">⏱ Start 45:00</button>
          </div>
          <nav class="iv-nav">${iv.phases.map((p) => `<button class="${state.done[p.id] ? 'done' : ''}" data-iv="jump" data-p="${esc(p.id)}">${p.time ? esc(p.time.split('–')[0]) + '′ ' : '⭐ '}${md(p.nav || p.title)}</button>`).join('')}</nav>
        </div>
        ${iv.phases.map((p) => phaseHtml(p, ctx)).join('')}
        <a class="btn ghost wide" href="#/quiz/${esc(iv.id)}">🧠 Quiz me on all ${iv.questions.length} checkpoint questions</a>
      </div>`;
  }

  return { render, highlight };
})();
