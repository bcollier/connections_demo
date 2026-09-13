# Connections-style Game

A small web app inspired by the NYT Connections game. There are 16 words that form four related groups of four. Select four related words and press Submit. You get 3 mistakes before the game ends.

The twist: type your name and location and the app asks GPT-5 (with web search) to build a puzzle about *you*, with a color-coded difficulty rubric, per-category explanations, and a few links to read afterwards.

**Live demo:** https://bcollier.github.io/connections_demo/

## How puzzles are generated

The frontend is plain HTML/CSS/JS with no build step. It picks a puzzle source in this order:

1. **Local server** (`server/index.js`). If the page can reach it, generation goes through the server, which holds the OpenAI key in `.env` and logs each run to `logs/` and `data/`.
2. **Your own key in the browser.** On the static GitHub Pages build there is no server, so the page offers a "Use your own OpenAI key" panel. The key lives only in that browser's `localStorage` and is sent only to `api.openai.com`. Nothing is ever committed or uploaded.
3. **Bundled samples** (`samples.js`). "Try a sample" loads one of three hand-written puzzles so the demo is playable with no key at all.

No API key is stored anywhere in this repository. `.env` is git-ignored and `.env.example` shows the expected variables.

## Run locally

Static only (samples and bring-your-own-key modes):

```bash
open index.html            # macOS
# or any static server, e.g.
python3 -m http.server 8080
```

With the AI server:

```bash
npm install
cp .env.example .env       # then set OPENAI_API_KEY in .env
npm run start              # http://localhost:3000 serves the game and the API
```

Optional `.env` settings: `MODEL` (defaults to `gpt-5`) and `PORT` (defaults to `3000`).

`viewer.html` lists past generations from `data/history.jsonl` when the server is running.

## Deploying to GitHub Pages

The site is served straight from the `main` branch root (Settings → Pages → Deploy from a branch → `main` / `/`). Every push to `main` redeploys. `.nojekyll` keeps GitHub from running Jekyll over the files.

If you later host the server somewhere (Render, Fly, a Cloudflare Worker, etc.), point the static page at it by adding this before `script.js` in `index.html`:

```html
<script>window.CONNECTIONS_API_BASE = 'https://your-server.example';</script>
```

The server already sends permissive CORS headers. Add rate limiting before exposing it publicly, since each request costs an OpenAI call.

## Customize the puzzle

Edit `script.js` and change `DEFAULT_PUZZLE.categories`, or add entries to `samples.js`.

- Keep four categories.
- Each with exactly four distinct words.
- Words are shown in uppercase, but any strings work.

## Gameplay

- Select tiles to choose up to four words.
- Click Submit to check.
- Correct sets are locked and displayed above the grid.
- You get 3 total mistakes. After that, the game reveals remaining groups and ends.
- Shuffle reorders remaining tiles. Deselect clears your current selection. Reset starts a new game.
- Solve all four groups to see the AI's overall explanation and reading links.
