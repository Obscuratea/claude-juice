// Claude Juice: a PC case full of orange liquid that sloshes when the window
// moves and drains as the Claude usage limit is used up.
// Also runs in a plain browser (no Tauri): drag the case to move a pretend window.

const T = window.__TAURI__;
const win = T ? T.window.getCurrentWindow() : null;
const $ = (id) => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Glass window interior, in the side panel's own flat coordinates (300 × 380).
const GX0 = 20, GX1 = 280, GY0 = 22, GY1 = 358;
const GW = GX1 - GX0, GH = GY1 - GY0, GXC = (GX0 + GX1) / 2;

// ---------- settings ----------

const settings = { window: 'five_hour', onTop: false };
try { Object.assign(settings, JSON.parse(localStorage.getItem('claude-juice') || '{}')); } catch {}
function saveSettings() {
  try { localStorage.setItem('claude-juice', JSON.stringify(settings)); } catch {}
}

// ---------- static vector parts built in code ----------

function el(tag, attrs, parent) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  parent.appendChild(node);
  return node;
}

// Claude spark: uneven rounded rays around a small core.
(function buildSpark() {
  const g = $('spark');
  const rays = 11;
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2 - Math.PI / 2 + 0.12;
    const len = 13 + ((i * 7) % 5) * 1.7;
    el('line', {
      x1: (Math.cos(a) * 3).toFixed(2), y1: (Math.sin(a) * 3).toFixed(2),
      x2: (Math.cos(a) * len).toFixed(2), y2: (Math.sin(a) * len).toFixed(2),
      stroke: '#d97757', 'stroke-width': 4.2, 'stroke-linecap': 'round',
    }, g);
  }
  el('circle', { r: 4.5, fill: '#d97757' }, g);
})();

(function buildFan() {
  const g = $('fan-blades');
  for (let i = 0; i < 7; i++) {
    el('ellipse', { cx: 0, cy: -23, rx: 9, ry: 18, transform: `rotate(${(i * 360) / 7}) skewX(-18)` }, g);
  }
})();

// ---------- usage data ----------

let usage = { state: 'none' };   // none | reset | live
let targetFill = 1;

async function poll() {
  let snaps = [];
  if (T) {
    try { snaps = await T.core.invoke('read_usage'); } catch { snaps = []; }
  } else {
    const now = Date.now() / 1000;
    snaps = [{ updated: now, five_hour: { used_percentage: 38, resets_at: now + 8040 },
               seven_day: { used_percentage: 61, resets_at: now + 300000 } }];
  }

  // Pick the freshest snapshot whose window hasn't reset yet.
  const now = Date.now() / 1000;
  let best = null;
  for (const s of snaps) {
    const w = s && s[settings.window];
    if (w && w.resets_at > now && (!best || s.updated > best.updated)) {
      best = { updated: s.updated, used: w.used_percentage, resetsAt: w.resets_at };
    }
  }
  if (best) usage = { state: 'live', used: best.used, resetsAt: best.resetsAt };
  else usage = { state: snaps.length ? 'reset' : 'none' };

  targetFill = usage.state === 'live' ? clamp(1 - usage.used / 100, 0, 1) : 1;
  updateReadout();
}

function fmtDuration(secs) {
  secs = Math.max(0, Math.round(secs));
  const d = Math.floor(secs / 86400), h = Math.floor((secs % 86400) / 3600), m = Math.floor((secs % 3600) / 60);
  if (d) return `${d}D ${h}H`;
  if (h) return `${h}H ${m}M`;
  return `${m}M`;
}

function updateReadout() {
  const label = settings.window === 'five_hour' ? '5H' : '7D';
  let text;
  if (usage.state === 'live') {
    const left = Math.max(0, Math.round(100 - usage.used));
    text = `${label} · ${left}% LEFT · RESETS ${fmtDuration(usage.resetsAt - Date.now() / 1000)}`;
  } else if (usage.state === 'reset') {
    text = `${label} · FULL TANK`;
  } else {
    text = 'WAITING FOR CLAUDE CODE';
  }
  const t = $('readout-text');
  t.textContent = text;
  const w = t.getComputedTextLength() + 32;
  $('readout-bg').setAttribute('x', (256 - w / 2).toFixed(1));
  $('readout-bg').setAttribute('width', w.toFixed(1));
}

// ---------- window motion ----------
// Window positions arrive as timestamped samples (scene units), either from
// Hyprland's IPC or from the window's own move events. Velocity is measured
// over the last few samples, so uneven event timing doesn't read as jerks.

const samples = [];
const motion = { vx: 0, vy: 0, ax: 0, ay: 0 };

function pushSample(x, y) {
  samples.push({ t: performance.now() / 1000, x, y });
  if (samples.length > 64) samples.shift();
}

function sampleMotion(dt, now) {
  let vx = 0, vy = 0;
  const n = samples.length;
  if (n >= 2 && now - samples[n - 1].t < 0.08) {          // no fresh samples = window is still
    const newest = samples[n - 1];
    let old = newest;
    for (let i = n - 2; i >= 0; i--) {
      old = samples[i];
      if (newest.t - old.t >= 0.05) break;
    }
    const span = newest.t - old.t;
    if (span > 0.004) {
      vx = (newest.x - old.x) / span;
      vy = (newest.y - old.y) / span;
    }
  }
  const k = 1 - Math.exp(-dt / 0.035);
  const nvx = motion.vx + (vx - motion.vx) * k, nvy = motion.vy + (vy - motion.vy) * k;
  motion.ax = clamp((nvx - motion.vx) / dt, -25000, 25000);
  motion.ay = clamp((nvy - motion.vy) / dt, -25000, 25000);
  motion.vx = nvx;
  motion.vy = nvy;
}

// ---------- liquid physics ----------
// The surface is a tilt (the whole body sloshing side to side, a damped
// pendulum) plus small ripples (a 1D chain of springs).

const N = 40;
const xs = Array.from({ length: N }, (_, i) => GX0 + (i * GW) / (N - 1));
const h = new Float32Array(N), hv = new Float32Array(N);
let tilt = 0, tiltV = 0;
let fill = 0;          // starts empty and pours in on launch

const SLOSH_K = 55, SLOSH_C = 1.1, SLOSH_G = 0.0075, TILT_MAX = 1.4;
const WAVE_C = 260, WAVE_R = 4, WAVE_D = 1.3;   // wave speed in scene units/s
const SLAP = 0.14, SHAKE = 0.6;

function stepPhysics(dt, ax) {
  // Window accelerates right -> liquid piles up on the left (positive tilt).
  tiltV += (-SLOSH_K * tilt - SLOSH_C * tiltV + ax * SLOSH_G) * dt;
  tilt = clamp(tilt + tiltV * dt, -TILT_MAX, TILT_MAX);

  const spacing = GW / (N - 1);
  const s = (WAVE_C * WAVE_C) / (spacing * spacing);
  for (let i = 0; i < N; i++) {
    const l = i > 0 ? h[i - 1] : h[i], r = i < N - 1 ? h[i + 1] : h[i];
    hv[i] += (s * (l + r - 2 * h[i]) - WAVE_R * h[i] - WAVE_D * hv[i]) * dt;
  }
  let mean = 0;
  for (let i = 0; i < N; i++) { h[i] = clamp(h[i] + hv[i] * dt, -55, 55); mean += h[i]; }
  mean /= N;
  for (let i = 0; i < N; i++) h[i] -= mean;
}

function disturb(dt, ax, ay) {
  // Sideways jerks slap the walls; vertical jolts shake the whole surface.
  hv[0] -= ax * dt * SLAP;
  hv[1] -= ax * dt * SLAP * 0.5;
  hv[N - 1] += ax * dt * SLAP;
  hv[N - 2] += ax * dt * SLAP * 0.5;
  const shake = Math.abs(ay) * dt * SHAKE;
  if (shake > 0.01) for (let i = 0; i < N; i++) hv[i] += (Math.random() - 0.5) * shake;
}

function splash(x, strength) {
  const c = clamp(Math.round(((x - GX0) / GW) * (N - 1)), 0, N - 1);
  for (let i = Math.max(0, c - 2); i <= Math.min(N - 1, c + 2); i++) hv[i] += strength * (1 - Math.abs(i - c) / 3);
}

function surfaceY(base, t, i) {
  return base + t * (xs[i] - GXC) + h[i];
}

function surfaceAt(base, t, x) {
  const f = clamp(((x - GX0) / GW) * (N - 1), 0, N - 1);
  const i = Math.floor(f), j = Math.min(N - 1, i + 1), u = f - i;
  return surfaceY(base, t, i) * (1 - u) + surfaceY(base, t, j) * u;
}

// ---------- bubbles ----------

const bubbles = Array.from({ length: 10 }, () => {
  const b = { node: el('circle', { r: 0 }, $('bubbles')) };
  respawn(b, true);
  return b;
});

function respawn(b, anywhere) {
  b.x = GX0 + 14 + Math.random() * (GW - 28);
  b.y = anywhere ? GY0 + Math.random() * GH : GY1 + 4;
  b.r = 1.5 + Math.random() * 3.2;
  b.speed = 18 + Math.random() * 30;
  b.phase = Math.random() * Math.PI * 2;
}

// ---------- render loop ----------

let last = performance.now(), fanAngle = 0, clock = 0;

function frame(nowMs) {
  const dt = clamp((nowMs - last) / 1000, 0.001, 0.05);
  last = nowMs;
  clock += dt;

  sampleMotion(dt, nowMs / 1000);
  disturb(dt, motion.ax, motion.ay);
  const sub = 4;
  for (let k = 0; k < sub; k++) stepPhysics(dt / sub, motion.ax);

  fill += (targetFill - fill) * (1 - Math.exp(-dt / 0.6));
  const base = GY1 - fill * GH;
  // Keep a low puddle from tilting out of the glass entirely.
  const maxTilt = Math.max(0.04, Math.min(TILT_MAX, (fill * GH + 8) / (GW / 2)));
  const t = clamp(tilt, -maxTilt, maxTilt);

  // Liquid body and its bright surface line.
  const ys = xs.map((_, i) => clamp(surfaceY(base, t, i), GY0 - 60, GY1 + 2));
  let top = `M${xs[0].toFixed(1)},${ys[0].toFixed(1)}`;
  for (let i = 1; i < N - 1; i++) {
    const mx = (xs[i] + xs[i + 1]) / 2, my = (ys[i] + ys[i + 1]) / 2;
    top += ` Q${xs[i].toFixed(1)},${ys[i].toFixed(1)} ${mx.toFixed(1)},${my.toFixed(1)}`;
  }
  top += ` L${xs[N - 1].toFixed(1)},${ys[N - 1].toFixed(1)}`;
  const visible = fill > 0.003;
  const body = `M${GX0 - 2},${GY1 + 4} L${GX0 - 2},${ys[0].toFixed(1)} ${top.replace(/^M/, 'L')} ` +
    `L${GX1 + 2},${ys[N - 1].toFixed(1)} L${GX1 + 2},${GY1 + 4} Z`;
  $('juice').setAttribute('d', visible ? body : '');
  $('surface').setAttribute('d', visible ? top : '');
  $('glow').setAttribute('opacity', (0.25 + 0.75 * fill).toFixed(3));

  // Bubbles rise, wobble, and pop at the surface with a tiny ripple.
  const showBubbles = fill > 0.05;
  for (const b of bubbles) {
    b.y -= b.speed * dt;
    const x = b.x + Math.sin(clock * 2 + b.phase) * 2.5;
    const sy = surfaceAt(base, t, x);
    if (b.y < sy + b.r + 1) {
      if (b.y > GY0 && showBubbles) splash(x, -6);
      respawn(b, false);
    }
    const inside = showBubbles && b.y > sy + b.r;
    b.node.setAttribute('cx', x.toFixed(1));
    b.node.setAttribute('cy', b.y.toFixed(1));
    b.node.setAttribute('r', inside ? b.r.toFixed(2) : 0);
  }

  // The fan spins slower once it's under the juice.
  fanAngle += dt * (base < 88 ? 50 : 200);
  $('fan-blades').setAttribute('transform', `rotate(${(fanAngle % 360).toFixed(1)})`);

  // Power LED breathes, and goes red when the tank is nearly dry.
  const low = fill < 0.15;
  const ring = $('power-ring');
  ring.setAttribute('stroke', low ? '#ff4b3e' : '#ff9a3c');
  ring.setAttribute('stroke-opacity', (0.55 + 0.45 * Math.sin(clock * (low ? 6 : 2))).toFixed(3));

  requestAnimationFrame(frame);
}

// ---------- interaction ----------

document.addEventListener('contextmenu', (e) => e.preventDefault());

$('case').addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  const p = toLocal($('side'), e);
  if (e.detail >= 2 && p.x > GX0 && p.x < GX1 && p.y > GY0 && p.y < GY1) {   // double-click the glass to splash
    splash(p.x, -160);
    return;
  }
  if (win) win.startDragging();
  else fakeDrag(e);
});

$('grip').addEventListener('mousedown', (e) => {
  if (e.button === 0 && win) win.startResizeDragging('SouthEast');
});

document.addEventListener('mousedown', async (e) => {
  if (e.button !== 2 || !T) return;
  const { Menu, CheckMenuItem, MenuItem, PredefinedMenuItem } = T.menu;
  const items = [
    await CheckMenuItem.new({ text: '5-hour limit', checked: settings.window === 'five_hour', action: () => setLimit('five_hour') }),
    await CheckMenuItem.new({ text: '7-day limit', checked: settings.window === 'seven_day', action: () => setLimit('seven_day') }),
    await PredefinedMenuItem.new({ item: 'Separator' }),
    await CheckMenuItem.new({ text: 'Always on top', checked: settings.onTop, action: () => setOnTop(!settings.onTop) }),
    await PredefinedMenuItem.new({ item: 'Separator' }),
    await MenuItem.new({ text: 'Quit', action: () => win.close() }),
  ];
  const menu = await Menu.new({ items });
  await menu.popup();
});

function setLimit(w) {
  settings.window = w;
  saveSettings();
  poll();
}

function setOnTop(on) {
  settings.onTop = on;
  saveSettings();
  win.setAlwaysOnTop(on);
}

// Pointer position in an element's own coordinates (handles the 3/4 mapping).
function toLocal(node, e) {
  const pt = $('scene').createSVGPoint();
  pt.x = e.clientX;
  pt.y = e.clientY;
  return pt.matrixTransform(node.getScreenCTM().inverse());
}

// Browser preview: dragging the case moves a pretend window.
function fakeDrag(e) {
  const start = { x: e.screenX, y: e.screenY };
  const origin = samples.length ? samples[samples.length - 1] : { x: 0, y: 0 };
  const move = (m) => pushSample(origin.x + (m.screenX - start.x) * 2, origin.y + (m.screenY - start.y) * 2);
  const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); };
  addEventListener('mousemove', move);
  addEventListener('mouseup', up);
}

// ---------- startup ----------

async function start() {
  if (win) {
    let pxToScene = 1;   // physical pixels -> scene units
    const updateScale = async () => {
      const s = await win.innerSize();
      pxToScene = 512 / Math.max(1, Math.min(s.width, s.height));
    };
    await updateScale();

    // On Hyprland the backend polls the compositor (logical pixels plus size).
    let hyprSize = null;
    await T.event.listen('hypr-geometry', ({ payload: g }) => {
      const size = `${g.w}x${g.h}`;
      if (size !== hyprSize) { hyprSize = size; samples.length = 0; }   // a resize isn't motion
      const k = 512 / Math.max(1, Math.min(g.w, g.h));
      pushSample(g.x * k, g.y * k);
    });
    // Everywhere else the window reports its own moves.
    await win.onMoved(({ payload }) => {
      if (!hyprSize) pushSample(payload.x * pxToScene, payload.y * pxToScene);
    });

    // Keep the window square: after a resize settles, even out the sides.
    let squareTimer;
    await win.onResized(({ payload }) => {
      updateScale();
      if (!hyprSize) samples.length = 0;
      clearTimeout(squareTimer);
      squareTimer = setTimeout(() => {
        const { width, height } = payload;
        if (Math.abs(width - height) > 2) {
          const side = Math.round((width + height) / 2);
          win.setSize(new T.dpi.PhysicalSize(side, side));
        }
      }, 250);
    });
    if (settings.onTop) win.setAlwaysOnTop(true);
  }
  await poll();
  setInterval(poll, 5000);
  setInterval(updateReadout, 30000);
  requestAnimationFrame(frame);
}

start();
