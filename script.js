/*
  The page around the game. Three modes:
    - Today's paper: pick a newspaper, the server returns today's saved puzzle
      for it (or writes one from its headlines), and each solved group reveals
      the story that inspired it.
    - Study cards: type a topic; sixteen terms in four concept families, with
      a definition per term revealed as you solve.
    - Themed packs: the hand-made puzzles played by player/player.js.

  The live modes need the server (the Vercel functions in api/, or
  server/index.js on localhost:3000). The GitHub Pages copy has no server, so
  it plays the packs only and says so.

  Deep links: ?mode=news&paper=nyt  ?mode=study&topic=cell%20biology
              ?game=<id> (a saved game from history.html)  ?theme=&puzzle= (packs)
*/
const API_BASE = resolveApiBase();
const DEMO_MODE = API_BASE === null;

function resolveApiBase() {
  const configured = (window.CONNECTIONS_API_BASE || '').trim();
  if (configured) return configured.replace(/\/$/, '');
  if (location.protocol === 'file:') return 'http://localhost:3000';
  if (location.hostname.endsWith('github.io')) return null;
  return ''; // same origin: the Vercel deployment, or server/index.js serving this page
}

const $ = id => document.getElementById(id);
const tabs = [...document.querySelectorAll('.modes [role="tab"]')];
const panels = { news: $('newsPanel'), study: $('studyPanel'), packs: $('packsPanel') };
const paperSelect = $('paperSelect');
const topicInput = $('topicInput');
const newsStatus = $('newsStatus');
const studyStatus = $('studyStatus');

const S = { mode: 'news', info: null, current: null, busy: false, seen: loadSeen(), playing: loadPlaying() };
// The query string as the page opened; the player rewrites it (?theme=&puzzle=) as soon as it mounts.
const OPENED_WITH = new URLSearchParams(location.search);

const LONG_DATE = d => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

// ----- the game -----
const game = window.ConnectionsPlayer.mount($('game'), {
  packs: window.CONNECTIONS_PACKS,
  pack: 'starwars',
  useUrl: true,
  shareUrl: location.protocol.startsWith('http') ? location.origin + location.pathname : 'https://connections-about-you.vercel.app/',
  more: { label: 'Another puzzle', onclick: () => another() },
  onChange(packId) {
    const live = packId === 'news' || packId === 'study' || packId === 'live';
    document.body.dataset.theme = packId === 'live' ? 'notebook' : packId;
    if (!live) {
    }
  },
});

// ----- modes -----
function setMode(mode, { fromUser = false } = {}) {
  S.mode = mode;
  document.body.dataset.mode = mode;
  for (const t of tabs) t.setAttribute('aria-selected', String(t.dataset.mode === mode));
  for (const [k, p] of Object.entries(panels)) p.hidden = k !== mode;
  if (mode === 'packs') {
    if (S.current) { S.current = null; game.setPack(lastPack(), 0); }
    writeUrl({});
  }
  if (fromUser) {
    if (mode === 'news') { if (!S.current || S.current.mode !== 'news') playNews(); }
    if (mode === 'study') { topicInput.focus(); if (S.current && S.current.mode === 'study') { /* keep */ } else if (S.current) { S.current = null; } }
  }
}
function lastPack() {
  const t = new URLSearchParams(location.search).get('theme');
  return window.CONNECTIONS_PACKS.some(p => p.id === t) ? t : window.CONNECTIONS_PACKS[0].id;
}
tabs.forEach(t => t.addEventListener('click', () => setMode(t.dataset.mode, { fromUser: true })));

function writeUrl(params) {
  if (!history.replaceState) return;
  const u = new URL(location.href);
  for (const k of ['mode', 'paper', 'topic', 'game', 'theme', 'puzzle']) u.searchParams.delete(k);
  for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
  history.replaceState(null, '', u);
}

// ----- remembering which puzzle this browser is in the middle of -----
// Per paper or topic, the id of the puzzle last opened, so coming back to the
// paper (or reloading) reopens that puzzle, whose progress the player keeps.
function loadPlaying() { try { return JSON.parse(sessionStorage.getItem('cx_playing') || '{}'); } catch { return {}; } }
function markPlaying(key, id) {
  S.playing[key] = id;
  try { sessionStorage.setItem('cx_playing', JSON.stringify(S.playing)); } catch { /* fine */ }
}

// ----- remembering which saved puzzles this browser has played -----
function loadSeen() { try { return JSON.parse(sessionStorage.getItem('cx_seen') || '{}'); } catch { return {}; } }
function markSeen(key, id) {
  const list = S.seen[key] || (S.seen[key] = []);
  if (!list.includes(id)) list.push(id);
  try { sessionStorage.setItem('cx_seen', JSON.stringify(S.seen)); } catch { /* fine */ }
}

// ----- status lines -----
const LOADER = {
  news: p => [`Reading today's headlines from ${p}...`, 'Picking four stories that are nothing alike...', 'Writing the groups and a red herring or two...', 'Checking for repeated words...', 'Almost there: the explanations...'],
  study: t => [`Listing the vocabulary of ${t}...`, 'Sorting it into four concept families...', 'Setting a trap for beginners...', 'Writing the definitions...', 'Checking for repeated words...'],
};
let loaderTimer = 0;
function status(mode, text, kind) {
  const el = mode === 'news' ? newsStatus : studyStatus;
  el.textContent = text || '';
  el.className = 'panel-status' + (kind ? ' ' + kind : '');
}
function startLoader(mode, lines) {
  let i = 0;
  status(mode, lines[0] + ' (a saved puzzle is instant; a new one takes about half a minute)', 'busy');
  clearInterval(loaderTimer);
  loaderTimer = setInterval(() => status(mode, lines[++i % lines.length], 'busy'), 3200);
}
function stopLoader() { clearInterval(loaderTimer); }

// ----- talking to the server -----
async function requestPuzzle(body) {
  const res = await fetch(`${API_BASE}/api/puzzle`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.userMessage = (data && data.message) || 'The server could not answer. Try again in a moment.';
    err.saved = data && data.saved;
    throw err;
  }
  return data;
}

function paperInfo(id) { return (S.info && S.info.papers.find(p => p.id === id)) || { id, name: id, short: id }; }

function loadLive(mode, data, key) {
  const p = data.puzzle;
  const src = p.source || {};
  const when = data.created_at ? new Date(data.created_at) : new Date();
  const timeStr = when.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (mode === 'news') {
    const paper = paperInfo(src.id);
    const n = (S.seen[key] || []).length + (S.seen[key] && S.seen[key].includes(String(data.id)) ? 0 : 1);
    p.intro = p.intro || 'Four groups, four of today\'s stories. Solve a group to see the story that inspired it.';
    game.loadPuzzle(p, {
      id: 'news', theme: 'news', key: String(data.id || ''),
      name: `${paper.name} · ${LONG_DATE(src.date || S.info.date)} · puzzle ${n}`,
      disclaimer: `Written ${data.cached ? 'at ' + timeStr : 'just now'} by ${modelName(data.model)} from the paper's headlines; it can misread a story. Links open ${paper.name}'s site or app, where you sign in with your own subscription.`,
    });
    status('news', data.cached ? `Today's ${paper.short} puzzle ${n}${data.saved > n ? ` of ${data.saved} saved` : ''}. Solve a group to read its story.` : `A new puzzle, written just now from ${paper.name}'s headlines.`);
    $('newsAnother').hidden = false;
    writeUrl({ mode: 'news', paper: paper.id });
  } else {
    p.intro = p.intro || `Sixteen terms from ${src.name}. Solve a group to turn over its cards.`;
    game.loadPuzzle(p, {
      id: 'study', theme: 'notebook', key: String(data.id || ''),
      name: `Study cards · ${src.name}`,
      disclaimer: `Written ${data.cached ? 'at ' + timeStr : 'just now'} by ${modelName(data.model)}. Check anything you will be graded on against your course materials.`,
    });
    status('study', data.cached ? `A saved ${src.name} puzzle. Solve a group to see its definitions.` : `A new puzzle on ${src.name}, written just now.`);
    $('studyAnother').hidden = false;
    writeUrl({ mode: 'study', topic: src.name });
  }
  if (data.id) { markSeen(key, String(data.id)); markPlaying(key, String(data.id)); }
  S.current = { mode, key, paper: src.id, topic: src.name, id: data.id };
  if (S.mode !== mode) setMode(mode);
}

function modelName(id) {
  const m = /^[^/]+\/(.+)$/.exec(id || '');
  return (m ? m[1] : id || 'the model').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).replace(/(\d) (\d)/g, '$1.$2');
}

async function playNews({ fresh = false, savedOnly = false, next = false } = {}) {
  if (DEMO_MODE || S.busy) return;
  const paper = paperInfo(paperSelect.value);
  const key = `news:${paper.id}`;
  if (!fresh && !next && S.playing[key] && await reopen(S.playing[key])) return;
  S.busy = true; $('newsPlay').disabled = true; $('newsAnother').disabled = true;
  startLoader('news', LOADER.news(paper.name));
  try {
    const data = await requestPuzzle({ mode: 'news', paper: paper.id, seen: S.seen[key] || [], fresh, savedOnly });
    stopLoader();
    if (data.none) { nothingSaved('news', paper); return; }
    loadLive('news', data, key);
  } catch (err) {
    stopLoader();
    status('news', err.userMessage || 'Could not reach the server.', 'error');
  } finally {
    S.busy = false; $('newsPlay').disabled = false; $('newsAnother').disabled = false;
  }
}

async function playStudy(topic, { fresh = false, savedOnly = false, next = false } = {}) {
  if (DEMO_MODE || S.busy) return;
  topic = (topic || '').replace(/\s+/g, ' ').trim();
  if (topic.length < 2) { topicInput.focus(); return; }
  topicInput.value = topic;
  const key = `study:${topic.toLowerCase()}`;
  if (!fresh && !next && S.playing[key] && await reopen(S.playing[key])) return;
  S.busy = true; $('studyPlay').disabled = true; $('studyAnother').disabled = true;
  startLoader('study', LOADER.study(topic));
  try {
    const data = await requestPuzzle({ mode: 'study', topic, seen: S.seen[key] || [], fresh, savedOnly });
    stopLoader();
    if (data.none) { nothingSaved('study', topic); return; }
    loadLive('study', data, key);
  } catch (err) {
    stopLoader();
    status('study', err.userMessage || 'Could not reach the server.', 'error');
  } finally {
    S.busy = false; $('studyPlay').disabled = false; $('studyAnother').disabled = false;
  }
}

/** Opening the page only asks for a saved puzzle, so nothing is spent until someone presses a button. */
function nothingSaved(mode, what) {
  if (!S.info || !S.info.live) return; // the switched-off message is already showing
  if (mode === 'news') status('news', `Nobody has asked for today's ${what.short} puzzle yet. Press "Play today's puzzle" and the writer makes one from this morning's headlines (about half a minute).`);
  else status('study', `No saved deck on ${what} yet. Press "Deal the cards" to have one written (about half a minute).`);
}

/** The "Another puzzle" button: a saved one this browser has not played, or a new one. */
function another() {
  if (!S.current) return;
  if (S.current.mode === 'news') playNews({ next: true });
  else playStudy(S.current.topic, { next: true });
  $(S.current.mode === 'news' ? 'newsPanel' : 'studyPanel').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

/** Reopen the puzzle this browser was playing for a paper or topic. False if it is gone. */
async function reopen(id) {
  S.busy = true;
  try { await playSaved(id); return true; } catch { return false; } finally { S.busy = false; }
}

async function playSaved(id) {
  const res = await fetch(`${API_BASE}/api/history?id=${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error('not found');
  const data = await res.json();
  const mode = data.puzzle.generated && data.puzzle.generated.mode === 'study' ? 'study' : (data.puzzle.categories.some(c => c.story) ? 'news' : 'study');
  const src = data.puzzle.source || {};
  if (mode === 'news' && src.id) paperSelect.value = src.id;
  if (mode === 'study') topicInput.value = src.name || '';
  loadLive(mode, { ...data, cached: true }, mode === 'news' ? `news:${src.id}` : `study:${String(src.name || '').toLowerCase()}`);
}

// ----- forms -----
$('newsForm').addEventListener('submit', e => { e.preventDefault(); playNews(); });
$('newsAnother').addEventListener('click', () => playNews({ next: true }));
paperSelect.addEventListener('change', () => { $('newsAnother').hidden = true; playNews({ savedOnly: true }); });
$('studyForm').addEventListener('submit', e => { e.preventDefault(); playStudy(topicInput.value); });
$('studyAnother').addEventListener('click', () => playStudy(S.current && S.current.topic || topicInput.value, { next: true }));
document.querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => playStudy(c.dataset.topic)));

// ----- start -----
async function init() {
  const q = OPENED_WITH;
  if (DEMO_MODE) {
    $('demoNote').hidden = false;
    for (const id of ['newsPlay', 'newsAnother', 'studyPlay', 'studyAnother']) $(id).disabled = true;
    setMode('packs');
    return;
  }
  try {
    const res = await fetch(`${API_BASE}/api/papers`);
    S.info = await res.json();
  } catch {
    S.info = { live: false, papers: [], date: new Date().toISOString().slice(0, 10) };
  }
  paperSelect.innerHTML = '';
  for (const p of S.info.papers || []) paperSelect.appendChild(new Option(p.name, p.id));
  if (!paperSelect.options.length) paperSelect.appendChild(new Option('The New York Times', 'nyt'));
  if (S.info.model) $('modelNote').textContent = `Live puzzles are written by ${modelName(S.info.model)} through OpenRouter. ` + $('modelNote').textContent;
  if (!S.info.live) {
    status('news', 'The puzzle writer is switched off on this server; saved puzzles still play.', 'error');
  }

  const want = q.get('mode');
  if (q.get('game')) {
    try { await playSaved(q.get('game')); return; } catch { /* fall through */ }
  }
  if (q.get('theme') || want === 'packs') { setMode('packs'); return; }
  if (want === 'study') {
    setMode('study');
    if (q.get('topic')) playStudy(q.get('topic'), { savedOnly: true });
    return;
  }
  if (q.get('paper') && [...paperSelect.options].some(o => o.value === q.get('paper'))) paperSelect.value = q.get('paper');
  setMode('news');
  playNews({ savedOnly: true }); // free: a saved puzzle or a nudge to press Play
}


init();
