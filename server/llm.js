// One model call through OpenRouter. Which model is a setting an admin can
// change (server/settings.js); the default is Claude Opus 5.5.
const BASE = 'https://openrouter.ai/api/v1';

export function hasKey() { return Boolean(process.env.OPENROUTER_API_KEY); }

/**
 * Ask `model` for a completion. Returns { text, usage, cost } where cost is
 * OpenRouter's reported dollar cost for the call (undefined if not reported).
 * Throws an Error with .status on HTTP failure.
 */
export async function complete({ model, system, prompt, maxTokens = 4000, temperature = 0.8, timeoutMs = 240000 }) {
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: prompt });
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.APP_URL || 'https://connections-about-you.vercel.app',
      'X-Title': 'Connections (news and study cards)',
    },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature, usage: { include: true } }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const err = new Error(`openrouter ${res.status}: ${(await res.text()).slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  if (data.error) {
    const err = new Error(`openrouter: ${data.error.message || JSON.stringify(data.error).slice(0, 200)}`);
    err.status = data.error.code || 502;
    throw err;
  }
  const text = String(data.choices?.[0]?.message?.content || '').trim();
  return { text, usage: data.usage, cost: data.usage?.cost, model: data.model || model };
}

/** The models OpenRouter offers, as [{ id, name, inPerM, outPerM, context }]. Cached an hour. */
let modelsCache = { at: 0, list: [] };
export async function listModels() {
  if (Date.now() - modelsCache.at < 3600_000 && modelsCache.list.length) return modelsCache.list;
  try {
    const res = await fetch(`${BASE}/models`, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return modelsCache.list;
    const data = await res.json();
    const list = (data.data || [])
      .filter(m => !/:(batch|free|extended|thinking|nitro)$/.test(m.id) && !m.id.startsWith('~'))
      .map(m => ({
        id: m.id, name: m.name || m.id,
        inPerM: Number(m.pricing?.prompt || 0) * 1e6, outPerM: Number(m.pricing?.completion || 0) * 1e6,
        context: m.context_length || null,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
    modelsCache = { at: Date.now(), list };
  } catch { /* keep the old list */ }
  return modelsCache.list;
}
