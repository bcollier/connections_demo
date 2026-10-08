import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { makePuzzle, RequestSchema, MODEL } from './generator.js';
import fs from 'fs';
import path from 'path';

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(cors({ origin: '*'}));
// Request logging middleware
app.use((req, _res, next) => {
  try { logEvent({ event: 'http_request', method: req.method, path: req.path }); } catch {}
  next();
});

// Basic health route
app.get('/', (_req, res) => {
  res.type('text/plain').send('OK');
});

// History API (read-only)
app.get('/api/history', (_req, res) => {
  const rows = readRecentHistory(200);
  res.json({ items: rows });
});

// Health check / ping
app.get('/api/ping', (_req, res) => {
  logEvent({ event: 'ping' });
  res.json({ ok: true, ts: new Date().toISOString() });
});

// Client-side log bridge (best-effort)
app.post('/api/client-log', (req, res) => {
  const { level = 'info', message = '', context = {} } = req.body || {};
  logEvent({ event: 'client_log', level, message, context });
  res.json({ ok: true });
});

// Logging setup
const LOG_DIR = path.resolve(process.cwd(), 'logs');
const LOG_FILE = path.join(LOG_DIR, 'app.log');
const DATA_DIR = path.resolve(process.cwd(), 'data');
const HISTORY_FILE = path.join(DATA_DIR, 'history.jsonl');
function logEvent(event) {
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    const line = JSON.stringify({ ts: new Date().toISOString(), model: MODEL, ...event }) + '\n';
    fs.appendFileSync(LOG_FILE, line);
  } catch (e) {
    // best-effort logging; ignore errors
  }
}

function saveHistoryRow(row) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const line = JSON.stringify({ ts: new Date().toISOString(), model: MODEL, ...row }) + '\n';
    fs.appendFileSync(HISTORY_FILE, line);
  } catch {}
}

function readRecentHistory(limit = 20) {
  try {
    if (!fs.existsSync(HISTORY_FILE)) return [];
    const raw = fs.readFileSync(HISTORY_FILE, 'utf8').trim().split(/\n/).filter(Boolean);
    const slice = raw.slice(-limit);
    return slice.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

app.post('/api/generate', async (req, res) => {
  try {
    const { name, location } = RequestSchema.parse(req.body);
    logEvent({ event: 'request', name, location });
    logEvent({ event: 'validate_ok' });

    const { data, rawText, prompt } = await makePuzzle({ name, location, recent: readRecentHistory(20), log: logEvent });
    logEvent({ event: 'generation_success', categories: data.categories.map(c => c.label) });
    logEvent({ event: 'response', name, location, prompt, rawText, parsed: data });
    saveHistoryRow({ name, location, categories: data.categories, explanation: data.explanation, recommendations: data.recommendations });
    return res.json(data);
  } catch (err) {
    console.error('Generation error:', err);
    logEvent({ event: 'error', error: String(err && err.stack ? err.stack : err) });
    const fallback = {
      categories: [
        { label: 'TECH TRENDS', words: ['AI', 'CLOUD', 'EDGE', 'QUANTUM'], color: 'Yellow' },
        { label: 'PITTSBURGH', words: ['STEEL', 'BRIDGES', 'RIVERS', 'PENS'], color: 'Green' },
        { label: 'FITNESS', words: ['RUN', 'YOGA', 'ROW', 'CYCLE'], color: 'Blue' },
        { label: 'COFFEE', words: ['ESPRESSO', 'LATTE', 'DRIP', 'BEANS'], color: 'Purple' },
      ],
      explanation: 'Fallback set used when AI generation fails. Update your OPENAI_API_KEY and restart the server.',
      recommendations: [],
    };
    res.status(200).json(fallback);
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});


