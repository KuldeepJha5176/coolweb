# Coolweb — Live Dither Studies

**Live site:** https://coolweb-rosy.vercel.app

Three video sources, one shared engine, twelve visual studies — each page renders a live Bayer ordered-dither dot field from an MP4 and reacts to your cursor.

---

## Projects

| # | Project | Gallery | Source |
|---|---------|---------|--------|
| 01 | **Aphelion** — vortex plasma | [/aphelion](https://coolweb-rosy.vercel.app/aphelion) | `assets/source.mp4` |
| 02 | **Nocturne** — autumn trees | [/tree-index](https://coolweb-rosy.vercel.app/tree-index) | `assets/tree.mp4` |
| 03 | **Meridian** — rotating earth | [/tree](https://coolweb-rosy.vercel.app/tree) | `assets/rotatingearth.mp4` |

Each project has four visual variants (A–D) exploring different fonts, palettes, dot shapes, and pointer-warp styles.

### Variant directions

| Variant | Font | Palette | Dots | Warp |
|---------|------|---------|------|------|
| A | Space Grotesk | Accent blend on dark | Circles | Twist |
| B | Fraunces + Space Mono | Ink on ivory (`multiply` type) | Airy circles | Scatter |
| C | Anton | Duotone poster (hot colour) | Hard squares | Lean / Twist |
| D | Newsreader | Sampled source colours | Fine circles | Twist |

---

## How it works

Everything runs in one file — [`dither.js`](dither.js).

```
Video → offscreen buffer (one px per cell) → Rec.709 luma
  → auto-levels (2nd/98th pct, pinned for the run)
  → gamma · contrast · brightness
  → 8×8 Bayer ordered dither → N tone levels
  → filled circle/square per cell, bucketed by colour
  → pointer warp applied to sampling coords (not output)
```

Key design decisions from the [source technique guide](https://coolweb-rosy.vercel.app):

- **Auto-levels pinned on the first frame** — recomputing per frame makes dot density pulse visibly.
- **Warp on sampling coords** — displacing where each cell *reads* from costs nothing extra per frame (the buffer is already tiny).
- **Colour bucketing** — cells are grouped by quantised colour before drawing, so `fillStyle` is set ~dozens of times per frame, not once per dot.

### Parameters (all overridable per page via `window.__dither`)

```js
pixelSize   6–14    cell size in CSS px — bigger = coarser, more graphic
spacing     0.3–0.5 gap fraction of each cell
dotScale    0.7–0.9 dot radius as fraction of inner cell
levels      2–6     tone steps (2 = hard 1-bit, 6 = smooth)
contrast    20–35
brightness  −10..+5
invert      false   set true when subject is dark-on-light
floor       0.02–0.08  clamp near-zero tones to zero (kills background haze)
gamma       0.85–1.0
shape       'circle' | 'square'
colorMode   'blend' | 'duotone' | 'sampled'
colorMix    0–1     (blend only) 0 = source palette, 1 = accent colour
warp        'twist' | 'lean' | 'scatter'
zoom        >1      enlarges the centred subject in the buffer
offsetX/Y   0–1     subject centre as fraction of canvas size
```

---

## Running locally

Requires Node.js (no npm install needed — plain http server):

```bash
node server.js
# open http://localhost:5173
```

`server.js` serves the directory with HTTP Range support so the browser can stream and seek the MP4 files correctly.

---

## Deployment

Deployed to Vercel as a static site (no build step):

```bash
npx vercel@latest deploy --prod --yes
```

`vercel.json` sets `cleanUrls: true` so pages are accessible without `.html`.

Live URL: **https://coolweb-rosy.vercel.app**
