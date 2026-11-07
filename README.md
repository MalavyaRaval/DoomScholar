# DoomScholar 📱🧠

Learn system design the way you doomscroll: full-screen swipeable cards with memes, animated diagrams and quick quizzes.

- **Feed**: endless vertical scroll through topics (Load Balancers, Redis, Kafka, Design YouTube…). Snap-scrolls one card at a time, like Reels/TikTok.
- **Card types**: meme formats (classic top/bottom text, "Drake", expanding brain, interviewer chat), concepts, analogies, animated architecture diagrams, comparisons, numbers, code, inline MCQs, TL;DRs.
- **Quiz tab**: random MCQs by topic or across everything, with explanations, scores, and a "fix my mistakes" mode.
- **Saved**: double-tap any card (or hit ❤️) to save it for revision.
- **XP + streaks**: progress is stored in your browser (localStorage), with no account or server.
- **Learn anything**: Topics → "Add a deck" gives you an AI prompt. Paste it into Claude/ChatGPT with any topic (Docker, React, ML…) and paste the JSON back. The deck lives on that device.
- **Installable + offline**: it's a PWA. Add it to your home screen and it opens full-screen and works offline.

It's plain HTML/CSS/JS with **no build step and no dependencies**, so any free static host works.

## Run it locally

```bash
node tools/serve.js          # → http://localhost:8080
```

It also prints a `http://192.168.x.x:8080` address. Open that on your phone (same Wi-Fi) to try it before deploying. (`python -m http.server 8080` works too.)

## Deploy for free

### Option A: GitHub Pages

1. Create a new repo on GitHub (e.g. `doomscholar`) and push this folder:
   ```bash
   git init && git add . && git commit -m "DoomScholar"
   git branch -M main
   git remote add origin https://github.com/<you>/doomscholar.git
   git push -u origin main
   ```
2. Repo → **Settings → Pages** → Source: **Deploy from a branch** → Branch: `main`, folder `/ (root)` → Save.
3. After ~1 minute it's live at `https://<you>.github.io/doomscholar/`.

(The `.nojekyll` file is there on purpose: it stops GitHub from running Jekyll over the site.)

### Option B: Vercel

1. Push the repo to GitHub (step 1 above).
2. Go to [vercel.com/new](https://vercel.com/new) → import the repo → Framework preset: **Other**, leave Build Command empty, Output Directory: `.` → Deploy.
3. Every `git push` redeploys automatically.

(Or from this folder: `npx vercel` and accept the defaults.)

## Put it on your phone like an app

- **iPhone (Safari)**: open your URL → Share → **Add to Home Screen**.
- **Android (Chrome)**: open your URL → ⋮ menu → **Install app** / **Add to Home screen**.

It then launches full-screen with its own icon. Progress is per device/browser.

## Adding or editing topics

Content lives in `content/` as one file per topic. See **[CONTENT_GUIDE.md](CONTENT_GUIDE.md)** for the card format.

1. Copy an existing file (e.g. `content/concepts/load-balancer.js`) to a new id.
2. Add its path to `content/manifest.js` (that's also the feed order).
3. Check it:
   ```bash
   node tools/validate.js            # schema, quiz answers, diagram geometry
   node tools/audit.js               # renders every card at phone size in headless Chrome, flags anything that overflows
   node tools/shot.js <topicId> 3 4  # screenshots cards into shots/
   ```
   (`audit` and `shot` need Node 22+ and Chrome or Edge installed.)

Tip: ask Claude to "write a new DoomScholar topic about X following CONTENT_GUIDE.md". It can then run the validator and audit itself.

## Project layout

```
index.html              app shell
css/style.css           all styling
js/app.js               feed, topics, quiz, saved, deck import
js/cards.js             one renderer per card type
js/diagram.js           JSON → animated SVG architecture diagrams
js/storage.js           progress / XP / streak in localStorage
content/manifest.js     list + order of topic files
content/**/*.js         the topics
sw.js                   offline support (network-first cache)
tools/                  local dev server, validator, phone-size audit, screenshots
```
