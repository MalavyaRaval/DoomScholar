(() => {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const { esc, md, LETTERS } = Cards;
  const App = { topics: [], byId: {} };
  const HEX = /^#[0-9a-f]{3,8}$/i;

  /* ---------------- boot ---------------- */

  function loadContent() {
    const files = window.CONTENT_FILES || [];
    return Promise.all(files.map((f) => new Promise((res) => {
      const s = document.createElement('script');
      s.src = 'content/' + f;
      s.async = false; // execute in manifest order
      s.onload = res;
      s.onerror = () => { console.warn('Could not load content file', f); res(); };
      document.head.appendChild(s);
    })));
  }

  function prepareTopics() {
    const custom = Store.decks().map((t) => ({ ...t, category: 'Your decks', custom: true }));
    App.topics = [...(window.TOPICS || []), ...custom]
      .filter((t) => t && t.id && Array.isArray(t.cards) && t.cards.length)
      .map((t) => {
        t.color = HEX.test(t.color || '') ? t.color : '#8b5cf6';
        t.emoji = t.emoji || '📘';
        t.category = t.category || 'Topics';
        t.questions = [];
        t.cards.forEach((c, i) => { if (c.type === 'quiz') t.questions.push({ ...c, key: `${t.id}#${i}`, t: t.id }); });
        (t.quiz || []).forEach((q, j) => t.questions.push({ ...q, key: `${t.id}#q${j}`, t: t.id }));
        return t;
      });
    App.byId = Object.fromEntries(App.topics.map((t) => [t.id, t]));

    // Mock interviews: number every checkpoint quiz (including ones nested in "Go deeper").
    App.interviews = (window.INTERVIEWS || []).filter((iv) => iv.id && iv.title && iv.phases && iv.phases.length).map((iv) => {
      iv.color = HEX.test(iv.color || '') ? iv.color : '#8b5cf6';
      iv.emoji = iv.emoji || '🎤';
      iv.questions = [];
      let n = 0;
      const walk = (blocks) => (blocks || []).forEach((b) => {
        if (b.type === 'quiz') { b.key = `${iv.id}#${n++}`; iv.questions.push({ ...b, t: iv.id }); }
        if (b.type === 'deep') walk(b.blocks);
      });
      iv.phases.forEach((p) => walk(p.blocks));
      return iv;
    });
    App.ivById = Object.fromEntries(App.interviews.map((iv) => [iv.id, iv]));
    App.src = { ...App.ivById, ...App.byId }; // anything that owns quiz questions
  }

  function findQuestion(key) {
    const [tid] = key.split('#');
    return App.src[tid]?.questions.find((q) => q.key === key);
  }

  async function boot() {
    await loadContent();
    prepareTopics();
    if (new URLSearchParams(location.search).has('audit')) return runAudit();
    if (!App.topics.length) { $('#view-feed').innerHTML = '<p class="empty">No content found. Check content/manifest.js.</p>'; return; }
    bindGlobal();
    updateStats();
    Feed.init();
    route();
    window.addEventListener('hashchange', route);
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  /* ---------------- routing ---------------- */

  const TABS = ['feed', 'topics', 'quiz', 'saved'];
  const VIEWS = [...TABS, 'interview'];
  let currentTab = null;

  function route() {
    const parts = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
    if (parts[0] === 'interview' && App.ivById[parts[1]]) return show('interview', { id: parts[1] });
    let tab = TABS.includes(parts[0]) ? parts[0] : 'feed';
    if (tab === 'feed' && parts[1] && App.byId[parts[1]]) {
      Feed.start(parts[1], +parts[2] || 0);
      history.replaceState(null, '', '#/feed');
    }
    if (tab === 'quiz' && parts[1] && (App.src[parts[1]] || parts[1] === 'mistakes')) {
      history.replaceState(null, '', '#/quiz');
      show('quiz', { pre: parts[1] });
      return;
    }
    show(tab);
  }

  function show(tab, opts = {}) {
    currentTab = tab;
    VIEWS.forEach((t) => { $('#view-' + t).hidden = t !== tab; });
    const navTab = tab === 'interview' ? 'topics' : tab;
    $$('.tabbar a').forEach((a) => a.classList.toggle('on', a.dataset.tab === navTab));
    document.body.dataset.tab = tab;
    if (tab === 'topics') Topics.render();
    if (tab === 'quiz') Quiz.enter(opts.pre);
    if (tab === 'saved') Saved.render();
    if (tab === 'feed') { Feed.applyScroll(); Feed.refreshSaved(); }
    if (tab === 'interview') IV.open(opts.id);
  }

  function go(tab, sub) { location.hash = '#/' + tab + (sub ? '/' + encodeURIComponent(sub) : ''); }

  /* ---------------- shared UI ---------------- */

  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
    clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 1800);
  }

  function updateStats(bump) {
    const s = Store.get();
    $('#streak').textContent = '🔥 ' + Store.streak();
    $('#xp').textContent = '⚡ ' + s.xp;
    if (bump) { const x = $('#xp'); x.classList.remove('bump'); void x.offsetWidth; x.classList.add('bump'); }
  }

  function buzz(ms) { try { navigator.vibrate?.(ms); } catch { /* unsupported */ } }

  function heartBurst(x, y) {
    const h = document.createElement('div');
    h.className = 'burst'; h.textContent = '❤️';
    h.style.left = x + 'px'; h.style.top = y + 'px';
    document.body.appendChild(h);
    setTimeout(() => h.remove(), 900);
  }

  function setSaved(key, on) {
    const v = Store.toggleSave(key, on);
    $$(`[data-act="save"][data-k="${CSS.escape(key)}"]`).forEach((b) => b.classList.toggle('on', v));
    return v;
  }

  async function share(key) {
    const [tid, i] = key.split('#');
    const t = App.byId[tid]; const c = t?.cards[+i];
    if (!t) return;
    const url = location.origin + location.pathname + `#/feed/${encodeURIComponent(tid)}/${i}`;
    const what = (c.title || c.q || c.top || t.title).replace(/[*=`]/g, '');
    const data = { title: 'DoomScholar', text: `${t.emoji} ${t.title}: ${what}`, url };
    try {
      if (navigator.share) await navigator.share(data);
      else { await navigator.clipboard.writeText(`${data.text}\n${url}`); toast('Link copied 📋'); }
    } catch { /* cancelled */ }
  }

  function bindGlobal() {
    const main = $('main');

    main.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      if (act === 'save') { const on = setSaved(b.dataset.k); toast(on ? 'Saved ❤️' : 'Removed from saved'); buzz(10); }
      else if (act === 'share') share(b.dataset.k);
      else if (act === 'opt') answerFeedQuiz(b);
      else if (act === 'quiz-topic') go('quiz', b.dataset.t);
      else if (act === 'goto-tab') go(b.dataset.tab);
      else if (act === 'goto-topic') Topics.sheet(b.dataset.t);
      else if (act === 'next') { const sc = b.closest('.feed'); sc?.scrollBy({ top: sc.clientHeight, behavior: 'smooth' }); }
    });

    // Double-tap a card to save it (like the other apps).
    let last = { t: 0, x: 0, y: 0 };
    main.addEventListener('pointerup', (e) => {
      const card = e.target.closest('.card');
      if (!card || e.target.closest('button, a, input, textarea') || !card.dataset.t) return;
      const now = Date.now();
      if (now - last.t < 320 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 40) {
        setSaved(`${card.dataset.t}#${card.dataset.i}`, true);
        heartBurst(e.clientX, e.clientY); buzz(15);
        last.t = 0;
      } else last = { t: now, x: e.clientX, y: e.clientY };
    });

    document.addEventListener('keydown', (e) => {
      if (e.target.matches?.('input, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
      const sc = currentTab === 'feed' ? Feed.el : currentTab === 'saved' ? $('#view-saved .feed') : null;
      if (!sc) return;
      if (['ArrowDown', 'j', ' ', 'PageDown'].includes(e.key)) { e.preventDefault(); sc.scrollBy({ top: sc.clientHeight, behavior: 'smooth' }); }
      if (['ArrowUp', 'k', 'PageUp'].includes(e.key)) { e.preventDefault(); sc.scrollBy({ top: -sc.clientHeight, behavior: 'smooth' }); }
    });

    // Mouse wheel / trackpad on desktop: one card per notch or swipe. Native wheel scrolling in a
    // mandatory-snap feed moves ~100px and then snaps straight back to the same card.
    let acc = 0, lastWheel = 0, lastAbs = 0, lockedUntil = 0, inertia = false;
    main.addEventListener('wheel', (e) => {
      const sc = e.target.closest('.feed');
      if (!sc || e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return; // ctrl+wheel = zoom
      // A card whose text overflows scrolls itself first, then hands over to the feed.
      const body = e.target.closest('.card-body');
      if (body && body.scrollHeight > body.clientHeight + 1) {
        const atTop = body.scrollTop <= 0;
        const atEnd = body.scrollTop + body.clientHeight >= body.scrollHeight - 1;
        if ((e.deltaY > 0 && !atEnd) || (e.deltaY < 0 && !atTop)) return;
      }
      e.preventDefault();
      const dy = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaY;
      const now = performance.now();
      const gap = now - lastWheel;
      const abs = Math.abs(dy);
      const rising = abs > lastAbs;
      lastWheel = now; lastAbs = abs;
      // After a card change, trackpads keep streaming a decaying "momentum" tail. Ignore it until
      // the user pauses or pushes again (deltas grow), so one swipe = one card.
      if (gap > 300) inertia = false;
      if (now < lockedUntil) return;
      if (inertia && !rising) return;
      inertia = false;
      if (gap > 250) acc = 0;
      acc += dy;
      if (Math.abs(acc) >= 40) {
        sc.scrollBy({ top: Math.sign(acc) * sc.clientHeight, behavior: 'smooth' });
        acc = 0;
        lockedUntil = now + 450;
        inertia = true;
      }
    }, { passive: false });

    $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal' || e.target.closest('[data-close]')) closeModal(); });
  }

  function answerFeedQuiz(btn) {
    const key = btn.dataset.k, n = +btn.dataset.n;
    const q = findQuestion(key);
    if (!q || Store.answerOf(key) != null) return;
    const correct = n === q.answer;
    const xp = Store.record(key, n, correct, true);
    const card = btn.closest('.card, .iv-quiz');
    $$('.opt', card).forEach((o, k) => {
      o.disabled = true;
      o.classList.add(k === q.answer ? 'right' : k === n ? 'wrong' : 'dim');
    });
    const ex = $('.explain', card);
    $('.verdict', ex).textContent = correct ? `✅ Nailed it. +${xp} XP` : '❌ Not quite.';
    ex.classList.add('show');
    buzz(correct ? 20 : [30, 40, 30]);
    updateStats(correct);
  }

  function openModal(html) { const m = $('#modal'); m.innerHTML = `<div class="sheet">${html}</div>`; m.hidden = false; }
  function closeModal() { const m = $('#modal'); m.hidden = true; m.innerHTML = ''; }

  /* ---------------- feed ---------------- */

  const Feed = {
    el: null, order: [], next: 0, laps: 0, io: null,

    init() {
      this.el = $('#view-feed');
      this.io = new IntersectionObserver((es) => this.onSee(es), { root: this.el, threshold: 0.6 });
      const lp = Store.get().lastPos;
      if (lp && App.byId[lp.t]) this.start(lp.t, lp.i);
      else this.start(App.topics[0].id, 0);
    },

    start(tid, index = 0) {
      this.el.innerHTML = '';
      const ids = App.topics.map((t) => t.id);
      const s = Math.max(0, ids.indexOf(tid));
      this.order = [...ids.slice(s), ...ids.slice(0, s)];
      this.next = 0; this.laps = 0;
      this.append();
      const t = App.byId[tid];
      const i = Math.max(0, Math.min(index, t.cards.length - 1));
      this.pending = $(`.card[data-t="${CSS.escape(tid)}"][data-i="${i}"]`, this.el);
      this.applyScroll();
    },

    // A hidden (display:none) feed can't be scrolled, so remember the target until it's shown.
    applyScroll() {
      if (!this.pending || this.el.hidden) return;
      this.el.scrollTop = this.pending.offsetTop;
      this.pending = null;
    },

    append() {
      if (this.next >= this.order.length) {
        this.next = 0; this.laps++;
        this.el.insertAdjacentHTML('beforeend', Cards.loopCard(this.laps, this.order.length));
      }
      const t = App.byId[this.order[this.next++]];
      this.el.insertAdjacentHTML('beforeend', t.cards.map((c, i) => Cards.render(t, c, i)).join(''));
      $$('.card:not([data-obs])', this.el).forEach((c) => {
        c.dataset.obs = 1;
        this.io.observe(c);
        $('svg.dia', c)?.pauseAnimations?.();
      });
    },

    onSee(entries) {
      for (const e of entries) {
        const card = e.target, svg = $('svg.dia', card);
        if (e.isIntersecting) { card.classList.add('active'); svg?.unpauseAnimations?.(); this.current(card); }
        else { card.classList.remove('active'); svg?.pauseAnimations?.(); }
      }
    },

    current(card) {
      const kids = this.el.children;
      // Keep the scroll endless: add the next topic when we get near the bottom.
      if (kids.length - Array.prototype.indexOf.call(kids, card) <= 4) this.append();
      const tid = card.dataset.t; if (!tid) return;
      const i = +card.dataset.i, t = App.byId[tid];
      if (Store.markSeen(tid, i)) updateStats();
      Store.setLastPos(tid, i);
      $('#progress').style.setProperty('--p', ((i + 1) / t.cards.length).toFixed(3));
      $('#progress').style.setProperty('--accent', t.color);
    },

    refreshSaved() {
      if (!this.el) return;
      $$('[data-act="save"]', this.el).forEach((b) => b.classList.toggle('on', Store.isSaved(b.dataset.k)));
    },
  };

  /* ---------------- topics ---------------- */

  const Topics = {
    render() {
      const el = $('#view-topics');
      const s = Store.get();
      const total = App.topics.reduce((a, t) => a + t.cards.length, 0);
      const acc = s.quiz.total ? Math.round((s.quiz.right / s.quiz.total) * 100) + '%' : '–';
      const cats = [...new Set(App.topics.map((t) => t.category))].filter((c) => c !== 'Your decks');
      const tile = (t) => {
        const seen = Store.seenCount(t.id), pct = Math.round((seen / t.cards.length) * 100);
        const best = s.quiz.best[t.id];
        return `
          <button class="tile" data-go="${esc(t.id)}" style="--accent:${t.color}">
            <span class="tile-emoji">${esc(t.emoji)}</span>
            <span class="tile-t">${esc(t.title)}</span>
            <span class="tile-x">${esc(t.tagline || '')}</span>
            <span class="bar"><i style="width:${pct}%"></i></span>
            <span class="tile-m">${pct === 100 ? '✅ done' : `${seen}/${t.cards.length} seen`}${best != null ? ` · 🎯 ${best}%` : ''}</span>
            ${t.custom ? `<span class="tile-del" data-del="${esc(t.id)}" role="button" aria-label="Delete deck">✕</span>` : ''}
          </button>`;
      };
      el.innerHTML = `
        <div class="page-in">
          <h1 class="page-title">Your brain, <span>leveling up</span></h1>
          <div class="kpis">
            <div class="kpi"><b>🔥 ${Store.streak()}</b><span>day streak</span></div>
            <div class="kpi"><b>⚡ ${s.xp}</b><span>XP</span></div>
            <div class="kpi"><b>👀 ${Store.totalSeen()}</b><span>of ${total} cards</span></div>
            <div class="kpi"><b>🎯 ${acc}</b><span>quiz accuracy</span></div>
          </div>
          <div class="row">
            <button class="btn primary" data-a="continue">▶ Keep scrolling</button>
            <button class="btn ghost" data-a="random">🎲 Surprise me</button>
          </div>
          ${App.interviews.length ? `<h3 class="sec">🎤 Mock interviews</h3><div class="tiles">${App.interviews.map((iv) => {
            const st = Store.ivState(iv.id);
            const done = iv.phases.filter((p) => st.done[p.id]).length;
            return `
            <a class="tile iv-tile" href="#/interview/${esc(iv.id)}" style="--accent:${iv.color}">
              <span class="tile-emoji">${esc(iv.emoji)}</span>
              <span class="tile-t">${esc(iv.title)}</span>
              <span class="tile-x">${esc(iv.tagline || '')}</span>
              <span class="bar"><i style="width:${Math.round((done / iv.phases.length) * 100)}%"></i></span>
              <span class="tile-m">${esc(iv.duration || 45)} min · ${done}/${iv.phases.length} phases · ${iv.questions.length} checkpoints</span>
            </a>`;
          }).join('')}</div>` : ''}
          ${cats.map((c) => `<h3 class="sec">${esc(c)}</h3><div class="tiles">${App.topics.filter((t) => t.category === c).map(tile).join('')}</div>`).join('')}
          <h3 class="sec">Learn anything</h3>
          <div class="tiles">
            ${App.topics.filter((t) => t.custom).map(tile).join('')}
            <button class="tile add" data-a="import"><span class="tile-emoji">➕</span><span class="tile-t">Add a deck</span><span class="tile-x">Any topic: Kubernetes, React, ML… made by AI, pasted here</span></button>
          </div>
          <p class="fine">Progress is saved on this device only. <button class="linkish" data-a="reset">Reset progress</button></p>
        </div>`;
      el.onclick = (e) => {
        const del = e.target.closest('[data-del]');
        if (del) { e.stopPropagation(); return Importer.remove(del.dataset.del); }
        const g = e.target.closest('[data-go]');
        if (g) { Feed.start(g.dataset.go, 0); return go('feed'); }
        const a = e.target.closest('[data-a]')?.dataset.a;
        if (a === 'continue') go('feed');
        if (a === 'random') { const t = App.topics[Math.floor(Math.random() * App.topics.length)]; Feed.start(t.id, 0); go('feed'); }
        if (a === 'import') Importer.open();
        if (a === 'reset' && confirm('Reset all progress, XP, saved cards and quiz history on this device?')) {
          Store.reset(); updateStats(); Topics.render(); Feed.refreshSaved();
        }
      };
    },

    // Bottom sheet when tapping the topic chip on a card.
    sheet(tid) {
      const t = App.byId[tid]; if (!t) return;
      openModal(`
        <div class="sheet-h"><span class="tile-emoji">${esc(t.emoji)}</span><div><b>${esc(t.title)}</b><small>${esc(t.tagline || '')}</small></div></div>
        <div class="sheet-acts">
          <button class="btn primary" data-s="restart">↺ Restart this topic</button>
          <button class="btn ghost" data-s="quiz">🧠 Quiz on ${esc(t.title)}</button>
          <button class="btn ghost" data-s="skip">⏭ Skip to next topic</button>
          <button class="btn ghost" data-close>Close</button>
        </div>`);
      $('#modal .sheet').onclick = (e) => {
        const s = e.target.closest('[data-s]')?.dataset.s; if (!s) return;
        closeModal();
        if (s === 'restart') { Feed.start(tid, 0); go('feed'); }
        if (s === 'quiz') go('quiz', tid);
        if (s === 'skip') { const ids = App.topics.map((x) => x.id); Feed.start(ids[(ids.indexOf(tid) + 1) % ids.length], 0); go('feed'); }
      };
    },
  };

  /* ---------------- quiz ---------------- */

  const shuffle = (a) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  const Quiz = {
    s: null, sel: 'all', count: 10,
    get el() { return $('#view-quiz'); },

    enter(pre) {
      if (pre === 'mistakes') return this.start('mistakes');
      if (pre) { this.sel = pre; return this.start(); }
      if (this.s && !this.s.done) return this.renderQ();
      this.setup();
    },

    setup() {
      this.s = null;
      const st = Store.get();
      const withQ = [...App.interviews, ...App.topics].filter((t) => t.questions.length);
      const totalQ = withQ.reduce((a, t) => a + t.questions.length, 0);
      const acc = st.quiz.total ? Math.round((st.quiz.right / st.quiz.total) * 100) + '%' : '–';
      const mistakes = st.mistakes.filter(findQuestion).length;
      this.el.innerHTML = `
        <div class="page-in">
          <h1 class="page-title">Quiz <span>time</span> 🧠</h1>
          <div class="kpis three">
            <div class="kpi"><b>${totalQ}</b><span>questions</span></div>
            <div class="kpi"><b>${st.quiz.total}</b><span>answered</span></div>
            <div class="kpi"><b>${acc}</b><span>accuracy</span></div>
          </div>
          ${mistakes ? `<button class="btn warn wide" data-q="mistakes">🔁 Fix my mistakes (${mistakes})</button>` : ''}
          <h3 class="sec">Pick a topic</h3>
          <div class="chips">
            <button class="pick${this.sel === 'all' ? ' on' : ''}" data-sel="all">🌍 Everything</button>
            ${withQ.map((t) => `<button class="pick${this.sel === t.id ? ' on' : ''}" data-sel="${esc(t.id)}" style="--accent:${t.color}">${esc(t.emoji)} ${esc(t.title)}</button>`).join('')}
          </div>
          <h3 class="sec">How many?</h3>
          <div class="seg">${[5, 10, 20].map((n) => `<button class="${this.count === n ? 'on' : ''}" data-n="${n}">${n}</button>`).join('')}</div>
          <button class="btn primary wide big" data-q="start">Start quiz →</button>
        </div>`;
      this.el.onclick = (e) => {
        const sel = e.target.closest('[data-sel]'), n = e.target.closest('[data-n]'), q = e.target.closest('[data-q]');
        if (sel) { this.sel = sel.dataset.sel; $$('.pick', this.el).forEach((p) => p.classList.toggle('on', p === sel)); }
        if (n) { this.count = +n.dataset.n; $$('.seg button', this.el).forEach((b) => b.classList.toggle('on', b === n)); }
        if (q) this.start(q.dataset.q === 'mistakes' ? 'mistakes' : undefined);
      };
    },

    start(mode) {
      let pool;
      if (mode === 'mistakes') pool = Store.get().mistakes.map(findQuestion).filter(Boolean);
      else if (this.sel === 'all' || !App.src[this.sel]) { this.sel = 'all'; pool = [...App.topics, ...App.interviews].flatMap((t) => t.questions); }
      else pool = App.src[this.sel].questions;
      if (!pool.length) { toast('No questions here yet'); return this.setup(); }
      const qs = shuffle(pool).slice(0, mode === 'mistakes' ? 20 : this.count).map((q) => ({ ...q, order: shuffle(q.options.map((_, i) => i)) }));
      this.s = { qs, idx: 0, right: 0, mode, scope: mode === 'mistakes' ? 'mistakes' : this.sel, done: false, answered: false };
      this.renderQ();
    },

    renderQ() {
      const s = this.s, q = s.qs[s.idx], t = App.src[q.t];
      this.el.innerHTML = `
        <div class="page-in quiz-run" style="--accent:${t.color}">
          <div class="qbar"><i style="width:${(s.idx / s.qs.length) * 100}%"></i></div>
          <div class="qmeta"><span>${esc(t.emoji)} ${esc(t.title)}</span><span>${s.idx + 1} / ${s.qs.length} · ✅ ${s.right}</span></div>
          <h2 class="q">${md(q.q)}</h2>
          <div class="opts">${q.order.map((oi, k) => `
            <button class="opt" data-o="${oi}"><span class="opt-l">${LETTERS[k]}</span><span>${md(q.options[oi])}</span></button>`).join('')}</div>
          <div class="explain"><b class="verdict"></b> ${md(q.explain || '')}</div>
          <div class="row end"><button class="btn ghost" data-q="quit">Quit</button><button class="btn primary" data-q="next" hidden>${s.idx + 1 === s.qs.length ? 'See results 🏁' : 'Next →'}</button></div>
        </div>`;
      s.answered = false;
      this.el.scrollTop = 0;
      this.el.onclick = (e) => {
        const o = e.target.closest('[data-o]'), b = e.target.closest('[data-q]');
        if (o && !s.answered) this.answer(+o.dataset.o);
        if (b?.dataset.q === 'next') this.next();
        if (b?.dataset.q === 'quit') { this.s = null; this.setup(); }
      };
    },

    answer(pick) {
      const s = this.s, q = s.qs[s.idx];
      s.answered = true;
      const correct = pick === q.answer;
      if (correct) s.right++;
      const xp = Store.record(q.key, pick, correct, false);
      $$('.opt', this.el).forEach((o) => {
        const v = +o.dataset.o; o.disabled = true;
        o.classList.add(v === q.answer ? 'right' : v === pick ? 'wrong' : 'dim');
      });
      $('.verdict', this.el).textContent = correct ? `✅ Correct! +${xp} XP` : '❌ Not quite.';
      $('.explain', this.el).classList.add('show');
      $('[data-q="next"]', this.el).hidden = false;
      buzz(correct ? 20 : [30, 40, 30]);
      updateStats(correct);
    },

    next() {
      const s = this.s;
      if (++s.idx >= s.qs.length) return this.results();
      this.renderQ();
    },

    results() {
      const s = this.s; s.done = true;
      const pct = Math.round((s.right / s.qs.length) * 100);
      if (s.mode !== 'mistakes') Store.setBest(s.scope, pct);
      const [emoji, line] = pct === 100 ? ['😎', 'Staff engineer energy. Flawless.']
        : pct >= 80 ? ['🎉', 'Hired. Probably.']
        : pct >= 60 ? ['📈', 'Mid-level and climbing.']
        : pct >= 40 ? ['⚖️', 'Balanced… barely. Scroll a bit more.']
        : ['💥', 'Single point of failure detected. Back to the feed, then retry.'];
      const mistakes = Store.get().mistakes.filter(findQuestion).length;
      this.el.innerHTML = `
        <div class="page-in result">
          <div class="res-emoji">${emoji}</div>
          <div class="res-score">${s.right}<small>/${s.qs.length}</small></div>
          <p class="res-line">${line}</p>
          <div class="col">
            <button class="btn primary wide" data-r="again">↺ Another round</button>
            ${mistakes ? `<button class="btn warn wide" data-r="mistakes">🔁 Fix my mistakes (${mistakes})</button>` : ''}
            <button class="btn ghost wide" data-r="setup">Change topic</button>
            <button class="btn ghost wide" data-r="feed">Back to scrolling</button>
          </div>
        </div>`;
      this.el.onclick = (e) => {
        const r = e.target.closest('[data-r]')?.dataset.r;
        if (r === 'again') this.start(s.mode);
        if (r === 'mistakes') this.start('mistakes');
        if (r === 'setup') this.setup();
        if (r === 'feed') go('feed');
      };
    },
  };

  /* ---------------- mock interview view ---------------- */

  const IV = {
    id: null, t0: null, tick: null, io: null,
    get el() { return $('#view-interview'); },

    open(id) {
      const fresh = this.id !== id;
      this.id = id;
      this.render();
      if (fresh) this.el.scrollTop = 0;
    },

    render() {
      const iv = App.ivById[this.id];
      const keep = this.el.scrollTop;
      this.el.innerHTML = Interview.render(iv, Store.ivState(iv.id));
      this.el.scrollTop = keep;
      this.el.onclick = (e) => this.click(e);
      this.el.onkeydown = (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-iv="reveal"]')) { e.preventDefault(); this.click(e); } };
      this.updateTimer();
      // Highlight the phase you're reading in the sticky nav.
      this.io?.disconnect();
      this.io = new IntersectionObserver((es) => es.forEach((en) => {
        if (!en.isIntersecting) return;
        const b = $(`.iv-nav [data-p="${CSS.escape(en.target.dataset.p)}"]`, this.el);
        $$('.iv-nav .here', this.el).forEach((x) => x.classList.remove('here'));
        if (b) {
          b.classList.add('here');
          // Scroll only the chip strip; scrollIntoView would also scroll the page and cancel a jump in progress.
          const nav = b.parentElement;
          nav.scrollTo({ left: b.offsetLeft - nav.clientWidth / 2 + b.offsetWidth / 2, behavior: 'smooth' });
        }
      }), { root: this.el, rootMargin: '-35% 0px -60% 0px' });
      $$('.iv-phase', this.el).forEach((s) => this.io.observe(s));
    },

    click(e) {
      const t = e.target.closest('[data-iv]');
      if (!t) return;
      const iv = App.ivById[this.id];
      const act = t.dataset.iv;
      if (act === 'reveal' && t.classList.contains('hide')) t.classList.remove('hide');
      if (act === 'mode') { Store.ivSetMode(iv.id, t.dataset.m); this.render(); toast(t.dataset.m === 'read' ? '👀 All answers shown' : '🙈 Answers hidden: answer first, then tap'); }
      if (act === 'done') {
        const on = Store.ivToggleDone(iv.id, t.dataset.p);
        if (on) { Store.get().xp += 25; updateStats(true); toast('Phase done +25 XP'); }
        this.render();
      }
      if (act === 'jump') {
        const sec = $(`#ph-${CSS.escape(t.dataset.p)}`, this.el);
        const bar = $('.iv-bar', this.el);
        // land the phase heading just below the sticky bar (its stuck offset + its height)
        const stuckBottom = (parseFloat(getComputedStyle(bar).top) || 0) + bar.offsetHeight;
        if (sec) this.el.scrollTo({ top: sec.offsetTop - stuckBottom - 6, behavior: 'smooth' });
      }
      if (act === 'copy') {
        const code = t.closest('.iv-code').querySelector('code').textContent;
        navigator.clipboard?.writeText(code).then(() => toast('Code copied 📋'), () => toast('Copy failed'));
      }
      if (act === 'timer') {
        if (this.t0) { if (confirm('Stop the 45-minute timer?')) { clearInterval(this.tick); this.t0 = null; this.tick = null; } }
        else { this.t0 = Date.now(); this.tick = setInterval(() => this.updateTimer(), 1000); toast('⏱ Timer started. Follow the phase it highlights'); }
        this.updateTimer();
      }
    },

    // While the timer runs, show elapsed time and the phase you *should* be on.
    updateTimer() {
      const btn = $('.iv-timer', this.el);
      if (!btn) return;
      if (!this.t0) { btn.textContent = '⏱ Start 45:00'; btn.classList.remove('on', 'late'); return; }
      const iv = App.ivById[this.id];
      const sec = Math.floor((Date.now() - this.t0) / 1000), min = sec / 60;
      const ph = iv.phases.find((p) => p.start != null && min >= p.start && min < p.end);
      btn.textContent = `⏱ ${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}${ph ? ' · ' + (ph.nav || ph.title) : min >= 45 ? " · Time's up" : ''}`;
      btn.classList.add('on');
      btn.classList.toggle('late', min >= 45);
      $$('.iv-nav button', this.el).forEach((b) => b.classList.toggle('now', !!ph && b.dataset.p === ph.id));
    },
  };

  /* ---------------- saved ---------------- */

  const Saved = {
    render() {
      const el = $('#view-saved');
      const keys = Store.get().saved.filter((k) => { const [t, i] = k.split('#'); return App.byId[t]?.cards[+i]; });
      if (!keys.length) {
        el.innerHTML = `<div class="page-in empty"><div class="res-emoji">💾</div><h2>Nothing saved yet</h2><p>Double-tap any card, or hit the ❤️, to keep it here for quick revision.</p><button class="btn primary" data-act="goto-tab" data-tab="feed">Start scrolling</button></div>`;
        return;
      }
      el.innerHTML = `<div class="feed">${keys.map((k) => { const [tid, i] = k.split('#'); const t = App.byId[tid]; return Cards.render(t, t.cards[+i], +i); }).join('')}</div>`;
      const sc = $('.feed', el);
      const io = new IntersectionObserver((es) => es.forEach((e) => {
        const svg = $('svg.dia', e.target);
        e.target.classList.toggle('active', e.isIntersecting);
        if (e.isIntersecting) svg?.unpauseAnimations?.(); else svg?.pauseAnimations?.();
      }), { root: sc, threshold: 0.6 });
      $$('.card', sc).forEach((c) => io.observe(c));
    },
  };

  /* ---------------- import "learn anything" decks ---------------- */

  const PROMPT = `You are making a deck for DoomScholar, a TikTok-style learning app. Teach the topic below in 12-18 short swipeable cards that feel like memes + flashcards. Be funny but accurate. Keep every card SHORT (it must fit one phone screen: max ~45 words of body text per card).

Return ONLY valid JSON (no prose, no code fences) in this exact shape:
{
  "id": "kebab-case-id",
  "title": "Short Title",
  "emoji": "🐳",
  "color": "#0ea5e9",
  "tagline": "one-line hook",
  "cards": [ ...cards... ],
  "quiz": [ { "q": "...", "options": ["...","...","...","..."], "answer": 0, "explain": "..." } ]
}

Card types (use a varied mix, start with "hook", end with "tldr", put a "quiz" card every ~5 cards):
{"type":"hook","emoji":"🐳","title":"...","text":"..."}
{"type":"meme","emoji":"🐶☕🔥","top":"TOP TEXT","bottom":"BOTTOM TEXT","caption":"what it teaches"}
{"type":"drake","no":"bad approach","yes":"good approach","caption":"why"}
{"type":"brain","title":"...","levels":["basic","better","galaxy brain","cosmic"]}
{"type":"chat","them":"Senior Dev","messages":[{"from":"them","text":"..."},{"from":"me","text":"..."}]}
{"type":"concept","emoji":"📦","title":"...","body":"... **bold** and \`code\` allowed","bullets":["...","..."]}
{"type":"analogy","emoji":"🍕","title":"...","body":"..."}
{"type":"compare","title":"A vs B","left":{"emoji":"🐢","title":"A","points":["..."]},"right":{"emoji":"🐇","title":"B","points":["..."]}}
{"type":"list","title":"...","items":[{"emoji":"1️⃣","title":"...","text":"..."}]}
{"type":"steps","title":"...","steps":["...","..."]}
{"type":"numbers","title":"...","stats":[{"value":"99.9%","label":"..."}]}
{"type":"code","title":"...","code":"kubectl get pods\\n# comment","caption":"..."}
{"type":"tip","text":"..."}
{"type":"quiz","q":"...","options":["...","...","...","..."],"answer":2,"explain":"..."}
{"type":"tldr","points":["...","...","..."]}

"answer" is the 0-based index of the correct option; vary its position. Add 4-6 extra questions in "quiz".

TOPIC: `;

  const Importer = {
    open() {
      openModal(`
        <h2>Learn anything ✨</h2>
        <ol class="howto">
          <li>Copy the prompt and paste it into Claude (or any AI). Add your topic at the end.</li>
          <li>Copy the JSON it replies with.</li>
          <li>Paste it below. The deck is saved on this device.</li>
        </ol>
        <button class="btn ghost wide" data-i="copy">📋 Copy AI prompt</button>
        <textarea id="deck-json" placeholder='{"id": "docker", "title": "Docker", "cards": [ ... ]}' spellcheck="false"></textarea>
        <div class="row"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" data-i="import">Add deck</button></div>
        <p class="err" id="deck-err"></p>`);
      $('#modal .sheet').onclick = async (e) => {
        const a = e.target.closest('[data-i]')?.dataset.i;
        if (a === 'copy') {
          try { await navigator.clipboard.writeText(PROMPT); toast('Prompt copied, now add your topic'); }
          catch { $('#deck-json').value = PROMPT; toast('Copy it from the box'); }
        }
        if (a === 'import') this.add($('#deck-json').value);
      };
    },

    add(text) {
      const err = (m) => { $('#deck-err').textContent = m; };
      let data;
      try {
        const clean = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
        data = JSON.parse(clean);
      } catch (e) { return err('That is not valid JSON: ' + e.message); }
      const list = Array.isArray(data) ? data : [data];
      const decks = Store.decks();
      let firstId = null;
      for (const t of list) {
        if (!t || !t.title || !Array.isArray(t.cards) || !t.cards.length) return err('Each deck needs a "title" and a non-empty "cards" array.');
        const bad = t.cards.find((c) => !c || !Cards.types.includes(c.type));
        if (bad) return err(`Unknown card type "${bad && bad.type}". Allowed: ${Cards.types.join(', ')}`);
        const qBad = [...t.cards.filter((c) => c.type === 'quiz'), ...(t.quiz || [])].find((q) => !Array.isArray(q.options) || !(q.answer >= 0 && q.answer < q.options.length));
        if (qBad) return err(`Quiz question "${qBad.q}" has a bad options/answer.`);
        let id = 'my-' + String(t.id || t.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        while (App.byId[id] && !App.byId[id].custom) id += '-2';
        const deck = { ...t, id };
        const at = decks.findIndex((d) => d.id === id);
        if (at >= 0) decks[at] = deck; else decks.push(deck);
        firstId ||= id;
      }
      Store.saveDecks(decks);
      prepareTopics();
      closeModal();
      toast('Deck added 🎉');
      Feed.start(firstId, 0);
      go('feed');
    },

    remove(id) {
      if (!confirm('Delete this deck from this device?')) return;
      Store.saveDecks(Store.decks().filter((d) => d.id !== id));
      prepareTopics();
      Topics.render();
      Feed.start(App.topics[0].id, 0);
    },
  };

  /* ---------------- audit (dev tool: ?audit) ---------------- */
  // Renders every card at phone size and reports cards whose content overflows.
  async function runAudit() {
    try { await document.fonts.ready; } catch { /* ignore */ }
    document.body.classList.add('auditing');
    const host = document.createElement('div');
    host.className = 'audit-host';
    document.body.appendChild(host);
    const out = { viewport: [innerWidth, innerHeight], cards: 0, overflow: [], diagrams: [] };
    for (const t of App.topics) {
      t.cards.forEach((c, i) => {
        host.innerHTML = Cards.render(t, c, i);
        const card = host.firstElementChild;
        card.classList.add('active');
        const body = $('.card-body', card);
        const over = body.scrollHeight - body.clientHeight;
        out.cards++;
        if (over > 2) out.overflow.push({ topic: t.id, card: i, type: c.type, overflowPx: over });
        if (c.type === 'diagram') Diagram.check(c.diagram).forEach((m) => out.diagrams.push({ topic: t.id, card: i, issue: m }));
      });
    }
    host.remove();
    // Long-form interviews: nothing may stick out sideways (code and tables scroll inside their own boxes).
    out.interviews = [];
    for (const iv of App.interviews) {
      const page = document.createElement('section');
      page.className = 'view page iv-page';
      page.style.cssText = 'position:fixed;inset:0;max-width:480px';
      document.body.appendChild(page);
      page.innerHTML = Interview.render(iv, { done: {}, mode: 'read' });
      $$('details', page).forEach((d) => { d.open = true; });
      const edge = page.getBoundingClientRect().right;
      const wide = $$('*', page).filter((n) => !n.closest('pre, .tbl-scroll, .iv-nav') && n.getBoundingClientRect().right > edge + 1);
      out.interviews.push({ id: iv.id, overflowPx: page.scrollWidth - page.clientWidth, offenders: wide.slice(0, 5).map((n) => `${n.tagName.toLowerCase()}.${n.className}: ${n.textContent.slice(0, 40)}`) });
      page.remove();
    }
    const pre = document.createElement('pre');
    pre.id = 'audit';
    pre.textContent = JSON.stringify(out);
    document.body.appendChild(pre);
  }

  boot();
})();
