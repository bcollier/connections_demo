/*
  The page around the game: the theme packs (played by player/player.js) and,
  in the About Ben theme, the form that asks the live server for a new puzzle.

  Live generation needs a server holding the AI key: the Vercel deployment
  (same origin, api/generate.js) or server/index.js on localhost:3000. The
  GitHub Pages copy has no server, so it plays the saved puzzles in the
  About Ben pack instead.
*/
const API_BASE = resolveApiBase();
const DEMO_MODE = API_BASE === null;

function resolveApiBase() {
  const configured = (window.CONNECTIONS_API_BASE || '').trim();
  if (configured) return configured.replace(/\/$/, '');
  if (location.protocol === 'file:' || ['localhost', '127.0.0.1'].includes(location.hostname)) return 'http://localhost:3000';
  if (location.hostname.endsWith('github.io')) return null;
  return ''; // same origin: the Vercel deployment
}

const genPanel = document.getElementById('genPanel');
const genForm = document.getElementById('genForm');
const nameInput = document.getElementById('nameInput');
const locationInput = document.getElementById('locationInput');
const generateBtn = document.getElementById('generateBtn');
const genStatus = document.getElementById('genStatus');
const demoNote = document.getElementById('demoNote');

if (DEMO_MODE) {
  genForm.hidden = true;
  demoNote.hidden = false;
}

const game = window.ConnectionsPlayer.mount(document.getElementById('game'), {
  packs: window.CONNECTIONS_PACKS,
  pack: 'ben',
  useUrl: true,
  shareUrl: location.protocol.startsWith('http') ? location.origin + location.pathname : 'https://bcollier.github.io/connections_demo/',
  onChange(packId) {
    // The form only makes sense next to the About Ben theme (and a live puzzle).
    genPanel.hidden = !(packId === 'ben' || packId === 'live');
    document.body.dataset.theme = packId === 'live' ? 'ben' : packId;
  },
});

const LOADER_MESSAGES = ['Asking the AI...', 'Searching the web...', 'Picking four groups...', 'Checking for repeated words...', 'Writing the reasons...'];
let loaderTimer = null;

genForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = nameInput.value.trim();
  const town = locationInput.value.trim();
  if (!name || !town) return;
  generateBtn.disabled = true;
  let i = 0;
  genStatus.textContent = LOADER_MESSAGES[0] + ' (this takes 30 seconds to 3 minutes)';
  loaderTimer = setInterval(() => { genStatus.textContent = LOADER_MESSAGES[++i % LOADER_MESSAGES.length]; }, 2500);
  try {
    const data = await fetchGeneratedPuzzle(name, town);
    game.loadPuzzle({ ...data, title: `About ${name}` }, {
      name: `About ${name}, ${town}`,
      disclaimer: 'Written just now by an AI from public web pages. It can be wrong, and some guesses about your tastes are made up for fun.',
    });
    genStatus.textContent = 'Your puzzle is ready.';
  } catch (err) {
    console.error(err);
    clientLog('error', 'client_generate_exception', { err: String(err) });
    const saved = window.CONNECTIONS_PACKS.find(p => p.id === 'ben');
    game.setPack('ben', Math.floor(Math.random() * saved.puzzles.length));
    genStatus.textContent = err.userMessage || 'Could not reach the AI server, so this is a saved puzzle about me.';
  } finally {
    clearInterval(loaderTimer);
    generateBtn.disabled = false;
  }
});

async function fetchGeneratedPuzzle(name, location) {
  clientLog('info', 'client_generate_click', {});
  const res = await fetch(`${API_BASE}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, location }),
  });
  if (!res.ok) {
    clientLog('error', 'client_generate_http_error', { status: res.status });
    const err = new Error(`HTTP ${res.status}`);
    try { err.userMessage = (await res.json()).message; } catch { /* no message */ }
    throw err;
  }
  return res.json();
}

// Best-effort breadcrumb to the local server's log; never blocks the game.
function clientLog(level, message, context) {
  if (DEMO_MODE) return;
  fetch(`${API_BASE}/api/client-log`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ level, message, context }),
  }).catch(() => {});
}
