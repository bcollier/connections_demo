// The puzzle packs and the validator they share with the live generator.
// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { puzzleProblems, canonicalizeWord, COLORS } from '../server/validate.js';
import { loadPacks, packProblems, bundle } from '../scripts/build-packs.mjs';

const packs = loadPacks();
const good = packs.find(p => p.id === 'starwars').puzzles[0];
const clone = o => JSON.parse(JSON.stringify(o));

test('there are four packs: About Ben, Star Wars, Lord of the Rings, Carnegie Mellon', () => {
  assert.deepEqual(packs.map(p => p.id), ['ben', 'starwars', 'lotr', 'cmu']);
});

test('every pack passes the validator, with at least three puzzles each', () => {
  assert.deepEqual(packProblems(packs), []);
  for (const p of packs) assert.ok(p.puzzles.length >= 3, p.id);
});

for (const pack of packs) {
  for (const puzzle of pack.puzzles) {
    test(`${pack.id}/${puzzle.id} "${puzzle.title}": 4 groups x 4 words, 16 distinct, one of each color`, () => {
      assert.equal(puzzle.categories.length, 4);
      for (const c of puzzle.categories) assert.equal(c.words.length, 4, c.label);
      assert.equal(new Set(puzzle.categories.flatMap(c => c.words.map(canonicalizeWord))).size, 16);
      assert.deepEqual([...puzzle.categories.map(c => c.color)].sort(), [...COLORS].sort());
      for (const c of puzzle.categories) assert.ok(c.explanation && c.explanation.length <= 240, c.label);
    });
  }
}

test('hand-written packs list their groups in difficulty order, yellow to purple', () => {
  for (const pack of packs.filter(p => p.id !== 'ben')) {
    for (const p of pack.puzzles) assert.deepEqual(p.categories.map(c => c.color), COLORS, p.id);
  }
});

test('the validator catches a repeated word, even with different punctuation', () => {
  const bad = clone(good);
  bad.categories[1].words[0] = 'R2 D2';
  assert.match(puzzleProblems(bad).join('\n'), /duplicate word: R2D2/);
});

test('the validator catches a group of three or five', () => {
  const three = clone(good);
  three.categories[0].words.pop();
  assert.ok(puzzleProblems(three).some(m => m.startsWith('schema')));
  const five = clone(good);
  five.categories[0].words.push('EXTRA');
  assert.ok(puzzleProblems(five).some(m => m.startsWith('schema')));
});

test('the validator catches a missing color or explanation in strict mode', () => {
  const bad = clone(good);
  bad.categories[3].color = 'Yellow';
  delete bad.categories[2].explanation;
  const msgs = puzzleProblems(bad, { strict: true }).join('\n');
  assert.match(msgs, /missing color Purple/);
  assert.match(msgs, /has no explanation/);
  assert.deepEqual(puzzleProblems(bad), []); // the live generator's looser check
});

test('packs/packs.js matches packs/*.json (run node scripts/build-packs.mjs)', () => {
  assert.equal(fs.readFileSync(new URL('../packs/packs.js', import.meta.url), 'utf8'), bundle(packs));
});

test('the committed history holds only puzzles about Ben (the local server appends every player)', () => {
  const rows = fs.readFileSync(new URL('../data/history.jsonl', import.meta.url), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  for (const r of rows) assert.equal(r.name, 'Ben Collier', 'remove other players from data/history.jsonl before committing');
});

test('the About Ben pack is only about Ben', () => {
  for (const p of packs.find(x => x.id === 'ben').puzzles) assert.equal(p.generated.player, 'Ben Collier');
});
