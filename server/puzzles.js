// The two puzzle writers: one from a newspaper's headlines, one from a study
// topic. Both brief the model like a puzzle editor, parse and check the answer
// (server/validate.js), and retry up to twice with a note about what broke.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { complete } from './llm.js';
import { extractJsonCandidate } from './parse.js';
import { OutputSchema, normalizeWordForDisplay, canonicalizeWord, normalizeColor, COLORS } from './validate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXAMPLE_CSV = path.join(ROOT, 'nyt_connections_groups_history_sept2025.csv');

export const SYSTEM = `You write Connections puzzles: sixteen words that sort into four groups of four. A good puzzle has one plain group, one clever group built on wordplay or a hidden pattern, and red herrings: words that look like they belong to one group but are needed in another (five words that could be "colors" when only four are). Every word is a single game token (one word, or a short fixed phrase like "RED TAPE" at most 20 characters), in capitals, with no word repeated or sharing a root with another. Labels are witty category names, never the headline itself. You answer with JSON only.`;

const RUBRIC = `COLOR RUBRIC (difficulty)
- Yellow: the plain group, obvious once seen.
- Green: specific but clear.
- Blue: needs a sideways step.
- Purple: wordplay, a hidden pattern, or words that complete a phrase.
Assign each color exactly once.`;

const OUTPUT = (extra) => `Return ONLY this JSON:
{
  "title": "a short headline-style title for the puzzle (at most 60 characters)",
  "categories": [
    { "label": "...", "words": ["...", "...", "...", "..."], "color": "Yellow|Green|Blue|Purple", "explanation": "..."${extra} },
    ... four groups
  ],
  "explanation": "two sentences on the puzzle's design: the trap, and what makes the purple group click"
}`;

function exampleGroups(n = 10) {
  try {
    const lines = fs.readFileSync(EXAMPLE_CSV, 'utf8').split(/\r?\n/).slice(1).filter(Boolean);
    const pick = [];
    for (let i = 0; i < lines.length && pick.length < n; i += Math.max(1, Math.floor(lines.length / n))) {
      const c = lines[i].split(',').map(x => x.replace(/^"|"$/g, '').trim());
      if (c.length >= 6) pick.push(`- ${c[0]}: ${c[2]}, ${c[3]}, ${c[4]}, ${c[5]}`);
    }
    return pick.join('\n');
  } catch { return '- THINGS WITH KEYS: PIANO, KEYBOARD, MAP, LOCK'; }
}

// ---------------------------------------------------------------------------
// Newspaper puzzles
// ---------------------------------------------------------------------------
export function newsPrompt({ paper, stories, avoid }) {
  const list = stories.map((s, i) => `[${i + 1}]${s.section ? ` (${s.section})` : ''} ${s.title}${s.summary ? ` — ${s.summary.slice(0, 280)}` : ''}`).join('\n');
  const memo = avoid.length ? `\n\nALREADY USED TODAY (do not build groups on these stories or labels again):\n${avoid.map(a => `- ${a}`).join('\n')}` : '';
  return `Today's stories from ${paper.name}, numbered:\n${list}${memo}

Write one Connections puzzle from these stories.

RULES
1. Pick FOUR stories, as different from each other as possible (different sections, different parts of the world, at least one that is not politics or markets). Each group is inspired by exactly one story and names it with "story_index".
2. The four words of a group are things named in or strongly evoked by that story: people's surnames, places, companies, products, objects, verbs, numbers written as words. A reader who has read the story should feel the click; a reader who has not should still be able to solve it from general knowledge, so avoid private names nobody knows.
3. The label is a category, not a summary: "THINGS A CENTRAL BANK CAN RAISE", "NAMED FOR A GREEK LETTER", "___ MARKET". Never put the story's headline in the label.
4. Red herrings across groups are required: at least three words should plausibly fit a different group at first glance.
5. Sixteen distinct words, each at most 20 characters, no two sharing a root (RUN and RUNNING count as the same word). No word appears in another group's label.
6. The explanation of each group (two or three sentences, at most 400 characters) says how the four words connect and how the story inspired them, without giving away more of the story than its headline does.
7. Family friendly. Nothing about victims of crimes, accidents or disasters by name.

EXAMPLES OF REAL GROUPS (format and difficulty, not topics):
${exampleGroups()}

${RUBRIC}

${OUTPUT(', "story_index": 3')}`;
}

/** Fill in each group's story from the numbered list and check the references. */
function attachStories(data, stories) {
  const used = new Set();
  for (const c of data.categories) {
    const i = c.story_index;
    if (!Number.isInteger(i) || i < 1 || i > stories.length) throw new Error('story_index out of range');
    if (used.has(i)) throw new Error('two groups use the same story');
    used.add(i);
    const s = stories[i - 1];
    c.story = { title: s.title, url: s.url, summary: s.summary || '', section: s.section || '', published: s.published || null, via: s.via };
  }
  return data;
}

// ---------------------------------------------------------------------------
// Study cards
// ---------------------------------------------------------------------------
export function studyPrompt({ topic, avoid }) {
  const memo = avoid.length ? `\n\nALREADY USED FOR THIS TOPIC (choose different groups and words):\n${avoid.map(a => `- ${a}`).join('\n')}` : '';
  return `Topic to study: ${topic}${memo}

Write one Connections puzzle whose sixteen words are vocabulary a student of this topic should know. Solving it should teach: the groups are concept families (kinds of something, steps of a process, things measured in the same unit, terms named after people, words with a second everyday meaning).

RULES
1. Every word is a real term from the topic, at most 20 characters, as a single token (one word or a short fixed phrase). Prefer the standard term over a paraphrase. Sixteen distinct words, no two sharing a root.
2. At least one group is a trap: terms a beginner would file under a different group.
3. The label names the concept family. The group's explanation (two or three sentences, at most 400 characters) teaches why the four belong together and what separates them from the near misses.
4. "definitions" gives one definition per word in the same order as the words, each at most fifteen words, plain language.
5. Accuracy over cleverness: every definition must be correct for the topic as taught in a standard course. Do not invent terms.

EXAMPLES OF REAL GROUPS (format and difficulty, not topics):
${exampleGroups()}

${RUBRIC}

${OUTPUT(', "definitions": ["...", "...", "...", "..."]')}`;
}

// ---------------------------------------------------------------------------
// Shared: call, parse, check, retry
// ---------------------------------------------------------------------------
function normalize(data) {
  data.categories = data.categories.map(c => ({
    ...c,
    label: String(c.label).trim(),
    words: c.words.map(normalizeWordForDisplay).slice(0, 4),
    explanation: c.explanation ? String(c.explanation).trim() : undefined,
    color: normalizeColor(c.color),
  }));
  const used = new Set();
  const remaining = COLORS.filter(col => !data.categories.some(c => c.color === col));
  data.categories = data.categories.map(c => {
    if (c.color && !used.has(c.color)) { used.add(c.color); return c; }
    const color = remaining.shift() || COLORS.find(col => !used.has(col));
    used.add(color);
    return { ...c, color };
  });
  data.categories.sort((a, b) => COLORS.indexOf(a.color) - COLORS.indexOf(b.color));
  return data;
}

function problems(data) {
  const out = [];
  const all = data.categories.flatMap(c => c.words.map(canonicalizeWord));
  if (new Set(all).size !== 16) out.push('the sixteen words are not all different');
  const stems = all.map(w => w.replace(/(ING|ED|ERS|ES|S)$/, ''));
  if (new Set(stems).size !== 16) out.push('two words share a root (e.g. RUN and RUNNING)');
  for (const w of all) if (!w) out.push('a word has no letters');
  const labels = data.categories.map(c => c.label.toUpperCase());
  for (const c of data.categories) for (const w of c.words) if (labels.some(l => l.includes(w) && w.length > 3)) out.push(`the word ${w} appears in a label`);
  if (new Set(labels).size !== 4) out.push('two groups share a label');
  for (const c of data.categories) if (!c.explanation) out.push(`group ${c.label} has no explanation`);
  return out;
}

async function generate({ prompt, model, check, maxRetries = 2, log = () => {} }) {
  let attempt = 0; let lastError = null; let costTotal = 0;
  while (attempt <= maxRetries) {
    let p = prompt;
    if (attempt > 0 && lastError) p += `\n\nYOUR LAST ANSWER WAS REJECTED: ${lastError.message}. Write a new puzzle that follows every rule. JSON only.`;
    const t0 = Date.now();
    try {
      const r = await complete({ model, system: SYSTEM, prompt: p, maxTokens: 4000, temperature: attempt ? 1 : 0.8 });
      costTotal += Number(r.cost || 0);
      log({ event: 'model_call', model: r.model, attempt, ms: Date.now() - t0, usage: r.usage });
      let data = OutputSchema.parse(extractJsonCandidate(r.text));
      data = normalize(data);
      if (check) data = check(data);
      const probs = problems(data);
      if (probs.length) throw new Error(probs.join('; '));
      return { data, cost: costTotal, model: r.model, attempts: attempt + 1 };
    } catch (err) {
      if (err && err.status) throw err; // network or provider trouble: do not burn retries
      log({ event: 'rejected', attempt, reason: String(err.message || err).slice(0, 200) });
      lastError = err;
      attempt += 1;
    }
  }
  throw lastError || new Error('generation-failed');
}

/** A puzzle from a paper's stories. `avoid` is text about groups already used today. */
export async function makeNewsPuzzle({ paper, stories, avoid = [], model, log, date }) {
  if (stories.length < 8) throw Object.assign(new Error('too few stories'), { code: 'nostories' });
  const prompt = newsPrompt({ paper, stories, avoid });
  const r = await generate({ prompt, model, check: d => attachStories(d, stories), log });
  r.data.source = { id: paper.id, name: paper.name, short: paper.short, home: paper.home, date };
  r.data.generated = { model: r.model, ts: new Date().toISOString(), mode: 'news' };
  return r;
}

/** A study-cards puzzle for a topic. */
export async function makeStudyPuzzle({ topic, avoid = [], model, log }) {
  const prompt = studyPrompt({ topic, avoid });
  const r = await generate({ prompt, model, log, check: d => {
    for (const c of d.categories) if (!Array.isArray(c.definitions) || c.definitions.length !== 4) throw new Error('every group needs four definitions');
    return d;
  } });
  r.data.source = { id: 'study', name: topic };
  r.data.generated = { model: r.model, ts: new Date().toISOString(), mode: 'study' };
  return r;
}

/** One line per past puzzle, for the "already used" memo. */
export function summarize(puzzle) {
  return puzzle.categories.map(c => c.story ? `${c.label} (from: ${c.story.title})` : `${c.label}: ${c.words.join(', ')}`).join(' | ');
}
