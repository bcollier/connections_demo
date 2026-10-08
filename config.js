// Where the puzzle generator runs. Usually leave this empty:
// - on Vercel the page calls its own /api/generate (api/generate.js);
// - on localhost or a file it calls http://localhost:3000 (server/index.js);
// - on GitHub Pages there is no server, so the button plays saved AI puzzles
//   (the About Ben pack in packs/ben.json).
// Set a URL here only to point a copy at a server somewhere else.
window.CONNECTIONS_API_BASE = '';
