// Headless browser checks of every theme at desktop and phone width, saving
// screenshots to docs/screenshots/. Run with: npm run test:e2e
//
// For each theme it opens puzzle 1 and saves four frames: the start, one
// solved group, a wrong guess mid-shake (with the "one away" toast), and the
// win screen. It also checks the game by keyboard, with reduced motion, and
// the copied share grid, and fails on any console error.
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'docs', 'screenshots');
fs.mkdirSync(OUT, { recursive: true });
const THEMES = ['ben', 'starwars', 'lotr', 'cmu'];
const SIZES = [['desktop', 1440, 900], ['phone', 390, 844]];
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' };

// A static server for the repo folder; the page sees an http origin, not a
// file, so it runs in its no-server demo mode only when told to (below).
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let file = path.join(ROOT, decodeURIComponent(url.pathname));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/index.html`;
const packs = JSON.parse(fs.readFileSync(path.join(ROOT, 'packs', 'packs.js'), 'utf8').replace(/^[\s\S]*?= /, '').replace(/;\s*$/, ''));

const browser = await chromium.launch();
const errors = [];
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.jpg`), type: 'jpeg', quality: 82 });

async function openGame(context, theme) {
  const page = await context.newPage();
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.g|Failed to load resource/.test(m.text())) errors.push(`${theme}: ${m.text()}`); });
  page.on('pageerror', e => errors.push(`${theme}: ${e.message}`));
  // Local mode, with every request to the generator server answered offline.
  await page.addInitScript(() => { window.CONNECTIONS_API_BASE = ''; });
  await page.route('**/api/**', r => r.fulfill({ status: 503, body: '{}' }));
  await page.goto(`${BASE}?theme=${theme}&puzzle=1`);
  await page.waitForSelector('.cx-tile');
  return page;
}

async function pick(page, words) {
  for (const w of words) await page.click(`.cx-tile[data-word="${w}"]`);
}
async function submitAndSettle(page) {
  const before = await page.locator('.cx-band').count();
  await page.click('.cx-primary');
  await page.waitForFunction(n => document.querySelectorAll('.cx-band').length > n, before, { timeout: 8000 });
  await page.waitForTimeout(800); // the band's entrance and the theme's flourish
}

for (const theme of THEMES) {
  const puzzle = packs.find(p => p.id === theme).puzzles[0];
  const cats = puzzle.categories;
  for (const [label, width, height] of SIZES) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: label === 'phone' ? 2 : 1 });
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const page = await openGame(context, theme);
    const name = `${theme}-${label}`;
    await page.evaluate(() => document.fonts.ready);

    // 1. Start. Star Wars opens with its crawl: save a frame of it, then skip.
    if (theme === 'starwars') {
      await page.waitForTimeout(6500);
      await shot(page, `${name}-0-crawl`);
      await page.click('.cx-crawl-skip');
      assert.equal(await page.isVisible('.cx-crawl'), false, 'crawl skipped');
    } else {
      await page.waitForTimeout(2600); // let the map border and runes ink in
    }
    assert.equal(await page.locator('.cx-tile').count(), 16);
    assert.equal(await page.locator('.cx-dots i.on').count(), 4);
    await shot(page, `${name}-1-start`);

    // 2. A solved group slides to the top in its color.
    await pick(page, cats[0].words);
    assert.equal(await page.getAttribute(`.cx-tile[data-word="${cats[0].words[0]}"]`, 'aria-pressed'), 'true');
    await submitAndSettle(page);
    assert.equal(await page.locator('.cx-band').count(), 1);
    assert.equal(await page.locator('.cx-tile').count(), 12);
    assert.match(await page.textContent('.cx-band'), new RegExp(cats[0].label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    await shot(page, `${name}-2-solved`);

    // 3. A wrong guess: three from one group and one from another is "one away".
    await pick(page, [...cats[1].words.slice(0, 3), cats[2].words[0]]);
    await page.click('.cx-primary');
    await page.waitForTimeout(720); // after the hop, inside the shake
    await shot(page, `${name}-3-wrong`);
    await page.waitForTimeout(500);
    assert.match(await page.textContent('.cx-toast'), /One away/);
    assert.equal(await page.locator('.cx-dots i.on').count(), 3);
    // the same guess again costs nothing
    await page.click('.cx-primary');
    await page.waitForTimeout(200);
    assert.match(await page.textContent('.cx-toast'), /Already guessed/);
    assert.equal(await page.locator('.cx-dots i.on').count(), 3);
    await page.click('text=Deselect all');

    // 4. Solve the rest: the win screen, confetti, and the share grid.
    for (const c of cats.slice(1)) { await pick(page, c.words); await submitAndSettle(page); }
    await page.waitForSelector('.cx-end:not([hidden])');
    await page.locator('.cx-end').scrollIntoViewIfNeeded();
    await page.waitForTimeout(label === 'phone' ? 400 : 250);
    await shot(page, `${name}-4-win`);
    await page.click('text=Copy result');
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    assert.match(copied, /Connections/);
    assert.equal(copied.split('\n').filter(l => /^[\u{1F7E8}\u{1F7E9}\u{1F7E6}\u{1F7EA}]{4}$/u.test(l)).length, 5, 'five guess rows');
    assert.equal(await page.locator('.cx-why li').count(), 4);

    // No sideways scrolling at this width.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 0, `${name} scrolls sideways by ${overflow}px`);
    console.log(`ok ${name}`);
    await context.close();
  }
}

// Keyboard only, with reduced motion, at the narrowest phone width.
{
  const context = await browser.newContext({ viewport: { width: 360, height: 740 }, reducedMotion: 'reduce' });
  const page = await openGame(context, 'cmu');
  assert.equal(await page.isVisible('.cx-crawl'), false);
  const cats = packs.find(p => p.id === 'cmu').puzzles[0].categories;
  for (const c of cats) {
    await page.focus('.cx-tile[tabindex="0"]');
    for (const w of c.words) {
      const order = await page.$$eval('.cx-tile', ts => ts.map(t => t.dataset.word));
      const current = order.indexOf(await page.evaluate(() => document.activeElement.dataset.word));
      const target = order.indexOf(w);
      const key = target > current ? 'ArrowRight' : 'ArrowLeft';
      for (let i = 0; i < Math.abs(target - current); i++) await page.keyboard.press(key);
      await page.keyboard.press('Space');
    }
    await page.keyboard.press('Control+Enter');
    await page.waitForTimeout(150);
  }
  await page.waitForSelector('.cx-end:not([hidden])');
  assert.equal(await page.evaluate(() => document.activeElement.className), 'cx-end-title');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 0, `360px scrolls sideways by ${overflow}px`);
  await shot(page, 'cmu-360-keyboard-reduced-win');
  console.log('ok keyboard + reduced motion at 360px');
  await context.close();
}

// Four wrong guesses end the game and reveal every group.
{
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await openGame(context, 'lotr');
  const cats = packs.find(p => p.id === 'lotr').puzzles[0].categories;
  const wrong = [[0, 1, 2, 3], [1, 2, 3, 0], [2, 3, 0, 1], [3, 0, 1, 2]];
  for (const [a, b, c, d] of wrong) {
    if (await page.isEnabled('text=Deselect all')) await page.click('text=Deselect all');
    await pick(page, [cats[a].words[0], cats[b].words[1], cats[c].words[2], cats[d].words[3]]);
    await page.click('.cx-primary');
    await page.waitForTimeout(1300);
  }
  await page.waitForSelector('.cx-end:not([hidden])', { timeout: 10000 });
  assert.equal(await page.locator('.cx-band.cx-missed').count(), 4);
  console.log('ok losing reveals the groups');
  await context.close();
}

await browser.close();
server.close();
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`screenshots in ${path.relative(ROOT, OUT)}/`);
