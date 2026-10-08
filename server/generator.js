// The puzzle generator, shared by the local Express server (server/index.js)
// and the Vercel function (api/generate.js). It builds the prompt, calls the
// OpenAI Responses API with web search, and checks the answer.
import OpenAI from 'openai';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { OutputSchema, normalizeWordForDisplay, canonicalizeWord, normalizeColor } from './validate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Which model writes the puzzle. With JETSTREAM_API_KEY set, an open model on
// Jetstream2 (free on an academic allocation, OpenAI-compatible API); the server
// searches the web first with Tavily and hands the model what it found, since
// Jetstream models cannot search. Otherwise OpenAI with its own web search tool.
export const PROVIDER = process.env.JETSTREAM_API_KEY ? 'jetstream' : 'openai';
const JETSTREAM_BASE = (process.env.JETSTREAM_BASE_URL || 'https://llm.jetstream-cloud.org/api').replace(/\/$/, '');
export const MODEL = PROVIDER === 'jetstream'
  ? (process.env.JETSTREAM_MODEL || 'gpt-oss-120b')
  : (process.env.MODEL || 'gpt-5');
const EXAMPLE_ROWS = Number.parseInt(process.env.EXAMPLE_ROWS || '12', 10);
const EXAMPLE_CSV_PATH = path.join(ROOT, 'nyt_connections_groups_history_sept2025.csv');

let client = null;
function openai() {
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}

/** One model call; returns the reply text. `search` asks OpenAI to use its web
 *  search tool (Jetstream gets search results in the prompt instead). */
async function callModel(prompt, { search = false, temperature } = {}) {
  if (PROVIDER === 'jetstream') {
    const res = await fetch(`${JETSTREAM_BASE}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.JETSTREAM_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: prompt }], max_tokens: 12000 }),
      signal: AbortSignal.timeout(240000),
    });
    if (!res.ok) {
      const err = new Error(`jetstream ${res.status}: ${(await res.text()).slice(0, 200)}`);
      err.status = res.status;
      throw err;
    }
    const data = await res.json();
    return String(data.choices?.[0]?.message?.content || '').trim();
  }
  const req = { model: MODEL, input: prompt };
  if (search) req.tools = [{ type: 'web_search' }];
  if (temperature !== undefined && !/^gpt-5(\b|\D)/.test(MODEL)) req.temperature = temperature;
  const response = await openai().responses.create(req);
  return (response.output_text || '').trim();
}

/** Web research for models that cannot search: a few Tavily queries about the
 *  player and their town, as a numbered source list for the prompt. Empty if
 *  there is no TAVILY_API_KEY or the search fails. */
export async function research(name, location) {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return { text: '', sources: [] };
  const queries = [`"${name}" ${location}`, `${name} ${location} interests hobbies`, `${location} local food traditions landmarks`];
  const seen = new Set();
  const sources = [];
  await Promise.all(queries.map(async (query) => {
    try {
      const r = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, search_depth: 'basic', max_results: 5 }),
        signal: AbortSignal.timeout(20000),
      });
      if (!r.ok) return;
      for (const it of (await r.json()).results || []) {
        if (!it.url || seen.has(it.url)) continue;
        seen.add(it.url);
        sources.push({ title: String(it.title || '').slice(0, 160), url: it.url, content: String(it.content || '').replace(/\s+/g, ' ').slice(0, 600) });
      }
    } catch { /* one failed query is fine */ }
  }));
  const text = sources.map((x, i) => `[${i + 1}] ${x.title}\n${x.url}\n${x.content}`).join('\n\n');
  return { text, sources };
}

// Called with one object per OpenAI call; the Express server writes these to logs/app.log.
let logEvent = () => {};

export const RequestSchema = z.object({
  name: z.string().min(1).max(80),
  location: z.string().min(1).max(160),
});


function buildPrompt({ name, location }) {
  const examplesText = getExampleGroupsText(EXAMPLE_ROWS);
  return `You are designing a Connections-style word GROUPING GAME for a specific player. It must feel fun, playful, and surprising — not like a resume.\n\nPlayer: Name = ${name} | Location = ${location}.\n\nTONE\n- Make this a party-friendly mini-game. Be imaginative and lighthearted. It's okay to SPECULATE about hobbies and tastes (food, travel, music, sports, nostalgic media, games, outdoors, pop culture), as long as it’s family‑friendly and non-sensitive.\n\nSOURCES\n- USE WEB SEARCH only for public, non-sensitive info. Never include private data.\n\nCONSTRAINTS\n  1) At least TWO categories must be fun/non‑professional (hobbies, culture, food, humor, etc.).\n  2) At MOST ONE category may be tied to work/professional background.\n  3) At MOST ONE category may be primarily location-based.\n  4) Words must be SINGLE TOKENS for gameplay; spaces or hyphens are allowed when natural (e.g., MOUNT WASHINGTON).\n  5) No overlaps across categories. Exactly 16 unique words.\n  6) Keep everything friendly and suitable for all ages.\n\nProvide a SHORT explanation per category (why the set fits and why it might delight this player). Also provide 3–6 recent links (articles/videos) about the chosen topics.\n\nEXAMPLES OF GOOD GROUPS (format and difficulty):\n${examplesText}\n\nCOLOR RUBRIC\n- Yellow (Simplest): straightforward, common categories.\n- Green (Simple): slightly more challenging, specific but clear.\n- Blue (Medium): moderately difficult, requires lateral thinking.\n- Purple (Hardest): most difficult, wordplay/puns/obscure references.\n\nReturn ONLY JSON with this structure:\n{\n  \"categories\": [\n    { \"label\": \"Category A\", \"words\": [\"WORD1\", \"WORD2\", \"WORD3\", \"WORD4\"], \"explanation\": \"short per-category reason\", \"color\": \"Yellow|Green|Blue|Purple\" },\n    { \"label\": \"Category B\", \"words\": [\"WORD1\", \"WORD2\", \"WORD3\", \"WORD4\"], \"explanation\": \"...\", \"color\": \"Yellow|Green|Blue|Purple\" },\n    { \"label\": \"Category C\", \"words\": [\"WORD1\", \"WORD2\", \"WORD3\", \"WORD4\"], \"explanation\": \"...\", \"color\": \"Yellow|Green|Blue|Purple\" },\n    { \"label\": \"Category D\", \"words\": [\"WORD1\", \"WORD2\", \"WORD3\", \"WORD4\"], \"explanation\": \"...\", \"color\": \"Yellow|Green|Blue|Purple\" }\n  ],\n  \"explanation\": \"one paragraph describing the playful rationale tailored to the player\",\n  \"recommendations\": [\n    { \"title\": \"Title\", \"url\": \"https://...\", \"type\": \"article|video|podcast\" }\n  ]\n}`;
}

// Read a capped number of rows from the CSV and format as lines like:
// Group Name: WORD1, WORD2, WORD3, WORD4
function getExampleGroupsText(maxRows) {
  try {
    const raw = fs.readFileSync(EXAMPLE_CSV_PATH, 'utf8');
    const lines = raw.split(/\r?\n/);
    const out = [];
    for (let i = 1; i < lines.length && out.length < maxRows; i++) {
      const line = lines[i];
      if (!line || !line.trim()) continue;
      const cells = splitCsvLine(line);
      if (cells.length < 6) continue;
      const name = cells[0];
      const w1 = cells[2];
      const w2 = cells[3];
      const w3 = cells[4];
      const w4 = cells[5];
      out.push(`- ${name}: ${w1}, ${w2}, ${w3}, ${w4}`);
    }
    return out.join('\n');
  } catch (e) {
    return '- KINDS OF UNDERWEAR: BOXER, BRIEF, HIPSTER, THONG';
  }
}

// CSV splitter that respects quotes
function splitCsvLine(line) {
  const result = [];
  let curr = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      // toggle quotes or handle escaped quotes
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        curr += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(curr.trim().replace(/^"|"$/g, ''));
      curr = '';
    } else {
      curr += ch;
    }
  }
  result.push(curr.trim().replace(/^"|"$/g, ''));
  return result;
}

function extractJsonCandidate(text) {
  // Try as-is
  try { return JSON.parse(text); } catch {}
  // Try fenced code block ```json ... ```
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) {
    try { return JSON.parse(fenced[1].trim()); } catch {}
  }
  // Try slice from first { to last }
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) {
    const slice = text.slice(first, last + 1);
    try { return JSON.parse(slice); } catch {}
  }
  throw new Error('Unable to parse JSON from model output');
}

function formatDuration(ms) {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const millis = Math.floor(ms % 1000);
  if (minutes > 0) return `${minutes}m ${seconds}s ${millis}ms`;
  if (seconds > 0) return `${seconds}s ${millis}ms`;
  return `${millis}ms`;
}

async function generateOnce(prompt, attempt) {
  const t0 = Date.now();
  let text;
  try {
    text = await callModel(prompt, { search: true, temperature: 0.7 });
  } finally {
    const ms = Date.now() - t0;
    logEvent({ event: 'model_call', provider: PROVIDER, kind: 'generate', attempt, ms, duration: formatDuration(ms) });
  }
  let data = extractJsonCandidate(text);
  data = OutputSchema.parse(data);
  // Normalize
  data.categories = data.categories.map(cat => ({
    label: String(cat.label).trim(),
    words: cat.words.map(normalizeWordForDisplay).slice(0, 4),
    explanation: cat.explanation ? String(cat.explanation).trim() : undefined,
    color: normalizeColor(cat.color),
  }));
  data.categories = ensureColors(data.categories);
  return { data, rawText: text };
}

async function generateWithRetries(name, location, recent = [], maxRetries = 2) {
  const memo = recent
    .filter(r => r && r.name && r.location && Array.isArray(r.categories))
    .map(r => `- ${r.name} | ${r.location}: ${r.categories.map(c => c.label).join(' | ')}`)
    .join('\n');
  let sourcesBlock = '';
  if (PROVIDER === 'jetstream') {
    const found = await research(name, location);
    logEvent({ event: 'research', sources: found.sources.length });
    sourcesBlock = found.text
      ? `\n\nSOURCES\nYou cannot search the web. These search results are all you know about the player and their town. Use only them for facts; tastes and hobbies may still be playful guesses. Every recommendation URL must be copied exactly from this list.\n\n${found.text}`
      : `\n\nSOURCES\nNo search results were found. Base the puzzle on the town and on playful, friendly guesses, and leave recommendations empty.`;
  }
  const basePrompt = buildPrompt({ name, location }) + sourcesBlock + (memo ? `\n\nAVOID REPETITION\nHere are recent players and category themes already used. Be novel and vary themes; avoid repeating these unless justified:\n${memo}` : '');
  let attempt = 0;
  let lastError = null;
  while (attempt <= maxRetries) {
    let prompt = basePrompt;
    if (attempt > 0) {
      prompt += `\n\nYour previous output had issues (e.g., duplicate words or schema errors). Regenerate STRICTLY ensuring: 4 categories x 4 words = 16 UNIQUE SINGLE-TOKEN words across all categories. No overlaps. Return ONLY raw JSON.`;
    }
    try {
      const { data, rawText } = await generateOnce(prompt, attempt);
      const all = data.categories.flatMap(c => c.words.map(canonicalizeWord));
      const unique = new Set(all);
      if (unique.size !== 16) {
        throw new Error('duplicate-words');
      }
      return { data, rawText, prompt };
    } catch (err) {
      lastError = err;
      attempt += 1;
      if (attempt > maxRetries) break;
    }
  }
  throw lastError || new Error('generation-failed');
}

async function ensureExplanations(data) {
  const missing = data.categories.some(c => !c.explanation);
  if (!missing) return data;
  const categoriesJson = JSON.stringify(data.categories.map(c => ({ label: c.label, words: c.words })), null, 2);
  const prompt = `Provide a SHORT explanation (<= 200 chars) for each Connections category below. Return ONLY JSON array of strings in the SAME ORDER as input categories.\n\nCategories:\n${categoriesJson}`;
  const t0 = Date.now();
  let text;
  try {
    text = await callModel(prompt, { temperature: 0.2 });
  } finally {
    const ms = Date.now() - t0;
    logEvent({ event: 'model_call', provider: PROVIDER, kind: 'explanations', ms, duration: formatDuration(ms) });
  }
  let arr;
  try {
    const parsed = extractJsonCandidate(text);
    if (Array.isArray(parsed)) arr = parsed;
  } catch {}
  if (!arr || arr.length !== 4) return data;
  data.categories = data.categories.map((c, i) => ({ ...c, explanation: String(arr[i] || '').trim() }));
  return data;
}

function ensureColors(categories) {
  const order = ['Yellow', 'Green', 'Blue', 'Purple'];
  const used = new Set(categories.map(c => c.color).filter(Boolean));
  const remaining = order.filter(c => !used.has(c));
  return categories.map((c, idx) => {
    if (order.includes(c.color)) return c;
    const assigned = remaining.shift() || order[idx % order.length];
    return { ...c, color: assigned };
  });
}


/** Make one puzzle. `recent` is the last few puzzles ({ name, location, categories }),
 *  so the prompt can ask for new themes. Throws if generation fails. */
export async function makePuzzle({ name, location, recent = [], log }) {
  if (log) logEvent = log;
  let { data, rawText, prompt } = await generateWithRetries(name, location, recent, 2);
  data = await ensureExplanations(data);
  return { data, rawText, prompt };
}
