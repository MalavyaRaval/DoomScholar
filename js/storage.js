/* Progress lives in this browser's localStorage. No accounts, no server. */
window.Store = (() => {
  'use strict';
  const KEY = 'doomscholar:v1';
  const DECKS = 'doomscholar:decks';

  const defaults = () => ({
    seen: {},          // { topicId: { cardIndex: 1 } }
    saved: [],         // ["topicId#index"], newest first
    answers: {},       // feed quiz picks: { "topicId#index": optionIndex }
    mistakes: [],      // question keys answered wrong (cleared when answered right later)
    quiz: { right: 0, total: 0, best: {} },
    xp: 0,
    streak: { count: 0, last: null },
    lastPos: null,     // { t, i }
  });

  let d = load();
  let timer = null;

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
      const base = defaults();
      return { ...base, ...raw, quiz: { ...base.quiz, ...(raw.quiz || {}) }, streak: { ...base.streak, ...(raw.streak || {}) } };
    } catch { return defaults(); }
  }
  function save() {
    clearTimeout(timer);
    timer = setTimeout(flush, 200);
  }
  function flush() {
    clearTimeout(timer);
    try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* private mode / quota: keep in memory */ }
  }
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });

  const today = (off = 0) => {
    const t = new Date(); t.setDate(t.getDate() + off);
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  };

  function touchStreak() {
    const now = today();
    if (d.streak.last === now) return;
    d.streak.count = d.streak.last === today(-1) ? d.streak.count + 1 : 1;
    d.streak.last = now;
  }

  return {
    get: () => d,
    flush,

    streak() {
      // A streak that skipped a day is shown as broken (0) until you scroll again.
      const { count, last } = d.streak;
      return last === today() || last === today(-1) ? count : 0;
    },

    markSeen(t, i) {
      const m = (d.seen[t] ||= {});
      if (m[i]) return false;
      m[i] = 1; d.xp += 1; touchStreak(); save();
      return true;
    },
    seenCount(t) { return Object.keys(d.seen[t] || {}).length; },
    totalSeen() { return Object.values(d.seen).reduce((a, m) => a + Object.keys(m).length, 0); },

    setLastPos(t, i) { d.lastPos = { t, i }; save(); },

    isSaved(k) { return d.saved.includes(k); },
    toggleSave(k, force) {
      const has = d.saved.includes(k);
      const want = force ?? !has;
      if (want && !has) d.saved.unshift(k);
      if (!want && has) d.saved = d.saved.filter((x) => x !== k);
      save();
      return want;
    },

    answerOf(k) { return d.answers[k] ?? null; },
    // Records a question attempt from the feed or the quiz tab. Returns XP earned.
    record(k, pick, correct, fromFeed) {
      if (fromFeed) {
        if (d.answers[k] != null) return 0;
        d.answers[k] = pick;
      }
      d.quiz.total += 1;
      if (correct) d.quiz.right += 1;
      d.mistakes = d.mistakes.filter((x) => x !== k);
      if (!correct) d.mistakes.unshift(k);
      const xp = correct ? 10 : 0;
      d.xp += xp; touchStreak(); save();
      return xp;
    },
    setBest(scope, pct) {
      if ((d.quiz.best[scope] ?? -1) < pct) { d.quiz.best[scope] = pct; save(); }
    },

    // Imported decks are stored separately so they survive a progress reset.
    decks() { try { return JSON.parse(localStorage.getItem(DECKS) || '[]'); } catch { return []; } },
    saveDecks(list) { localStorage.setItem(DECKS, JSON.stringify(list)); },

    reset() { d = defaults(); flush(); },
  };
})();
