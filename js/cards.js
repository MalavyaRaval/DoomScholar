/* Card renderers. Each card type in content/ maps to one function below. */
window.Cards = (() => {
  'use strict';

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Tiny markdown: **bold**, *italic*, `code`, ==highlight==, newlines.
  function md(s) {
    let h = esc(s);
    h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
    h = h.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    h = h.replace(/==([^=]+)==/g, '<mark>$1</mark>');
    h = h.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, '$1<i>$2</i>');
    return h.replace(/\n/g, '<br>');
  }

  const A = (cls, i) => ` class="${cls} anim" style="--d:${i}"`;
  const LETTERS = 'ABCDEFGH';

  const ICON = {
    heart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>',
    share: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>',
  };

  const R = {
    hook: (c, t) => `
      <div class="hook">
        <div${A('hook-emoji', 0)}>${esc(c.emoji || t.emoji)}</div>
        <div${A('kicker', 1)}>${esc(t.category)} · ${t.cards.length} cards</div>
        <h1${A('', 2)}>${md(c.title || t.title)}</h1>
        ${c.text ? `<p${A('lead', 3)}>${md(c.text)}</p>` : ''}
      </div>
      <div class="swipe-hint" aria-hidden="true"><span>↑</span>swipe</div>`,

    meme: (c) => `
      <div${A('meme', 0)}>
        ${c.top ? `<div class="meme-txt top">${esc(c.top)}</div>` : ''}
        <div class="meme-emoji">${esc(c.emoji || '🤔')}</div>
        ${c.bottom ? `<div class="meme-txt bottom">${esc(c.bottom)}</div>` : ''}
      </div>
      ${c.caption ? `<p${A('caption', 1)}>${md(c.caption)}</p>` : ''}`,

    drake: (c) => `
      ${c.title ? `<h2${A('', 0)}>${md(c.title)}</h2>` : ''}
      <div${A('drake', 1)}>
        <div class="dk-face no">${esc(c.noEmoji || '🙅')}</div><div class="dk-txt no"><span>${md(c.no)}</span></div>
        <div class="dk-face yes">${esc(c.yesEmoji || '😎')}</div><div class="dk-txt yes"><span>${md(c.yes)}</span></div>
      </div>
      ${c.caption ? `<p${A('caption', 2)}>${md(c.caption)}</p>` : ''}`,

    brain: (c) => `
      ${c.title ? `<h2${A('', 0)}>${md(c.title)}</h2>` : ''}
      <div class="brain">
        ${(c.levels || []).map((l, i, all) => `
          <div${A('br-row', i + 1)}>
            <div class="br-txt"><span>${md(l)}</span></div>
            <div class="br-pic" style="--lvl:${all.length > 1 ? i / (all.length - 1) : 1}"><span>🧠</span></div>
          </div>`).join('')}
      </div>`,

    chat: (c) => `
      ${c.title ? `<h2${A('', 0)}>${md(c.title)}</h2>` : ''}
      <div class="chat">
        <div${A('chat-head', 1)}><span class="av">${esc(c.themEmoji || '🧑‍💼')}</span>${esc(c.them || 'Interviewer')}</div>
        ${(c.messages || []).map((m, i) => `<div${A('bub ' + (m.from === 'me' ? 'me' : 'them'), i + 2)}>${md(m.text)}</div>`).join('')}
      </div>`,

    concept: (c) => `
      ${c.emoji ? `<div${A('big-emoji', 0)}>${esc(c.emoji)}</div>` : ''}
      ${c.title ? `<h2${A('', 1)}>${md(c.title)}</h2>` : ''}
      ${c.body ? `<p${A('body', 2)}>${md(c.body)}</p>` : ''}
      ${c.bullets ? `<ul class="bullets">${c.bullets.map((b, i) => `<li${A('', i + 3)}>${md(b)}</li>`).join('')}</ul>` : ''}`,

    analogy: (c) => `
      <div${A('label', 0)}>🧩 Think of it like…</div>
      <div${A('big-emoji xl', 1)}>${esc(c.emoji || '💡')}</div>
      ${c.title ? `<h2${A('', 2)}>${md(c.title)}</h2>` : ''}
      <p${A('body', 3)}>${md(c.body)}</p>`,

    diagram: (c) => `
      ${c.title ? `<h2${A('', 0)}>${md(c.title)}</h2>` : ''}
      <div${A('dia-wrap', 1)}>${window.Diagram ? Diagram.render(c.diagram || { nodes: [] }) : ''}</div>
      ${c.caption ? `<p${A('caption', 2)}>${md(c.caption)}</p>` : ''}`,

    compare: (c) => {
      const side = (s, k, i) => `
        <div${A('cmp-col ' + k, i)}>
          <div class="cmp-head">${s.emoji ? `<span>${esc(s.emoji)}</span>` : ''}<span>${md(s.title)}</span></div>
          <ul>${(s.points || []).map((p) => `<li>${md(p)}</li>`).join('')}</ul>
        </div>`;
      return `
        ${c.title ? `<h2${A('', 0)}>${md(c.title)}</h2>` : ''}
        <div class="cmp">${side(c.left || {}, 'l', 1)}${side(c.right || {}, 'r', 2)}</div>
        ${c.caption ? `<p${A('caption', 3)}>${md(c.caption)}</p>` : ''}`;
    },

    list: (c) => `
      ${c.title ? `<h2${A('', 0)}>${md(c.title)}</h2>` : ''}
      <div class="items">
        ${(c.items || []).map((it, i) => `
          <div${A('item', i + 1)}>
            <div class="item-emoji">${esc(it.emoji || '•')}</div>
            <div><div class="item-t">${md(it.title)}</div>${it.text ? `<div class="item-x">${md(it.text)}</div>` : ''}</div>
          </div>`).join('')}
      </div>`,

    steps: (c) => `
      ${c.title ? `<h2${A('', 0)}>${md(c.title)}</h2>` : ''}
      <ol class="steps">${(c.steps || []).map((s, i) => `<li${A('', i + 1)}><span class="n">${i + 1}</span><span>${md(s)}</span></li>`).join('')}</ol>`,

    numbers: (c) => `
      ${c.title ? `<h2${A('', 0)}>${md(c.title)}</h2>` : ''}
      <div class="stats">${(c.stats || []).map((s, i) => `<div${A('stat', i + 1)}><div class="v">${esc(s.value)}</div><div class="k">${md(s.label)}</div></div>`).join('')}</div>
      ${c.caption ? `<p${A('caption', (c.stats || []).length + 1)}>${md(c.caption)}</p>` : ''}`,

    code: (c) => `
      ${c.title ? `<h2${A('', 0)}>${md(c.title)}</h2>` : ''}
      <pre${A('code', 1)}><code>${String(c.code || '').split('\n').map((l) =>
        /^\s*(#|\/\/|--)/.test(l) ? `<span class="cm">${esc(l)}</span>` : esc(l)).join('\n')}</code></pre>
      ${c.caption ? `<p${A('caption', 2)}>${md(c.caption)}</p>` : ''}`,

    tip: (c) => `
      <div${A('label', 0)}>${esc(c.label || '💡 Interview tip')}</div>
      <blockquote${A('tip', 1)}>${md(c.text)}</blockquote>`,

    quiz: (c, t, i) => quizBlock(`${t.id}#${i}`, c, '🧠 Quick check', true),

    tldr: (c, t) => {
      const iv = (window.INTERVIEWS || []).find((x) => x.related === t.id);
      return `
      <div${A('label', 0)}>⚡ TL;DR</div>
      <h2${A('', 1)}>${md(c.title || t.title + ' in 10 seconds')}</h2>
      <ul class="checks">${(c.points || []).map((p, i) => `<li${A('', i + 2)}>${md(p)}</li>`).join('')}</ul>
      <div${A('cta', (c.points || []).length + 2)}>
        <button class="btn primary" data-act="quiz-topic" data-t="${esc(t.id)}">🧠 Quiz me on this</button>
        ${iv ? `<a class="btn warn" href="#/interview/${esc(iv.id)}">🎤 Mock interview</a>` : ''}
        <button class="btn ghost" data-act="next">Next topic ↓</button>
      </div>`;
    },
  };

  // Shared by quiz cards and interview checkpoints. Answers persist via Store.answerOf(key).
  function quizBlock(key, c, label, anim) {
    const a = (cls, i) => (anim ? A(cls, i) : ` class="${cls}"`);
    const pick = Store.answerOf(key);
    const done = pick != null;
    const right = done && pick === c.answer;
    return `
        <div${a('label', 0)}>${label}</div>
        <h2${a('q', 1)}>${md(c.q)}</h2>
        <div class="opts">${(c.options || []).map((o, n) => `
          <button${a('opt' + (done ? (n === c.answer ? ' right' : n === pick ? ' wrong' : ' dim') : ''), n + 2)} data-act="opt" data-k="${esc(key)}" data-n="${n}"${done ? ' disabled' : ''}>
            <span class="opt-l">${LETTERS[n]}</span><span>${md(o)}</span>
          </button>`).join('')}
        </div>
        <div class="explain${done ? ' show' : ''}">
          <b class="verdict">${done ? (right ? '✅ Nailed it.' : '❌ Not quite.') : ''}</b> ${md(c.explain || '')}
        </div>`;
  }

  function foot(t, i) {
    const key = `${t.id}#${i}`;
    return `
      <footer class="card-foot">
        <button class="chip" data-act="goto-topic" data-t="${esc(t.id)}">
          <span>${esc(t.emoji)}</span><span class="chip-t">${esc(t.short || t.title)}</span><span class="chip-n">${i + 1}/${t.cards.length}</span>
        </button>
        <div class="acts">
          <button class="act save${Store.isSaved(key) ? ' on' : ''}" data-act="save" data-k="${esc(key)}" aria-label="Save card">${ICON.heart}</button>
          <button class="act" data-act="share" data-k="${esc(key)}" aria-label="Share card">${ICON.share}</button>
        </div>
      </footer>`;
  }

  function render(t, c, i) {
    const fn = R[c.type] || R.concept;
    return `
      <article class="card ty-${esc(c.type)}" data-t="${esc(t.id)}" data-i="${i}" style="--accent:${t.color}">
        <div class="card-body">${fn(c, t, i)}</div>
        ${foot(t, i)}
      </article>`;
  }

  function loopCard(round, n) {
    return `
      <article class="card ty-hook ty-loop" style="--accent:#f59e0b">
        <div class="card-body">
          <div class="hook">
            <div${A('hook-emoji', 0)}>🏆</div>
            <div${A('kicker', 1)}>Lap ${round} complete</div>
            <h1${A('', 2)}>You scrolled through all ${n} topics.</h1>
            <p${A('lead', 3)}>Most people doomscroll for nothing. You learned system design. Round ${round + 1} starts below. Repetition is how it sticks.</p>
            <div${A('cta', 4)}><button class="btn primary" data-act="goto-tab" data-tab="quiz">🧠 Test yourself</button></div>
          </div>
        </div>
      </article>`;
  }

  return { render, loopCard, quizBlock, md, esc, ICON, types: Object.keys(R), LETTERS };
})();
