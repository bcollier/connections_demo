# Connections-style Game

A simple, static web app inspired by the NYT Connections game. There are 16 words that form four related groups of four. Select four related words and press Submit. You have 3 mistakes allowed before the game ends.

## Run locally

Open `index.html` in a browser:

- macOS Finder: double-click `index.html`.
- Terminal:
```bash
open /Users/bcollier/Code/connections_demo/index.html
```

No build step is required.

## Optional: Enable AI-generated puzzles

This project includes a tiny Node server that calls OpenAI with web search to generate puzzle categories and words tailored to a name and location.

1) Install dependencies and set your API key:

```bash
cd /Users/bcollier/Code/connections_demo
npm install
cp .env.example .env
# edit .env and set OPENAI_API_KEY
```

2) Start the server:

```bash
npm run start
# Server runs on http://localhost:3000
```

3) In the web page, enter your name and location and click "Generate puzzle with AI". The app will fetch `/api/generate` and load a new puzzle. If generation fails, a safe fallback puzzle is used.

Model configuration
- Defaults to GPT-5 with web search. To override:

```bash
echo "MODEL=gpt-5" >> .env  # or set another supported model
```

## Customize the puzzle

Edit `script.js` and change `DEFAULT_PUZZLE.categories` to your own labels and words.

- Keep four categories.
- Each with exactly four distinct words.
- Words are shown in uppercase for consistency, but any strings work.

## Gameplay

- Select tiles to choose up to four words.
- Click Submit to check.
- Correct sets are locked and displayed above the grid.
- You get 3 total mistakes. After that, the game reveals remaining groups and ends.
- Shuffle reorders remaining tiles. Deselect clears your current selection. Reset starts a new game.

## Colors and celebrations

Each category includes a color that reflects its difficulty (inspired by NYT):

- Yellow: simplest
- Green: simple
- Blue: medium
- Purple: hardest

When a group is solved, its solved chip is tinted with the assigned color. The app also triggers celebratory animations with increasing intensity for the 1st, 2nd, and 3rd solved groups, and a large fireworks-style celebration when all four groups are solved. Animations are client-side only and require no external libraries.

## Notes

This app is intentionally minimal and client-only, no tracking, and works offline once loaded.
