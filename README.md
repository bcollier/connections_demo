# Connections About You

**Play it live:** https://connections-about-you.vercel.app (the AI writes a new puzzle about you)  
**Saved-puzzle demo:** https://bcollier.github.io/connections_demo/ (no server, plays five puzzles the AI wrote earlier)

A Connections-style word game in the style of the NYT puzzle, where an AI writes the four groups about the player. Type a name and a town, and a small Node server asks GPT-5, with web search, for four groups of four words drawn from that person's public footprint, their city, and some playful guesses about their tastes. Find the four groups with no more than three mistakes. When the game ends, the page shows why each group was chosen and links to what the AI read.

<p align="center"><img src="docs/screenshot.jpg" alt="The game mid-puzzle: QUARTER-MUNCHING ARCADE ICONS solved in yellow above a grid of twelve words, two of them selected" width="720"></p>

## The GitHub Pages demo

GitHub Pages only serves static files, and an OpenAI key cannot live in a public web page: anything the browser can read, a visitor can read. So the demo has no live generation. Its button plays the five puzzles GPT-5 wrote for "Ben Collier, Pittsburgh, PA" on September 29, 2025, one per click, saved from the server's history in [`demo/puzzles.js`](demo/puzzles.js). Everything else is the real game: selection, mistakes, the colored groups, the per-group notes, the closing explanation, and the links.

[`viewer.html`](https://bcollier.github.io/connections_demo/viewer.html) lists the same saved puzzles side by side.

## The live version on Vercel

https://connections-about-you.vercel.app serves the same page, and `api/generate.js` runs the generator as a Vercel function. The OpenAI key is stored only in the Vercel project's environment variables (`OPENAI_API_KEY`), never in the page or the repo.

Because anyone can press the button, the cost has limits, outermost first:

1. **A hard spend limit at OpenAI.** The key belongs to its own OpenAI project, with a monthly budget and "Enforce a hard limit" turned on. Past the budget OpenAI refuses the call, and the page says so and plays a saved puzzle.
2. **Only this page may call it.** Requests from other sites, or with no `Origin`, get a 403.
3. **Per-visitor limits.** Three puzzles per 15 minutes and eight a day per IP address, and at most two puzzles in progress per server instance. These counters live in memory and reset when Vercel starts a fresh instance, so they slow abuse rather than stop it; the OpenAI limit is the real cap.

On Vercel nothing is written to disk. Names and towns typed by visitors are not stored, `GET /api/history` does not exist, and the "avoid repeating themes" memory starts from `data/history.jsonl` and is kept in memory only. If the key is missing, the budget is spent, or a call fails, the page plays a saved puzzle with a one-line note.

Deploy with `npx vercel deploy --prod` from this folder (project `connections-about-you`, team `cmu-demos`). `vercel.json` gives the function up to 300 seconds, since a puzzle takes one to three minutes.

## Run it with live AI generation

1. Install dependencies and add an OpenAI key:

   ```bash
   npm install
   cp .env.example .env
   # edit .env and set OPENAI_API_KEY
   ```

2. Start the server (port 3000):

   ```bash
   npm start
   ```

3. Open `index.html` from disk, or serve the folder (`python3 -m http.server 8000`) and open http://localhost:8000. On `localhost` or a file the page calls `http://localhost:3000` automatically. Enter a name and a location and press **Generate a Puzzle About Me!** A puzzle takes one to three minutes because the model searches the web first.

If the server is not running, the page says so and plays a saved puzzle instead. To point a hosted copy at a server you deploy yourself, set `window.CONNECTIONS_API_BASE` in [`config.js`](config.js).

## How a puzzle is made

`server/generator.js` builds one prompt and calls the OpenAI Responses API with the `web_search` tool.

- **Rules for the groups.** At least two groups are about fun things (food, games, music, nostalgia), at most one is about work, and at most one is about the place. Sixteen unique words, family friendly, public information only.
- **Examples of good groups.** The prompt includes real NYT Connections groups from [`nyt_connections_groups_history_sept2025.csv`](nyt_connections_groups_history_sept2025.csv) to show the format and the difficulty ladder (yellow easiest, then green, blue, and purple for wordplay).
- **Memory between players.** The labels of the last 20 puzzles in `data/history.jsonl` go into the prompt with a request not to repeat them.
- **Checks.** The reply is parsed out of the model text, validated with a zod schema, and normalized. If any word repeats across groups, it asks again, up to two retries. Missing per-group explanations are filled by a second, cheaper call.
- **Fallback.** If generation fails, the server returns a fixed puzzle instead of an error.

Every request and model reply is appended to `logs/app.log`, and every finished puzzle to `data/history.jsonl`. The log is git-ignored; it holds the full prompts and model output.

## Files

| Path | What it is |
| --- | --- |
| `index.html`, `styles.css`, `script.js` | The game. No build step and no libraries. |
| `config.js` | Where the generator runs. Empty means demo mode. |
| `demo/puzzles.js` | The saved GPT-5 puzzles the demo plays. |
| `viewer.html` | Lists generated puzzles, from the server's history or the saved ones. |
| `server/generator.js` | The prompt, the OpenAI call and the checks, shared by both servers. |
| `server/index.js` | Local Express server: `POST /api/generate`, `GET /api/history`, `GET /api/ping`, `POST /api/client-log`. Writes `logs/app.log` and `data/history.jsonl`. |
| `api/generate.js`, `api/ping.js`, `api/client-log.js`, `vercel.json` | The Vercel deployment: the same generator behind the cost limits above. |
| `data/history.jsonl` | Every puzzle the server has generated. |
| `nyt_connections_groups_*.csv` | Example groups used in the prompt. |

## Gameplay

- Select four tiles and press **Submit**.
- A correct set locks in at the top, tinted with its difficulty color. A wrong one costs a mistake; three mistakes end the game and reveal the rest.
- **Shuffle** reorders the tiles, **Deselect** clears your picks, **Show answers** lists every group, and **Reset Game** replays the current puzzle.
- Each solved group sets off confetti, bigger every time, and solving all four sets off fireworks. The animations are plain CSS and JavaScript.

To change the starting puzzle, edit `DEFAULT_PUZZLE` in `script.js`: four categories of four distinct words, each with a color.
