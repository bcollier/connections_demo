/*
  Simple Connections-style game
  - 16 tiles, 4 groups of 4
  - Select 4 tiles, submit to check
  - 3 mistakes allowed total

  Puzzle sources, tried in this order:
  1. The Node server in server/ (auto-detected; holds the OpenAI key in .env)
  2. A browser-side call to OpenAI with a key the visitor pastes in (kept in
     localStorage only, so the static GitHub Pages build never needs a secret)
  3. Bundled sample puzzles from samples.js
*/

const DEFAULT_PUZZLE = {
  // Provide four categories with labels and words.
  // You can replace these with any 4 x 4 words you'd like.
  categories: [
    { label: 'Fruits', words: ['APPLE', 'PEAR', 'PLUM', 'GRAPE'], color: 'Yellow' },
    { label: 'Colors', words: ['RED', 'BLUE', 'GREEN', 'PINK'], color: 'Green' },
    { label: 'Pets', words: ['DOG', 'CAT', 'FISH', 'BIRD'], color: 'Blue' },
    { label: 'Clothes', words: ['SHIRT', 'PANTS', 'HAT', 'COAT'], color: 'Purple' },
  ],
};

// Browser-side generation settings. Override before script.js loads if needed:
//   <script>window.CONNECTIONS_API_BASE = 'https://my-server.example';</script>
const OPENAI_MODEL = window.CONNECTIONS_MODEL || 'gpt-5';
const OPENAI_ENDPOINT = 'https://api.openai.com/v1/responses';
const KEY_STORAGE = 'connections.openaiKey';
const COLOR_ORDER = ['Yellow', 'Green', 'Blue', 'Purple'];

/** @typedef {{ label: string, words: string[], color?: string, explanation?: string }} Category */

/**
 * GameState tracks the current puzzle words, which are solved, selection, and mistakes.
 * This is a minimal state container so we can reset/restart easily.
 */
class GameState {
  /**
   * @param {{ categories: Category[] }} puzzle
   */
  constructor(puzzle) {
    this.puzzle = puzzle;
    this.allWords = puzzle.categories.flatMap(c => c.words);
    this.categoryByWord = new Map();
    for (const category of puzzle.categories) {
      for (const word of category.words) {
        this.categoryByWord.set(word, category.label);
      }
    }

    this.unsolvedWords = new Set(this.allWords);
    this.solvedGroups = []; // { label, words[], color, note }
    this.selected = new Set();
    this.mistakes = 0;
    this.maxMistakes = 3;
    this.gridOrder = shuffleArray([...this.allWords]);
  }

  get isGameOver() {
    return this.mistakes >= this.maxMistakes || this.solvedGroups.length === 4;
  }
}

// DOM elements
const gridEl = document.getElementById('grid');
const submitBtn = document.getElementById('submitBtn');
const shuffleBtn = document.getElementById('shuffleBtn');
const clearBtn = document.getElementById('clearBtn');
const resetBtn = document.getElementById('resetBtn');
const mistakesEl = document.getElementById('mistakes');
const messageEl = document.getElementById('message');
const solvedEl = document.getElementById('solved');
const nameInput = document.getElementById('nameInput');
const locationInput = document.getElementById('locationInput');
const generateBtn = document.getElementById('generateBtn');
const sampleBtn = document.getElementById('sampleBtn');
const explanationEl = document.getElementById('explanation');
const recommendationsEl = document.getElementById('recommendations');
const answersBtn = document.getElementById('answersBtn');
const answersEl = document.getElementById('answers');
const notesEl = document.getElementById('notes');
const loaderEl = document.getElementById('loader');
const loaderTextEl = document.getElementById('loaderText');
const sourceEl = document.getElementById('source');
const keyPanelEl = document.getElementById('keyPanel');
const keyInput = document.getElementById('keyInput');
const saveKeyBtn = document.getElementById('saveKeyBtn');
const clearKeyBtn = document.getElementById('clearKeyBtn');
const keyStatusEl = document.getElementById('keyStatus');

// Loader messages must be defined before any call to startLoader()
const LOADER_MESSAGES = [
  'Asking the AI…',
  'Searching the web…',
  'Digging for the best categories for YOU…',
  'Building…',
  'Puzzling…',
  'Cross-checking sources…',
];
let loaderTimer = null;

let state = new GameState(DEFAULT_PUZZLE);
let lastSampleIndex = -1;
let apiBasePromise = null; // resolved once, see resolveApiBase()
let puzzleMeta = { explanation: '', recommendations: [], categories: [] };

init();

function init() {
  render();
  wireEvents();
  stopLoader();
  updateKeyStatus();
  // Detect the local server in the background so the UI can say where puzzles come from.
  resolveApiBase().then(updateSourceHint);
}

function wireEvents() {
  submitBtn.addEventListener('click', onSubmit);
  shuffleBtn.addEventListener('click', onShuffle);
  clearBtn.addEventListener('click', onClear);
  resetBtn.addEventListener('click', resetGame);
  if (generateBtn) generateBtn.addEventListener('click', onGenerate);
  if (sampleBtn) sampleBtn.addEventListener('click', onSample);
  if (answersBtn) answersBtn.addEventListener('click', onToggleAnswers);
  if (saveKeyBtn) saveKeyBtn.addEventListener('click', onSaveKey);
  if (clearKeyBtn) clearKeyBtn.addEventListener('click', onClearKey);
  if (keyInput) keyInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); onSaveKey(); } });
}

function resetGame() {
  loadPuzzle(DEFAULT_PUZZLE, { explanation: '', recommendations: [] });
  announce('New game started.');
}

function onClear() {
  state.selected.clear();
  updateControls();
  updateTilesSelection();
}

function onShuffle() {
  if (state.isGameOver) return;
  state.gridOrder = shuffleArray(state.gridOrder);
  renderGrid();
}

function onSubmit() {
  if (state.isGameOver) return;
  const selection = [...state.selected];
  if (selection.length !== 4) return;

  // Validate: all four belong to the same category
  const labels = selection.map(w => state.categoryByWord.get(w));
  const first = labels[0];
  const isSameCategory = labels.every(l => l === first);

  if (isSameCategory) {
    // Ensure they are not already solved
    const alreadySolved = state.solvedGroups.some(g => g.label === first);
    if (alreadySolved) {
      flashMessage('That group is already solved.', 'warn');
      return;
    }

    // Lock this group
    const color = getCategoryColor(first);
    // Derive a short note if we have a matching explanation
    const catMeta = puzzleMeta.categories.find(c => c.label === first);
    const note = catMeta?.explanation || '';
    state.solvedGroups.push({ label: first, words: selection.slice().sort(), color, note });
    selection.forEach(w => state.unsolvedWords.delete(w));
    state.selected.clear();
    render();
    flashMessage('Correct!', 'success');
    celebrateOnSolve(state.solvedGroups.length);

    // Check for win
    if (state.solvedGroups.length === 4) {
      announce('You solved all groups!');
      endGame(true);
    }
  } else {
    state.mistakes += 1;
    flashMessage(`Not quite. ${state.maxMistakes - state.mistakes} chance(s) left.`, 'error');
    if (state.mistakes >= state.maxMistakes) {
      endGame(false);
    }
    updateStatus();
    // brief wrong flash
    wrongFlash(selection);
  }
}

function endGame(won) {
  // Reveal remaining categories if any
  if (!won) {
    const remaining = remainingGroups();
    for (const group of remaining) {
      state.solvedGroups.push({ label: group.label, words: group.words.slice().sort(), color: group.color || 'Yellow' });
    }
    renderSolved();
    announce('Game over.');
  } else {
    announce('Congratulations!');
  }
  updateControls();
}

function remainingGroups() {
  const remaining = [];
  for (const category of state.puzzle.categories) {
    const solved = state.solvedGroups.some(g => g.label === category.label);
    if (!solved) remaining.push(category);
  }
  return remaining;
}

function wrongFlash(words) {
  const tiles = [...gridEl.querySelectorAll('.tile')];
  for (const tile of tiles) {
    const word = tile.dataset.word;
    if (words.includes(word)) {
      tile.classList.add('wrong');
      setTimeout(() => tile.classList.remove('wrong'), 450);
    }
  }
}

function render() {
  renderSolved();
  renderGrid();
  updateStatus();
  updateControls();
  clearMessage();
}

function renderSolved() {
  solvedEl.innerHTML = '';
  for (const group of state.solvedGroups) {
    const div = document.createElement('div');
    div.className = 'group';
    const labelEl = document.createElement('span');
    labelEl.textContent = group.label;
    const wordsEl = document.createElement('span');
    wordsEl.textContent = group.words.join(', ');
    div.append(labelEl, wordsEl);
    applyGroupColor(div, group.color);
    solvedEl.appendChild(div);
  }
  renderNotes();
}

function renderGrid() {
  gridEl.innerHTML = '';
  for (const word of state.gridOrder) {
    const isSolved = !state.unsolvedWords.has(word);
    if (isSolved) continue; // solved words are displayed in solved section only

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tile';
    btn.textContent = word;
    btn.dataset.word = word;
    if (state.selected.has(word)) btn.classList.add('selected');
    btn.addEventListener('click', () => onTileClick(word, btn));
    gridEl.appendChild(btn);
  }
}

function onTileClick(word, el) {
  if (state.isGameOver) return;
  if (!state.unsolvedWords.has(word)) return;

  if (state.selected.has(word)) {
    state.selected.delete(word);
  } else {
    if (state.selected.size >= 4) return; // max 4
    state.selected.add(word);
  }
  el.classList.toggle('selected');
  updateControls();
}

function updateTilesSelection() {
  const tiles = [...gridEl.querySelectorAll('.tile')];
  for (const tile of tiles) {
    const word = tile.dataset.word;
    tile.classList.toggle('selected', state.selected.has(word));
  }
}

function updateStatus() {
  mistakesEl.textContent = `Mistakes: ${state.mistakes}/${state.maxMistakes}`;
}

function updateControls() {
  const canSubmit = state.selected.size === 4 && !state.isGameOver;
  submitBtn.disabled = !canSubmit;
  shuffleBtn.disabled = state.isGameOver;
  clearBtn.disabled = state.selected.size === 0 || state.isGameOver;
}

function announce(text) {
  messageEl.textContent = text;
}

function flashMessage(text, type) {
  messageEl.textContent = text;
  messageEl.classList.remove('success', 'error', 'warn');
  if (type) messageEl.classList.add(type);
  setTimeout(() => messageEl.classList.remove('success', 'error', 'warn'), 800);
}

// Utility
function clearMessage() {
  messageEl.textContent = '';
  messageEl.classList.remove('success', 'error', 'warn');
}

function shuffleArray(arr) {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// ---------------------------------------------------------------------------
// Loading puzzles (shared by the server, the browser-side generator, and samples)
// ---------------------------------------------------------------------------

/**
 * Replace the current game with a new puzzle and cache its explanations for reveal.
 * @param {{ categories: Category[] }} puzzle
 * @param {{ explanation?: string, recommendations?: Array<{title?: string, url: string}> }} meta
 */
function loadPuzzle(puzzle, meta = {}) {
  state = new GameState(puzzle);
  puzzleMeta = {
    explanation: meta.explanation || '',
    recommendations: Array.isArray(meta.recommendations) ? meta.recommendations : [],
    categories: puzzle.categories.map(c => ({ label: c.label, explanation: c.explanation || '' })),
  };
  render();
  stopLoader();

  // Hide explanation & references until completion
  explanationEl.textContent = '';
  recommendationsEl.innerHTML = '';
  notesEl.innerHTML = '';

  // Answers box (revealed on demand)
  answersEl.hidden = true;
  answersEl.innerHTML = '';
  if (answersBtn) answersBtn.textContent = 'Show answers';
  for (const cat of puzzle.categories) {
    const row = document.createElement('div');
    row.className = 'answer';
    const label = document.createElement('div');
    label.className = 'label';
    label.textContent = cat.label;
    const words = document.createElement('div');
    words.textContent = cat.words.join(', ');
    row.appendChild(label);
    row.appendChild(words);
    if (cat.explanation) {
      const expl = document.createElement('div');
      expl.textContent = cat.explanation;
      row.appendChild(expl);
    }
    answersEl.appendChild(row);
  }
}

/** Turn a raw generator response into a puzzle, or throw if it is not playable. */
function normalizePuzzle(data) {
  if (!data || !Array.isArray(data.categories) || data.categories.length !== 4) {
    throw new Error('Expected exactly 4 categories');
  }
  const categories = data.categories.map(c => ({
    label: String(c.label || '').trim(),
    words: (Array.isArray(c.words) ? c.words : []).slice(0, 4).map(normalizeWordForDisplay),
    explanation: c.explanation ? String(c.explanation).trim() : '',
    color: normalizeColor(c.color),
  }));
  if (categories.some(c => !c.label || c.words.length !== 4 || c.words.some(w => !w))) {
    throw new Error('Each category needs a label and 4 words');
  }
  const canonical = categories.flatMap(c => c.words.map(canonicalizeWord));
  if (new Set(canonical).size !== 16) throw new Error('Words must be unique across categories');
  return { categories: ensureColors(categories) };
}

function normalizeWordForDisplay(word) {
  return String(word).toUpperCase().replace(/\s+/g, ' ').replace(/[^A-Z0-9 \-']/g, '').trim();
}
function canonicalizeWord(word) {
  return String(word).toUpperCase().replace(/[^A-Z0-9]/g, '');
}
function normalizeColor(input) {
  if (!input) return undefined;
  const v = String(input).trim().toLowerCase();
  return COLOR_ORDER.find(c => v.startsWith(c[0].toLowerCase()));
}
function ensureColors(categories) {
  const used = new Set(categories.map(c => c.color).filter(Boolean));
  const remaining = COLOR_ORDER.filter(c => !used.has(c));
  return categories.map((c, idx) => {
    if (COLOR_ORDER.includes(c.color)) return c;
    return { ...c, color: remaining.shift() || COLOR_ORDER[idx % COLOR_ORDER.length] };
  });
}

// ---------------------------------------------------------------------------
// Puzzle source 1: the local Node server (server/index.js)
// ---------------------------------------------------------------------------

/** Find a reachable API server once. Resolves to a base URL or null. */
function resolveApiBase() {
  if (apiBasePromise) return apiBasePromise;
  apiBasePromise = (async () => {
    const candidates = [];
    if (window.CONNECTIONS_API_BASE) {
      candidates.push(String(window.CONNECTIONS_API_BASE).replace(/\/$/, ''));
    } else {
      if (/^https?:$/.test(location.protocol)) candidates.push(location.origin);
      const local = location.protocol === 'file:' || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
      if (local && location.port !== '3000') candidates.push('http://localhost:3000');
    }
    for (const base of candidates) {
      if (await pingServer(base)) return base;
    }
    return null;
  })();
  return apiBasePromise;
}

async function pingServer(base) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 1500);
  try {
    const res = await fetch(`${base}/api/ping`, { signal: ctrl.signal });
    if (!res.ok) return false;
    const json = await res.json();
    return json && json.ok === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function clientLog(base, level, message, context) {
  if (!base) return;
  try {
    await fetch(`${base}/api/client-log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level, message, context }),
    });
  } catch {}
}

async function generateViaServer(base, name, location) {
  await clientLog(base, 'info', 'client_generate_click', { name, location });
  const res = await fetch(`${base}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, location }),
  });
  if (!res.ok) {
    await clientLog(base, 'error', 'client_generate_http_error', { status: res.status });
    throw new Error(`Server responded with ${res.status}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Puzzle source 2: OpenAI called straight from the browser with the visitor's key
// ---------------------------------------------------------------------------

function getStoredKey() {
  try { return localStorage.getItem(KEY_STORAGE) || ''; } catch { return ''; }
}

function onSaveKey() {
  const key = (keyInput?.value || '').trim();
  if (!key) { updateKeyStatus('Paste a key first.'); return; }
  try { localStorage.setItem(KEY_STORAGE, key); } catch {}
  if (keyInput) keyInput.value = '';
  updateKeyStatus();
  flashMessage('Key saved in this browser only.', 'success');
}

function onClearKey() {
  try { localStorage.removeItem(KEY_STORAGE); } catch {}
  if (keyInput) keyInput.value = '';
  updateKeyStatus();
}

function updateKeyStatus(text) {
  if (!keyStatusEl) return;
  if (text) { keyStatusEl.textContent = text; return; }
  const key = getStoredKey();
  keyStatusEl.textContent = key
    ? `A key ending in …${key.slice(-4)} is saved in this browser.`
    : 'No key saved.';
  if (clearKeyBtn) clearKeyBtn.hidden = !key;
}

function updateSourceHint(base) {
  if (!sourceEl) return;
  if (base) {
    sourceEl.textContent = 'Live generation via the local server.';
    if (keyPanelEl) keyPanelEl.hidden = true;
  } else {
    sourceEl.textContent = 'Static build: live generation needs your own OpenAI key, or try a sample.';
    if (keyPanelEl) keyPanelEl.hidden = false;
  }
}

function buildClientPrompt({ name, location }) {
  return `You are designing a Connections-style word GROUPING GAME for a specific player. It must feel fun, playful, and surprising — not like a resume.

Player: Name = ${name} | Location = ${location}.

TONE
- Make this a party-friendly mini-game. Be imaginative and lighthearted. It's okay to SPECULATE about hobbies and tastes (food, travel, music, sports, nostalgic media, games, outdoors, pop culture), as long as it's family-friendly and non-sensitive.

SOURCES
- USE WEB SEARCH only for public, non-sensitive info. Never include private data.

CONSTRAINTS
  1) At least TWO categories must be fun/non-professional (hobbies, culture, food, humor, etc.).
  2) At MOST ONE category may be tied to work/professional background.
  3) At MOST ONE category may be primarily location-based.
  4) Words must be SINGLE TOKENS for gameplay; spaces or hyphens are allowed when natural (e.g., MOUNT WASHINGTON).
  5) No overlaps across categories. Exactly 16 unique words.
  6) Keep everything friendly and suitable for all ages.

Provide a SHORT explanation per category (why the set fits and why it might delight this player). Also provide 3-6 recent links (articles/videos) about the chosen topics.

EXAMPLES OF GOOD GROUPS (format and difficulty):
- KINDS OF UNDERWEAR: BOXER, BRIEF, HIPSTER, THONG
- THINGS WITH KEYS: PIANO, MAP, KEYBOARD, LOCK
- ___ BALL: EIGHT, ODD, CANNON, MEAT
- ANAGRAMS: LISTEN, SILENT, TINSEL, ENLIST

COLOR RUBRIC
- Yellow (Simplest): straightforward, common categories.
- Green (Simple): slightly more challenging, specific but clear.
- Blue (Medium): moderately difficult, requires lateral thinking.
- Purple (Hardest): most difficult, wordplay/puns/obscure references.

Return ONLY JSON with this structure:
{
  "categories": [
    { "label": "Category A", "words": ["WORD1", "WORD2", "WORD3", "WORD4"], "explanation": "short per-category reason", "color": "Yellow|Green|Blue|Purple" },
    { "label": "Category B", "words": ["WORD1", "WORD2", "WORD3", "WORD4"], "explanation": "...", "color": "Yellow|Green|Blue|Purple" },
    { "label": "Category C", "words": ["WORD1", "WORD2", "WORD3", "WORD4"], "explanation": "...", "color": "Yellow|Green|Blue|Purple" },
    { "label": "Category D", "words": ["WORD1", "WORD2", "WORD3", "WORD4"], "explanation": "...", "color": "Yellow|Green|Blue|Purple" }
  ],
  "explanation": "one paragraph describing the playful rationale tailored to the player",
  "recommendations": [
    { "title": "Title", "url": "https://...", "type": "article|video|podcast" }
  ]
}`;
}

/** Pull the assistant's text out of a raw Responses API payload. */
function extractOutputText(payload) {
  if (typeof payload?.output_text === 'string') return payload.output_text;
  const parts = [];
  for (const item of payload?.output || []) {
    if (item.type !== 'message') continue;
    for (const c of item.content || []) {
      if (c.type === 'output_text' && typeof c.text === 'string') parts.push(c.text);
    }
  }
  return parts.join('\n');
}

function extractJsonCandidate(text) {
  try { return JSON.parse(text); } catch {}
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) {
    try { return JSON.parse(fenced[1].trim()); } catch {}
  }
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) {
    try { return JSON.parse(text.slice(first, last + 1)); } catch {}
  }
  throw new Error('The model did not return valid JSON');
}

async function generateInBrowser(key, name, location, maxRetries = 1) {
  const basePrompt = buildClientPrompt({ name, location });
  let lastError = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let prompt = basePrompt;
    if (attempt > 0) {
      prompt += `\n\nYour previous output had issues (${lastError?.message || 'schema errors'}). Regenerate STRICTLY ensuring: 4 categories x 4 words = 16 UNIQUE SINGLE-TOKEN words across all categories. No overlaps. Return ONLY raw JSON.`;
    }
    const res = await fetch(OPENAI_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: OPENAI_MODEL, tools: [{ type: 'web_search' }], input: prompt }),
    });
    if (!res.ok) {
      let detail = `OpenAI responded with ${res.status}`;
      try { detail = (await res.json())?.error?.message || detail; } catch {}
      throw new Error(detail); // auth/quota/model errors will not improve on retry
    }
    const payload = await res.json();
    try {
      const data = extractJsonCandidate(extractOutputText(payload));
      const puzzle = normalizePuzzle(data);
      return { puzzle, explanation: data.explanation, recommendations: data.recommendations };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('Generation failed');
}

// ---------------------------------------------------------------------------
// Puzzle source 3: bundled samples
// ---------------------------------------------------------------------------

function onSample() {
  const samples = Array.isArray(window.SAMPLE_PUZZLES) ? window.SAMPLE_PUZZLES : [];
  if (!samples.length) { flashMessage('No sample puzzles bundled.', 'warn'); return; }
  let idx = Math.floor(Math.random() * samples.length);
  if (samples.length > 1 && idx === lastSampleIndex) idx = (idx + 1) % samples.length;
  lastSampleIndex = idx;
  const sample = samples[idx];
  try {
    loadPuzzle(normalizePuzzle(sample), sample);
    flashMessage(`Sample loaded: ${sample.title || 'puzzle ' + (idx + 1)}`, 'success');
  } catch (err) {
    console.error(err);
    flashMessage('That sample is malformed.', 'error');
  }
}

// ---------------------------------------------------------------------------
// Generate button: pick whichever source is available
// ---------------------------------------------------------------------------

async function onGenerate() {
  const name = (nameInput?.value || '').trim() || 'Ben Collier';
  const location = (locationInput?.value || '').trim() || 'Pittsburgh, PA';
  const base = await resolveApiBase();
  const key = base ? '' : getStoredKey();

  if (!base && !key) {
    if (keyPanelEl) { keyPanelEl.hidden = false; keyPanelEl.open = true; }
    if (keyInput) keyInput.focus();
    flashMessage('Add an OpenAI key for live generation, or try a sample puzzle.', 'warn');
    return;
  }

  try {
    generateBtn.disabled = true;
    generateBtn.textContent = 'Generating…';
    startLoader();

    let puzzle, meta;
    if (base) {
      const data = await generateViaServer(base, name, location);
      puzzle = normalizePuzzle(data);
      meta = data;
    } else {
      const result = await generateInBrowser(key, name, location);
      puzzle = result.puzzle;
      meta = result;
    }
    loadPuzzle(puzzle, meta);
    flashMessage('AI puzzle loaded!', 'success');
  } catch (e) {
    console.error(e);
    await clientLog(base, 'error', 'client_generate_exception', { err: String(e) });
    flashMessage(`AI generation failed: ${e.message || e}`, 'error');
  } finally {
    generateBtn.disabled = false;
    generateBtn.textContent = 'Generate a Puzzle About Me!';
    stopLoader();
  }
}

function onToggleAnswers() {
  answersEl.hidden = !answersEl.hidden;
  answersBtn.textContent = answersEl.hidden ? 'Show answers' : 'Hide answers';
}

// Colors and celebrations
function getCategoryColor(label) {
  const cat = state.puzzle.categories.find(c => c.label === label);
  return cat?.color;
}

function applyGroupColor(el, color) {
  const map = {
    Yellow: '#f59e0b',
    Green: '#22c55e',
    Blue: '#3b82f6',
    Purple: '#a855f7',
  };
  const c = map[color] || '#9ca3af';
  el.style.borderColor = c;
  el.style.background = `linear-gradient(0deg, ${c}22, transparent)`;
}

function celebrateOnSolve(count) {
  if (count <= 0) return; // only on actual solves
  const intensity = ['small', 'medium', 'large', 'mega'][Math.min(count - 1, 3)];
  spawnConfetti(intensity);
  if (count === 4) {
    spawnFireworks();
    // Reveal overall explanation and recommendations on completion
    explanationEl.textContent = puzzleMeta.explanation || '';
    renderNotes();
    renderCachedRecommendations();
  }
}

// Confetti particles
function spawnConfetti(level) {
  const n = level === 'small' ? 80 : level === 'medium' ? 160 : level === 'large' ? 280 : 520;
  for (let i = 0; i < n; i++) {
    const p = document.createElement('div');
    p.className = 'confetti';
    p.style.left = Math.random() * 100 + 'vw';
    p.style.background = `hsl(${Math.floor(Math.random()*360)}, 90%, 55%)`;
    p.style.animationDuration = 2 + Math.random() * 3 + 's';
    document.body.appendChild(p);
    setTimeout(() => p.remove(), 6000);
  }
}

function spawnFireworks() {
  const bursts = 14;
  for (let b = 0; b < bursts; b++) {
    const cx = Math.random() * window.innerWidth;
    const cy = Math.random() * window.innerHeight * 0.6 + 40;
    for (let i = 0; i < 60; i++) {
      const s = document.createElement('div');
      s.className = 'spark';
      s.style.left = cx + 'px';
      s.style.top = cy + 'px';
      const angle = (Math.PI * 2 * i) / 60;
      const dist = 40 + Math.random() * 160;
      const tx = Math.cos(angle) * dist;
      const ty = Math.sin(angle) * dist;
      s.style.setProperty('--tx', tx + 'px');
      s.style.setProperty('--ty', ty + 'px');
      s.style.background = `hsl(${Math.floor(Math.random()*360)}, 95%, 60%)`;
      document.body.appendChild(s);
      setTimeout(() => s.remove(), 2500);
    }
  }
}

function renderNotes() {
  notesEl.innerHTML = '';
  for (const g of state.solvedGroups) {
    if (!g.note) continue;
    const p = document.createElement('div');
    p.textContent = g.note;
    notesEl.appendChild(p);
  }
}

function renderCachedRecommendations() {
  recommendationsEl.innerHTML = '';
  for (const rec of puzzleMeta.recommendations) {
    if (!rec || !rec.url || !/^https?:\/\//i.test(rec.url)) continue;
    const a = document.createElement('a');
    a.href = rec.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = rec.title || rec.url;
    const div = document.createElement('div');
    div.appendChild(a);
    recommendationsEl.appendChild(div);
  }
}

function startLoader() {
  let idx = 0;
  if (loaderEl) loaderEl.hidden = false;
  if (loaderTextEl) loaderTextEl.textContent = LOADER_MESSAGES[idx % LOADER_MESSAGES.length];
  loaderTimer = setInterval(() => {
    idx += 1;
    if (loaderTextEl) loaderTextEl.textContent = LOADER_MESSAGES[idx % LOADER_MESSAGES.length];
    if (loaderEl) loaderEl.setAttribute('aria-label', loaderTextEl ? loaderTextEl.textContent : 'Loading');
    if (loaderEl) loaderEl.setAttribute('title', loaderTextEl ? loaderTextEl.textContent : 'Loading');
  }, 1800);
}
function stopLoader() {
  if (loaderTimer) clearInterval(loaderTimer);
  loaderTimer = null;
  if (loaderEl) loaderEl.hidden = true;
}
