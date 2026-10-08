// The puzzle checks, shared by the live generator (server/generator.js), the
// pack bundler (scripts/build-packs.mjs) and the tests (test/). Only zod, no
// network, so it runs anywhere.
import { z } from 'zod';

export const COLORS = ['Yellow', 'Green', 'Blue', 'Purple'];

// What the model must return, and what every saved or hand-written puzzle must
// look like: four groups of four words, a label, an optional reason per group.
export const OutputSchema = z.object({
  categories: z.array(z.object({
    label: z.string().min(1).max(40),
    words: z.array(z.string().min(1).max(20)).length(4),
    explanation: z.string().min(1).max(240).optional(),
    color: z.string().optional(),
  })).length(4),
  explanation: z.string().min(1),
  recommendations: z.array(z.object({
    title: z.string(),
    url: z.string().url(),
    type: z.enum(['article', 'video', 'podcast']).optional(),
  })).max(6).optional(),
});

/** Upper case, single spaces, only letters, digits, spaces, hyphens and apostrophes. */
export function normalizeWordForDisplay(word) {
  return String(word)
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .replace(/[^A-Z0-9 \-']/g, '')
    .trim();
}

/** The form used to decide whether two words are "the same": letters and digits only. */
export function canonicalizeWord(word) {
  return String(word).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function normalizeColor(input) {
  if (!input) return undefined;
  const v = String(input).trim().toLowerCase();
  if (v.startsWith('y')) return 'Yellow';
  if (v.startsWith('g')) return 'Green';
  if (v.startsWith('b')) return 'Blue';
  if (v.startsWith('p')) return 'Purple';
  return undefined;
}

/**
 * Every problem with a puzzle, as a list of strings (empty means it is fine).
 * `strict` is for puzzles people curate by hand (the packs): each group must
 * also have an explanation, the four colors must each appear once, and words
 * must already be in display form.
 */
export function puzzleProblems(puzzle, { strict = false } = {}) {
  const problems = [];
  const parsed = OutputSchema.safeParse(puzzle);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) problems.push(`schema: ${issue.path.join('.')}: ${issue.message}`);
    return problems;
  }
  const all = puzzle.categories.flatMap(c => c.words.map(canonicalizeWord));
  const seen = new Set();
  for (const w of all) {
    if (!w) problems.push('a word has no letters or digits');
    else if (seen.has(w)) problems.push(`duplicate word: ${w}`);
    seen.add(w);
  }
  if (seen.size !== 16) problems.push(`expected 16 unique words, found ${seen.size}`);
  const labels = new Set(puzzle.categories.map(c => c.label.trim().toUpperCase()));
  if (labels.size !== 4) problems.push('two groups share a label');
  if (strict) {
    const colors = puzzle.categories.map(c => c.color);
    for (const c of COLORS) if (!colors.includes(c)) problems.push(`missing color ${c}`);
    puzzle.categories.forEach((c, i) => {
      if (!c.explanation) problems.push(`group ${i + 1} (${c.label}) has no explanation`);
      for (const w of c.words) if (normalizeWordForDisplay(w) !== w) problems.push(`word not in display form: ${w}`);
    });
  }
  return problems;
}
