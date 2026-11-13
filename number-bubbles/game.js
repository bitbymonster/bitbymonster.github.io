// Number Bubbles — a number-bonds game for small children.
// Drag bubbles together to add them, tap a bubble to split it, make the number the creature asks for.
// Fully self-contained: no network, no tracking, no external assets.
(() => {
'use strict';

const params = new URLSearchParams(location.search);
// Target range, e.g. ?min=2&max=10 for a little one, or ?min=50&max=200 for more of a challenge.
const intParam = (k, lo, hi) => { const n = parseInt(params.get(k), 10); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : null; };
let MAX_TARGET = intParam('max', 2, 999) ?? 100;
let MIN_TARGET = intParam('min', 2, 999) ?? (MAX_TARGET >= 15 ? 15 : 2);
if (MIN_TARGET > MAX_TARGET) [MIN_TARGET, MAX_TARGET] = [MAX_TARGET, MIN_TARGET];

// ---------- canvas / layout ----------
const cv = document.getElementById('c');
const ctx = cv.getContext('2d');
let W = 0, H = 0, u = 0, dpr = 1;
let cr = 0, cx = 0, cy = 0;          // creature radius + centre
let sx = 0, sy = 0, sr = 0;          // speech bubble centre + radius

function layout() {
  cr = u * 0.13;
  cx = W - cr * 1.4;  cy = H - cr * 1.2;
  sr = cr * 0.85;
  sx = cx - cr * 0.5; sy = cy - cr * 2.7;
}
function resize() {
  const oW = W, oH = H;
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth; H = window.innerHeight;
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  u = Math.min(W, H);
  layout();
  if (oW) for (const b of bubbles) { b.x *= W / oW; b.y *= H / oH; }
}
const obstacles = () => [{ x: cx, y: cy, r: cr * 1.1 }, { x: sx, y: sy, r: sr * 1.1 }];

// ---------- values: size and colour ----------
// Bubble size grows with value, scaled to this round's target so big numbers still fit on screen
// and the smallest bubbles stay easy to tap.
const rad = v => u * (0.04 + 0.11 * Math.sqrt(v / Math.max(target, 5)));

// Each digit has its own colour, so a bubble's colours show its place value:
//   ones digit  -> centre, full colour       (1 red, 2 orange, 3 yellow, 4 green, 5 cyan,
//   tens digit  -> outer ring, light colour    6 indigo, 7 rainbow, 8 pink, 9 grey)
//   hundreds    -> stippled outermost area     (10 is white; 100 is stippled red + light red)
// A zero digit has no layer, so 20 is all light orange and 7 is all rainbow.
const BASE = { 1: '#ff3b3b', 2: '#ff8a1f', 3: '#ffd21f', 4: '#3dbb4a', 5: '#18c8de', 6: '#4a3fc4', 8: '#ff6fb5', 9: '#8a909c' };
function mix(hex, k) {                       // blend towards white
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${[n >> 16 & 255, n >> 8 & 255, n & 255].map(x => Math.round(x + (255 - x) * k))})`;
}
const rainbow = (i, light) => `hsl(${i * 30} 90% ${light ? 80 : 55}%)`;
function layersOf(v) {                       // outermost first
  const h = Math.floor(v / 100) % 10, t = Math.floor(v / 10) % 10, o = v % 10, L = [];
  if (h) L.push({ k: 'stipple', bg: h === 7 ? '#f3f3f3' : mix(BASE[h], 0.6), dot: h === 7 ? null : BASE[h] });
  if (t) L.push(t === 1 ? { k: 'solid', c: '#ffffff' } : t === 7 ? { k: 'rainbow', light: true } : { k: 'solid', c: mix(BASE[t], 0.55) });
  if (o) L.push(o === 7 ? { k: 'rainbow', light: false } : { k: 'solid', c: BASE[o] });
  return L;
}
const LAYER_R = [[], [1], [1, 0.68], [1, 0.84, 0.66]];
const sparkCols = v => layersOf(v).flatMap(l => l.k === 'solid' ? [l.c] : l.k === 'stipple' ? [l.dot || RAINBOW[0]] : RAINBOW.slice(0, 4));

// ---------- audio (synthesised, so nothing to download) ----------
let ac = null;
function audio() {
  try {
    if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
    if (ac.state === 'suspended') ac.resume();
  } catch (e) { ac = null; }
  return ac;
}
const PENT = [0, 2, 4, 7, 9];
function note(v) { const i = v - 1; return 261.63 * Math.pow(2, (PENT[i % 5] + 12 * (Math.floor(i / 5) % 3)) / 12); }
function tone(f, when, dur, type, vol, slide) {
  const a = audio(); if (!a) return;
  const t = a.currentTime + when;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type || 'sine';
  o.frequency.setValueAtTime(f, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(f * slide, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol || 0.15, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(a.destination);
  o.start(t); o.stop(t + dur + 0.05);
}
const sPick  = () => tone(700, 0, 0.06, 'sine', 0.07);
const sMerge = v => { tone(note(v), 0, 0.28, 'triangle', 0.2); tone(note(v) * 2, 0.06, 0.22, 'sine', 0.1); };
const sSplit = (a, b) => { tone(note(a), 0, 0.14, 'sine', 0.18, 1.25); tone(note(b), 0.09, 0.14, 'sine', 0.18, 1.25); };
const sNope  = () => tone(220, 0, 0.18, 'triangle', 0.14, 0.6);
function sWin() {
  [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => tone(f, i * 0.1, 0.35, 'triangle', 0.2));
  for (let i = 0; i < 8; i++) tone(1500 + Math.random() * 1800, 0.5 + i * 0.07, 0.12, 'sine', 0.05);
}

// ---------- speech ----------
function say(text) {
  try {
    if (!('speechSynthesis' in window)) return;
    const ss = window.speechSynthesis;
    ss.cancel();
    const ut = new SpeechSynthesisUtterance(text);
    const lang = (navigator.language || 'en-GB');
    const voices = ss.getVoices();
    const v = voices.find(x => x.lang === lang) || voices.find(x => x.lang.startsWith('en'));
    if (v) { ut.voice = v; ut.lang = v.lang; } else ut.lang = 'en-GB';
    ut.rate = 0.9; ut.pitch = 1.4;
    ss.speak(ut);
  } catch (e) { /* speech is a bonus, never fatal */ }
}
const CHEERS = ['Well done!', 'Brilliant!', 'You did it!', 'Amazing!', 'Hooray!', 'Super!', 'Fantastic!'];
const askTarget = () => say(`Can you make ${target}?`);

// ---------- game state ----------
let bubbles = [], particles = [];
let target = 0, round = 0, state = 'menu', wonT = 0, winner = null, idle = 0, lastTarget = 0;
let nextId = 1, sbS = 1, sbV = 0;           // speech-bubble pop spring
let look = { x: 0, y: 0 }, creatureJump = 0;
const drags = new Map();

function makeBubble(v, x, y, extra) {
  return Object.assign({ id: nextId++, v, x, y, vx: 0, vy: 0, s: 0.01, sv: 0, ts: 1, a: 1,
    delay: 0, ph: Math.random() * 6.28, wig: 0, fly: false, drag: false, rot: 0 }, extra);
}

function genValues(T) {
  const maxV = Math.max(1, T - 1), vals = []; let sum = 0;
  while (vals.length < 4 || sum <= T) { const v = 1 + Math.floor(Math.random() * maxV); vals.push(v); sum += v; }
  return vals.sort((a, b) => b - a);   // total > T, and none equals T
}

function placeAll(vals) {
  const pad = u * 0.02, placed = [], obs = obstacles();
  for (const v of vals) {
    const r = rad(v); let pos = null;
    for (let k = 0; k < 500 && !pos; k++) {
      const x = r + pad + Math.random() * (W - 2 * r - 2 * pad), y = r + pad + Math.random() * (H - 2 * r - 2 * pad);
      if (obs.some(o => Math.hypot(x - o.x, y - o.y) < r + o.r + pad)) continue;
      if (placed.some(p => Math.hypot(x - p.x, y - p.y) < r + rad(p.v) + pad)) continue;
      pos = { x, y };
    }
    if (!pos) pos = { x: r + Math.random() * (W - 2 * r), y: r + Math.random() * (H - 2 * r) }; // separation will sort it
    placed.push({ v, x: pos.x, y: pos.y });
  }
  return placed;
}

function newRound() {
  round++;
  do { target = MIN_TARGET + Math.floor(Math.random() * (MAX_TARGET - MIN_TARGET + 1)); }
  while (target === lastTarget && MAX_TARGET > MIN_TARGET);
  lastTarget = target;
  bubbles = [];
  placeAll(genValues(target)).forEach((p, i) => bubbles.push(makeBubble(p.v, p.x, p.y, { delay: 0.1 + i * 0.09 })));
  sbS = 0.01; sbV = 0; winner = null; idle = 0; state = 'play';
  setTimeout(askTarget, 500);
}

// ---------- effects ----------
function burst(x, y, n, cols, speed) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * 6.283, sp = (0.3 + Math.random()) * speed;
    particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - speed * 0.3, life: 0, max: 0.8 + Math.random() * 0.9,
      col: cols[(Math.random() * cols.length) | 0], size: u * (0.008 + Math.random() * 0.014),
      star: Math.random() < 0.4, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 10 });
  }
}
const RAINBOW = ['#ff6b6b', '#ff9f43', '#feca57', '#8bd450', '#48dbfb', '#a06cff', '#ff78c4'];

// ---------- game actions ----------
function mergeCandidate(b) {
  let best = null, bd = 1e9;
  for (const o of bubbles) {
    if (o === b || o.fly || o.delay > 0) continue;
    const d = Math.hypot(o.x - b.x, o.y - b.y);
    if (d < (rad(o.v) * o.s + rad(b.v) * b.s) * 0.65 && d < bd) { best = o; bd = d; }
  }
  return best;
}
function merge(a, t) {                     // a is dragged onto t
  t.v += a.v; t.s = 0.7; t.sv = 5; // pop
  bubbles.splice(bubbles.indexOf(a), 1);
  burst(t.x, t.y, 12, sparkCols(t.v).concat('#fff'), u * 0.5);
  sMerge(t.v);
  checkWin(t);
}
function split(b) {
  if (b.v <= 1) { b.wig = 0.5; sNope(); return; }
  const a = Math.floor(b.v / 2), c = b.v - a, ang = (Math.random() - 0.5) * 1.2;
  const nb = makeBubble(c, b.x, b.y, { s: 0.6, sv: 4 });
  b.v = a; b.s = 0.6; b.sv = 4;
  b.vx = -Math.cos(ang) * u * 0.5; b.vy = -Math.sin(ang) * u * 0.5;
  nb.vx = Math.cos(ang) * u * 0.5;  nb.vy = Math.sin(ang) * u * 0.5;
  bubbles.push(nb);
  burst(b.x, b.y, 8, sparkCols(a).concat(sparkCols(c), '#fff'), u * 0.4);
  sSplit(a, c);
  checkWin(b) || checkWin(nb);
}
function checkWin(b) {
  if (state !== 'play' || b.v !== target) return false;
  state = 'won'; wonT = 0; winner = b;
  for (const [, d] of drags) { const db = bubbles.find(x => x.id === d.id); if (db) db.drag = false; }
  drags.clear();
  for (const o of bubbles) if (o !== b) {
    o.fly = true; o.drag = false; o.vx = (Math.random() - 0.5) * u * 0.6; o.vy = -(0.4 + Math.random() * 0.5) * u;
    o.rot = (Math.random() - 0.5) * 0.4;
  }
  b.drag = false; b.ts = 1.5; b.vx = b.vy = 0;
  burst(b.x, b.y, 70, RAINBOW, u * 0.9);
  sWin();
  setTimeout(() => say(`${CHEERS[(Math.random() * CHEERS.length) | 0]} That's ${target}!`), 450);
  return true;
}

// ---------- input ----------
function topBubbleAt(x, y) {
  for (let i = bubbles.length - 1; i >= 0; i--) {
    const b = bubbles[i];
    if (b.fly || b.delay > 0 || b.drag) continue;
    if (Math.hypot(x - b.x, y - b.y) <= rad(b.v) * b.s + 6) return b;
  }
  return null;
}
cv.addEventListener('pointerdown', e => {
  e.preventDefault();
  audio();
  look = { x: e.clientX, y: e.clientY };
  if (state !== 'play') return;
  idle = 0;
  const b = topBubbleAt(e.clientX, e.clientY);
  if (!b) {
    if (Math.hypot(e.clientX - cx, e.clientY - cy) < cr * 1.2 || Math.hypot(e.clientX - sx, e.clientY - sy) < sr * 1.1) { askTarget(); sbS = 0.8; sbV = 3; }
    return;
  }
  cv.setPointerCapture(e.pointerId);
  bubbles.splice(bubbles.indexOf(b), 1); bubbles.push(b);        // bring to front
  b.drag = true; b.vx = b.vy = 0;
  drags.set(e.pointerId, { id: b.id, ox: b.x - e.clientX, oy: b.y - e.clientY, sx: e.clientX, sy: e.clientY, t0: performance.now(), moved: false, cand: null });
  sPick();
});
cv.addEventListener('pointermove', e => {
  look = { x: e.clientX, y: e.clientY };
  const d = drags.get(e.pointerId); if (!d) return;
  const b = bubbles.find(x => x.id === d.id); if (!b) return;
  if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > Math.max(12, u * 0.015)) d.moved = true;
  if (d.moved) { b.x = e.clientX + d.ox; b.y = e.clientY + d.oy; }
});
function endDrag(e, cancelled) {
  const d = drags.get(e.pointerId); if (!d) return;
  drags.delete(e.pointerId);
  const b = bubbles.find(x => x.id === d.id); if (!b) return;
  b.drag = false;
  if (cancelled) return;
  if (!d.moved && performance.now() - d.t0 < 600) { split(b); return; }
  const t = mergeCandidate(b);
  if (t) merge(b, t);
}
cv.addEventListener('pointerup', e => endDrag(e, false));
cv.addEventListener('pointercancel', e => endDrag(e, true));
cv.addEventListener('contextmenu', e => e.preventDefault());

// ---------- update ----------
function update(dt) {
  const obs = obstacles();
  for (let i = bubbles.length - 1; i >= 0; i--) {
    const b = bubbles[i];
    if (b.delay > 0) { b.delay -= dt; continue; }
    b.sv += (b.ts - b.s) * 140 * dt; b.sv *= Math.exp(-9 * dt); b.s += b.sv * dt;
    if (b.wig > 0) b.wig -= dt;
    if (b.fly) {
      b.vy -= u * 0.6 * dt; b.x += (b.vx + Math.sin(wonT * 5 + b.ph) * u * 0.05) * dt; b.y += b.vy * dt;
      if (b.y < -u * 0.4) bubbles.splice(i, 1);
      continue;
    }
    if (b === winner) {
      b.x += (W * 0.4 - b.x) * Math.min(1, 4 * dt); b.y += (H * 0.45 - b.y) * Math.min(1, 4 * dt);
      continue;
    }
    if (!b.drag) {
      b.x += b.vx * dt; b.y += b.vy * dt;
      const k = Math.exp(-5 * dt); b.vx *= k; b.vy *= k;
    }
  }
  if (state === 'play') {
    for (let it = 0; it < 3; it++) {
      for (let i = 0; i < bubbles.length; i++) for (let j = i + 1; j < bubbles.length; j++) {
        const a = bubbles[i], b = bubbles[j];
        if (a.drag || b.drag || a.delay > 0 || b.delay > 0) continue;
        const ra = rad(a.v) * a.s, rb = rad(b.v) * b.s;
        let dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 0.01;
        const over = ra + rb - d;
        if (over > 0) { dx /= d; dy /= d; const p = over * 0.5 * 0.5; a.x -= dx * p; a.y -= dy * p; b.x += dx * p; b.y += dy * p; }
      }
    }
    for (const b of bubbles) {
      if (b.fly || b.delay > 0) continue;
      const r = rad(b.v) * b.s;
      for (const o of obs) {                       // keep clear of the creature and its speech bubble
        const dx = b.x - o.x, dy = b.y - o.y, d = Math.hypot(dx, dy) || 0.01, min = r + o.r;
        if (d < min) { b.x = o.x + dx / d * min; b.y = o.y + dy / d * min; }
      }
      b.x = Math.max(r, Math.min(W - r, b.x)); b.y = Math.max(r, Math.min(H - r, b.y));
    }
    for (const [, d] of drags) { const b = bubbles.find(x => x.id === d.id); d.cand = b ? mergeCandidate(b) : null; }
    idle += dt;
    if (idle > 22) { idle = 0; askTarget(); sbS = 0.8; sbV = 3; }
  }
  if (state === 'won') {
    wonT += dt;
    if (winner && wonT < 2.2 && Math.random() < dt * 25) burst(winner.x, winner.y, 3, RAINBOW, u * 0.5);
    if (wonT > 4.4) newRound();
  }
  sbV += (1 - sbS) * 140 * dt; sbV *= Math.exp(-9 * dt); sbS += sbV * dt;
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i]; p.life += dt;
    if (p.life > p.max) { particles.splice(i, 1); continue; }
    p.vy += u * 1.1 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
  }
}

// ---------- drawing ----------
function starPath(x, y, r, rot) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = rot + i * Math.PI / 5 - Math.PI / 2, rr = i % 2 ? r * 0.45 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
}
function drawNumber(v, x, y, r) {
  const digits = String(v).length;
  ctx.font = `800 ${r * (digits > 2 ? 0.7 : digits > 1 ? 0.95 : 1.15)}px "Arial Rounded MT Bold","Trebuchet MS",system-ui,sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round'; ctx.lineWidth = r * 0.16;
  ctx.strokeStyle = '#2a2150'; ctx.strokeText(v, x, y + r * 0.05);
  ctx.fillStyle = '#fff'; ctx.fillText(v, x, y + r * 0.05);
}
function paintDisc(p, rr) {                  // one coloured layer, centred on the origin
  ctx.beginPath(); ctx.arc(0, 0, rr, 0, 6.2832);
  if (p.k === 'solid') { ctx.fillStyle = p.c; ctx.fill(); }
  else if (p.k === 'rainbow') {
    for (let i = 0; i < 12; i++) {           // 12 wedges around the bubble (slight overlap hides seams)
      ctx.beginPath(); ctx.moveTo(0, 0);
      ctx.arc(0, 0, rr, (i * 30 - 91) * Math.PI / 180, (i * 30 + 31 - 90) * Math.PI / 180);
      ctx.fillStyle = rainbow(i, p.light); ctx.fill();
    }
  } else {                                   // stippled: dots on a light background
    ctx.fillStyle = p.bg; ctx.fill(); ctx.save(); ctx.clip();
    const sp = rr * 0.19, N = Math.ceil(rr / sp) + 1;
    for (let j = -N; j <= N; j++) for (let i = -N; i <= N; i++) {
      const h1 = ((i * 73856093) ^ (j * 19349663)) >>> 0, a = (h1 % 1000) / 1000, b = ((h1 >>> 10) % 1000) / 1000;
      const x = (i + (j & 1) * 0.5) * sp + (a - 0.5) * sp * 0.4, y = j * sp * 0.866 + (b - 0.5) * sp * 0.4;
      if (x * x + y * y > (rr + sp) * (rr + sp)) continue;
      ctx.fillStyle = p.dot || rainbow(((i + j) % 12 + 12) % 12, false);
      ctx.beginPath(); ctx.arc(x, y, sp * (0.24 + 0.1 * a), 0, 6.2832); ctx.fill();
    }
    ctx.restore();
  }
  const g = ctx.createRadialGradient(-rr * 0.3, -rr * 0.35, rr * 0.1, 0, 0, rr);   // glassy shading
  g.addColorStop(0, 'rgba(255,255,255,.45)'); g.addColorStop(0.6, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(30,20,80,.12)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, rr, 0, 6.2832); ctx.fill();
}
function drawBubbleFace(v, r, lift) {        // coloured layers, rim, shine and number; origin = centre
  const L = layersOf(v), rs = LAYER_R[L.length];
  L.forEach((p, i) => {
    if (i === 1) ctx.shadowColor = 'transparent';     // drop shadow only from the outermost layer
    if (i === 0 && lift) { ctx.shadowColor = 'rgba(40,30,90,.35)'; ctx.shadowBlur = r * 0.35; ctx.shadowOffsetY = r * 0.15; }
    paintDisc(p, r * rs[i]);
  });
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = r * 0.04; ctx.strokeStyle = 'rgba(43,33,80,.3)';
  ctx.beginPath(); ctx.arc(0, 0, r, 0, 6.2832); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,.6)';
  ctx.beginPath(); ctx.ellipse(-r * 0.38, -r * 0.45, r * 0.22, r * 0.12, -0.7, 0, 6.2832); ctx.fill();
  drawNumber(v, 0, 0, r);
}
function drawBubble(b, t, highlight) {
  if (b.delay > 0) return;
  const r = rad(b.v) * b.s * (b.drag ? 1.07 : 1);
  if (r < 1) return;
  const wob = b.drag ? 0 : Math.sin(t * 1.6 + b.ph) * r * 0.03;
  ctx.save();
  ctx.translate(b.x + (b.wig > 0 ? Math.sin(b.wig * 50) * r * 0.12 : 0), b.y + wob);
  if (b.rot) ctx.rotate(b.rot * (b.fly ? Math.sin(t * 4 + b.ph) : 1));
  ctx.globalAlpha = b.a;
  drawBubbleFace(b.v, r, b.drag);
  if (highlight) { ctx.lineWidth = r * 0.09; ctx.strokeStyle = '#fff'; ctx.shadowColor = '#fff'; ctx.shadowBlur = r * 0.4;
    ctx.beginPath(); ctx.arc(0, 0, r * 1.08, 0, 6.2832); ctx.stroke(); }
  ctx.restore();
}
function drawCreature(t) {
  const won = state === 'won';
  const jump = won ? -Math.abs(Math.sin(wonT * 7)) * cr * 0.35 : Math.sin(t * 2) * cr * 0.02;
  creatureJump = jump;
  ctx.save(); ctx.translate(cx, cy + jump);
  ctx.lineCap = 'round';
  // feet
  ctx.fillStyle = '#5b3fcc';
  ctx.beginPath(); ctx.ellipse(-cr * 0.45, cr * 0.98, cr * 0.3, cr * 0.15, 0, 0, 6.2832); ctx.ellipse(cr * 0.45, cr * 0.98, cr * 0.3, cr * 0.15, 0, 0, 6.2832); ctx.fill();
  // arms
  ctx.strokeStyle = '#7e5cf0'; ctx.lineWidth = cr * 0.22;
  const wave = Math.sin(t * 3) * cr * 0.08;
  ctx.beginPath();
  if (won) { ctx.moveTo(-cr * 0.9, 0); ctx.lineTo(-cr * 1.2, -cr * 0.75 + Math.sin(wonT * 14) * cr * 0.1);
             ctx.moveTo(cr * 0.9, 0);  ctx.lineTo(cr * 1.2, -cr * 0.75 - Math.sin(wonT * 14) * cr * 0.1); }
  else { ctx.moveTo(-cr * 0.9, cr * 0.1); ctx.lineTo(-cr * 1.2, cr * 0.4 + wave);
         ctx.moveTo(cr * 0.9, cr * 0.1);  ctx.lineTo(cr * 1.2, cr * 0.4 - wave); }
  ctx.stroke();
  // antennae
  ctx.strokeStyle = '#5b3fcc'; ctx.lineWidth = cr * 0.06;
  const sway = Math.sin(t * 2.5) * cr * 0.08;
  [[-1, '#ff78c4'], [1, '#feca57']].forEach(([s, col]) => {
    ctx.beginPath(); ctx.moveTo(s * cr * 0.35, -cr * 0.88); ctx.quadraticCurveTo(s * cr * 0.5, -cr * 1.2, s * cr * 0.5 + sway, -cr * 1.4); ctx.stroke();
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(s * cr * 0.5 + sway, -cr * 1.4, cr * 0.12, 0, 6.2832); ctx.fill();
  });
  // body
  const g = ctx.createRadialGradient(-cr * 0.3, -cr * 0.4, cr * 0.1, 0, 0, cr * 1.05);
  g.addColorStop(0, '#b9a4ff'); g.addColorStop(1, '#7e5cf0');
  ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(0, 0, cr, cr * 0.97, 0, 0, 6.2832); ctx.fill();
  ctx.fillStyle = '#e1d7ff'; ctx.beginPath(); ctx.ellipse(0, cr * 0.38, cr * 0.58, cr * 0.5, 0, 0, 6.2832); ctx.fill();
  // eyes
  const blink = (t % 4.2) < 0.12 ? 0.1 : 1;
  const lx = look.x - cx, ly = look.y - cy, ld = Math.hypot(lx, ly) || 1;
  const px = lx / ld * cr * 0.08, py = ly / ld * cr * 0.08;
  [-1, 1].forEach(s => {
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(s * cr * 0.33, -cr * 0.22, cr * 0.24, cr * 0.28 * blink, 0, 0, 6.2832); ctx.fill();
    if (blink > 0.5) {
      ctx.fillStyle = '#2b2d42'; ctx.beginPath(); ctx.arc(s * cr * 0.33 + px, -cr * 0.2 + py, cr * 0.12, 0, 6.2832); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(s * cr * 0.33 + px + cr * 0.04, -cr * 0.24 + py, cr * 0.04, 0, 6.2832); ctx.fill();
    }
  });
  // cheeks + mouth
  ctx.fillStyle = 'rgba(255,120,190,.45)';
  ctx.beginPath(); ctx.arc(-cr * 0.62, cr * 0.1, cr * 0.1, 0, 6.2832); ctx.arc(cr * 0.62, cr * 0.1, cr * 0.1, 0, 6.2832); ctx.fill();
  if (won) {
    ctx.fillStyle = '#3a2a7a'; ctx.beginPath(); ctx.arc(0, cr * 0.05, cr * 0.24, 0, Math.PI); ctx.fill();
    ctx.fillStyle = '#ff78c4'; ctx.beginPath(); ctx.ellipse(0, cr * 0.22, cr * 0.1, cr * 0.06, 0, 0, 6.2832); ctx.fill();
  } else {
    ctx.strokeStyle = '#3a2a7a'; ctx.lineWidth = cr * 0.05;
    ctx.beginPath(); ctx.arc(0, cr * 0.02, cr * 0.2, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
  }
  ctx.restore();
}
// The target is shown as a dark-purple thought cloud made of circles, so it looks nothing like a bubble.
function drawSpeech(t) {
  if (!target) return;
  const pulse = state === 'won' ? 1 + 0.05 * Math.sin(wonT * 10) : 1;
  const k = Math.max(0.01, sbS) * pulse;
  const BODY = '#3b2a85', EDGE = '#a78bfa';
  // circles that make up the cloud (relative to its centre): [x, y, radius]
  const bob = Math.sin(t * 1.5) * sr * 0.03;
  const cl = [[0, 0, sr * 0.8]];
  for (let i = 0; i < 9; i++) {
    const a = i * 6.2832 / 9 + 0.3, w = Math.sin(t * 2.2 + i * 1.3);
    cl.push([Math.cos(a) * sr * (0.72 + 0.02 * w), Math.sin(a) * sr * (0.72 + 0.02 * w), sr * (0.34 + 0.03 * w)]);
  }
  // trail of little thought circles down to the creature's head, growing towards the cloud
  const ax = sx + sr * 0.1, ay = sy + sr * 0.95, bx = cx, by = cy + creatureJump - cr * 1.12;
  const trail = [[0.3, 0.07], [0.56, 0.11], [0.82, 0.16]].map(([f, rr], i) => {
    const w = Math.sin(t * 2.6 - i * 0.9);
    return [bx + (ax - bx) * f, by + (ay - by) * f + w * cr * 0.03, cr * rr * (1 + 0.1 * w)];
  });
  ctx.save();
  ctx.translate(sx, sy + bob); ctx.scale(k, k); ctx.translate(-sx, -(sy + bob));
  const circles = cl.map(([x, y, r]) => [sx + x, sy + bob + y, r]).concat(trail);
  ctx.fillStyle = EDGE;                         // pass 1: slightly larger circles give the whole cloud an outline
  for (const [x, y, r] of circles) { ctx.beginPath(); ctx.arc(x, y, r + sr * 0.06, 0, 6.2832); ctx.fill(); }
  ctx.fillStyle = BODY;                         // pass 2: the dark fill
  for (const [x, y, r] of circles) { ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill(); }
  ctx.fillStyle = 'rgba(255,255,255,.10)';      // soft shine on the cloud
  ctx.beginPath(); ctx.ellipse(sx - sr * 0.35, sy + bob - sr * 0.5, sr * 0.3, sr * 0.14, -0.6, 0, 6.2832); ctx.fill();
  ctx.restore();
  ctx.save();                                   // the number, plain white on the dark cloud
  ctx.translate(sx, sy + bob); drawNumber(target, 0, 0, sr * 0.85 * Math.min(1, k));
  for (let i = 0; i < 3; i++) {                 // twinkling sparkles around the cloud
    const a = [-2.3, -0.9, 0.25][i], d = sr * 1.32, tw = 0.5 + 0.5 * Math.sin(t * 3 + i * 2.1);
    ctx.fillStyle = `rgba(255,255,255,${0.35 + 0.6 * tw})`;
    starPath(Math.cos(a) * d, Math.sin(a) * d, sr * (0.07 + 0.07 * tw) * k, t * 0.5 + i); ctx.fill();
  }
  ctx.restore();
}
function drawParticles() {
  for (const p of particles) {
    ctx.globalAlpha = Math.max(0, 1 - p.life / p.max); ctx.fillStyle = p.col;
    if (p.star) { starPath(p.x, p.y, p.size * 1.6, p.rot); ctx.fill(); }
    else { ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, 6.2832); ctx.fill(); }
  }
  ctx.globalAlpha = 1;
}
function draw(t) {
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#bfe3ff'); bg.addColorStop(1, '#e6d9ff');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  drawCreature(t); drawSpeech(t);
  const cands = new Set(); for (const [, d] of drags) if (d.cand) cands.add(d.cand.id);
  for (const b of bubbles) drawBubble(b, t, cands.has(b.id));
  drawParticles();
}

// ---------- boot ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  update(dt); draw(now / 1000);
  requestAnimationFrame(frame);
}
window.addEventListener('resize', resize);
resize();
requestAnimationFrame(frame);

const startEl = document.getElementById('start');
startEl.addEventListener('pointerdown', e => {
  e.preventDefault();
  audio();
  try { const el = document.documentElement; (el.requestFullscreen || el.webkitRequestFullscreen || (() => {})).call(el); } catch (err) {}
  startEl.classList.add('hide');
  if ('speechSynthesis' in window) window.speechSynthesis.getVoices();
  newRound();
});

// test hook (harmless): lets automated checks read state
window.__nb = { newRound, get bubbles() { return bubbles; }, get target() { return target; }, get state() { return state; }, rad,
  get creature() { return { cx, cy, cr }; } };
})();
