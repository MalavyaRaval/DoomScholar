#!/usr/bin/env node
// Validates every topic in content/: schema, quiz answers, diagram geometry, length limits.
// Usage: node tools/validate.js [topicId ...]
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Diagram = require('../js/diagram.js');

const ROOT = path.resolve(__dirname, '..');
const CATEGORIES = ['Fundamentals', 'Building Blocks', 'Design Problems'];
const MEMEY = ['meme', 'drake', 'brain', 'chat'];

const strip = (s) => String(s ?? '').replace(/[*`=]/g, '');
const words = (s) => strip(s).split(/\s+/).filter(Boolean).length;
const chars = (s) => [...strip(s)].length;

// Required fields + soft length limits per card type (see CONTENT_GUIDE.md).
const RULES = {
  hook: { req: ['title', 'text'], lim: (c, w) => { w(words(c.text) > 30, 'text > 30 words'); } },
  meme: { req: ['emoji'], lim: (c, w) => { w(chars(c.top) > 45, 'top > 45 chars'); w(chars(c.bottom) > 60, 'bottom > 60 chars'); w(!c.top && !c.bottom, 'needs top or bottom'); w(words(c.caption) > 35, 'caption > 35 words'); } },
  drake: { req: ['no', 'yes'], lim: (c, w) => { w(chars(c.no) > 70, 'no > 70 chars'); w(chars(c.yes) > 70, 'yes > 70 chars'); w(words(c.caption) > 35, 'caption > 35 words'); } },
  brain: { req: ['levels'], lim: (c, w) => { w(c.levels.length < 3 || c.levels.length > 5, 'use 3-5 levels'); c.levels.forEach((l, i) => w(chars(l) > 55, `level ${i} > 55 chars`)); } },
  chat: { req: ['messages'], lim: (c, w) => { w(c.messages.length > 6, '> 6 messages'); c.messages.forEach((m, i) => { w(!['me', 'them'].includes(m.from), `message ${i} from must be "me" or "them"`); w(chars(m.text) > 100, `message ${i} > 100 chars`); }); } },
  concept: { req: ['title'], lim: (c, w) => { w(words(c.body) > 50, 'body > 50 words'); w((c.bullets || []).length > 4, '> 4 bullets'); (c.bullets || []).forEach((b, i) => w(words(b) > 16, `bullet ${i} > 16 words`)); } },
  analogy: { req: ['title', 'body'], lim: (c, w) => { w(words(c.body) > 50, 'body > 50 words'); } },
  diagram: { req: ['diagram'], lim: (c, w) => { w(words(c.caption) > 32, 'caption > 32 words'); w((c.diagram.h || 280) > 340, 'diagram h > 340'); } },
  compare: { req: ['left', 'right'], lim: (c, w) => { ['left', 'right'].forEach((k) => { const s = c[k] || {}; w(!s.title, `${k}.title missing`); w((s.points || []).length > 4, `${k} > 4 points`); (s.points || []).forEach((p, i) => w(words(p) > 7, `${k} point ${i} > 7 words`)); }); w(words(c.caption) > 30, 'caption > 30 words'); } },
  list: { req: ['items'], lim: (c, w) => { w(c.items.length > 5, '> 5 items'); c.items.forEach((it, i) => { w(!it.title, `item ${i} title missing`); w(words(it.text) > 16, `item ${i} text > 16 words`); }); } },
  steps: { req: ['steps'], lim: (c, w) => { w(c.steps.length > 6, '> 6 steps'); c.steps.forEach((s, i) => w(words(s) > 20, `step ${i} > 20 words`)); } },
  numbers: { req: ['stats'], lim: (c, w) => { w(c.stats.length > 4, '> 4 stats'); c.stats.forEach((s, i) => { w(chars(s.value) > 9, `stat ${i} value > 9 chars`); w(words(s.label) > 10, `stat ${i} label > 10 words`); }); } },
  code: { req: ['code'], lim: (c, w) => { const ls = c.code.split('\n'); w(ls.length > 13, '> 13 lines'); ls.forEach((l, i) => w(l.length > 40, `line ${i} > 40 chars`)); } },
  tip: { req: ['text'], lim: (c, w) => { w(words(c.text) > 38, 'text > 38 words'); } },
  quiz: { req: ['q', 'options', 'explain'], lim: (c, w) => { w(chars(c.q) > 140, 'question > 140 chars'); c.options.forEach((o, i) => w(chars(o) > 70, `option ${i} > 70 chars`)); w(words(c.explain) > 40, 'explain > 40 words'); } },
  tldr: { req: ['points'], lim: (c, w) => { w(c.points.length > 5, '> 5 points'); c.points.forEach((p, i) => w(words(p) > 16, `point ${i} > 16 words`)); } },
};

function load() {
  const ctx = { TOPICS: [] };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'content/registry.js'), 'utf8'), ctx); // registerInterview / interviewPhase
  ctx.registerTopic = (t) => { t.__file = ctx.__file; ctx.TOPICS.push(t); };
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'content/manifest.js'), 'utf8'), ctx);
  const missing = [];
  for (const f of ctx.CONTENT_FILES) {
    const p = path.join(ROOT, 'content', f);
    if (!fs.existsSync(p)) { missing.push(f); continue; }
    ctx.__file = f;
    vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: p });
  }
  return { topics: ctx.TOPICS, interviews: ctx.INTERVIEWS || [], missing };
}

const IV_BLOCKS = ['say', 'think', 'text', 'list', 'table', 'code', 'diagram', 'callout', 'quiz', 'yourturn', 'deep'];

// Mock interviews are long-form, so there are no one-screen limits, just structural checks.
function checkInterview(iv, topicIds) {
  const E = [], W = [];
  const err = (m) => E.push(m);
  ['title', 'tagline', 'intro'].forEach((k) => { if (!iv[k]) err(`missing ${k}`); });
  if (topicIds.has(iv.id)) err(`id "${iv.id}" collides with a topic id`);
  if (iv.related && !topicIds.has(iv.related)) W.push(`related topic "${iv.related}" not found`);
  if (!/^#[0-9a-f]{6}$/i.test(iv.color || '')) err(`color "${iv.color}" must be a 6-digit hex`);
  if (!iv.phases.length) err('no phases (call interviewPhase in each phase file)');
  const phaseIds = new Set();
  const answers = [];
  let lastEnd = 0;
  iv.phases.forEach((p, pi) => {
    const where = `phase ${pi} (${p.id})`;
    if (!p.id || !p.title) err(`${where}: needs id and title`);
    if (phaseIds.has(p.id)) err(`${where}: duplicate phase id`);
    phaseIds.add(p.id);
    if (p.start != null) {
      if (!(p.end > p.start)) err(`${where}: end must be greater than start`);
      if (p.start < lastEnd) W.push(`${where}: starts before the previous phase ends`);
      lastEnd = p.end;
    }
    const walk = (blocks, w) => (blocks || []).forEach((b, bi) => {
      const wb = `${w} › ${bi} (${b.type})`;
      if (!IV_BLOCKS.includes(b.type)) return err(`${wb}: unknown block type. Allowed: ${IV_BLOCKS.join(', ')}`);
      if (b.type === 'say' && (!['me', 'them'].includes(b.who) || !b.text)) err(`${wb}: needs who: 'me'|'them' and text`);
      if ((b.type === 'think' || b.type === 'callout') && !b.text) err(`${wb}: missing text`);
      if (b.type === 'text' && !(b.md || b.text)) err(`${wb}: missing md`);
      if (b.type === 'list' && !(b.items || []).length) err(`${wb}: empty items`);
      if (b.type === 'table') {
        const n = (b.head || []).length;
        if (!n) err(`${wb}: missing head`);
        (b.rows || []).forEach((r, ri) => { if (r.length !== n) err(`${wb}: row ${ri} has ${r.length} cells but the header has ${n}`); });
      }
      if (b.type === 'code') { if (!b.code) err(`${wb}: missing code`); if (!b.lang) W.push(`${wb}: no lang (no highlighting)`); }
      if (b.type === 'diagram') Diagram.check(b.diagram).forEach((m) => err(`${wb}: ${m}`));
      if (b.type === 'quiz') { checkQuestion(b, wb, err); answers.push(b.answer); }
      if (b.type === 'yourturn' && (!b.prompt || !b.answer)) err(`${wb}: needs prompt and answer`);
      if (b.type === 'deep') walk(b.blocks, wb);
      if (b.type !== 'deep' && b.type !== 'code' && (JSON.stringify(b).match(/\*\*/g) || []).length % 2) W.push(`${wb}: unbalanced ** markup`);
    });
    walk(p.blocks, where);
  });
  if (answers.length >= 4 && new Set(answers).size === 1) W.push(`every checkpoint answer is option ${answers[0]}; vary the position`);
  return { E, W, questions: answers.length };
}

function checkQuestion(q, where, err) {
  if (!q.q) err(`${where}: missing q`);
  if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 6) err(`${where}: options must be an array of 2-6`);
  else if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.options.length) err(`${where}: answer ${q.answer} is not a valid option index`);
  if (!q.explain) err(`${where}: missing explain`);
}

function main() {
  const only = process.argv.slice(2);
  const { topics, interviews, missing } = load();
  let errors = 0, warnings = 0;
  const ids = new Set();
  missing.forEach((f) => { console.log(`⚠ manifest lists ${f} but the file doesn't exist yet`); warnings++; });

  for (const t of topics) {
    if (only.length && !only.includes(t.id)) continue;
    const E = [], W = [];
    const err = (m) => E.push(m);
    if (!t.id || !/^[a-z0-9-]+$/.test(t.id)) err(`id "${t.id}" must be kebab-case`);
    if (ids.has(t.id)) err(`duplicate topic id "${t.id}"`);
    ids.add(t.id);
    if (path.basename(t.__file, '.js') !== t.id) err(`id "${t.id}" should match file name ${t.__file}`);
    ['title', 'emoji', 'tagline'].forEach((k) => { if (!t[k]) err(`missing ${k}`); });
    if ((t.short || t.title || '').length > 18) W.push(`title is long for the footer chip; add short: '...' (≤ 18 chars)`);
    if (!CATEGORIES.includes(t.category)) W.push(`category "${t.category}" is not one of ${CATEGORIES.join(' / ')}`);
    if (!/^#[0-9a-f]{6}$/i.test(t.color || '')) err(`color "${t.color}" must be a 6-digit hex`);
    if (!Array.isArray(t.cards) || !t.cards.length) { err('cards[] is empty'); }
    else {
      if (t.cards[0].type !== 'hook') err('first card must be a hook');
      if (t.cards[t.cards.length - 1].type !== 'tldr') err('last card must be a tldr');
      if (t.cards.length < 12 || t.cards.length > 22) W.push(`${t.cards.length} cards (aim for 14-20)`);
      t.cards.forEach((c, i) => {
        const where = `card #${i} (${c.type})`;
        const rule = RULES[c.type];
        if (!rule) return err(`${where}: unknown type. Allowed: ${Object.keys(RULES).join(', ')}`);
        for (const k of rule.req) if (c[k] == null || c[k] === '') return err(`${where}: missing "${k}"`);
        if (c.type === 'quiz') checkQuestion(c, where, err);
        if (c.type === 'diagram') Diagram.check(c.diagram).forEach((m) => err(`${where}: ${m}`));
        rule.lim(c, (cond, m) => { if (cond) W.push(`${where}: ${m}`); });
        if (i && t.cards[i - 1].type === c.type) W.push(`${where}: same type as the previous card`);
        const plain = c.type === 'meme' ? [c.top, c.bottom] : c.type === 'numbers' ? (c.stats || []).map((s) => s.value) : [];
        if (plain.some((s) => /[*`]|==/.test(s || ''))) W.push(`${where}: markdown in a plain-text field (meme top/bottom, stat value) shows literally`);
        const bolds = (JSON.stringify(c).match(/\*\*/g) || []).length;
        if (bolds % 2) W.push(`${where}: unbalanced ** markup`);
      });
      const memey = t.cards.filter((c) => MEMEY.includes(c.type)).length;
      if (memey < 3) W.push(`only ${memey} meme-style cards (meme/drake/brain/chat); aim for 3+`);
      const inline = t.cards.filter((c) => c.type === 'quiz').length;
      if (inline < 2) W.push(`only ${inline} inline quiz cards; aim for 3`);
    }
    (t.quiz || []).forEach((q, j) => checkQuestion(q, `quiz[${j}]`, err));
    if ((t.quiz || []).length < 3) W.push(`only ${(t.quiz || []).length} extra quiz questions; aim for 4-6`);
    const answers = [...(t.cards || []).filter((c) => c.type === 'quiz'), ...(t.quiz || [])].map((q) => q.answer);
    if (answers.length >= 4 && new Set(answers).size === 1) W.push(`every quiz answer is option ${answers[0]}; vary the position`);

    const status = E.length ? '✖' : W.length ? '⚠' : '✔';
    console.log(`${status} ${t.id} (${(t.cards || []).length} cards, ${answers.length} questions)`);
    E.forEach((m) => console.log(`    ERROR  ${m}`));
    W.forEach((m) => console.log(`    warn   ${m}`));
    errors += E.length; warnings += W.length;
  }

  const topicIds = new Set(topics.map((t) => t.id));
  for (const iv of interviews) {
    if (only.length && !only.includes(iv.id)) continue;
    const { E, W, questions } = checkInterview(iv, topicIds);
    console.log(`${E.length ? '✖' : W.length ? '⚠' : '✔'} 🎤 ${iv.id} (${iv.phases.length} phases, ${questions} checkpoint questions)`);
    E.forEach((m) => console.log(`    ERROR  ${m}`));
    W.forEach((m) => console.log(`    warn   ${m}`));
    errors += E.length; warnings += W.length;
  }
  console.log(`\n${errors} error(s), ${warnings} warning(s)`);
  process.exitCode = errors ? 1 : 0;
}

main();
