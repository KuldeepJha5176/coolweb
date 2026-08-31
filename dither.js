/* ------------------------------------------------------------------ *
 * Live ordered-dither dot field, driven by a looping <video>.
 *
 * Each page sets `window.__dither = {...}` BEFORE loading this script to
 * override any of the defaults below (colours, dot shape, placement,
 * pointer-warp style, ...). That is what lets one engine drive many looks.
 *
 * Source = a warp-tunnel vortex: a bright violet plasma made of many small
 * cell-like elements spiralling into a black singularity, with light-streaks
 * flying outward. A radial subject, light-on-dark, composition-locked on its
 * centre.
 *   - invert = false  -> dots land on the bright plasma, not on empty space
 *   - floor clamp      -> the black core + surrounding space render as nothing,
 *                         leaving the singularity as a natural empty focal void
 *   - warp = 'twist'   -> rotational warp about the cursor, the doc's
 *                         prescription for a radial subject (never radial ripple)
 * The tunnel flows continuously into itself, so <video loop> reads as a loop
 * without hunting for a seam.
 * ------------------------------------------------------------------ */

const DEFAULTS = {
  pixelSize: 9,      // cell size in CSS px. Bigger = coarser, more graphic.
  spacing: 0.42,     // fraction of each cell left as gap.
  dotScale: 0.82,    // dot radius as a fraction of the remaining cell.
  levels: 5,         // tone steps. 2 = hard 1-bit, 6 = smooth gradation.
  contrast: 30,
  brightness: 2,
  invert: false,     // subject is LIGHT on DARK -> do not invert.
  floor: 0.05,       // clamp tones below this to zero (erases the space haze
                     // and keeps the black singularity an empty void).
  gamma: 0.85,

  shape: 'circle',   // 'circle' | 'square'

  // Colour: 'sampled' | 'duotone' | 'blend'
  colorMode: 'blend',
  colorMix: 0.28,
  accent: [138, 120, 255],   // electric violet, the plasma's own hue
  ground: [7, 8, 16],

  // Placement of the vortex within the canvas. It fills a 16:9 frame, so a
  // slight zoom past "cover" plus a centred offset keeps the core in view.
  zoom: 1.12,
  offsetX: 0.5,
  offsetY: 0.5,

  // Pointer interaction. warp: 'twist' | 'lean' | 'scatter'
  warp: 'twist',
  pointerRadiusFrac: 0.6,
  pointerTwist: 0.9,   // twist: max radians at the cursor
  pointerLean: 9,      // lean: horizontal push in cells
  pointerScatter: 5,   // scatter: displacement in cells

  sampleFps: 12,

  // Loop-wrap crossfade, in seconds. 0 = off (a truly cyclic source, like the
  // vortex, needs no seam). For natural footage that does NOT return to its
  // first frame (e.g. a scene whose light drifts over the clip), set this to
  // ~1.5: over the final seconds the sampled pixels dissolve back toward the
  // captured first frame, so the jump to t=0 is invisible.
  loopCrossfade: 0,
};

const PARAMS = Object.assign({}, DEFAULTS, window.__dither || {});
window.PARAMS = PARAMS;

const canvas = document.getElementById('scene');
const ctx = canvas.getContext('2d');
const video = document.getElementById('src');

const buf = document.createElement('canvas');
const bctx = buf.getContext('2d', { willReadFrequently: true });

let dpr = 1;
let cols = 0, rows = 0;
let cell = PARAMS.pixelSize;
let srcData = null;
let levelsLo = 0, levelsHi = 1, levelsPinned = false;
let startFrame = null;   // captured first-frame pixels, for the loop crossfade

// --- 8x8 Bayer ordered-dither matrix, built by recursing a 2x2 ------------
function buildBayer(n) {
  if (n === 1) return [[0]];
  const half = buildBayer(n / 2);
  const h = half.length;
  const m = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < h; x++) {
      const v = half[y][x];
      m[y][x]         = 4 * v + 0;
      m[y][x + h]     = 4 * v + 2;
      m[y + h][x]     = 4 * v + 3;
      m[y + h][x + h] = 4 * v + 1;
    }
  }
  return m;
}
const BAYER_N = 8;
const bayerNorm = buildBayer(BAYER_N).map(r => r.map(v => (v + 0.5) / (BAYER_N * BAYER_N)));

function hash(x, y) {           // stable per-cell pseudo-random in [0,1)
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967296;
}

const pointer = { x: -1e5, y: -1e5, active: false };

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = window.innerWidth, h = window.innerHeight;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  cell = PARAMS.pixelSize * dpr;
  cols = Math.max(1, Math.ceil(canvas.width / cell));
  rows = Math.max(1, Math.ceil(canvas.height / cell));
  buf.width = cols;
  buf.height = rows;
  levelsPinned = false;
  startFrame = null;   // buffer size changed -> re-capture the loop-start frame
}

let tainted = false;
function drawVideoToBuffer() {
  if (!video.videoWidth) return false;
  bctx.fillStyle = 'rgb(0,0,0)';
  bctx.fillRect(0, 0, cols, rows);
  const vr = video.videoWidth / video.videoHeight;
  const br = cols / rows;
  let dw, dh;
  if (vr > br) { dw = cols; dh = cols / vr; }
  else { dh = rows; dw = rows * vr; }
  dw *= PARAMS.zoom; dh *= PARAMS.zoom;
  const dx = cols * PARAMS.offsetX - dw / 2;
  const dy = rows * PARAMS.offsetY - dh / 2;
  bctx.drawImage(video, dx, dy, dw, dh);
  try {
    srcData = bctx.getImageData(0, 0, cols, rows);
  } catch (e) {
    // Canvas tainted -> the page was opened over file:// instead of http.
    tainted = true;
    return false;
  }

  const xf = PARAMS.loopCrossfade;
  if (xf > 0 && video.duration) {
    const t = video.currentTime;
    const d = srcData.data;
    // Capture the loop-start frame once we're near t=0 (each loop offers a
    // chance; the flag guards against overwriting mid-clip).
    if (!startFrame && t <= xf) {
      startFrame = new Uint8ClampedArray(d);
    }
    // Over the final `xf` seconds, dissolve toward that captured start frame.
    if (startFrame && startFrame.length === d.length) {
      const tail = video.duration - xf;
      if (t >= tail) {
        let a = (t - tail) / xf;          // 0 at tail start -> 1 at the seam
        a = a * a * (3 - 2 * a);          // smoothstep
        const s = startFrame;
        for (let i = 0; i < d.length; i++) d[i] = d[i] + (s[i] - d[i]) * a;
      }
    }
  }

  return true;
}

// Fill the canvas with the ground colour so it never sits blank/black while
// the first video frame is still decoding.
function paintGround() {
  ctx.fillStyle = `rgb(${PARAMS.ground[0]},${PARAMS.ground[1]},${PARAMS.ground[2]})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function paintNotice(msg) {
  paintGround();
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = `${14 * dpr}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(msg, canvas.width / 2, canvas.height / 2);
}

// Auto-level against the 2nd / 98th percentile of the luma histogram, then
// PIN for the whole run (recomputing per frame makes the density pulse).
function pinLevels(data) {
  const hist = new Uint32Array(256);
  const d = data.data;
  for (let i = 0; i < d.length; i += 4) {
    const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    hist[l | 0]++;
  }
  const total = d.length / 4;
  const loCount = total * 0.02, hiCount = total * 0.98;
  let acc = 0, lo = 0, hi = 255;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= loCount) { lo = v; break; } }
  acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= hiCount) { hi = v; break; } }
  levelsLo = lo / 255;
  levelsHi = Math.max(hi / 255, levelsLo + 1e-3);
  levelsPinned = true;
}

const contrastFactor = () => {
  const c = PARAMS.contrast;
  return (259 * (c + 255)) / (255 * (259 - c));
};
const mix = (a, b, t) => a + (b - a) * t;

function render() {
  if (tainted) {
    paintNotice('Open via http://localhost — not the file:// path.');
    return;
  }
  if (!srcData) return;
  const d = srcData.data;
  const cf = contrastFactor();
  const bright = PARAMS.brightness / 255;
  const inner = cell * (1 - PARAMS.spacing);
  const rMax = (inner / 2) * PARAMS.dotScale;
  const Lm1 = PARAMS.levels - 1;
  const square = PARAMS.shape === 'square';

  const pr = Math.min(canvas.width, canvas.height) * PARAMS.pointerRadiusFrac;
  const pr2 = pr * pr;

  ctx.fillStyle = `rgb(${PARAMS.ground[0]},${PARAMS.ground[1]},${PARAMS.ground[2]})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const buckets = new Map();

  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      const ox = (gx + 0.5) * cell;
      const oy = (gy + 0.5) * cell;

      // --- pointer warp: displace the SAMPLING coordinate, not the output.
      let sx = gx, sy = gy;
      if (pointer.active) {
        const dx = ox - pointer.x, dy = oy - pointer.y;
        const dist2 = dx * dx + dy * dy;
        if (dist2 < pr2) {
          const dist = Math.sqrt(dist2) || 1;
          const f = 1 - dist / pr;
          const ease = f * f * (3 - 2 * f);          // smoothstep falloff
          if (PARAMS.warp === 'twist') {
            const ang = PARAMS.pointerTwist * ease;
            const cos = Math.cos(ang), sin = Math.sin(ang);
            sx = (pointer.x + dx * cos - dy * sin) / cell - 0.5;
            sy = (pointer.y + dx * sin + dy * cos) / cell - 0.5;
          } else if (PARAMS.warp === 'lean') {
            sx = gx + PARAMS.pointerLean * ease;       // cells lean downwind
            sy = gy - PARAMS.pointerLean * 0.4 * ease; // and lift a little
          } else { // scatter
            const a = hash(gx, gy) * Math.PI * 2;
            const amt = PARAMS.pointerScatter * ease;
            sx = gx + Math.cos(a) * amt;
            sy = gy + Math.sin(a) * amt;
          }
        }
      }

      const ix = Math.min(cols - 1, Math.max(0, Math.round(sx)));
      const iy = Math.min(rows - 1, Math.max(0, Math.round(sy)));
      const si = (iy * cols + ix) * 4;

      const r = d[si], g = d[si + 1], b = d[si + 2];
      let luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      luma = (luma - levelsLo) / (levelsHi - levelsLo);
      luma = Math.min(1, Math.max(0, luma));
      if (PARAMS.gamma !== 1) luma = Math.pow(luma, PARAMS.gamma);
      luma = (luma - 0.5) * cf + 0.5 + bright;
      luma = Math.min(1, Math.max(0, luma));
      if (PARAMS.invert) luma = 1 - luma;
      if (luma < PARAMS.floor) continue;

      const t = bayerNorm[gy & 7][gx & 7];
      const scaled = luma * Lm1;
      const low = Math.floor(scaled);
      const level = Math.min(Lm1, low + ((scaled - low) > t ? 1 : 0));
      if (level <= 0) continue;

      const radius = rMax * (level / Lm1);
      if (radius < 0.35) continue;

      let cr, cg, cb;
      if (PARAMS.colorMode === 'duotone') {
        cr = PARAMS.accent[0]; cg = PARAMS.accent[1]; cb = PARAMS.accent[2];
      } else if (PARAMS.colorMode === 'sampled') {
        cr = r; cg = g; cb = b;
      } else {
        cr = mix(r, PARAMS.accent[0], PARAMS.colorMix);
        cg = mix(g, PARAMS.accent[1], PARAMS.colorMix);
        cb = mix(b, PARAMS.accent[2], PARAMS.colorMix);
      }
      const key = ((cr >> 4) << 8) | ((cg >> 4) << 4) | (cb >> 4);
      let bucket = buckets.get(key);
      if (!bucket) { bucket = { r: cr, g: cg, b: cb, dots: [] }; buckets.set(key, bucket); }
      bucket.dots.push(ox, oy, radius);
    }
  }

  for (const bk of buckets.values()) {
    ctx.fillStyle = `rgb(${bk.r | 0},${bk.g | 0},${bk.b | 0})`;
    ctx.beginPath();
    const dots = bk.dots;
    for (let i = 0; i < dots.length; i += 3) {
      const x = dots[i], y = dots[i + 1], rr = dots[i + 2];
      if (square) ctx.rect(x - rr, y - rr, rr * 2, rr * 2);
      else { ctx.moveTo(x + rr, y); ctx.arc(x, y, rr, 0, Math.PI * 2); }
    }
    ctx.fill();
  }
}

let lastSample = 0;
function frame(now) {
  if (now - lastSample > 1000 / PARAMS.sampleFps) {
    if (drawVideoToBuffer() && !levelsPinned) pinLevels(srcData);
    lastSample = now;
  }
  render();
  requestAnimationFrame(frame);
}

window.addEventListener('pointermove', (e) => {
  pointer.x = e.clientX * dpr; pointer.y = e.clientY * dpr; pointer.active = true;
});
window.addEventListener('pointerleave', () => { pointer.active = false; });
window.addEventListener('pointerdown', (e) => {
  pointer.x = e.clientX * dpr; pointer.y = e.clientY * dpr; pointer.active = true;
});
window.addEventListener('resize', resize);

function boot() {
  resize();
  paintGround();
  // rAF is suspended while the page is hidden (and a hidden/collapsed pane can
  // size the canvas to 0x0 and reject autoplay). When the page is shown again,
  // re-measure, repaint, AND resume playback -- otherwise the field renders a
  // single frozen frame instead of the live loop.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { resize(); paintGround(); video.play().catch(() => {}); }
  });
  const start = () => video.play().catch(() => {});
  if (video.readyState >= 2) start();
  else video.addEventListener('loadeddata', start, { once: true });
  window.addEventListener('pointerdown', () => video.play().catch(() => {}), { once: true });
  requestAnimationFrame(frame);
}
boot();

window.__repin = () => { levelsPinned = false; };
