import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import * as H from './handlers.js';
import fs from 'fs';
import path from 'path';

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(cors({ origin: '*' }));
app.use((req, _res, next) => {
  logEvent({ event: 'http_request', method: req.method, path: req.path });
  next();
});

// The news and study-cards game, the saved-games history and the admin page
// share their handlers with the Vercel functions in api/.
app.get('/api/ping', H.ping);
app.get('/api/papers', H.papers);
app.post('/api/puzzle', H.puzzle);
app.get('/api/history', H.history);
app.post('/api/admin', H.admin);
// Serve the page itself too, so http://localhost:3000 is the whole app.
app.use(express.static(path.resolve(process.cwd()), { extensions: ['html'] }));

// Client-side log bridge (best-effort)
app.post('/api/client-log', (req, res) => {
  const { level = 'info', message = '', context = {} } = req.body || {};
  logEvent({ event: 'client_log', level, message, context });
  res.json({ ok: true });
});

const LOG_DIR = path.resolve(process.cwd(), 'logs');
const LOG_FILE = path.join(LOG_DIR, 'app.log');
function logEvent(event) {
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, JSON.stringify({ ts: new Date().toISOString(), ...event }) + '\n');
  } catch { /* best-effort logging */ }
}

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});
