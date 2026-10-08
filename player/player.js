/*
  Connections player: the game, its four themes and their animations.

  One file, no libraries, no build step. Used by this repo's index.html and,
  through a synced copy, by the /connections/ page on ben.collier.phd.

    const game = ConnectionsPlayer.mount(element, {
      packs: window.CONNECTIONS_PACKS,  // from packs/packs.js
      pack: 'starwars', puzzle: 0,      // what to start with
      picker: true,                     // draw the theme picker inside the game
      useUrl: true,                     // read and write ?theme=&puzzle=
      shareUrl: 'https://...',          // the link in the copied result
      onChange(packId, index) {},       // after a new puzzle loads
    });
    game.setPack('lotr', 2);
    game.loadPuzzle(puzzleFromTheServer, { name: 'About you' });

  Accessibility: tiles are toggle buttons (aria-pressed) with arrow-key
  movement, results are announced through a live region, solved groups say
  their name and level in words, and prefers-reduced-motion turns every
  movement off (the game still plays the same).
*/
(function () {
  'use strict';

  const COLORS = ['Yellow', 'Green', 'Blue', 'Purple'];
  const EMOJI = { Yellow: '\u{1F7E8}', Green: '\u{1F7E9}', Blue: '\u{1F7E6}', Purple: '\u{1F7EA}' };
  const LEVEL = { Yellow: 'level 1 of 4, yellow', Green: 'level 2 of 4, green', Blue: 'level 3 of 4, blue', Purple: 'level 4 of 4, purple' };
  const MAX_MISTAKES = 4;
  const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

  // Theme copy: the end-of-game lines and the confetti each theme throws.
  const THEMES = {
    ben: {
      won: 'Solved. Nice work.', lost: 'Out of mistakes. Here is how it fit together.',
      confetti: ['#ffe56b', '#b9f0a0', '#bfe3ff', '#dcc6f5', '#ffc0d2', '#2447a6'], shape: 'paper',
    },
    starwars: {
      won: 'Solved. Punch it!', lost: 'Out of mistakes. The grid wins this round.',
      confetti: ['#ffe27a', '#ffffff', '#7fd3ff', '#ffb347'], shape: 'spark',
    },
    lotr: {
      won: 'There and back again: solved!', lost: 'The road was too long this time. Here are the groups.',
      confetti: ['#d4a017', '#f3d27a', '#8a9a3b', '#b5651d'], shape: 'leaf',
    },
    cmu: {
      won: 'My heart is in the work: solved!', lost: 'Out of mistakes. Back to the library.',
      confetti: ['#c41230', '#6d6e71', '#1b1b1b', '#e0b13a', '#ffffff', '#1f5f3a'], shape: 'square',
    },
  };

  const mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const reduced = () => Boolean(mq && mq.matches);
  const wait = ms => new Promise(r => setTimeout(r, reduced() ? 0 : ms));
  const canon = w => String(w).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const SVGNS = 'http://www.w3.org/2000/svg';

  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === false || v == null) continue;
      if (k === 'text') n.textContent = v;
      else if (k === 'html') n.innerHTML = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null) n.append(kid);
    return n;
  }
  function svg(markup, cls) {
    const wrap = document.createElement('span');
    wrap.innerHTML = markup.trim();
    const s = wrap.firstChild;
    if (cls) s.setAttribute('class', cls);
    s.setAttribute('aria-hidden', 'true');
    s.setAttribute('focusable', 'false');
    return s;
  }
  function shuffled(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function normalizePuzzle(p) {
    const cats = (p.categories || []).map((c, i) => ({
      label: String(c.label),
      words: c.words.map(w => String(w).toUpperCase()),
      explanation: c.explanation || '',
      color: COLORS.includes(c.color) ? c.color : COLORS[i % 4],
    }));
    cats.sort((a, b) => COLORS.indexOf(a.color) - COLORS.indexOf(b.color));
    return { ...p, categories: cats };
  }

  // ---------------------------------------------------------------------
  // Decorations drawn per theme. All original line art.
  // ---------------------------------------------------------------------

  // Angular rune-like marks: invented strokes, not any real alphabet.
  const RUNES = '<svg viewBox="0 0 120 16" width="120" height="16"><path pathLength="1" d="M2 14 L8 2 L14 14 M20 2 V14 M20 8 L27 2 M33 14 L39 2 L45 8 L39 14 M51 2 L57 14 M57 2 L51 14 M63 8 H75 M69 2 V14 M81 2 L87 8 L81 14 M93 14 V2 L99 8 L105 2 V14 M111 2 L117 14"/></svg>';

  // The map border: a route line around the edge plus corner doodles.
  // No viewBox: the rectangles are in pixels, so the drawing stroke keeps its length.
  const MAP_BORDER = `<svg class="cx-map">
    <rect class="cx-map-edge" x="1" y="1" width="99.6%" height="99.6%" rx="6" pathLength="1"/>
    <rect class="cx-map-route" x="9" y="9" width="97.4%" height="97.4%" rx="4"/>
  </svg>`;
  const COMPASS = '<svg viewBox="0 0 60 60" width="60" height="60"><circle cx="30" cy="30" r="17"/><circle cx="30" cy="30" r="12"/><path d="M30 4 L34 30 L30 56 L26 30 Z M4 30 L30 26 L56 30 L30 34 Z"/><path class="fill" d="M30 4 L34 30 L26 30 Z"/></svg>';
  const MOUNTAINS = '<svg viewBox="0 0 110 40" width="110" height="40"><path d="M2 38 L16 14 L24 26 L34 8 L48 38 M30 15 L34 8 L38 15 M44 38 L58 18 L66 30 L76 12 L92 38 M72 19 L76 12 L80 19 M90 38 L98 26 L108 38"/></svg>';
  const TREES = '<svg viewBox="0 0 80 40" width="80" height="40"><path d="M10 38 V30 M4 30 Q10 6 16 30 Z M28 38 V28 M21 28 Q28 2 35 28 Z M46 38 V31 M41 31 Q46 12 51 31 Z M64 38 V29 M58 29 Q64 8 70 29 Z"/></svg>';
  const RING = '<svg viewBox="0 0 120 120"><defs><radialGradient id="cxRingG" cx="50%" cy="40%" r="60%"><stop offset="0" stop-color="#fff6c8"/><stop offset=".55" stop-color="#e8b923"/><stop offset="1" stop-color="#a8740a"/></radialGradient></defs><circle cx="60" cy="60" r="44" fill="none" stroke="url(#cxRingG)" stroke-width="13"/><circle class="cx-ring-script" cx="60" cy="60" r="44" fill="none" stroke-width="2.2" stroke-dasharray="7 4 2 4 11 4" pathLength="200"/></svg>';
  const BAGPIPE = '<svg viewBox="0 0 120 100" width="120" height="100"><g class="cx-pipe-drones"><rect x="58" y="4" width="6" height="52" rx="2" transform="rotate(-18 61 56)"/><rect x="70" y="10" width="5" height="44" rx="2" transform="rotate(-6 72 54)"/><rect x="82" y="16" width="5" height="38" rx="2" transform="rotate(8 84 54)"/><rect x="54" y="0" width="14" height="6" rx="2" transform="rotate(-18 61 56)"/><rect x="66" y="6" width="13" height="6" rx="2" transform="rotate(-6 72 54)"/><rect x="78" y="12" width="13" height="6" rx="2" transform="rotate(8 84 54)"/></g><path class="cx-pipe-bag" d="M30 58 C26 38 54 34 74 46 C96 58 96 84 70 88 C46 92 33 78 30 58 Z"/><path class="cx-pipe-tartan" d="M38 50 L86 80 M48 44 L92 70 M34 66 L72 88 M44 86 L84 50 M36 74 L70 46"/><rect class="cx-pipe-chanter" x="30" y="70" width="7" height="30" rx="2" transform="rotate(28 33 70)"/><path class="cx-pipe-blow" d="M44 50 L22 28" stroke-width="4"/></svg>';
  const NOTE = '<svg viewBox="0 0 20 28" width="20" height="28"><path d="M14 2 V20 A5 4 0 1 1 11 16.4 V6 L14 2 Z"/></svg>';

  // ---------------------------------------------------------------------
  // Full-screen confetti, shared by every game on the page.
  // ---------------------------------------------------------------------
  let confettiCanvas = null;
  function confetti(theme, n = 160) {
    if (reduced()) return;
    if (!confettiCanvas) {
      confettiCanvas = el('canvas', { class: 'cx-confetti', 'aria-hidden': 'true' });
      document.body.appendChild(confettiCanvas);
    }
    const c = confettiCanvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = innerWidth * dpr; c.height = innerHeight * dpr;
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const t = THEMES[theme] || THEMES.ben;
    const parts = Array.from({ length: n }, (_, i) => ({
      x: innerWidth * (0.5 + (Math.random() - 0.5) * 0.3), y: innerHeight * 0.35,
      vx: (Math.random() - 0.5) * 16, vy: -6 - Math.random() * 11,
      r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.35,
      s: 5 + Math.random() * 7, color: t.confetti[i % t.confetti.length], life: 0,
    }));
    const start = performance.now();
    c.style.display = 'block';
    function frame(now) {
      const el2 = now - start;
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      for (const p of parts) {
        p.vy += 0.32; p.vx *= 0.985; p.x += p.vx; p.y += p.vy; p.r += p.vr;
        if (t.shape === 'leaf') { p.vx += Math.sin(el2 / 300 + p.s) * 0.15; p.vy = Math.min(p.vy, 3.2); }
        ctx.save();
        ctx.translate(p.x, p.y); ctx.rotate(p.r);
        ctx.globalAlpha = Math.max(0, 1 - el2 / 3600);
        ctx.fillStyle = p.color;
        if (t.shape === 'spark') {
          ctx.shadowColor = p.color; ctx.shadowBlur = 10;
          ctx.beginPath();
          for (let k = 0; k < 8; k++) {
            const rr = k % 2 ? p.s * 0.28 : p.s * 0.8;
            ctx.lineTo(Math.cos(k * Math.PI / 4) * rr, Math.sin(k * Math.PI / 4) * rr);
          }
          ctx.fill();
        } else if (t.shape === 'leaf') {
          ctx.beginPath(); ctx.ellipse(0, 0, p.s, p.s * 0.42, 0, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = 'rgba(60,40,10,.45)'; ctx.lineWidth = 0.8;
          ctx.beginPath(); ctx.moveTo(-p.s, 0); ctx.lineTo(p.s, 0); ctx.stroke();
        } else if (t.shape === 'square') {
          ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s);
          ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(-p.s / 2, -1, p.s, 2);
        } else {
          ctx.fillRect(-p.s / 2, -p.s * 0.3, p.s, p.s * 0.6);
        }
        ctx.restore();
      }
      if (el2 < 3800) requestAnimationFrame(frame);
      else { ctx.clearRect(0, 0, innerWidth, innerHeight); c.style.display = 'none'; }
    }
    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------------
  // Star Wars sky: a starfield that jumps to hyperspace when a group is solved.
  // ---------------------------------------------------------------------
  function Starfield(canvas) {
    const ctx = canvas.getContext('2d');
    let w = 0, h = 0, raf = 0, running = false, warp = 0, warpTarget = 0;
    const stars = Array.from({ length: 260 }, () => newStar(true));
    function newStar(anywhere) {
      return { x: (Math.random() - 0.5) * 2, y: (Math.random() - 0.5) * 2, z: anywhere ? Math.random() : 1, pz: 0 };
    }
    function size() {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = r.width; h = r.height;
      canvas.width = Math.max(1, w * dpr); canvas.height = Math.max(1, h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw(true);
    }
    function draw(still) {
      ctx.fillStyle = 'rgba(3,4,12,' + (warp > 0.05 && !still ? 0.35 : 1) + ')';
      ctx.fillRect(0, 0, w, h);
      const cx = w / 2, cy = h / 2, scale = Math.max(w, h) * 0.6;
      for (const s of stars) {
        s.pz = s.z;
        if (!still) {
          s.z -= 0.0016 + warp * 0.03;
          if (s.z <= 0.02) { Object.assign(s, newStar(false)); s.pz = s.z; continue; }
        }
        const x = cx + (s.x / s.z) * scale * 0.5, y = cy + (s.y / s.z) * scale * 0.5;
        if (x < 0 || x > w || y < 0 || y > h) { if (!still) Object.assign(s, newStar(false)); continue; }
        const bright = Math.min(1, (1 - s.z) * 1.4 + 0.15);
        if (warp > 0.05 && !still) {
          const tail = Math.min(0.9, warp * 0.55);
          const px = cx + (s.x / (s.z + tail * 0.3)) * scale * 0.5, py = cy + (s.y / (s.z + tail * 0.3)) * scale * 0.5;
          ctx.strokeStyle = `rgba(${200 + 55 * bright | 0},${225 + 30 * bright | 0},255,${bright})`;
          ctx.lineWidth = 0.6 + (1 - s.z) * 1.8;
          ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(x, y); ctx.stroke();
        } else {
          ctx.fillStyle = `rgba(255,255,255,${bright})`;
          const r = 0.4 + (1 - s.z) * 1.3;
          ctx.fillRect(x - r / 2, y - r / 2, r, r);
        }
      }
    }
    function tick() {
      warp += (warpTarget - warp) * 0.08;
      if (warpTarget > 0 && warp > warpTarget * 0.92) warpTarget = 0;
      draw(false);
      if (running) raf = requestAnimationFrame(tick);
    }
    const ro = window.ResizeObserver ? new ResizeObserver(size) : null;
    return {
      start() {
        if (ro) ro.observe(canvas); else size();
        size();
        if (reduced()) return;
        if (!running) { running = true; raf = requestAnimationFrame(tick); }
      },
      stop() { running = false; cancelAnimationFrame(raf); if (ro) ro.disconnect(); },
      jump(power = 1.6) { if (!reduced()) warpTarget = power; },
    };
  }

  // ---------------------------------------------------------------------
  // Carnegie Mellon sound: a synthesized drone and chanter tune. Silent
  // until the player turns sound on, which is also the click browsers need.
  // ---------------------------------------------------------------------
  let audio = null;
  function pipeTune(full) {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    } catch { return; }
    const a = audio, t0 = a.currentTime + 0.05;
    const master = a.createGain(); master.gain.value = 0.0001; master.connect(a.destination);
    const len = full ? 3.6 : 1.1;
    master.gain.exponentialRampToValueAtTime(0.09, t0 + 0.15);
    master.gain.setValueAtTime(0.09, t0 + len - 0.3);
    master.gain.exponentialRampToValueAtTime(0.0001, t0 + len);
    const lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200; lp.connect(master);
    for (const f of [110, 220]) {
      const o = a.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
      const g = a.createGain(); g.gain.value = 0.22; o.connect(g); g.connect(lp);
      o.start(t0); o.stop(t0 + len);
    }
    // A short original tune in A mixolydian, the bagpipe's home scale.
    const tune = full
      ? [[659, .25], [880, .25], [880, .38], [988, .12], [1109, .25], [988, .25], [880, .25], [740, .25], [784, .38], [880, .12], [988, .25], [880, .6]]
      : [[880, .2], [1109, .2], [1319, .5]];
    const ch = a.createOscillator(); ch.type = 'square';
    const cg = a.createGain(); cg.gain.value = 0.18; ch.connect(cg); cg.connect(lp);
    let t = t0 + 0.12;
    for (const [f, d] of tune) { ch.frequency.setValueAtTime(f, t); t += d; }
    ch.start(t0 + 0.1); ch.stop(Math.min(t, t0 + len));
  }

  // ---------------------------------------------------------------------
  // The game.
  // ---------------------------------------------------------------------
  function mount(root, opts = {}) {
    const packs = opts.packs || window.CONNECTIONS_PACKS || [];
    const S = {
      pack: null, index: 0, puzzle: null, order: [], selected: new Set(), solved: [],
      mistakes: 0, guesses: [], guessed: new Set(), over: false, won: false, busy: false, sound: false,
    };
    let crawlTimer = 0;

    // ----- DOM -----
    const sky = el('canvas', { class: 'cx-sky', 'aria-hidden': 'true' });
    const deco = el('div', { class: 'cx-deco', 'aria-hidden': 'true' });
    const picker = el('nav', { class: 'cx-picker', 'aria-label': 'Choose a theme' });
    const kicker = el('p', { class: 'cx-kicker' });
    const title = el('h2', { class: 'cx-title', tabindex: '-1' });
    const nums = el('div', { class: 'cx-nums', role: 'group', 'aria-label': 'Choose a puzzle' });
    const intro = el('p', { class: 'cx-intro' });
    const crawl = el('div', { class: 'cx-crawl', hidden: true });
    const solvedEl = el('div', { class: 'cx-solved' });
    const grid = el('div', { class: 'cx-grid', role: 'group', 'aria-label': 'Words. Pick four that share something.' });
    const dots = el('span', { class: 'cx-dots', 'aria-hidden': 'true' });
    const dotsText = el('span', { class: 'cx-sr' });
    const status = el('div', { class: 'cx-status' }, el('span', { class: 'cx-status-label', 'aria-hidden': 'true', text: 'Mistakes remaining:' }), dots, dotsText);
    const btnShuffle = el('button', { type: 'button', class: 'cx-btn', text: 'Shuffle', onclick: () => shuffle() });
    const btnClear = el('button', { type: 'button', class: 'cx-btn', text: 'Deselect all', onclick: () => clearSelection() });
    const btnSubmit = el('button', { type: 'button', class: 'cx-btn cx-primary', text: 'Submit', onclick: () => submit() });
    const btnSound = el('button', { type: 'button', class: 'cx-btn cx-sound', 'aria-pressed': 'false', text: 'Sound: off', onclick: toggleSound });
    const controls = el('div', { class: 'cx-controls' }, btnShuffle, btnClear, btnSubmit, btnSound);
    const toastEl = el('div', { class: 'cx-toast', role: 'status', 'aria-live': 'polite' });
    const live = el('div', { class: 'cx-sr', 'aria-live': 'assertive' });
    const fx = el('div', { class: 'cx-fx', 'aria-hidden': 'true' });
    const stage = el('div', { class: 'cx-stage' }, crawl, toastEl, solvedEl, grid, fx);
    const end = el('section', { class: 'cx-end', hidden: true, 'aria-label': 'Result' });
    const keys = el('p', { class: 'cx-keys', text: 'Keyboard: arrow keys move between words, Space or Enter picks one, Ctrl+Enter submits, Esc clears.' });
    const disclaimer = el('p', { class: 'cx-disclaimer' });
    const head = el('div', { class: 'cx-head' }, kicker, title, nums);
    const inner = el('div', { class: 'cx-inner' }, opts.picker === false ? null : picker, head, intro, stage, status, controls, end, keys, disclaimer, live);
    const cx = el('div', { class: 'cx', 'data-theme': 'ben' }, sky, deco, inner);
    root.innerHTML = '';
    root.appendChild(cx);
    const stars = Starfield(sky);

    grid.addEventListener('keydown', onGridKey);
    cx.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); submit(); }
      else if (e.key === 'Escape') { if (!crawl.hidden) endCrawl(); else clearSelection(); }
    });

    // ----- theme picker -----
    function renderPicker() {
      picker.innerHTML = '';
      for (const p of packs) {
        picker.appendChild(el('button', {
          type: 'button', class: 'cx-pick', 'data-pack': p.id, 'aria-pressed': String(S.pack && S.pack.id === p.id),
          text: p.name, onclick: () => setPack(p.id, 0, true),
        }));
      }
    }

    function applyTheme(theme) {
      const prev = cx.dataset.theme;
      cx.dataset.theme = theme;
      deco.innerHTML = '';
      if (theme === 'lotr') {
        deco.append(svg(MAP_BORDER), svg(COMPASS, 'cx-compass'), svg(MOUNTAINS, 'cx-mountains'), svg(TREES, 'cx-trees'));
      }
      if (theme === 'cmu') deco.append(svg(BAGPIPE, 'cx-piper'));
      if (theme === 'starwars') stars.start(); else if (prev === 'starwars') stars.stop();
      btnSound.hidden = theme !== 'cmu';
    }

    // ----- loading puzzles -----
    function setPack(id, index = 0, fromUser = false) {
      const pack = packs.find(p => p.id === id) || packs[0];
      if (!pack) return;
      S.pack = pack;
      S.index = Math.max(0, Math.min(index, pack.puzzles.length - 1));
      applyTheme(pack.theme);
      start(pack.puzzles[S.index]);
      if (opts.useUrl) writeUrl();
      if (fromUser) title.focus({ preventScroll: true });
      if (opts.onChange) opts.onChange(pack.id, S.index);
    }

    /** Play a puzzle that is not in a pack, such as one the live server just wrote. */
    function loadPuzzle(puzzle, meta = {}) {
      S.pack = {
        id: meta.id || 'live', name: meta.name || 'About you', theme: meta.theme || 'ben',
        disclaimer: meta.disclaimer || '', puzzles: [puzzle], live: true,
      };
      S.index = 0;
      applyTheme(S.pack.theme);
      start(puzzle);
      if (opts.onChange) opts.onChange(S.pack.id, 0);
    }

    function start(raw) {
      const p = normalizePuzzle(raw);
      S.puzzle = p;
      S.order = shuffled(p.categories.flatMap(c => c.words));
      S.selected = new Set(); S.solved = []; S.mistakes = 0; S.guesses = []; S.guessed = new Set();
      S.over = false; S.won = false; S.busy = false;
      renderPicker();
      kicker.textContent = S.pack.live ? S.pack.name : `${S.pack.name} · puzzle ${S.index + 1} of ${S.pack.puzzles.length}`;
      title.textContent = p.title || 'Connections';
      if (cx.dataset.theme === 'lotr') {
        title.prepend(svg(RUNES, 'cx-runes'));
        title.append(svg(RUNES, 'cx-runes cx-runes-r'));
      }
      nums.innerHTML = '';
      if (!S.pack.live && S.pack.puzzles.length > 1) {
        S.pack.puzzles.forEach((q, i) => nums.appendChild(el('button', {
          type: 'button', class: 'cx-num', 'aria-pressed': String(i === S.index), 'aria-label': `Puzzle ${i + 1}: ${q.title}`,
          text: String(i + 1), onclick: () => setPack(S.pack.id, i, true),
        })));
      }
      intro.textContent = p.intro || '';
      intro.hidden = !p.intro;
      disclaimer.textContent = S.pack.disclaimer || '';
      solvedEl.innerHTML = '';
      end.hidden = true; end.innerHTML = '';
      toastEl.textContent = ''; toastEl.className = 'cx-toast';
      renderGrid();
      renderStatus();
      renderControls();
      startCrawl(p);
    }

    // ----- Star Wars opening crawl -----
    function startCrawl(p) {
      clearTimeout(crawlTimer);
      crawl.innerHTML = '';
      crawl.hidden = true;
      cx.classList.remove('cx-crawling');
      if (cx.dataset.theme !== 'starwars' || !p.intro || opts.intro === false || reduced()) return;
      const text = el('div', { class: 'cx-crawl-text' },
        el('p', { class: 'cx-crawl-ep', text: `Puzzle ${ROMAN[S.index] || S.index + 1}` }),
        el('p', { class: 'cx-crawl-title', text: (p.title || '').toUpperCase() }),
        el('p', { text: p.intro }));
      crawl.append(
        el('p', { class: 'cx-crawl-pre', text: 'Not so long ago, in a browser near you....' }),
        el('div', { class: 'cx-crawl-view' }, text),
        el('button', { type: 'button', class: 'cx-btn cx-crawl-skip', text: 'Skip intro', onclick: () => endCrawl(true) }));
      crawl.hidden = false;
      cx.classList.add('cx-crawling');
      text.addEventListener('animationend', () => endCrawl());
      crawlTimer = setTimeout(endCrawl, 21000);
    }
    function endCrawl(focusGrid) {
      if (crawl.hidden) return;
      clearTimeout(crawlTimer);
      crawl.hidden = true;
      cx.classList.remove('cx-crawling');
      if (focusGrid) focusTile(0);
    }

    // ----- rendering -----
    function tileFor(word) { return grid.querySelector(`[data-word="${CSS.escape(word)}"]`); }

    function renderGrid() {
      grid.innerHTML = '';
      const solvedWords = new Set(S.solved.flatMap(c => c.words));
      S.order.filter(w => !solvedWords.has(w)).forEach((word, i) => {
        const longest = Math.max(...word.split(/[\s-]/).map(s => s.length), 4);
        const b = el('button', {
          type: 'button', class: 'cx-tile', 'data-word': word, 'aria-pressed': String(S.selected.has(word)),
          tabindex: i === 0 ? '0' : '-1', onclick: () => toggle(word),
        }, el('span', { text: word }));
        b.style.setProperty('--len', longest);
        b.style.setProperty('--tilt', ((i * 37) % 7 - 3) * 0.35 + 'deg');
        grid.appendChild(b);
      });
    }

    function band(cat, missed) {
      const b = el('div', { class: 'cx-band' + (missed ? ' cx-missed' : ''), 'data-color': cat.color, role: 'group', 'aria-label': `${cat.label}, ${LEVEL[cat.color]}${missed ? ', not found' : ''}` },
        el('span', { class: 'cx-band-level', 'aria-hidden': 'true', text: `${COLORS.indexOf(cat.color) + 1} · ${cat.color.toLowerCase()}` }),
        el('strong', { class: 'cx-band-label', text: cat.label }),
        el('span', { class: 'cx-band-words', text: cat.words.join(', ') }));
      return b;
    }

    function renderStatus() {
      dots.innerHTML = '';
      const left = MAX_MISTAKES - S.mistakes;
      for (let i = 0; i < MAX_MISTAKES; i++) dots.appendChild(el('i', { class: i < left ? 'on' : 'off' }));
      dotsText.textContent = `${left} of ${MAX_MISTAKES} mistakes remaining`;
    }

    function renderControls() {
      const n = S.selected.size;
      btnSubmit.disabled = n !== 4 || S.over || S.busy;
      btnClear.disabled = n === 0 || S.over || S.busy;
      btnShuffle.disabled = S.over || S.busy;
      btnSubmit.textContent = n === 4 || S.over ? 'Submit' : `Submit (${n}/4)`;
    }

    // ----- interaction -----
    function toggle(word) {
      if (S.over || S.busy) return;
      endCrawl();
      const t = tileFor(word);
      if (S.selected.has(word)) S.selected.delete(word);
      else if (S.selected.size < 4) S.selected.add(word);
      else { if (t) bump(t); toast('Four at most. Deselect one first.'); return; }
      if (t) {
        t.setAttribute('aria-pressed', String(S.selected.has(word)));
        bump(t);
      }
      renderControls();
    }
    function bump(t) {
      if (reduced()) return;
      t.animate([{ transform: 'scale(1)' }, { transform: 'scale(.9)' }, { transform: 'scale(1.06)' }, { transform: 'scale(1)' }],
        { duration: 260, easing: 'ease-out' });
    }

    function clearSelection() {
      if (S.busy || S.over) return;
      S.selected.clear();
      for (const t of grid.children) t.setAttribute('aria-pressed', 'false');
      renderControls();
    }

    function onGridKey(e) {
      const tiles = [...grid.querySelectorAll('.cx-tile')];
      const i = tiles.indexOf(document.activeElement);
      if (i < 0) return;
      const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 4, ArrowUp: -4, Home: -i, End: tiles.length - 1 - i }[e.key];
      if (step === undefined) return;
      e.preventDefault();
      focusTile(Math.max(0, Math.min(tiles.length - 1, i + step)));
    }
    function focusTile(i) {
      const tiles = [...grid.querySelectorAll('.cx-tile')];
      tiles.forEach((t, k) => t.setAttribute('tabindex', k === i ? '0' : '-1'));
      if (tiles[i]) tiles[i].focus();
    }

    // FLIP: move tiles in the DOM, then animate each from where it was.
    function flip(mutate, duration = 380) {
      const tiles = [...grid.children];
      const before = new Map(tiles.map(t => [t, t.getBoundingClientRect()]));
      mutate();
      if (reduced()) return Promise.resolve();
      const runs = [];
      for (const t of tiles) {
        if (!t.isConnected) continue;
        const a = before.get(t), b = t.getBoundingClientRect();
        const dx = a.left - b.left, dy = a.top - b.top;
        if (!dx && !dy) continue;
        runs.push(t.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
          { duration, easing: 'cubic-bezier(.2,.8,.2,1)' }).finished.catch(() => {}));
      }
      return Promise.all(runs);
    }
    function reorderDom() {
      const byWord = new Map([...grid.children].map(t => [t.dataset.word, t]));
      for (const w of S.order) { const t = byWord.get(w); if (t) grid.appendChild(t); }
      const tiles = [...grid.children];
      tiles.forEach((t, k) => t.setAttribute('tabindex', k === 0 ? '0' : '-1'));
    }

    async function shuffle() {
      if (S.over || S.busy) return;
      const solvedWords = new Set(S.solved.flatMap(c => c.words));
      const open = S.order.filter(w => !solvedWords.has(w));
      S.order = [...S.order.filter(w => solvedWords.has(w)), ...shuffled(open)];
      cx.classList.add('cx-shuffling');
      await flip(reorderDom, 460);
      cx.classList.remove('cx-shuffling');
      announce('Shuffled.');
    }

    async function hop(words) {
      if (reduced()) return;
      const runs = words.map((w, i) => {
        const t = tileFor(w);
        return t ? t.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(-10px)' }, { transform: 'translateY(0)' }],
          { duration: 240, delay: i * 85, easing: 'ease-in-out' }).finished.catch(() => {}) : null;
      });
      await Promise.all(runs);
    }
    async function shake(words) {
      const tiles = words.map(tileFor).filter(Boolean);
      tiles.forEach(t => t.classList.add('cx-wrong'));
      if (!reduced()) {
        await Promise.all(tiles.map(t => t.animate(
          [0, -7, 7, -6, 6, -3, 3, 0].map(x => ({ transform: `translateX(${x}px)` })),
          { duration: 480, easing: 'ease-in-out' }).finished.catch(() => {})));
      } else await new Promise(r => setTimeout(r, 450));
      tiles.forEach(t => t.classList.remove('cx-wrong'));
    }

    function catOf(word) { return S.puzzle.categories.find(c => c.words.includes(word)); }

    async function submit() {
      if (S.busy || S.over || S.selected.size !== 4) return;
      endCrawl();
      const picked = S.order.filter(w => S.selected.has(w));
      const key = picked.map(canon).sort().join('|');
      if (S.guessed.has(key)) { toast('Already guessed!'); return; }
      S.guessed.add(key);
      S.busy = true; renderControls();
      S.guesses.push(picked.map(w => catOf(w).color));
      await hop(picked);
      const counts = new Map();
      for (const w of picked) counts.set(catOf(w), (counts.get(catOf(w)) || 0) + 1);
      const [best, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      if (n === 4) {
        await solve(best, false);
        announce(`Correct. ${best.label}: ${best.words.join(', ')}. ${4 - S.solved.length} groups to go.`);
        if (S.solved.length === 4) { S.busy = false; return finish(true); }
      } else {
        S.mistakes += 1;
        renderStatus();
        popDot();
        const left = MAX_MISTAKES - S.mistakes;
        const msg = n === 3 ? 'One away...' : 'Not quite.';
        toast(msg, n === 3 ? 'away' : 'miss');
        await shake(picked);
        announce(`${msg} ${left} ${left === 1 ? 'mistake' : 'mistakes'} remaining.`);
        if (S.mistakes >= MAX_MISTAKES) { S.busy = false; return finish(false); }
      }
      S.busy = false; renderControls();
    }

    function popDot() {
      const off = dots.querySelectorAll('.off');
      const d = off[0];
      if (d && !reduced()) d.animate([{ transform: 'scale(1.6)', opacity: 1 }, { transform: 'scale(1)' }], { duration: 380, easing: 'ease-out' });
    }

    async function solve(cat, missed) {
      const solvedWords = new Set(S.solved.flatMap(c => c.words));
      const open = S.order.filter(w => !solvedWords.has(w));
      const front = open.filter(w => cat.words.includes(w));
      const rest = open.filter(w => !cat.words.includes(w));
      S.order = [...S.order.filter(w => solvedWords.has(w)), ...front, ...rest];
      for (const w of front) {
        const t = tileFor(w);
        if (t) { t.classList.add('cx-flying'); t.dataset.color = cat.color; t.setAttribute('aria-pressed', 'false'); }
      }
      await flip(reorderDom, 420);
      await wait(120);
      for (const w of front) { const t = tileFor(w); if (t) t.remove(); }
      for (const w of cat.words) S.selected.delete(w);
      S.solved.push(cat);
      const b = band(cat, missed);
      solvedEl.appendChild(b);
      if (!reduced()) b.classList.add('cx-band-in');
      themeSolve(b, cat, missed);
      const first = grid.querySelector('.cx-tile');
      if (first) first.setAttribute('tabindex', '0');
      await wait(missed ? 380 : 260);
    }

    // ----- per-theme celebration of one group -----
    function themeSolve(bandEl, cat, missed) {
      if (missed) return;
      const theme = cx.dataset.theme;
      if (theme === 'starwars') stars.jump(S.solved.length === 4 ? 3 : 1.6);
      if (theme === 'lotr') {
        bandEl.classList.add('cx-glow');
        if (!reduced()) {
          const r = svg(RING, 'cx-ring');
          r.style.top = bandEl.offsetTop + bandEl.offsetHeight / 2 + 'px';
          fx.appendChild(r);
          setTimeout(() => r.remove(), 1600);
        }
      }
      if (theme === 'cmu') {
        if (S.sound) pipeTune(S.solved.length === 4);
        if (!reduced()) {
          for (let i = 0; i < 3; i++) {
            const n = svg(NOTE, 'cx-note');
            n.style.left = 70 + i * 9 + '%';
            n.style.top = bandEl.offsetTop + 'px';
            n.style.animationDelay = i * 140 + 'ms';
            fx.appendChild(n);
            setTimeout(() => n.remove(), 1700);
          }
        }
      }
    }

    async function finish(won) {
      S.over = true; S.won = won;
      S.selected.clear();
      renderControls();
      if (!won) {
        for (const t of grid.children) t.setAttribute('aria-pressed', 'false');
        const left = S.puzzle.categories.filter(c => !S.solved.includes(c));
        for (const c of left) await solve(c, true);
      }
      const theme = cx.dataset.theme;
      if (won) {
        confetti(theme);
        cx.classList.add('cx-won');
        if (theme === 'cmu' && !reduced()) {
          const p = deco.querySelector('.cx-piper');
          if (p) { p.classList.remove('cx-march'); void p.getBoundingClientRect(); p.classList.add('cx-march'); }
        }
        if (theme === 'lotr' && !reduced()) {
          const r = svg(RING, 'cx-ring cx-ring-big');
          fx.appendChild(r);
          setTimeout(() => r.remove(), 2600);
        }
        setTimeout(() => cx.classList.remove('cx-won'), 2600);
      }
      await wait(won ? 700 : 300);
      showEnd(won);
    }

    function shareText() {
      const rows = S.guesses.map(g => g.map(c => EMOJI[c]).join('')).join('\n');
      const where = opts.shareUrl || (location.protocol.startsWith('http') ? location.href : '');
      return `Connections · ${S.pack.name}\n"${S.puzzle.title || 'Puzzle'}"\n${rows}${where ? '\n' + where : ''}`;
    }

    function showEnd(won) {
      const T = THEMES[cx.dataset.theme] || THEMES.ben;
      end.innerHTML = '';
      const h = el('h3', { class: 'cx-end-title', tabindex: '-1', text: won ? T.won : T.lost });
      const summary = won
        ? `${S.guesses.length} guesses, ${S.mistakes} ${S.mistakes === 1 ? 'mistake' : 'mistakes'}.`
        : `${S.solved.filter(c => !c.missed).length} groups found before the mistakes ran out.`;
      const gridText = S.guesses.map(g => g.map(c => EMOJI[c]).join('')).join('\n');
      const copy = el('button', { type: 'button', class: 'cx-btn cx-primary', text: 'Copy result', onclick: async () => {
        const ok = await copyText(shareText());
        toast(ok ? 'Copied. Paste it anywhere.' : 'Could not copy. Select the squares above instead.');
      } });
      const buttons = el('div', { class: 'cx-end-buttons' }, copy,
        el('button', { type: 'button', class: 'cx-btn', text: 'Play again', onclick: () => { start(S.pack.puzzles[S.index]); title.focus({ preventScroll: true }); } }));
      if (!S.pack.live && S.pack.puzzles.length > 1) {
        buttons.appendChild(el('button', { type: 'button', class: 'cx-btn', text: 'Next puzzle', onclick: () => setPack(S.pack.id, (S.index + 1) % S.pack.puzzles.length, true) }));
      }
      const why = el('ol', { class: 'cx-why' }, S.puzzle.categories.map(c => el('li', { 'data-color': c.color },
        el('strong', { text: c.label }), ' ', el('span', { class: 'cx-why-words', text: `(${c.words.join(', ')})` }),
        c.explanation ? el('span', { class: 'cx-why-text', text: ' ' + c.explanation }) : null)));
      end.append(
        h,
        el('p', { class: 'cx-end-sum', text: summary }),
        el('pre', { class: 'cx-share', 'aria-label': `Your guesses as colored squares: ${summary}` , text: gridText }),
        buttons,
        el('h4', { text: 'Why these groups' }),
        why,
        S.puzzle.explanation ? el('p', { class: 'cx-end-note', text: S.puzzle.explanation }) : null);
      const recs = (S.puzzle.recommendations || []).filter(r => r && /^https?:\/\//i.test(r.url || ''));
      if (recs.length) {
        end.append(el('h4', { text: 'What the AI read' }),
          el('ul', { class: 'cx-recs' }, recs.map(r => el('li', {}, el('a', { href: r.url, target: '_blank', rel: 'noopener noreferrer', text: r.title || r.url })))));
      }
      end.hidden = false;
      if (!reduced()) end.classList.add('cx-end-in');
      announce(`${h.textContent} ${summary}`);
      h.focus({ preventScroll: true });
      end.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' });
      if (opts.onEnd) opts.onEnd(won);
    }

    async function copyText(text) {
      try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
      try {
        const ta = el('textarea', { class: 'cx-sr' });
        ta.value = text; document.body.appendChild(ta); ta.select();
        const ok = document.execCommand('copy'); ta.remove(); return ok;
      } catch { return false; }
    }

    let toastTimer = 0;
    function toast(text, kind) {
      toastEl.textContent = text;
      toastEl.className = 'cx-toast cx-toast-on' + (kind ? ' cx-toast-' + kind : '');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { toastEl.className = 'cx-toast'; }, 1900);
    }
    function announce(text) { live.textContent = ''; setTimeout(() => { live.textContent = text; }, 30); }

    function toggleSound() {
      S.sound = !S.sound;
      btnSound.setAttribute('aria-pressed', String(S.sound));
      btnSound.textContent = S.sound ? 'Sound: on' : 'Sound: off';
      if (S.sound) pipeTune(false);
    }

    // ----- URL -----
    function readUrl() {
      const q = new URLSearchParams(location.search);
      const pack = q.get('theme');
      const n = parseInt(q.get('puzzle') || '1', 10);
      return pack && packs.some(p => p.id === pack) ? [pack, Number.isFinite(n) ? n - 1 : 0] : null;
    }
    function writeUrl() {
      if (!history.replaceState || S.pack.live) return;
      const u = new URL(location.href);
      u.searchParams.set('theme', S.pack.id);
      u.searchParams.set('puzzle', String(S.index + 1));
      history.replaceState(null, '', u);
    }

    const fromUrl = opts.useUrl ? readUrl() : null;
    if (fromUrl) setPack(fromUrl[0], fromUrl[1]);
    else setPack(opts.pack || (packs[0] && packs[0].id), opts.puzzle || 0);

    return {
      setPack, loadPuzzle,
      get state() { return { pack: S.pack && S.pack.id, index: S.index, over: S.over, won: S.won, mistakes: S.mistakes, solved: S.solved.length }; },
      destroy() { stars.stop(); clearTimeout(crawlTimer); root.innerHTML = ''; },
    };
  }

  window.ConnectionsPlayer = { mount, version: '2.0.0' };
})();
