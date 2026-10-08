// Vercel function: GET /api/ping, a health check.
export default function handler(_req, res) {
  res.status(200).json({ ok: true, live: Boolean(process.env.OPENAI_API_KEY), ts: new Date().toISOString() });
}
