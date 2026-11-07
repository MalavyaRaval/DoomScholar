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
