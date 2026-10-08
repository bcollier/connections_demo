// Records a short play-through of each theme and turns it into a GIF for the
// README (docs/gifs/<theme>.gif). Needs ffmpeg. Run with: npm run gifs
import fs from 'fs';
import path from 'path';
import http from 'http';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'docs', 'gifs');
const TMP = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'cx-gif-'));
fs.mkdirSync(OUT, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  let file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
  if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const packs = JSON.parse(fs.readFileSync(path.join(ROOT, 'packs', 'packs.js'), 'utf8').replace(/^[\s\S]*?= /, '').replace(/;\s*$/, ''));
const browser = await chromium.launch();
const W = 390, H = 760;

for (const theme of ['ben', 'starwars', 'lotr', 'cmu']) {
  const cats = packs.find(p => p.id === theme).puzzles[0].categories;
  const context = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: TMP, size: { width: W, height: H } } });
  const page = await context.newPage();
  await page.route('**/api/**', r => r.fulfill({ status: 503, body: '{}' }));
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html?theme=${theme}&puzzle=1`);
  await page.waitForSelector('.cx-tile');
  await page.evaluate(() => document.querySelector('.cx').scrollIntoView());
  await page.waitForTimeout(theme === 'starwars' ? 5200 : 1500);
  if (theme === 'starwars') await page.click('.cx-crawl-skip');
  await page.evaluate(() => document.querySelector('.cx-grid').scrollIntoView({ block: 'center' }));
  const pick = async ws => { for (const w of ws) { await page.click(`.cx-tile[data-word="${w}"]`); await page.waitForTimeout(160); } };
  await page.click('text=Shuffle'); await page.waitForTimeout(700);
  await pick(cats[0].words); await page.click('.cx-primary'); await page.waitForTimeout(1700);
  await pick([...cats[1].words.slice(0, 3), cats[2].words[0]]); await page.click('.cx-primary'); await page.waitForTimeout(1500);
  await page.click('text=Deselect all');
  for (const c of cats.slice(1)) { await pick(c.words); await page.click('.cx-primary'); await page.waitForTimeout(1500); }
  await page.waitForTimeout(1600);
  const video = page.video();
  await context.close();
  const webm = await video.path();
  const gif = path.join(OUT, `${theme}.gif`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', webm, '-vf',
    'fps=7,scale=250:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=64:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle', gif]);
  console.log(`${path.relative(ROOT, gif)}: ${(fs.statSync(gif).size / 1e6).toFixed(1)} MB`);
}
await browser.close();
server.close();
fs.rmSync(TMP, { recursive: true, force: true });
