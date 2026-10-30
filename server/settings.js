// Settings an admin can change at run time, stored in Supabase (cx_settings)
// with environment-variable defaults. Read-through cache of one minute per
// server instance, so a model change shows up everywhere within a minute.
import { getSetting, setSetting, persistentStore } from './store.js';

export const DEFAULT_MODEL = process.env.DEFAULT_MODEL || 'anthropic/claude-opus-5.5';
// A spending brake: puzzles generated per day across all visitors, all modes.
export const DEFAULT_DAILY_CAP = Number.parseInt(process.env.DAILY_CAP || '150', 10);

const cache = new Map(); // key -> { at, value }
const TTL = 60_000;

async function read(key, fallback) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  let value = await getSetting(key);
  if (value === undefined) value = fallback;
  cache.set(key, { at: Date.now(), value });
  return value;
}

export async function getModel() { return String(await read('model', DEFAULT_MODEL)); }
export async function getDailyCap() { return Number(await read('daily_cap', DEFAULT_DAILY_CAP)) || DEFAULT_DAILY_CAP; }

export async function setModel(id) {
  cache.set('model', { at: Date.now(), value: id });
  return setSetting('model', id);
}
export async function setDailyCap(n) {
  cache.set('daily_cap', { at: Date.now(), value: n });
  return setSetting('daily_cap', n);
}

/** True when Supabase is configured and the cx_ tables exist (see supabase/001_cx.sql). */
export function persistent() { return persistentStore(); }
