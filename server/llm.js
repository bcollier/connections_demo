// One model call. Two providers behind one function:
//   - OpenRouter (OPENROUTER_API_KEY): every commercial model, billed per call.
//   - Jetstream2 (JETSTREAM_API_KEY): open models on an academic allocation, free.
//     Their ids carry a "jetstream/" prefix (jetstream/gpt-oss-120b) so one
//     setting names both the provider and the model.
// Which model writes is a setting an admin can change (server/settings.js).
const OPENROUTER = 'https://openrouter.ai/api/v1';
const JETSTREAM = (process.env.JETSTREAM_BASE_URL || 'https://llm.jetstream-cloud.org/api').replace(/\/$/, '');
const JS_PREFIX = 'jetstream/';

export const isJetstream = id => String(id || '').startsWith(JS_PREFIX);
export const hasOpenRouter = () => Boolean(process.env.OPENROUTER_API_KEY);
export const hasJetstream = () => Boolean(process.env.JETSTREAM_API_KEY);
/** True when at least one provider has a key. */
export function hasKey() { return hasOpenRouter() || hasJetstream(); }
/** True when the key for this particular model is set. */
export function canRun(model) { return isJetstream(model) ? hasJetstream() : hasOpenRouter(); }

/**
 * Ask `model` for a completion. Returns { text, usage, cost, model } where cost
 * is the provider's reported dollar cost (0 on Jetstream, undefined if unknown).
 * Throws an Error with .status on HTTP failure (503 with .code 'nokey' when the
 * provider's key is missing).
 */
export async function complete({ model, system, prompt, maxTokens = 4000, temperature = 0.8, timeoutMs = 240000 }) {
  if (!canRun(model)) {
    const err = new Error(`no key for ${isJetstream(model) ? 'Jetstream' : 'OpenRouter'} (model ${model})`);
    err.status = 503; err.code = 'nokey';
    throw err;
  }
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: prompt });

  const js = isJetstream(model);
  const url = js ? `${JETSTREAM}/chat/completions` : `${OPENROUTER}/chat/completions`;
  const headers = js
    ? { Authorization: `Bearer ${process.env.JETSTREAM_API_KEY}`, 'Content-Type': 'application/json' }
    : {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.APP_URL || 'https://connections-about-you.vercel.app',
      'X-Title': 'Connections (news and study cards)',
    };
  // Jetstream's models reason before they answer and the reasoning counts
  // against max_tokens, so give them room or the JSON never arrives.
  const body = { model: js ? model.slice(JS_PREFIX.length) : model, messages, max_tokens: js ? Math.max(maxTokens, 16000) : maxTokens, temperature };
  if (!js) body.usage = { include: true };

  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  const who = js ? 'jetstream' : 'openrouter';
  if (!res.ok) {
    const err = new Error(`${who} ${res.status}: ${(await res.text()).slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  if (data.error) {
    const err = new Error(`${who}: ${data.error.message || JSON.stringify(data.error).slice(0, 200)}`);
    err.status = data.error.code || 502;
    throw err;
  }
  const text = String(data.choices?.[0]?.message?.content || '').trim();
  return { text, usage: data.usage, cost: js ? 0 : data.usage?.cost, model: js ? model : (data.model || model) };
}

/**
 * The models on offer, as [{ id, name, provider, inPerM, outPerM, context }]:
 * OpenRouter's catalogue plus, with a Jetstream key, Jetstream's open models at
 * $0. Cached an hour per server instance.
 */
let modelsCache = { at: 0, list: [] };
export async function listModels() {
  if (Date.now() - modelsCache.at < 3600_000 && modelsCache.list.length) return modelsCache.list;
  const [openrouter, jetstream] = await Promise.all([listOpenRouter(), listJetstream()]);
  const list = [...jetstream, ...openrouter];
  if (list.length) modelsCache = { at: Date.now(), list };
  return list.length ? list : modelsCache.list;
}

async function listOpenRouter() {
  try {
    const res = await fetch(`${OPENROUTER}/models`, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.data || [])
      .filter(m => !/:(batch|free|extended|thinking|nitro)$/.test(m.id) && !m.id.startsWith('~'))
      .map(m => ({
        id: m.id, name: m.name || m.id, provider: 'openrouter',
        inPerM: Number(m.pricing?.prompt || 0) * 1e6, outPerM: Number(m.pricing?.completion || 0) * 1e6,
        context: m.context_length || null,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
  } catch { return []; }
}

async function listJetstream() {
  if (!hasJetstream()) return [];
  try {
    const res = await fetch(`${JETSTREAM}/models`, { headers: { Authorization: `Bearer ${process.env.JETSTREAM_API_KEY}` }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.data || [])
      .map(m => ({ id: JS_PREFIX + m.id, name: m.name || m.id, provider: 'jetstream', inPerM: 0, outPerM: 0, context: null }))
      .sort((a, b) => a.id.localeCompare(b.id));
  } catch { return []; }
}
