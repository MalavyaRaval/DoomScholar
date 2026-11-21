# Writing content for DoomScholar

Every topic is one file in `content/<folder>/<id>.js` that calls `registerTopic({...})`, plus one line in `content/manifest.js`.
Look at `content/concepts/load-balancer.js` (a concept) and `content/designs/url-shortener.js` (a design problem) as the reference examples.

## Topic shape

```js
registerTopic({
  id: 'load-balancer',            // unique, kebab-case, same as the file name
  title: 'Load Balancers',        // shown on the cover card and topic tile
  short: 'LBs',                   // optional: shorter name for the card footer chip if title > 18 chars
  emoji: '⚖️',
  category: 'Building Blocks',    // 'Fundamentals' | 'Building Blocks' | 'Design Problems'
  color: '#8b5cf6',               // accent; mid-brightness hex that looks good on near-black
  tagline: 'One front door, many servers',
  cards: [ /* 14–20 cards, see below */ ],
  quiz: [ /* 4–6 extra MCQs, only shown in the Quiz tab */ ],
});
```

## Card types

Text fields support a tiny markdown: `**bold**`, `*italic*`, `` `code` ``, `==highlight==`, and `\n` for a line break.
**Plain-text exceptions** (markup would show literally): meme `top`/`bottom`, numbers `value`, `emoji` fields, chat `them`. The meme font also lacks some symbols, so write `2x`, not `2×`.

| type | fields | use it for |
|---|---|---|
| `hook` | `emoji, title, text` | **First card of every topic.** A punchy cover. |
| `meme` | `emoji, top, bottom, caption?` | Classic top/bottom-text meme. `emoji` is the "image": 1–3 emoji that set the scene (`'🐶☕🔥'`). `top`/`bottom` ≤ 45 chars each. Caption explains the lesson. |
| `drake` | `no, yes, title?, caption?, noEmoji?, yesEmoji?` | Rejecting the bad idea / approving the good one. `no`/`yes` ≤ 60 chars. |
| `brain` | `levels[3–4], title?` | Expanding-brain: naive → enlightened. Each level ≤ 50 chars. |
| `chat` | `them?, themEmoji?, title?, messages[{from:'them'|'me', text}]` | Interview banter / Slack incident. 3–6 short bubbles (≤ 90 chars). |
| `concept` | `emoji?, title, body?, bullets?[]` | Core explanation. body ≤ 45 words, ≤ 4 bullets of ≤ 14 words. |
| `analogy` | `emoji, title, body` | Real-world comparison. body ≤ 45 words. |
| `diagram` | `title, diagram{}, caption?` | Architecture picture (see below). caption ≤ 30 words. |
| `compare` | `title, left{emoji,title,points[]}, right{…}, caption?` | Two columns. ≤ 4 points per side, each ≤ 7 words (columns are narrow). |
| `list` | `title, items[{emoji, title, text?}]` | 3–5 items; text ≤ 15 words. |
| `steps` | `title, steps[]` | Ordered flow (request path, algorithm). 3–6 steps, each ≤ 18 words. |
| `numbers` | `title, stats[{value, label}], caption?` | Back-of-envelope numbers. 2–4 stats; value ≤ 9 chars. |
| `code` | `title, code, caption?` | Commands / pseudo-code. ≤ 12 lines, ≤ 38 chars per line. Lines starting with `#`, `//` or `--` render as comments. |
| `tip` | `text, label?` | Interview tip or hot take. ≤ 35 words. Default label is "💡 Interview tip". |
| `quiz` | `q, options[3–4], answer, explain` | Inline MCQ. `answer` is the 0-based index; **vary the position**. Options ≤ 60 chars. explain ≤ 35 words. |
| `read` | `title, text, emoji?, label?, href?, more?` | A paragraph to actually read (≤ 100 words; blank line = new paragraph). Deep dives generate these for the feed automatically; `href` adds a "Read the full part →" link. |
| `tldr` | `points[3–5], title?` | **Last card of every topic.** Recap + buttons for quiz/next topic. |

Extra questions in `quiz: []` use the same `{q, options, answer, explain}` shape.

### A good topic rhythm (~16 cards)

`hook` → meme/drake (why should I care?) → concept → analogy → diagram → **quiz** → compare/list → brain/chat (fun) → diagram/steps (how it works) → numbers/code → **quiz** → tip → meme → **quiz** → `tldr`

Rules of thumb:
- Mix types: never two of the same type in a row, and at least 3 meme-style cards (`meme`, `drake`, `brain`, `chat`) per topic.
- Put a `quiz` card every 4–6 cards. Plus 4–6 extra quiz-only questions.
- Every card must fit ONE phone screen. If it is long, split it into two cards.
- Be accurate. Be funny about it.
- Design problems should follow the interview flow: requirements → estimates → API → data model → high-level diagram → deep dives (scaling, bottlenecks) → trade-offs.

## Diagrams

The canvas is **360 wide** and `h` tall (default 280, keep ≤ 330). `x`, `y` are node **centers**.

```js
{
  type: 'diagram',
  title: 'The basic setup',
  diagram: {
    h: 260,
    nodes: [
      { id: 'u',  x: 55,  y: 130, label: 'Users', icon: '👥', shape: 'pill' },
      { id: 'lb', x: 180, y: 130, label: 'Load\nBalancer', icon: '⚖️', tone: 'accent' },
      { id: 's1', x: 300, y: 60,  label: 'Server 1', icon: '🖥️' },
      { id: 'db', x: 300, y: 200, label: 'DB', icon: '🗄️', shape: 'db' },
    ],
    edges: [
      { from: 'u', to: 'lb', flow: true },              // flow = animated packets
      { from: 'lb', to: 's1', label: 'HTTP', dashed: true },
      { from: 's1', to: 'db', curve: 30, tone: 'good' }, // curve bends the line; tone colors it
    ],
    groups: [{ x: 240, y: 20, w: 115, h: 220, label: 'APP TIER' }], // top-left x/y
    notes: [{ x: 180, y: 250, text: 'traffic spreads out' }],
  },
  caption: 'Users only ever talk to the LB.',
}
```

- Node fields: `label` (use `\n` to break lines), `icon` (one emoji), `shape`: `box` (default) | `db` (cylinder) | `pill`, `tone`: `accent` | `good` | `warn` | `bad` | `muted`, optional `w`/`h`.
- Node size: width ≈ 7px per character of the longest label line + 24 (minimum 72 with an icon). Height ≈ 58 with icon and one line, plus 14 per extra line. A 3-column layout with x = 60 / 180 / 300 fits comfortably. Keep labels ≤ 12 chars per line.
- Edge fields: `label` (≤ 14 chars), `flow` (animated dots; `'back'` to animate in reverse), `dashed`, `curve` (± px, use it for request/response pairs), `bi` (arrow both ends), `arrow: false`, `tone`, `lx`/`ly` (nudge the label).
- Group labels: write them in CAPS.

## Checking your work

```bash
node tools/validate.js                # schema + diagram geometry for every topic
node tools/audit.js                   # renders every card at phone size (390x720) in headless Chrome, lists overflow
node tools/shot.js load-balancer 4 5  # screenshots cards 4 and 5 into shots/
```

`validate.js` must report 0 errors. `audit.js` should report no overflowing cards; if one overflows, shorten or split it.

## Mock interviews (long-form)

A mock interview is a scrollable, phase-by-phase walkthrough of a full 45-minute interview. It lives in `content/interviews/<id>/`: one file for the meta, one file per phase, all listed in `content/manifest.js` in order. See `content/interviews/design-load-balancer/` as the reference.

```js
// 00-intro.js
registerInterview({
  id: 'design-load-balancer',      // must not clash with a topic id
  title: 'Design a Load Balancer',
  emoji: '🎤', color: '#8b5cf6',
  related: 'load-balancer',        // that topic's TL;DR card links here
  duration: 45, level: 'Senior / Staff depth',
  tagline: 'One line for the Topics tile',
  intro: 'Markdown shown under the title. Paragraphs split on blank lines.',
});

// 01-requirements.js
interviewPhase('design-load-balancer', {
  id: 'requirements', nav: 'Requirements',   // nav = short chip label
  time: '0–5', start: 0, end: 5,              // omit all three for bonus phases
  title: 'Clarify the requirements',
  goal: 'What a great answer achieves in this phase.',
  blocks: [ /* see below */ ],
});
```

Unlike cards, blocks have **no one-screen limit**; write as much depth as the topic needs. Markdown works in all text (blank line = new paragraph).

| block | fields | notes |
|---|---|---|
| `say` | `who: 'them'\|'me', text` | Interviewer / candidate lines. In Practice mode every `me` line is blurred until tapped. |
| `think` | `text` | The candidate's inner reasoning or meta-advice. |
| `text` | `md` | Prose. |
| `list` | `title?, items[], ordered?` | Items are strings or `{title, text}`. |
| `table` | `title?, head[], rows[][]` | First column renders as row headers. 4+ columns scroll sideways on phones. |
| `code` | `title, lang, code, caption?` | `lang`: `python`, `go`, `nginx`, `haproxy`, `conf`, `json`, `http`, `text`. Has a Copy button. |
| `diagram` | `title?, diagram, caption?` | Same diagram format as cards. |
| `callout` | `tone: 'tip'\|'warn'\|'trap'\|'key', title?, text` | |
| `quiz` | `q, options, answer, explain` | Checkpoint MCQ; also added to the Quiz tab. |
| `yourturn` | `prompt, answer, points?[]` | Practice prompt; the model answer is hidden until tapped in Practice mode. |
| `deep` | `title, blocks[]` | Collapsible "Go deeper" section containing any other blocks. |

Check with `node tools/validate.js <id>` (structure, quiz answers, diagram geometry) and `node tools/audit.js` (nothing may overflow sideways on a phone).

## Deep dives (long-form reading)

A deep dive is an article for readers who want the full story: how a system works inside, where it runs in production, trade-offs and failure modes. It opens at `#/deep/<id>`, shows up under **📖 Deep dives** in the Topics tab, and its checkpoint questions join the Quiz tab.

It also feeds the doomscroll. Each part's `card` paragraph becomes a swipeable `read` card, and the deep dive's parts play as a "Deep read" deck right after its `related` topic in the feed: hook → (part paragraph + that part's first quiz) × parts → recap. Readers meet each idea three times: as a short card, as a paragraph, and in full.

A deep dive is one file (`content/deep-dives/<id>.js`) or a folder with one file per part (`content/deep-dives/<id>/00-intro.js`, `01-….js`). List every file in `content/manifest.js`. See `content/deep-dives/l4-vs-l7/` as the reference.

```js
registerDeepDive({
  id: 'l4-vs-l7',                 // must not clash with a topic or interview id
  title: 'L4 vs L7 Load Balancing',
  short: 'L4 vs L7',              // footer chip in the feed (≤ 18 chars)
  emoji: '🔬', color: '#6366f1',
  related: 'load-balancer',       // its deck plays after this topic; that topic's TL;DR links here
  tagline: 'One line for the Topics tile',
  hook: 'Cover text of the feed deck (≤ 30 words).',
  intro: 'Markdown under the title. Blank line = new paragraph.',
  recap: ['3–5 points, each ≤ 16 words', '…'],   // the feed deck's closing TL;DR
  // sections: [...]               // optional: parts inline instead of deepSection calls
});

deepSection('l4-vs-l7', {
  id: 'l4', nav: 'How L4 works',  // nav = short chip label (≤ 24 chars)
  title: 'How an L4 load balancer works, packet by packet',
  goal: 'What the reader can do after this part.',
  card: { emoji: '📦', text: 'A self-contained 80–100 word paragraph. Plays in the feed.' },
  blocks: [ /* any mock-interview block, plus the ones below */ ],
});
```

Rules of thumb:
- 7–9 parts, each a few minutes of reading. Paragraphs are welcome here; depth is the point. Repeating a key idea in a later part is fine, because repetition is how it sticks.
- The **first top-level `quiz`** of each part also plays in the feed right after that part's card, so make it answerable from the card paragraph alone. Two quizzes per part; vary the answer positions.
- Include an "in the wild" part (a `wild` carousel of real companies and systems) and finish with an "Explain it back" part (`flashcards`).
- Only state facts, dates and defaults you're sure of. When in doubt, leave it out.

Deep dives can use every mock-interview block (`text`, `list`, `table`, `code` with `lang` such as `python`, `yaml`, `nginx`, `callout`, `diagram`, `quiz`, `yourturn`, `deep`, `say`, `think`). `yourturn` answers are always hidden until tapped, which makes them good "diagnose it" prompts. These blocks are deep-dive only:

| block | fields | notes |
|---|---|---|
| `stepper` | `title?, diagram?, steps[{title, text, focus?[], diagram?}]` | One step at a time with Back/Next. `focus` lists node ids and `"from>to"` edge ids of the shared `diagram` to highlight; everything else dims. A step's own `diagram` replaces the shared one. |
| `layers` | `title?, layers[{tag, name, fields[]}], views[{label, sees[tags], text}]` | Nested boxes (the first layer wraps the rest), like packet headers. Each view button blurs the layers its reader can't see. |
| `tabs` | `title?, tabs[{label, blocks[]}]` | Switchable panels of any blocks. |
| `wild` | `title?, items[{who, what?, emoji?, tags?[], text}]` | Sideways-swipe carousel of real-world usage. |
| `flashcards` | `title?, text?, cards[{q, a}]` | Tap to flip. Use for active recall at the end. |
| `stats` | `title?, stats[{value, label}], caption?` | Big numbers (value ≤ 9 chars). |

Check with `node tools/validate.js <id>` (structure, card length, quiz answers, diagram geometry, stepper focus ids) and `node tools/audit.js` (feed cards must fit a phone screen; the article must not overflow sideways). Screenshot a block with `node tools/shot.js --page=deep/<id> --at=<css selector>` and add `--js="…"` to click something first.
