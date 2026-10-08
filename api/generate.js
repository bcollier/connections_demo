// Vercel function: POST /api/generate { name, location } -> a puzzle.
// Model keys live only in the Vercel project's environment variables:
// JETSTREAM_API_KEY (+ TAVILY_API_KEY for the web search) for the free open
// model, or OPENAI_API_KEY for GPT-5. See server/generator.js.
//
// Guards, outermost first:
//  1. Jetstream is free (an academic allocation) and Tavily's free plan stops at
//     its monthly credits instead of billing. If OpenAI is used instead, its key
//     belongs to a project with a hard monthly spend limit. Either way a refused
//     call answers 503 and the page plays a saved puzzle.
//  2. Requests must come from this site's own pages (Origin check).
//  3. Each visitor (by IP) gets PER_IP_WINDOW puzzles per 15 minutes and
//     PER_IP_DAY per day, and each server instance runs at most MAX_IN_FLIGHT
//     at once. These counters live in memory, so they reset when Vercel starts
//     a new instance: a brake, not a guarantee. Guard 1 is the guarantee.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { makePuzzle, RequestSchema, PROVIDER } from '../server/generator.js';

const PER_IP_WINDOW = 3;
const PER_IP_DAY = 8;
const MAX_IN_FLIGHT = 2;
const WINDOW_MS = 15 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const hits = new Map(); // ip -> timestamps of accepted requests
let inFlight = 0;

// Themes of recent puzzles, so the prompt avoids repeating them. Seeded from the
// saved history in the repo; new puzzles are kept in memory only, and names typed
// by visitors are never written anywhere.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const recent = (() => {
  try {
    return fs.readFileSync(path.join(ROOT, 'data', 'history.jsonl'), 'utf8')
      .split(/\n/).filter(Boolean).map(l => JSON.parse(l)).slice(-20);
  } catch { return []; }
})();

function allowedOrigin(req) {
  const origin = req.headers.origin || '';
  if (!origin) return false;
  let host;
  try { host = new URL(origin).host; } catch { return false; }
  const extra = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  return host === req.headers.host || extra.includes(origin);
}

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
}

function underLimit(ip, now) {
  const list = (hits.get(ip) || []).filter(t => now - t < DAY_MS);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear(); // keep memory bounded
  const lastWindow = list.filter(t => now - t < WINDOW_MS).length;
  return lastWindow < PER_IP_WINDOW && list.length < PER_IP_DAY;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method' });
  }
  if (!allowedOrigin(req)) return res.status(403).json({ error: 'origin' });

  let input;
  try {
    input = RequestSchema.parse(typeof req.body === 'string' ? JSON.parse(req.body) : req.body);
  } catch {
    return res.status(400).json({ error: 'input', message: 'Type a name and a town.' });
  }

  const ip = clientIp(req);
  const now = Date.now();
  if (!underLimit(ip, now)) {
    return res.status(429).json({ error: 'rate', message: 'That is a lot of puzzles. Here is a saved one; try again in a few minutes.' });
  }
  if (inFlight >= MAX_IN_FLIGHT) {
    return res.status(429).json({ error: 'busy', message: 'The AI is busy writing other puzzles. Here is a saved one for now.' });
  }
  if (!process.env.JETSTREAM_API_KEY && !process.env.OPENAI_API_KEY) {
    return res.status(503).json({ error: 'nokey', message: 'Live puzzles are switched off right now. Here is a saved one.' });
  }

  hits.get(ip).push(now);
  inFlight += 1;
  try {
    const { data } = await makePuzzle({ name: input.name, location: input.location, recent });
    recent.push({ name: '(visitor)', location: '', categories: data.categories });
    if (recent.length > 20) recent.shift();
    return res.status(200).json(data);
  } catch (err) {
    const code = err && (err.code || (err.error && err.error.code));
    console.error('generate failed:', err && err.status, code || String(err).slice(0, 200));
    if (err && err.status === 429) {
      const budget = PROVIDER === 'openai' && /spend_limit|quota/.test(String(code));
      return res.status(503).json({ error: budget ? 'budget' : 'upstream-busy', message: budget
        ? 'The AI has used up this month\'s budget. Here is a saved puzzle.'
        : 'The AI service is busy right now. Here is a saved puzzle; try again in a minute.' });
    }
    return res.status(502).json({ error: 'failed', message: 'The AI could not finish a puzzle this time. Here is a saved one.' });
  } finally {
    inFlight -= 1;
  }
}
