// The HTTP handlers, written once for both the Vercel functions (api/*.js)
// and the local Express server (server/index.js). Both give (req, res) with a
// parsed JSON body and res.status().json().
import crypto from 'crypto';
import { PAPERS, fetchStories } from './news.js';
import { makeNewsPuzzle, makeStudyPuzzle, summarize } from './puzzles.js';
import { hasKey, listModels } from './llm.js';
import * as store from './store.js';
import { getModel, setModel, getDailyCap, setDailyCap, DEFAULT_MODEL, DEFAULT_DAILY_CAP, persistent } from './settings.js';
import { allowedOrigin, clientIp, take, busy, begin, done } from './guard.js';

const log = (ev) => { try { console.log(JSON.stringify({ ts: new Date().toISOString(), ...ev })); } catch { /* ignore */ } };

/** Today's date in the newsroom's time zone, as YYYY-MM-DD. */
export function newsDate(tz = process.env.NEWS_TZ || 'America/New_York') {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
const startOfToday = () => new Date(new Date().setUTCHours(0, 0, 0, 0)).toISOString();

const topicKey = t => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 80);
const body = req => (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}));

// A short public view of a stored puzzle row.
const publicRow = r => ({ id: r.id, model: r.model, created_at: r.created_at, puzzle: r.puzzle });

// ---------------------------------------------------------------------------
// GET /api/papers: what the page needs to draw its menus.
// ---------------------------------------------------------------------------
export async function papers(_req, res) {
  res.status(200).json({
    live: hasKey(),
    about: Boolean(process.env.JETSTREAM_API_KEY || process.env.OPENAI_API_KEY), // the older "about you" writer
    model: await getModel(),
    history: await persistent(),
    date: newsDate(),
    papers: PAPERS.map(p => ({ id: p.id, name: p.name, short: p.short, home: p.home })),
  });
}

// ---------------------------------------------------------------------------
// POST /api/puzzle { mode: 'news', paper, seen: [ids], fresh, savedOnly }
//                  { mode: 'study', topic, seen: [ids], fresh, savedOnly }
// Plays a saved puzzle for the same paper-and-day or topic when there is one
// the visitor has not seen; otherwise writes a new one and saves it.
// savedOnly (what the page sends when it merely opens) answers { none: true }
// instead of writing, so a page load, a crawler or a preview never spends.
// When another visitor is already writing the same puzzle, this request waits
// for that one rather than paying for a second.
// ---------------------------------------------------------------------------
export async function puzzle(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'method' }); }
  if (!allowedOrigin(req)) return res.status(403).json({ error: 'origin' });
  let input;
  try { input = body(req); } catch { return res.status(400).json({ error: 'input' }); }
  const mode = input.mode === 'study' ? 'study' : input.mode === 'news' ? 'news' : null;
  if (!mode) return res.status(400).json({ error: 'input', message: 'mode must be news or study' });
  const seen = new Set(Array.isArray(input.seen) ? input.seen.map(String).slice(0, 200) : []);
  const fresh = Boolean(input.fresh);
  const savedOnly = Boolean(input.savedOnly);

  let paper = null, topic = '', key;
  if (mode === 'news') {
    paper = PAPERS.find(p => p.id === String(input.paper || ''));
    if (!paper) return res.status(400).json({ error: 'input', message: 'Pick a newspaper.' });
    key = `${paper.id}:${newsDate()}`;
  } else {
    topic = String(input.topic || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (topic.length < 2) return res.status(400).json({ error: 'input', message: 'Type a topic to study.' });
    key = topicKey(topic);
  }

  // 1. A saved puzzle the visitor has not played yet.
  const saved = await store.findPuzzles(mode, key, 40);
  const unseenOf = rows => rows.filter(r => !seen.has(String(r.id)));
  if (!fresh) {
    const unseen = unseenOf(saved);
    if (unseen.length) {
      const r = unseen[unseen.length - 1]; // oldest unseen first, so everyone starts with the day's first puzzle
      return res.status(200).json({ ...publicRow(r), cached: true, saved: saved.length });
    }
  }
  if (savedOnly) return res.status(200).json({ none: true, saved: saved.length, live: hasKey() });

  // 2. Otherwise write one, within the brakes.
  if (!hasKey()) return res.status(503).json({ error: 'nokey', message: 'The puzzle writer is switched off (no model key on the server).', saved: saved.length });
  const ip = clientIp(req);
  if (busy()) return res.status(429).json({ error: 'busy', message: 'The writer is busy with other puzzles. Try again in a minute.', saved: saved.length });
  const cap = await getDailyCap();
  const madeToday = await store.countSince(startOfToday());
  if (madeToday !== null && madeToday >= cap) return res.status(429).json({ error: 'cap', message: `Today's budget of ${cap} new puzzles is used up. Saved puzzles still play.`, saved: saved.length });

  // 3. One writer per puzzle. Whoever asks second waits for the first one's save.
  const lease = `${mode}:${key}`;
  if (!(await store.acquireLock(lease, LOCK_MS))) {
    const r = await waitForSaved(mode, key, unseenOf, saved.length);
    if (r) return res.status(200).json({ ...publicRow(r), cached: true, waited: true, saved: saved.length + 1 });
    return res.status(429).json({ error: 'busy', message: 'Someone else is having this puzzle written right now. Try again in a moment.', saved: saved.length });
  }
  if (!take(ip)) { await store.releaseLock(lease); return res.status(429).json({ error: 'rate', message: 'That is a lot of new puzzles from one place. Try again in a few minutes.', saved: saved.length }); }

  begin();
  try {
    const model = await getModel();
    const avoid = saved.slice(0, 12).map(r => summarize(r.puzzle));
    let r;
    if (mode === 'news') {
      const { stories, source } = await fetchStories(paper.id);
      log({ event: 'stories', paper: paper.id, n: stories.length, source });
      r = await makeNewsPuzzle({ paper, stories, avoid, model, log, date: newsDate() });
      r.data.source.feed = source;
    } else {
      r = await makeStudyPuzzle({ topic, avoid, model, log });
    }
    const id = await store.savePuzzle(mode, key, r.model, r.data, r.cost);
    log({ event: 'generated', mode, key, model: r.model, cost: r.cost, attempts: r.attempts, stored: Boolean(id) });
    return res.status(200).json({ id: id || `tmp-${crypto.randomUUID()}`, model: r.model, created_at: new Date().toISOString(), puzzle: r.data, cached: false, saved: saved.length + 1 });
  } catch (err) {
    log({ event: 'failed', mode, key, status: err.status, message: String(err.message || err).slice(0, 200) });
    if (err.code === 'nostories') return res.status(502).json({ error: 'nostories', message: `Could not read today's headlines from ${paper.name}. Try another paper.` });
    if (err.status === 402) return res.status(503).json({ error: 'budget', message: 'The model account is out of credit.' });
    if (err.status === 429) return res.status(503).json({ error: 'upstream-busy', message: 'The model service is busy. Try again in a minute.' });
    return res.status(502).json({ error: 'failed', message: 'The writer could not finish a puzzle this time. Try again.' });
  } finally {
    done();
    await store.releaseLock(lease);
  }
}

const LOCK_MS = 150000;   // longer than the slowest generation (three attempts)
const WAIT_MS = 110000;   // how long a second visitor waits for the first one's puzzle
const POLL_MS = 3000;

/** Poll the store until a puzzle for (mode, key) appears that this visitor has not seen. */
async function waitForSaved(mode, key, unseenOf, had) {
  const until = Date.now() + WAIT_MS;
  while (Date.now() < until) {
    await new Promise(r => setTimeout(r, POLL_MS));
    const rows = await store.findPuzzles(mode, key, 40);
    const unseen = unseenOf(rows);
    if (rows.length > had && unseen.length) return unseen[0]; // newest unseen: the one just written
    if (!(await store.acquireLock(`${mode}:${key}`, 1))) continue; // still being written
    await store.releaseLock(`${mode}:${key}`);
    return unseen.length ? unseen[0] : null; // the writer gave up (or failed) without saving
  }
  return null;
}

// ---------------------------------------------------------------------------
// GET /api/history?mode=&key=&limit=   every saved game, newest first
// GET /api/history?id=                 one game, to replay it
// ---------------------------------------------------------------------------
export async function history(req, res) {
  if (!(await persistent())) return res.status(200).json({ history: false, items: [] });
  const q = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);
  if (q.id) {
    const rows = await store.findById(String(q.id));
    return rows.length ? res.status(200).json(publicRow(rows[0])) : res.status(404).json({ error: 'notfound' });
  }
  const limit = Math.min(200, Math.max(1, parseInt(q.limit || '60', 10) || 60));
  const rows = await store.listPuzzles({ mode: q.mode, key: q.key, limit, offset: parseInt(q.offset || '0', 10) || 0 });
  res.status(200).json({ history: true, items: rows.map(publicRow) });
}

// ---------------------------------------------------------------------------
// POST /api/admin { password, action: 'status' | 'set', model?, dailyCap? }
// ---------------------------------------------------------------------------
function passwordOk(given) {
  const want = process.env.ADMIN_PASSWORD || '';
  if (!want || typeof given !== 'string') return false;
  const a = Buffer.from(given), b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function admin(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'method' }); }
  if (!allowedOrigin(req)) return res.status(403).json({ error: 'origin' });
  let input;
  try { input = body(req); } catch { return res.status(400).json({ error: 'input' }); }
  if (!process.env.ADMIN_PASSWORD) return res.status(503).json({ error: 'noadmin', message: 'No ADMIN_PASSWORD is set on the server.' });
  if (!passwordOk(input.password)) {
    await new Promise(r => setTimeout(r, 600)); // slow down guessing
    return res.status(401).json({ error: 'password', message: 'Wrong password.' });
  }
  const models = await listModels();
  if (input.action === 'set') {
    if (input.model !== undefined) {
      const id = String(input.model).trim();
      if (!models.some(m => m.id === id)) return res.status(400).json({ error: 'model', message: `OpenRouter does not list a model called ${id}.` });
      await setModel(id);
      log({ event: 'admin_set_model', model: id });
    }
    if (input.dailyCap !== undefined) {
      const n = parseInt(input.dailyCap, 10);
      if (!(n >= 0 && n <= 5000)) return res.status(400).json({ error: 'cap', message: 'Daily cap must be 0 to 5000.' });
      await setDailyCap(n);
      log({ event: 'admin_set_cap', cap: n });
    }
  }
  const [model, cap, madeToday, recent] = await Promise.all([getModel(), getDailyCap(), store.countSince(startOfToday()), store.recentPuzzles(40)]);
  const spent = recent.filter(r => r.created_at >= startOfToday()).reduce((s, r) => s + Number(r.cost_usd || 0), 0);
  res.status(200).json({
    model, defaultModel: DEFAULT_MODEL, dailyCap: cap, defaultDailyCap: DEFAULT_DAILY_CAP, persistent: await persistent(), live: hasKey(),
    madeToday, spentToday: spent, recent,
    models: models.filter(m => /^(anthropic|openai|google|x-ai|meta-llama|mistralai|deepseek|qwen)\//.test(m.id)),
  });
}

// ---------------------------------------------------------------------------
// GET /api/ping
// ---------------------------------------------------------------------------
export async function ping(_req, res) {
  res.status(200).json({ ok: true, live: hasKey(), model: await getModel(), history: await persistent(), ts: new Date().toISOString() });
}
