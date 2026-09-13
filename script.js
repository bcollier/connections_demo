/*
  Simple Connections-style game
  - 16 tiles, 4 groups of 4
  - Select 4 tiles, submit to check
  - 3 mistakes allowed total
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

/** @typedef {{ label: string, words: string[] }} Category */

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
    this.solvedGroups = []; // { label, words[] }
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
const explanationEl = document.getElementById('explanation');
const recommendationsEl = document.getElementById('recommendations');
const answersBtn = document.getElementById('answersBtn');
const answersEl = document.getElementById('answers');
const notesEl = document.getElementById('notes');
const loaderEl = document.getElementById('loader');
const loaderTextEl = document.getElementById('loaderText');

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

init();

function init() {
  render();
  wireEvents();
  // Ensure loader is hidden on first load (e.g., after a hard refresh)
  if (typeof stopLoader === 'function') stopLoader();
}

function wireEvents() {
  submitBtn.addEventListener('click', onSubmit);
  shuffleBtn.addEventListener('click', onShuffle);
  clearBtn.addEventListener('click', onClear);
  resetBtn.addEventListener('click', resetGame);
  if (generateBtn) generateBtn.addEventListener('click', onGenerate);
  if (answersBtn) answersBtn.addEventListener('click', onToggleAnswers);
}

function resetGame() {
  state = new GameState(DEFAULT_PUZZLE);
  render();
  announce('New game started.');
  explanationEl.textContent = '';
  recommendationsEl.innerHTML = '';
  answersEl.hidden = true;
  answersEl.innerHTML = '';
  notesEl.innerHTML = '';
  if (typeof stopLoader === 'function') stopLoader();
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
    const catMeta = (window.__lastCategoriesMeta || []).find(c => c.label === first);
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
    const words = group.words.join(', ');
    div.innerHTML = `<span>${group.label}</span><span>${words}</span>`;
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
  if (generateBtn) generateBtn.disabled = false;
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

// AI integration
async function onGenerate() {
  const name = (nameInput?.value || '').trim() || 'Ben Collier';
  const location = (locationInput?.value || '').trim() || 'Pittsburgh, PA';
  try {
    generateBtn.disabled = true;
    generateBtn.textContent = 'Generating…';
    startLoader();
    // client-side breadcrumb
    try { await fetch('http://localhost:3000/api/client-log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ level: 'info', message: 'client_generate_click', context: { name, location } }) }); } catch {}

    const res = await fetch('http://localhost:3000/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, location }),
    });
    if (!res.ok) {
      try { await fetch('http://localhost:3000/api/client-log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ level: 'error', message: 'client_generate_http_error', context: { status: res.status } }) }); } catch {}
    }
    const data = await res.json();

    if (!data || !Array.isArray(data.categories) || data.categories.length !== 4) {
      throw new Error('Invalid AI response');
    }

    // Replace current puzzle
    const newPuzzle = { categories: data.categories.map(c => ({
      label: String(c.label),
      words: c.words.map(String).map(w => w.toUpperCase()),
      color: c.color || undefined,
    })) };

    state = new GameState(newPuzzle);
    render();

    // Hide explanation & references until completion; cache for later reveal
    explanationEl.textContent = '';
    recommendationsEl.innerHTML = '';
    window.__lastOverallExplanation = data.explanation || '';
    window.__lastRecommendations = Array.isArray(data.recommendations) ? data.recommendations : [];

    // Build answers box if per-category explanations returned
    answersEl.innerHTML = '';
    if (Array.isArray(data.categories)) {
      for (const cat of data.categories) {
        const row = document.createElement('div');
        row.className = 'answer';
        const label = document.createElement('div');
        label.className = 'label';
        label.textContent = cat.label;
        const words = document.createElement('div');
        words.textContent = cat.words.join(', ');
        const expl = document.createElement('div');
        expl.textContent = cat.explanation || '';
        row.appendChild(label);
        row.appendChild(words);
        if (expl.textContent) row.appendChild(expl);
        answersEl.appendChild(row);
      }
    }

    // Save meta for per-group notes
    window.__lastCategoriesMeta = (data.categories || []).map(c => ({ label: String(c.label), explanation: c.explanation || '' }));

    flashMessage('AI puzzle loaded!', 'success');
    // no celebration here; celebrate when a group is actually solved
  } catch (e) {
    console.error(e);
    try { await fetch('http://localhost:3000/api/client-log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ level: 'error', message: 'client_generate_exception', context: { err: String(e) } }) }); } catch {}
    flashMessage('AI generation failed; using fallback.', 'error');
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
    explanationEl.textContent = window.__lastOverallExplanation || '';
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
  const recs = window.__lastRecommendations || [];
  for (const rec of recs) {
    if (!rec || !rec.url) continue;
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


