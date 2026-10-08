// Vercel function: GET /api/ping, a health check.
import { PROVIDER, MODEL } from '../server/generator.js';

export default function handler(_req, res) {
  const live = Boolean(process.env.JETSTREAM_API_KEY || process.env.OPENAI_API_KEY);
  res.status(200).json({ ok: true, live, provider: PROVIDER, model: MODEL, search: PROVIDER === 'openai' || Boolean(process.env.TAVILY_API_KEY), ts: new Date().toISOString() });
}
