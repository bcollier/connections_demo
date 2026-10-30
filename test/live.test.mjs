// The newspaper and study-card writers: feed parsing, the prompts, the
// extended puzzle schema and the handlers' input checks. No network and no
// model calls, so it runs anywhere (npm test).
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, PAPERS, paperById } from '../server/news.js';
import { newsPrompt, studyPrompt, summarize } from '../server/puzzles.js';
import { OutputSchema, puzzleProblems } from '../server/validate.js';
import { extractJsonCandidate } from '../server/parse.js';
import { puzzle, admin, papers } from '../server/handlers.js';
import { acquireLock, releaseLock } from '../server/store.js';

const RSS = `<?xml version="1.0"?><rss><channel><title>Feed</title>
<item><title>Intel Shares Fall 22% &amp; More</title><link>https://www.example.com/2026/10/29/business/intel.html</link>
<description><![CDATA[<p>Weak outlook dents turnaround hopes.</p>]]></description><pubDate>Thu, 29 Oct 2026 23:45:30 GMT</pubDate>
<category domain="http://www.example.com/keywords/per">Gelsinger, Pat</category></item>
<item><title>Print Edition</title><link>https://www.example.com/print</link></item>
<item><title>No link here</title></item>
</channel></rss>`;

test('parseFeed reads RSS items: title, link, cleaned summary, date, section from the article path', () => {
  const items = parseFeed(RSS);
  assert.equal(items.length, 2); // the item without a link is dropped
  assert.equal(items[0].title, 'Intel Shares Fall 22% & More');
  assert.equal(items[0].summary, 'Weak outlook dents turnaround hopes.');
  assert.equal(items[0].section, 'Business'); // from /2026/10/29/business/, never from <category> keywords
  assert.equal(items[0].published, '2026-10-29T23:45:30.000Z');
});

test('parseFeed reads Atom entries too', () => {
  const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>A Harmless Act</title><link href="https://www.example.com/a/"/><summary>Costumes.</summary><updated>2026-10-29T15:11:00-04:00</updated></entry></feed>`;
  const [it] = parseFeed(atom, 'Culture');
  assert.equal(it.url, 'https://www.example.com/a/');
  assert.equal(it.section, 'Culture');
  assert.equal(it.summary, 'Costumes.');
});

test('the eleven CMU papers each have a source: an API, feeds or a Google News query', () => {
  assert.equal(PAPERS.length, 11);
  for (const p of PAPERS) assert.ok(p.api || p.feeds.length || p.google, p.id);
  assert.equal(paperById('nyt').name, 'The New York Times');
  assert.equal(paperById('wsj').google, 'site:wsj.com'); // its public RSS stopped updating in 2025
});

const stories = Array.from({ length: 12 }, (_, i) => ({ title: `Story ${i + 1}`, summary: `Summary ${i + 1}`, url: `https://www.example.com/${i + 1}`, section: i % 2 ? 'World' : 'Arts' }));

test('the news prompt numbers the stories and asks for story_index, red herrings and sixteen distinct words', () => {
  const p = newsPrompt({ paper: paperById('nyt'), stories, avoid: ['OLD LABEL (from: Old story)'] });
  assert.match(p, /\[12\] \(World\) Story 12 — Summary 12/);
  assert.match(p, /"story_index"/);
  assert.match(p, /Red herrings/);
  assert.match(p, /Sixteen distinct words/);
  assert.match(p, /ALREADY USED TODAY[\s\S]*OLD LABEL/);
  assert.match(p, /Yellow[\s\S]*Green[\s\S]*Blue[\s\S]*Purple/);
});

test('the study prompt asks for vocabulary, a trap group and four definitions per group', () => {
  const p = studyPrompt({ topic: 'cell biology', avoid: [] });
  assert.match(p, /Topic to study: cell biology/);
  assert.match(p, /"definitions"/);
  assert.match(p, /trap/);
  assert.doesNotMatch(p, /ALREADY USED/);
});

const newsPuzzle = {
  title: 'Mutants and Marathons',
  categories: [
    { label: 'X-MEN', words: ['BEAST', 'ROGUE', 'STORM', 'CYCLOPS'], color: 'Yellow', explanation: 'Mutants.', story_index: 1, story: { title: 'Story 1', url: 'https://www.example.com/1', section: 'Arts' } },
    { label: 'STAND-UP', words: ['SET', 'BIT', 'ROAST', 'OPENER'], color: 'Green', explanation: 'Comedy.', story_index: 2, story: { title: 'Story 2', url: 'https://www.example.com/2' } },
    { label: 'MARATHON', words: ['BIB', 'WALL', 'TAPER', 'SPLIT'], color: 'Blue', explanation: 'Running.', story_index: 3, story: { title: 'Story 3', url: 'https://www.example.com/3' } },
    { label: '___ AGE', words: ['STONE', 'ICE', 'BRONZE', 'SPACE'], color: 'Purple', explanation: 'Eras.', story_index: 4, story: { title: 'Story 4', url: 'https://www.example.com/4' } },
  ],
  explanation: 'ICE tempts solvers toward the X-Men.',
  source: { id: 'nyt', name: 'The New York Times', date: '2026-10-29' },
};

test('the schema accepts a news puzzle with a story per group and a study puzzle with definitions', () => {
  assert.ok(OutputSchema.safeParse(newsPuzzle).success);
  assert.deepEqual(puzzleProblems(newsPuzzle), []);
  const study = JSON.parse(JSON.stringify(newsPuzzle));
  for (const c of study.categories) { delete c.story; delete c.story_index; c.definitions = c.words.map(w => `${w} means something.`); }
  assert.ok(OutputSchema.safeParse(study).success);
  study.categories[0].definitions.pop();
  assert.equal(OutputSchema.safeParse(study).success, false, 'three definitions is not four');
});

test('summarize gives one line per puzzle naming each group and its story, for the "already used" memo', () => {
  const s = summarize(newsPuzzle);
  assert.match(s, /X-MEN \(from: Story 1\)/);
  assert.match(s, /___ AGE \(from: Story 4\)/);
});

test('extractJsonCandidate copes with fences and chatter around the JSON', () => {
  assert.deepEqual(extractJsonCandidate('Here you go:\n```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJsonCandidate('Sure! {"a":[1,2]} Done.'), { a: [1, 2] });
  assert.throws(() => extractJsonCandidate('no json at all'));
});

// A tiny fake of the (req, res) pair the handlers see.
function fakeReq({ method = 'POST', body = {}, origin = 'http://localhost:3000', host = 'localhost:3000' } = {}) {
  return { method, body, headers: { origin, host, 'x-forwarded-for': '203.0.113.9' }, url: '/api/x', query: {} };
}
function fakeRes() {
  const r = { code: 200, body: null, headers: {}, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; }, setHeader(k, v) { r.headers[k] = v; } };
  return r;
}

test('POST /api/puzzle refuses other sites, bad modes, unknown papers and empty topics', async () => {
  let res = fakeRes();
  await puzzle(fakeReq({ origin: 'https://evil.example', body: { mode: 'news', paper: 'nyt' } }), res);
  assert.equal(res.code, 403);
  res = fakeRes();
  await puzzle(fakeReq({ body: { mode: 'weird' } }), res);
  assert.equal(res.code, 400);
  res = fakeRes();
  await puzzle(fakeReq({ body: { mode: 'news', paper: 'pravda' } }), res);
  assert.equal(res.code, 400);
  res = fakeRes();
  await puzzle(fakeReq({ body: { mode: 'study', topic: ' ' } }), res);
  assert.equal(res.code, 400);
  res = fakeRes();
  await puzzle(fakeReq({ method: 'GET' }), res);
  assert.equal(res.code, 405);
});

test('POST /api/puzzle with savedOnly never writes: an unknown topic answers none', async () => {
  const res = fakeRes();
  await puzzle(fakeReq({ body: { mode: 'study', topic: `never-studied-${Date.now()}`, savedOnly: true } }), res);
  assert.equal(res.code, 200);
  assert.equal(res.body.none, true);
  assert.equal(res.body.saved, 0);
});

test('the writing lease is held by one caller at a time', async () => {
  const name = `test:${Date.now()}`;
  assert.equal(await acquireLock(name, 60000), true);
  assert.equal(await acquireLock(name, 60000), false);
  await releaseLock(name);
  assert.equal(await acquireLock(name, 60000), true);
  await releaseLock(name);
  assert.equal(await acquireLock(name, 1), true);        // an expired lease can be taken over
  await new Promise(r => setTimeout(r, 5));
  assert.equal(await acquireLock(name, 60000), true);
  await releaseLock(name);
});

test('POST /api/admin needs the password, and says so when none is configured', async () => {
  const saved = process.env.ADMIN_PASSWORD;
  delete process.env.ADMIN_PASSWORD;
  let res = fakeRes();
  await admin(fakeReq({ body: { password: 'anything' } }), res);
  assert.equal(res.code, 503);
  process.env.ADMIN_PASSWORD = 'correct-horse';
  res = fakeRes();
  await admin(fakeReq({ body: { password: 'wrong' } }), res);
  assert.equal(res.code, 401);
  if (saved === undefined) delete process.env.ADMIN_PASSWORD; else process.env.ADMIN_PASSWORD = saved;
});

test('GET /api/papers lists the papers and the model', async () => {
  const res = fakeRes();
  await papers(fakeReq({ method: 'GET' }), res);
  assert.equal(res.code, 200);
  assert.equal(res.body.papers.length, 11);
  assert.ok(res.body.model);
});
