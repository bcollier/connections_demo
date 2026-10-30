// Abuse brakes shared by the API handlers. Counters live in memory, so they
// reset when a serverless instance restarts: a brake, not a guarantee. The
// guarantee is the daily cap counted in the database (handlers.js) and the
// spending limit on the OpenRouter key.
const PER_IP_WINDOW = Number(process.env.PER_IP_WINDOW || 6);   // generations per 15 minutes
const PER_IP_DAY = Number(process.env.PER_IP_DAY || 20);        // generations per day
const MAX_IN_FLIGHT = Number(process.env.MAX_IN_FLIGHT || 3);   // per instance
const WINDOW_MS = 15 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const hits = new Map();
let inFlight = 0;

export function allowedOrigin(req) {
  const origin = req.headers.origin || '';
  if (!origin) return false;
  let host;
  try { host = new URL(origin).host; } catch { return false; }
  const extra = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  return host === req.headers.host || extra.includes(origin) || /^localhost(:\d+)?$|^127\.0\.0\.1(:\d+)?$/.test(host);
}

export function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim() || 'unknown';
}

/** True if this IP may start another generation now; records it if so. */
export function take(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter(t => now - t < DAY_MS);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  const recent = list.filter(t => now - t < WINDOW_MS).length;
  if (recent >= PER_IP_WINDOW || list.length >= PER_IP_DAY) return false;
  list.push(now);
  return true;
}

export function busy() { return inFlight >= MAX_IN_FLIGHT; }
export function begin() { inFlight += 1; }
export function done() { inFlight = Math.max(0, inFlight - 1); }
