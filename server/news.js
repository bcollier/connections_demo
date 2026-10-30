// Today's headlines from each newspaper in Carnegie Mellon's digital news
// subscriptions (https://guides.library.cmu.edu/digital_news/home), as a list
// of { title, summary, url, section, published } the puzzle writer can read.
//
// Sources, in order of preference:
//   1. A publisher API with a key: the New York Times Top Stories API (NYT_API_KEY),
//      which gives a real abstract per story.
//   2. The paper's own RSS feeds (headline + one-line summary).
//   3. Google News search for the paper's site (headlines only, links that redirect
//      to the paper). Used when a paper has no working public feed (the Wall Street
//      Journal stopped updating its RSS in 2025) or the feeds come back stale.
// Nothing here needs a login; the links open the paper's site or app, where CMU
// readers sign in with their own subscription.

export const PAPERS = [
  { id: 'nyt', name: 'The New York Times', short: 'NYT', home: 'https://www.nytimes.com/', maxAgeHours: 36,
    api: 'nyt',
    feeds: ['https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml', 'https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml', 'https://rss.nytimes.com/services/xml/rss/nyt/Science.xml', 'https://rss.nytimes.com/services/xml/rss/nyt/Arts.xml', 'https://rss.nytimes.com/services/xml/rss/nyt/Sports.xml'],
    google: 'site:nytimes.com' },
  { id: 'wsj', name: 'The Wall Street Journal', short: 'WSJ', home: 'https://www.wsj.com/', maxAgeHours: 36,
    feeds: ['https://feeds.a.dj.com/rss/RSSWorldNews.xml', 'https://feeds.a.dj.com/rss/RSSMarketsMain.xml', 'https://feeds.a.dj.com/rss/WSJcomUSBusiness.xml', 'https://feeds.a.dj.com/rss/RSSWSJD.xml', 'https://feeds.a.dj.com/rss/RSSOpinion.xml'],
    google: 'site:wsj.com' },
  { id: 'wapo', name: 'The Washington Post', short: 'The Post', home: 'https://www.washingtonpost.com/', maxAgeHours: 36,
    feeds: ['https://feeds.washingtonpost.com/rss/national', 'https://feeds.washingtonpost.com/rss/world', 'https://feeds.washingtonpost.com/rss/politics', 'https://feeds.washingtonpost.com/rss/business'],
    google: 'site:washingtonpost.com' },
  { id: 'ft', name: 'Financial Times', short: 'FT', home: 'https://www.ft.com/', maxAgeHours: 36,
    feeds: ['https://www.ft.com/rss/home', 'https://www.ft.com/world?format=rss', 'https://www.ft.com/companies?format=rss', 'https://www.ft.com/technology?format=rss'],
    google: 'site:ft.com' },
  { id: 'bloomberg', name: 'Bloomberg', short: 'Bloomberg', home: 'https://www.bloomberg.com/', maxAgeHours: 36,
    feeds: ['https://feeds.bloomberg.com/markets/news.rss', 'https://feeds.bloomberg.com/politics/news.rss', 'https://feeds.bloomberg.com/technology/news.rss'],
    google: 'site:bloomberg.com' },
  { id: 'atlantic', name: 'The Atlantic', short: 'The Atlantic', home: 'https://www.theatlantic.com/', maxAgeHours: 96,
    feeds: ['https://www.theatlantic.com/feed/all/'], google: 'site:theatlantic.com' },
  { id: 'insider', name: 'Business Insider', short: 'Insider', home: 'https://www.businessinsider.com/', maxAgeHours: 36,
    feeds: ['https://feeds.businessinsider.com/custom/all'], google: 'site:businessinsider.com' },
  { id: 'information', name: 'The Information', short: 'The Information', home: 'https://www.theinformation.com/', maxAgeHours: 96,
    feeds: ['https://www.theinformation.com/feed'], google: 'site:theinformation.com' },
  { id: 'newyorker', name: 'The New Yorker', short: 'New Yorker', home: 'https://www.newyorker.com/', maxAgeHours: 120,
    feeds: ['https://www.newyorker.com/feed/everything'], google: 'site:newyorker.com' },
  { id: 'pbt', name: 'Pittsburgh Business Times', short: 'Business Times', home: 'https://www.bizjournals.com/pittsburgh/', maxAgeHours: 72,
    feeds: [], google: 'site:bizjournals.com/pittsburgh' },
  { id: 'pg', name: 'Pittsburgh Post-Gazette', short: 'Post-Gazette', home: 'https://www.post-gazette.com/', maxAgeHours: 36,
    feeds: ['https://www.post-gazette.com/rss/news', 'https://www.post-gazette.com/rss/local', 'https://www.post-gazette.com/rss/business', 'https://www.post-gazette.com/rss/sports'],
    google: 'site:post-gazette.com' },
];

export const paperById = id => PAPERS.find(p => p.id === id);

const UA = 'Mozilla/5.0 (compatible; connections-game/2.0; +https://github.com/bcollier/connections_demo)';
const MIN_STORIES = 10;

// ---- small XML helpers (feeds are simple enough that a parser dependency is not worth it) ----
const entities = s => String(s || '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
// CDATA off, entities decoded (feeds often escape their HTML), tags stripped, spaces collapsed.
const decode = s => entities(entities(String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')).replace(/<[^>]+>/g, ' '))
  .replace(/\s+/g, ' ').trim();
const tag = (xml, name) => {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(xml);
  return m ? m[1] : '';
};
const attr = (xml, name, a) => {
  const m = new RegExp(`<${name}\\b[^>]*\\b${a}="([^"]*)"`, 'i').exec(xml);
  return m ? m[1] : '';
};

/** Parse RSS 2.0 or Atom into story objects. `label` is the feed's own section name, if any. */
export function parseFeed(xml, label = '') {
  const items = xml.match(/<item\b[\s\S]*?<\/item>/gi) || xml.match(/<entry\b[\s\S]*?<\/entry>/gi) || [];
  return items.map(it => {
    const title = decode(tag(it, 'title'));
    let url = decode(tag(it, 'link')) || attr(it, 'link', 'href') || decode(tag(it, 'guid'));
    const summary = decode(tag(it, 'description') || tag(it, 'summary') || tag(it, 'content') || tag(it, 'media:description'));
    const when = decode(tag(it, 'pubDate') || tag(it, 'published') || tag(it, 'updated') || tag(it, 'dc:date'));
    const published = when ? new Date(when) : null;
    return { title, url, summary: summary === title ? '' : summary, section: label || sectionFromArticleUrl(url), published: published && !isNaN(published) ? published.toISOString() : null };
  }).filter(s => s.title && /^https?:\/\//i.test(s.url));
}

async function get(url, timeoutMs = 12000) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, application/json;q=0.9, */*;q=0.5' }, signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

/** "Arts" from https://www.nytimes.com/2026/10/29/arts/television/..., "Politics" from .../politics/2026/10/29/... */
function sectionFromArticleUrl(u) {
  const m = /\/(\d{4})\/\d{2}\/\d{2}\/([a-z][a-z-]{2,20})\//.exec(u) || /\/([a-z][a-z-]{2,20})\/\d{4}\/\d{2}\/\d{2}\//.exec(u);
  const s = m && (m[2] || m[1]);
  if (!s || /^\d/.test(s) || /^(article|articles|news|story|stories|www|en)$/.test(s)) return '';
  if (s === 'us') return 'U.S.';
  return s.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function sectionFromUrl(u) {
  const m = /\/rss\/(?:nyt\/)?([A-Za-z]+)\.xml$|\/rss\/([a-z]+)$|\/([a-z]+)\?format=rss$|feeds\.bloomberg\.com\/([a-z]+)\//.exec(u);
  const s = m && (m[1] || m[2] || m[3] || m[4]);
  return s && !/HomePage|home|news|all|everything|custom/i.test(s) ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

async function fromFeeds(paper) {
  const results = await Promise.allSettled(paper.feeds.map(async u => parseFeed(await get(u), sectionFromUrl(u))));
  const out = [];
  for (const r of results) if (r.status === 'fulfilled') out.push(...r.value);
  return out;
}

/** New York Times Top Stories API: real abstracts. Only with NYT_API_KEY. */
async function fromNytApi() {
  const key = process.env.NYT_API_KEY;
  if (!key) return [];
  const sections = ['home', 'technology', 'science', 'arts', 'sports', 'food'];
  const results = await Promise.allSettled(sections.map(async s => {
    const txt = await get(`https://api.nytimes.com/svc/topstories/v2/${s}.json?api-key=${encodeURIComponent(key)}`);
    const data = JSON.parse(txt);
    return (data.results || []).map(r => ({
      title: r.title, url: r.url, summary: r.abstract || '', section: r.section ? r.section.charAt(0).toUpperCase() + r.section.slice(1) : '',
      published: r.published_date || null,
    })).filter(s => s.title && /^https?:\/\//.test(s.url || ''));
  }));
  const out = [];
  for (const r of results) if (r.status === 'fulfilled') out.push(...r.value);
  return out;
}

/** Google News search for the paper's own site. Headlines only; links redirect to the paper. */
async function fromGoogle(paper, days) {
  const q = encodeURIComponent(`${paper.google} when:${days}d`);
  const xml = await get(`https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`);
  return parseFeed(xml).map(s => ({
    ...s,
    title: s.title.replace(/\s+-\s+[^-]{2,40}$/, ''), // "Headline - WSJ" -> "Headline"
    summary: '', section: '', via: 'Google News',
  }));
}

const canonTitle = t => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function fresh(stories, maxAgeHours) {
  const cutoff = Date.now() - maxAgeHours * 3600_000;
  return stories.filter(s => !s.published || new Date(s.published).getTime() >= cutoff);
}

// Section fronts and index pages that feeds and Google News sometimes list as stories.
const junk = (s, paper) => {
  const t = canonTitle(s.title);
  return t.split(' ').length < 4 || t.includes(canonTitle(paper.name)) || /^(print edition|latest news|top stories|today s paper|home page)/.test(t);
};

function dedupe(stories) {
  const seen = new Set();
  const out = [];
  for (const s of stories) {
    const k = canonTitle(s.title);
    const u = s.url.replace(/[?#].*$/, '');
    if (!k || seen.has(k) || seen.has(u)) continue;
    seen.add(k); seen.add(u);
    out.push(s);
  }
  return out;
}

/**
 * Today's stories for one paper, freshest first, at most `limit`. Also says
 * where they came from, so the page can tell the player.
 */
export async function fetchStories(paperId, { limit = 45 } = {}) {
  const paper = paperById(paperId);
  if (!paper) throw new Error('unknown paper');
  let stories = [];
  let source = '';
  if (paper.api === 'nyt' && process.env.NYT_API_KEY) {
    stories = fresh(await fromNytApi(), paper.maxAgeHours);
    source = 'the New York Times Top Stories API';
  }
  if (stories.length < MIN_STORIES && paper.feeds.length) {
    const feed = fresh(await fromFeeds(paper), paper.maxAgeHours);
    if (feed.length) { stories = stories.concat(feed); source = source ? source + ' and its RSS feeds' : `${paper.name}'s RSS feeds`; }
  }
  if (stories.length < MIN_STORIES && paper.google) {
    try {
      const g = fresh(await fromGoogle(paper, Math.max(1, Math.round(paper.maxAgeHours / 24))), paper.maxAgeHours);
      if (g.length) { stories = stories.concat(g); source = source ? source + ' and Google News' : `Google News headlines from ${paper.name}`; }
    } catch (err) { console.error('google news failed', String(err).slice(0, 120)); }
  }
  stories = dedupe(stories.filter(s => !junk(s, paper))).sort((a, b) => (b.published ? new Date(b.published).getTime() : 0) - (a.published ? new Date(a.published).getTime() : 0));
  // Keep a mix: no named section takes more than a quarter of the list.
  const perSection = new Map();
  const mixed = [];
  for (const s of stories) {
    const n = perSection.get(s.section || '') || 0;
    if (s.section && n >= Math.max(8, Math.ceil(limit / 4))) continue;
    perSection.set(s.section || '', n + 1);
    mixed.push(s);
    if (mixed.length >= limit) break;
  }
  return { paper: { id: paper.id, name: paper.name, short: paper.short, home: paper.home }, stories: mixed, source };
}
