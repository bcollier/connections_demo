// Supabase (PostgREST) as a small key-value and puzzle store. Every function
// degrades to "nothing stored" when SUPABASE_URL is unset or the cx_ tables
// are missing (see supabase/001_cx.sql), so the game still runs: the model
// then comes from DEFAULT_MODEL and each visit may cost a model call.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const URL_ = () => (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const KEY = () => process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export const enabled = () => Boolean(URL_() && KEY());

// Local development without Supabase (or before its tables exist): a JSON file
// under data/ (git-ignored) plays the same role, so a page reload does not pay
// for a new puzzle. Never on Vercel, which has no disk to keep.
const LOCAL_FILE = path.resolve(process.cwd(), 'data', 'cx_store.local.json');
const useLocal = async () => !process.env.VERCEL && !(await probe());
function localRead() {
  try { return JSON.parse(fs.readFileSync(LOCAL_FILE, 'utf8')); } catch { return { settings: {}, puzzles: [] }; }
}
function localWrite(db) {
  try { fs.mkdirSync(path.dirname(LOCAL_FILE), { recursive: true }); fs.writeFileSync(LOCAL_FILE, JSON.stringify(db)); } catch (err) { console.error('local store:', String(err).slice(0, 120)); }
}

async function rest(path, { method = 'GET', body, prefer } = {}) {
  if (!enabled()) return null;
  const headers = { apikey: KEY(), Authorization: `Bearer ${KEY()}`, 'Content-Type': 'application/json' };
  if (prefer) headers.Prefer = prefer;
  let res;
  try {
    res = await fetch(`${URL_()}/rest/v1/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(8000) });
  } catch (err) {
    console.error('store: network', String(err).slice(0, 120));
    return null;
  }
  if (!res.ok) {
    // 404 = table not created yet; anything else is worth a log line.
    if (res.status !== 404) console.error('store:', method, path.split('?')[0], res.status, (await res.text()).slice(0, 160));
    return null;
  }
  if (res.status === 204) return [];
  try { return await res.json(); } catch { return null; }
}

/** The value stored under `key`, or undefined. */
export async function getSetting(key) {
  if (await useLocal()) return localRead().settings[key];
  const rows = await rest(`cx_settings?key=eq.${encodeURIComponent(key)}&select=value`);
  return Array.isArray(rows) && rows[0] ? rows[0].value : undefined;
}

/** Store `value` (any JSON) under `key`. Returns true on success. */
export async function setSetting(key, value) {
  if (await useLocal()) { const db = localRead(); db.settings[key] = value; localWrite(db); return true; }
  const rows = await rest('cx_settings', {
    method: 'POST', prefer: 'resolution=merge-duplicates,return=representation',
    body: { key, value, updated_at: new Date().toISOString() },
  });
  return Array.isArray(rows);
}

/** Saved puzzles for a mode and key, newest first. */
export async function findPuzzles(mode, key, limit = 20) {
  if (await useLocal()) return localRead().puzzles.filter(r => r.mode === mode && r.key === key).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit);
  const rows = await rest(`cx_puzzles?mode=eq.${encodeURIComponent(mode)}&key=eq.${encodeURIComponent(key)}&select=id,model,puzzle,created_at&order=created_at.desc&limit=${limit}`);
  return Array.isArray(rows) ? rows : [];
}

/** Save one puzzle; returns its id (or null when not stored). */
export async function savePuzzle(mode, key, model, puzzle, costUsd) {
  if (await useLocal()) {
    const db = localRead();
    const row = { id: crypto.randomUUID(), mode, key, model, puzzle, cost_usd: costUsd ?? null, created_at: new Date().toISOString() };
    db.puzzles.push(row); localWrite(db); return row.id;
  }
  const rows = await rest('cx_puzzles', {
    method: 'POST', prefer: 'return=representation',
    body: { mode, key, model, puzzle, cost_usd: costUsd ?? null },
  });
  return Array.isArray(rows) && rows[0] ? rows[0].id : null;
}

/** How many puzzles were generated since `sinceIso` (a global spending brake). */
export async function countSince(sinceIso) {
  if (await useLocal()) return localRead().puzzles.filter(r => r.created_at >= sinceIso).length;
  if (!enabled()) return null;
  const headers = { apikey: KEY(), Authorization: `Bearer ${KEY()}`, Prefer: 'count=exact', Range: '0-0' };
  try {
    const res = await fetch(`${URL_()}/rest/v1/cx_puzzles?select=id&created_at=gte.${encodeURIComponent(sinceIso)}`, { headers, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const m = /\/(\d+)$/.exec(res.headers.get('content-range') || '');
    return m ? Number(m[1]) : null;
  } catch { return null; }
}

/** Recent puzzles across all modes, for the admin page. */
export async function recentPuzzles(limit = 30) {
  if (await useLocal()) return localRead().puzzles.slice().sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit).map(({ puzzle, ...r }) => r);
  const rows = await rest(`cx_puzzles?select=id,mode,key,model,cost_usd,created_at&order=created_at.desc&limit=${limit}`);
  return Array.isArray(rows) ? rows : [];
}

/** One saved puzzle by id. */
export async function findById(id) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return [];
  if (await useLocal()) return localRead().puzzles.filter(r => r.id === id);
  const rows = await rest(`cx_puzzles?id=eq.${id}&select=id,mode,key,model,puzzle,created_at`);
  return Array.isArray(rows) ? rows : [];
}

/** Saved puzzles, newest first, optionally filtered by mode and key. */
export async function listPuzzles({ mode, key, limit = 60, offset = 0 } = {}) {
  if (await useLocal()) return localRead().puzzles.filter(r => (!mode || r.mode === mode) && (!key || r.key === key)).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(offset, offset + limit);
  let q = `cx_puzzles?select=id,mode,key,model,puzzle,created_at&order=created_at.desc&limit=${limit}&offset=${offset}`;
  if (mode) q += `&mode=eq.${encodeURIComponent(mode)}`;
  if (key) q += `&key=eq.${encodeURIComponent(key)}`;
  const rows = await rest(q);
  return Array.isArray(rows) ? rows : [];
}

/** True once the cx_ tables are known to exist (checked once per instance). */
let probed = null;
export async function probe() {
  if (!enabled()) return false;
  if (probed !== null) return probed;
  const rows = await rest('cx_settings?select=key&limit=1');
  probed = Array.isArray(rows);
  if (!probed && !process.env.VERCEL) console.log('store: cx_ tables not found; using data/cx_store.local.json');
  return probed;
}
/** Is anything being kept: Supabase, or the local file in development. */
export async function persistentStore() { return (await probe()) || !process.env.VERCEL; }
