/* Tank Dynamics — world rendering: camera, themed landscapes, terrain, projectiles and effects.
 * Tanks are drawn by skins.js and the HUD by hud.js. Nothing here touches the simulation state. */
'use strict';
(function (TD) {
  const { W, H, WORLD_W, WORLD_H, COLS, ROWS } = TD;
  const TEX = 3;                 // texture pixels per terrain cell (12 px per metre)
  const TPM = TEX / TD.CELL;     // texture px per metre
  const rnd = TD.rng(12345);     // cosmetic randomness only (never the sim's RNG)
  const R = (a, b) => a + (b - a) * rnd.next();

  /* ---------------- themes ---------------- */
  const THEMES = {
    lagoon: {
      sky: ['#5ec8ff', '#9fe0ff', '#ffe3b8'], sun: { x: 0.78, y: 0.2, r: 46, c: '#fff6c9', glow: 'rgba(255,240,170,0.55)' },
      far: '#7fb4d9', far2: '#98c7e3', mid: '#4fae6a', mid2: '#3f9a5a', cloud: '#ffffff',
      grass: ['#6fdc5a', '#4cc24a'], soil: ['#9b6b3f', '#7c522d'], deep: ['#5e3d24', '#4d311d'], rock: ['#7d7f86', '#63656b'], goo: ['#ff8fcf', '#ff6bb8'],
      water: ['rgba(64,170,230,0.78)', 'rgba(30,110,190,0.92)'], deco: 'flower', particles: 'firefly', music: 'battle',
    },
    canyon: {
      sky: ['#3b2a6b', '#d9577a', '#ffb05c'], sun: { x: 0.25, y: 0.42, r: 70, c: '#ffe08a', glow: 'rgba(255,150,80,0.55)' },
      far: '#8e4a6b', far2: '#b3607a', mid: '#c7643f', mid2: '#a34f32', cloud: '#ffc2a8',
      grass: ['#e8a25c', '#d98945'], soil: ['#c96a3b', '#b35a30'], deep: ['#8f4226', '#7a3820'], rock: ['#6d4a3f', '#5a3c33'], goo: ['#ff8fcf', '#ff6bb8'],
      water: ['rgba(214,120,60,0.75)', 'rgba(140,60,30,0.95)'], deco: 'cactus', particles: 'dust', music: 'battle2',
    },
    frost: {
      sky: ['#0b1440', '#243a7a', '#5f7fc4'], sun: { x: 0.8, y: 0.16, r: 34, c: '#f4f7ff', glow: 'rgba(200,220,255,0.35)', moon: true }, aurora: true, stars: true,
      far: '#3d5a9c', far2: '#6d8dcf', mid: '#bcd7f5', mid2: '#9bbde6', cloud: '#c8d8ff',
      grass: ['#ffffff', '#e6f3ff'], soil: ['#a9c9ec', '#8db4e0'], deep: ['#5f86bf', '#4d74ad'], rock: ['#56617a', '#475066'], goo: ['#ff9fd6', '#ff7cc4'],
      water: ['rgba(90,150,210,0.75)', 'rgba(20,50,110,0.95)'], deco: 'pine', particles: 'snow', music: 'battle',
    },
    neon: {
      sky: ['#0a0220', '#2a0a5a', '#ff3fa4'], sun: { x: 0.5, y: 0.5, r: 110, c: '#ffdd55', glow: 'rgba(255,60,170,0.45)', synth: true }, stars: true, city: true,
      far: '#2b0f5c', far2: '#40207a', mid: '#1c0b3d', mid2: '#150830', cloud: '#7a4dff',
      grass: ['#39ffea', '#18d9c9'], soil: ['#3a2170', '#2f1a5c'], deep: ['#22124a', '#1b0e3b'], rock: ['#16122b', '#100d20'], goo: ['#ff5ad9', '#ff2ec8'],
      water: ['rgba(255,60,200,0.35)', 'rgba(40,10,90,0.95)'], deco: 'lamp', particles: 'neon', music: 'battle2',
    },
    candy: {
      sky: ['#ffb8e1', '#c9b8ff', '#a8e6ff'], sun: { x: 0.2, y: 0.18, r: 40, c: '#fff4b8', glow: 'rgba(255,255,220,0.6)' }, rainbow: true,
      far: '#f7a8d8', far2: '#ffc6e6', mid: '#b98cf0', mid2: '#a57ae0', cloud: '#fff0fa',
      grass: ['#ff6fb5', '#ff4fa3'], soil: ['#fff1d6', '#ffe1b3'], deep: ['#a0602c', '#8a4f22'], rock: ['#7a3d1a', '#663214'], goo: ['#7fe6ff', '#4fd0ff'],
      water: ['rgba(140,80,50,0.8)', 'rgba(90,45,25,0.97)'], deco: 'lolly', particles: 'sprinkle', music: 'battle',
    },
  };
  TD.THEMES = THEMES;

  const hexToRgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const mixRgb = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  function makeCanvas(w, h) {
    if (typeof OffscreenCanvas !== 'undefined') { try { return new OffscreenCanvas(w, h); } catch (e) { /* fall through */ } }
    const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
  }
  TD.makeCanvas = makeCanvas;

  /* ---------------- camera ---------------- */
  class Camera {
    constructor() { this.x = WORLD_W / 2; this.y = WORLD_H / 2; this.s = W / WORLD_W; this.tx = this.x; this.ty = this.y; this.ts = this.s; this.shake = 0; this.sx = 0; this.sy = 0; }
    get minS() { return W / WORLD_W; }
    focus(x, y, s) { this.tx = x; this.ty = y; this.ts = TD.clamp(s, this.minS, 20); }
    overview() { this.focus(WORLD_W / 2, WORLD_H / 2, this.minS); }
    update(dt, snap) {
      const k = snap ? 1 : 1 - Math.pow(0.0025, dt);
      this.s += (this.ts - this.s) * k;
      this.x += (this.tx - this.x) * k; this.y += (this.ty - this.y) * k;
      // keep the view inside the world (bottom of the world sits just above the HUD)
      const halfW = W / 2 / this.s, halfH = H / 2 / this.s;
      const hud = 96 / this.s;
      if (halfW * 2 >= WORLD_W) this.x = WORLD_W / 2; else this.x = TD.clamp(this.x, halfW, WORLD_W - halfW);
      const bottom = -hud - 1, top = WORLD_H + 6;
      if (halfH * 2 >= top - bottom) this.y = bottom + halfH; else this.y = TD.clamp(this.y, bottom + halfH, top - halfH);
      if (this.shake > 0) { this.shake = Math.max(0, this.shake - dt * 30); const a = this.shake * (TD.settings.shake ? 1 : 0.2); this.sx = (Math.random() - 0.5) * a; this.sy = (Math.random() - 0.5) * a; } else { this.sx = this.sy = 0; }
    }
    X(x) { return (x - this.x) * this.s + W / 2 + this.sx; }
    Y(y) { return H / 2 - (y - this.y) * this.s + this.sy; }
    toWorld(sx, sy) { return { x: (sx - W / 2) / this.s + this.x, y: (H / 2 - sy) / this.s + this.y }; }
    kick(a) { this.shake = Math.max(this.shake, a); }
  }
  TD.Camera = Camera;

  /* ---------------- terrain texture ---------------- */
  class TerrainView {
    constructor(terrain, themeId) {
      this.t = terrain; this.theme = THEMES[themeId] || THEMES.lagoon;
      this.w = COLS * TEX; this.h = ROWS * TEX;
      this.canvas = makeCanvas(this.w, this.h);
      this.ctx = this.canvas.getContext('2d');
      this.img = this.ctx.createImageData(this.w, this.h);
      this.px = new Uint32Array(this.img.data.buffer);
      this.base = new Uint32Array(this.w * this.h);   // colour of the ground at every pixel
      this.gooC = new Uint32Array(this.w * this.h);
      this.scorch = new Uint8Array(COLS * ROWS);      // burn marks around craters
      this.surf = new Float32Array(COLS);             // original surface height (cells) per column
      this.buildBase();
      this.decos = this.makeDecos();
      terrain.dirty = { x0: 0, y0: 0, x1: COLS - 1, y1: ROWS - 1 };
      this.version = -1;
      this.mini = makeCanvas(COLS / 4, ROWS / 4);
      this.miniV = -1;
    }
    buildBase() {
      const th = this.theme, t = this.t;
      for (let cx = 0; cx < COLS; cx++) { let top = -1; for (let cy = ROWS - 1; cy >= 0; cy--) if (t.cells[cy * COLS + cx]) { top = cy; break; } this.surf[cx] = top; }
      const pal = (a) => a.map(hexToRgb);
      const G = pal(th.grass), S = pal(th.soil), D = pal(th.deep), K = pal(th.rock), Q = pal(th.goo);
      const little = TD.rng(777);
      const LE = (typeof Uint8Array !== 'undefined') && new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
      const pack = (c) => (LE ? (255 << 24) | ((c[2] & 255) << 16) | ((c[1] & 255) << 8) | (c[0] & 255) : ((c[0] & 255) << 24) | ((c[1] & 255) << 16) | ((c[2] & 255) << 8) | 255) >>> 0;
      this.pack = pack;
      const ppm = TPM; // texture px per metre
      for (let py = 0; py < this.h; py++) {
        const cy = ROWS - 1 - Math.floor(py / TEX);
        for (let px = 0; px < this.w; px++) {
          const cx = Math.floor(px / TEX);
          // metres below the original surface, with a gentle wobble so layers aren't ruler-straight
          const depth = (this.surf[cx] - cy) * TD.CELL + Math.sin(px * 0.045) * 0.12 + Math.sin(px * 0.011 + 1.3) * 0.25;
          const n = little.next();
          // soft large-scale variation (clumps, patches) instead of per-pixel static
          const big = 0.5 + 0.25 * Math.sin(px / ppm * 0.9 + Math.sin(py / ppm * 1.3) * 1.7) + 0.25 * Math.sin(py / ppm * 1.1 - px / ppm * 0.35);
          const strata = Math.sin(depth * 1.6 + Math.sin(px / ppm * 0.25) * 1.2);
          let c;
          if (t.cells[cy * COLS + cx] === 2) c = mixRgb(K[0], K[1], big * 0.8 + n * 0.12);
          else if (depth < 0.5) { c = mixRgb(G[0], G[1], big * 0.7 + n * 0.12); if (depth < 0.12) c = mixRgb(c, [255, 255, 255], 0.18); }
          else if (depth < 0.75) c = mixRgb(G[1], S[0], (depth - 0.5) / 0.25);
          else if (depth < 8) { c = mixRgb(S[0], S[1], TD.clamp((depth - 0.75) / 7, 0, 1) * 0.55 + big * 0.35 + n * 0.08); if (strata > 0.92) c = mixRgb(c, D[0], 0.25); }
          else c = mixRgb(D[0], D[1], big * 0.8 + n * 0.1);
          if (n > 0.9975 && depth > 1) c = mixRgb(c, [255, 255, 255], 0.3); // a few pebbles
          const j = py * this.w + px;
          this.base[j] = pack(c);
          this.gooC[j] = pack(mixRgb(Q[0], Q[1], big * 0.8 + n * 0.1));
        }
      }
    }
    makeDecos() {
      const out = [], th = this.theme;
      const r2 = TD.rng(this.t.map.id.length * 99 + 3);
      for (let x = 3; x < WORLD_W - 3; x += r2.range(2.2, 6)) {
        const y = this.t.top(x);
        if (y < TD.WATER + 1) continue;
        out.push({ x, y, kind: th.deco, v: r2.next(), s: r2.range(0.8, 1.3), alive: true });
      }
      return out;
    }
    /** Re-colour the part of the texture the simulation changed. */
    sync() {
      const t = this.t, d = t.dirty;
      if (!d) return;
      t.dirty = null;
      const x0 = Math.max(0, d.x0 - 2), x1 = Math.min(COLS - 1, d.x1 + 2), y0 = Math.max(0, d.y0 - 2), y1 = Math.min(ROWS - 1, d.y1 + 2);
      const cells = t.cells, w = this.w;
      const solidAt = (cx, cy) => (cx < 0 || cx >= COLS || cy < 0 ? 0 : cy >= ROWS ? 0 : cells[cy * COLS + cx] ? 1 : 0);
      for (let py = (ROWS - 1 - y1) * TEX; py < (ROWS - y0) * TEX; py++) {
        // sample position in cell space (y up)
        const fy = (this.h - py - 0.5) / TEX - 0.5;
        const cy0 = Math.floor(fy), ty = fy - cy0;
        for (let px = x0 * TEX; px < (x1 + 1) * TEX; px++) {
          const fx = (px + 0.5) / TEX - 0.5;
          const cx0 = Math.floor(fx), tx = fx - cx0;
          // bilinear coverage -> smooth, rounded crater edges instead of 0.25 m stair steps
          const a = solidAt(cx0, cy0), b = solidAt(cx0 + 1, cy0), c = solidAt(cx0, cy0 + 1), e = solidAt(cx0 + 1, cy0 + 1);
          const v = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + e * tx) * ty;
          const j = py * w + px;
          if (v < 0.42) { this.px[j] = 0; continue; }
          const ccx = Math.floor((px + 0.5) / TEX), ccy = ROWS - 1 - Math.floor(py / TEX);
          const mat = cells[ccy * COLS + ccx] || cells[cy0 * COLS + cx0] || 1;
          let col = mat === 3 ? this.gooC[j] : this.base[j];
          // rim light on exposed edges, darker burn around craters
          const above = solidAt(ccx, ccy + 1) + solidAt(ccx, ccy + 2);
          const sc = this.scorch[ccy * COLS + ccx];
          if (above < 2 || sc) col = shade(col, above < 2 && !sc && ccy < this.surf[ccx] - 1 ? 0.82 : 1 - sc / 400, this.pack);
          if (v < 0.6) col = (col & 0x00ffffff) | ((((v - 0.42) / 0.18) * 255) << 24 >>> 0); // soft edge (little-endian alpha)
          this.px[j] = col >>> 0;
        }
      }
      const sx = x0 * TEX, sy = (ROWS - 1 - y1) * TEX;
      this.ctx.putImageData(this.img, 0, 0, sx, sy, (x1 - x0 + 1) * TEX, (y1 - y0 + 1) * TEX);
      for (const dc of this.decos) if (dc.alive && !t.solid(dc.x, dc.y - 0.15)) { dc.alive = false; dc.popped = true; }
    }
    burn(x, y, r) {
      const c0 = Math.floor((x - r - 1) / TD.CELL), c1 = Math.ceil((x + r + 1) / TD.CELL);
      const r0 = Math.floor((y - r - 1) / TD.CELL), r1 = Math.ceil((y + r + 1) / TD.CELL);
      for (let cy = Math.max(0, r0); cy <= Math.min(ROWS - 1, r1); cy++) for (let cx = Math.max(0, c0); cx <= Math.min(COLS - 1, c1); cx++) {
        const dx = (cx + 0.5) * TD.CELL - x, dy = (cy + 0.5) * TD.CELL - y, d = Math.sqrt(dx * dx + dy * dy);
        if (d < r + 1.1) { const i = cy * COLS + cx; this.scorch[i] = Math.min(160, this.scorch[i] + (d < r + 0.5 ? 120 : 60)); }
      }
      this.t.markDirty(Math.max(0, c0), Math.max(0, r0), Math.min(COLS - 1, c1), Math.min(ROWS - 1, r1));
    }
    /** Colour of the ground near a point, for debris. */
    colorAt(x, y) {
      const px = TD.clamp(Math.floor(x * TPM), 0, this.w - 1), py = TD.clamp(Math.floor(this.h - y * TPM), 0, this.h - 1);
      const c = this.base[py * this.w + px];
      return `rgb(${c & 255},${(c >> 8) & 255},${(c >> 16) & 255})`;
    }
    miniMap() {
      if (this.miniV === this.t.version) return this.mini;
      this.miniV = this.t.version;
      const g = this.mini.getContext('2d'), mw = this.mini.width, mh = this.mini.height;
      g.clearRect(0, 0, mw, mh);
      g.fillStyle = this.theme.grass[1];
      for (let x = 0; x < mw; x++) for (let y = 0; y < mh; y++) if (this.t.cells[(y * 4) * COLS + x * 4]) g.fillRect(x, mh - 1 - y, 1, 1);
      return this.mini;
    }
  }
  function shade(c, k, pack) {
    const r = c & 255, g = (c >> 8) & 255, b = (c >> 16) & 255;
    return pack([Math.min(255, r * k + (k > 1 ? 0 : 0)), Math.min(255, g * k), Math.min(255, b * k)]);
  }
  TD.TerrainView = TerrainView;

  /* ---------------- backgrounds (pre-rendered, parallax) ---------------- */
  function buildBackdrop(themeId) {
    const th = THEMES[themeId] || THEMES.lagoon;
    const layers = {};
    // sky: fixed to the screen
    const sky = makeCanvas(W, H), g = sky.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, th.sky[0]); gr.addColorStop(0.6, th.sky[1]); gr.addColorStop(1, th.sky[2]);
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    if (th.stars) for (let i = 0; i < 160; i++) { g.globalAlpha = R(0.3, 1); g.fillStyle = '#fff'; const s = R(0.8, 2.2); g.fillRect(R(0, W), R(0, H * 0.6), s, s); }
    g.globalAlpha = 1;
    const sun = th.sun, sx = sun.x * W, sy = sun.y * H;
    const glow = g.createRadialGradient(sx, sy, sun.r * 0.5, sx, sy, sun.r * 4);
    glow.addColorStop(0, sun.glow); glow.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = glow; g.fillRect(0, 0, W, H);
    if (sun.synth) { // striped synthwave sun
      const sg = g.createLinearGradient(0, sy - sun.r, 0, sy + sun.r); sg.addColorStop(0, '#ffe35a'); sg.addColorStop(1, '#ff3f9e');
      g.save(); g.beginPath(); g.arc(sx, sy, sun.r, 0, Math.PI * 2); g.clip(); g.fillStyle = sg; g.fillRect(sx - sun.r, sy - sun.r, sun.r * 2, sun.r * 2);
      g.globalCompositeOperation = 'destination-out'; for (let i = 0; i < 7; i++) g.fillRect(sx - sun.r, sy + i * 14 - 4, sun.r * 2, 3 + i * 1.3); g.restore();
    } else {
      g.fillStyle = sun.c; g.beginPath(); g.arc(sx, sy, sun.r, 0, Math.PI * 2); g.fill();
      if (sun.moon) { g.fillStyle = 'rgba(160,180,220,0.35)'; for (const [dx, dy, r] of [[-10, -6, 7], [8, 10, 5], [12, -12, 4]]) { g.beginPath(); g.arc(sx + dx, sy + dy, r, 0, Math.PI * 2); g.fill(); } }
    }
    if (th.rainbow) {
      g.globalAlpha = 0.35; g.lineWidth = 12;
      ['#ff5a5a', '#ffae3c', '#ffe35a', '#5de08a', '#5ab8ff', '#9a6bff'].forEach((c, i) => { g.strokeStyle = c; g.beginPath(); g.arc(W * 0.62, H * 0.95, 420 - i * 12, Math.PI * 1.08, Math.PI * 1.92); g.stroke(); });
      g.globalAlpha = 1;
    }
    layers.sky = sky;
    layers.far = ridge(th.far, th.far2, 0.52, 0.18, 0.012, themeId === 'frost' ? 'peaks' : themeId === 'canyon' ? 'mesa' : 'soft', th);
    layers.mid = ridge(th.mid, th.mid2, 0.7, 0.12, 0.02, themeId === 'canyon' ? 'mesa' : themeId === 'neon' ? 'city' : 'soft', th);
    return layers;
  }
  function ridge(c1, c2, base, amp, freq, style, th) {
    const w = W * 2, h = H, cv = makeCanvas(w, h), g = cv.getContext('2d');
    const ph = R(0, 100);
    const f = (x) => {
      if (style === 'peaks') { const u = x * freq; return base - amp * (Math.abs(Math.sin(u + ph)) * 0.7 + Math.abs(Math.sin(u * 2.3 + ph)) * 0.3); }
      if (style === 'mesa') { const u = Math.sin(x * freq * 0.7 + ph); return base - amp * (u > 0.2 ? 1 : u > -0.2 ? (u + 0.2) * 2.5 : 0) - amp * 0.1 * Math.sin(x * 0.2); }
      return base - amp * (0.6 * Math.sin(x * freq + ph) + 0.4 * Math.sin(x * freq * 2.7 + ph * 2)) * 0.5 - amp * 0.5;
    };
    const gr = g.createLinearGradient(0, h * (base - amp), 0, h);
    gr.addColorStop(0, c1); gr.addColorStop(1, c2);
    g.fillStyle = gr;
    if (style === 'city') {
      for (let x = 0; x < w;) {
        const bw = R(40, 110), bh = R(90, 300);
        g.fillStyle = gr; g.fillRect(x, h - bh, bw - 6, bh);
        for (let wy = h - bh + 12; wy < h - 10; wy += 16) for (let wx = x + 8; wx < x + bw - 16; wx += 14) {
          if (rnd.next() < 0.45) { g.fillStyle = rnd.pick(['#ffe35a', '#39ffea', '#ff5ad9', '#ffffff']); g.globalAlpha = R(0.4, 0.9); g.fillRect(wx, wy, 6, 8); g.globalAlpha = 1; }
        }
        x += bw;
      }
      return cv;
    }
    g.beginPath(); g.moveTo(0, h);
    for (let x = 0; x <= w; x += 4) g.lineTo(x, h * f(x));
    g.lineTo(w, h); g.closePath(); g.fill();
    // snow caps / highlights
    if (style === 'peaks') {
      g.save(); g.clip(); g.fillStyle = 'rgba(255,255,255,0.85)';
      g.beginPath(); g.moveTo(0, 0); for (let x = 0; x <= w; x += 4) g.lineTo(x, h * f(x) + 26); g.lineTo(w, 0); g.closePath(); g.fill(); g.restore();
    }
    if (th && th.deco === 'flower' && style === 'soft') { // little tree silhouettes on the mid hills
      g.fillStyle = 'rgba(30,110,60,0.55)';
      for (let x = 20; x < w; x += R(30, 90)) { const y = h * f(x); g.beginPath(); g.arc(x, y - 10, R(8, 14), 0, Math.PI * 2); g.fill(); g.fillRect(x - 2, y - 6, 4, 10); }
    }
    return cv;
  }

  /* ---------------- scene renderer ---------------- */
  class WorldRenderer {
    constructor(match) {
      this.m = match;
      this.themeId = match.terrain.map.theme;
      this.theme = THEMES[this.themeId];
      this.tv = new TerrainView(match.terrain, this.themeId);
      this.bg = buildBackdrop(this.themeId);
      this.cam = new Camera();
      this.fx = [];        // particles
      this.floaters = [];  // damage numbers / callouts
      this.time = 0;
      this.clouds = Array.from({ length: 7 }, () => ({ x: R(-100, W + 100), y: R(40, 260), s: R(0.6, 1.4), v: R(0.5, 1) }));
      this.amb = Array.from({ length: 50 }, () => ({ x: R(0, W), y: R(0, H), v: R(0.3, 1), p: R(0, 6.28) }));
      this.flash = 0;
      this.tankFx = match.tanks.map(() => ({ hurt: 0, recoil: 0, blink: R(1, 4), wheel: 0, scared: 0, freeze: 0, happy: 0, dmgShake: 0 }));
    }
    get ctx() { return this._ctx; }

    update(dt) {
      this.time += dt;
      this.tv.sync();
      const wind = this.m.wind;
      for (const c of this.clouds) { c.x += (wind.x * 3 + 4) * c.v * dt; if (c.x > W + 220) c.x = -220; if (c.x < -240) c.x = W + 200; }
      for (let i = this.fx.length - 1; i >= 0; i--) {
        const p = this.fx[i];
        p.life -= dt;
        if (p.life <= 0) { this.fx.splice(i, 1); continue; }
        p.vy -= (p.g ?? 9.81) * dt; p.vx *= p.drag ?? 1; p.vy *= p.drag ?? 1;
        if (p.wind) p.vx += wind.x * p.wind * dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.spin) p.a = (p.a || 0) + p.spin * dt;
        if (p.bounce && p.y < this.m.terrain.top(p.x) && p.vy < 0 && this.m.terrain.solid(p.x, p.y)) { p.vy *= -0.35; p.vx *= 0.6; p.y += 0.1; }
      }
      for (let i = this.floaters.length - 1; i >= 0; i--) { const f = this.floaters[i]; f.t += dt; if (f.t > f.life) this.floaters.splice(i, 1); }
      for (const tf of this.tankFx) { tf.hurt = Math.max(0, tf.hurt - dt); tf.recoil = Math.max(0, tf.recoil - dt * 4); tf.happy = Math.max(0, tf.happy - dt); tf.dmgShake = Math.max(0, tf.dmgShake - dt); tf.blink -= dt; if (tf.blink < -0.12) tf.blink = R(1.5, 4.5); tf.scared = Math.max(0, tf.scared - dt); }
      this.flash = Math.max(0, this.flash - dt * 3);
      // incoming shots make tanks nervous
      for (const p of this.m.projectiles) for (const t of this.m.tanks) {
        if (!t.alive || t.i === p.owner) continue;
        const dx = t.x - p.x, dy = t.y - p.y;
        if (dx * dx + dy * dy < 150 && p.vy < 0) this.tankFx[t.i].scared = 0.4;
      }
    }

    /* ---- effects (called from main when the sim emits events) ---- */
    burst(o) { this.fx.push(Object.assign({ vx: 0, vy: 0, life: 1, max: o.life || 1, size: 0.3, g: 9.81 }, o, { max: o.life || 1 })); }
    explosion(e) {
      const big = e.big, r = e.r;
      this.tv.burn(e.x, e.y, r * 0.9);
      this.cam.kick(big ? 16 : 9);
      this.flash = big ? 0.6 : 0.3;
      this.burst({ kind: 'flash', x: e.x, y: e.y, life: 0.25, size: r * 1.6, g: 0 });
      this.burst({ kind: 'ring', x: e.x, y: e.y, life: 0.45, size: r * 1.9, g: 0, color: e.color });
      for (let i = 0; i < (big ? 18 : 11); i++) {
        const a = R(0, 6.28), s = R(1, 5);
        this.burst({ kind: 'fire', x: e.x + Math.cos(a) * r * 0.3, y: e.y + Math.sin(a) * r * 0.3, vx: Math.cos(a) * s, vy: Math.sin(a) * s + 2, life: R(0.3, 0.7), size: R(r * 0.3, r * 0.6), g: -2, drag: 0.94 });
      }
      for (let i = 0; i < (big ? 12 : 7); i++) this.burst({ kind: 'smoke', x: e.x + R(-r, r) * 0.6, y: e.y + R(0, r * 0.5), vx: R(-1, 1), vy: R(1, 3), life: R(1.2, 2.2), size: R(r * 0.4, r * 0.8), g: -0.6, drag: 0.98, wind: 0.2 });
      const dc = this.tv.colorAt(e.x, e.y - 0.5);
      for (let i = 0; i < (big ? 26 : 16); i++) {
        const a = R(0.2, Math.PI - 0.2), s = R(5, 14);
        this.burst({ kind: 'chunk', x: e.x, y: e.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: R(0.8, 1.6), size: R(0.12, 0.35), color: dc, spin: R(-10, 10), bounce: true });
      }
      this.themed(e.fx, e.x, e.y, r, e.color);
      if (big) this.callout(rnd.pick(['KA-BOOM!', 'BLAMMO!', 'KER-POW!']), e.x, e.y + r + 2, '#ffe35a', 1.4);
    }
    themed(fx, x, y, r, color) {
      const n = 12;
      for (let i = 0; i < n; i++) {
        const a = R(0, 6.28), s = R(2, 7);
        const base = { x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s + 2, life: R(0.6, 1.3), size: R(0.2, 0.45), color };
        if (fx === 'leaf') this.burst(Object.assign(base, { kind: 'leaf', g: 2, drag: 0.96, spin: R(-8, 8), wind: 0.5, color: rnd.pick(['#5de08a', '#2fbf5a', '#b6ff5a']) }));
        else if (fx === 'snow' || fx === 'ice') this.burst(Object.assign(base, { kind: fx === 'ice' ? 'shard' : 'flake', g: 3, drag: 0.95, spin: R(-6, 6), color: fx === 'ice' ? '#bff4ff' : '#ffffff' }));
        else if (fx === 'star') this.burst(Object.assign(base, { kind: 'star', g: 1, drag: 0.95, spin: R(-6, 6), color: rnd.pick(['#ffe36b', '#ff7ad9', '#8fdcff']) }));
        else if (fx === 'bubble') this.burst(Object.assign(base, { kind: 'bubble', g: -3, drag: 0.95, color: '#bff4ff' }));
        else if (fx === 'goo') this.burst(Object.assign(base, { kind: 'blob', g: 12, color: '#ff8fcf', bounce: true }));
        else if (fx === 'spark' || fx === 'laser') this.burst(Object.assign(base, { kind: 'spark', g: 14, vx: base.vx * 2, vy: base.vy * 2, life: R(0.3, 0.6), color: fx === 'laser' ? '#39ffea' : '#ffdf6b' }));
        else if (fx === 'void') this.burst(Object.assign(base, { kind: 'spark', g: 0, vx: -Math.cos(a) * 6, vy: -Math.sin(a) * 6, x: x + Math.cos(a) * r * 1.4, y: y + Math.sin(a) * r * 1.4, life: 0.4, color: '#b36bff' }));
        else if (fx === 'ring') this.burst(Object.assign(base, { kind: 'leaf', g: 2, drag: 0.96, spin: 5, color: '#b6ff5a' }));
        else this.burst(Object.assign(base, { kind: 'ember', g: -1, drag: 0.96, color: rnd.pick(['#ffb02a', '#ff6a2a', '#ffe35a']) }));
      }
    }
    callout(text, x, y, color, scale = 1) { this.floaters.push({ text, x, y, color, t: 0, life: 1.3, scale, word: true }); }
    number(amount, x, y, direct) { this.floaters.push({ text: '-' + amount, x: x + R(-0.6, 0.6), y, color: direct ? '#ffe35a' : '#ffffff', t: 0, life: 1.4, scale: direct ? 1.25 : 1 }); }
    splash(x, y) {
      for (let i = 0; i < 16; i++) this.burst({ kind: 'drop', x: x + R(-0.8, 0.8), y, vx: R(-3, 3), vy: R(4, 11), life: R(0.6, 1.1), size: R(0.12, 0.25), color: '#bfe8ff' });
    }
    muzzle(t, fx, color) {
      const m = this.m.muzzle(t);
      for (let i = 0; i < 8; i++) { const a = m.ang + R(-0.5, 0.5), s = R(3, 9); this.burst({ kind: 'smoke', x: m.x, y: m.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: R(0.4, 0.9), size: R(0.3, 0.6), g: -1, drag: 0.9 }); }
      this.burst({ kind: 'flash', x: m.x, y: m.y, life: 0.12, size: 1.3, g: 0 });
      this.themed(fx, m.x, m.y, 1, color);
      this.tankFx[t.i].recoil = 1;
      this.cam.kick(3);
    }

    /* ---- drawing ---- */
    draw(g, opts = {}) {
      const cam = this.cam, th = this.theme, m = this.m;
      g.drawImage(this.bg.sky, 0, 0);
      this.drawSkyFx(g);
      this.layer(g, this.bg.far, 0.25);
      this.drawClouds(g);
      this.layer(g, this.bg.mid, 0.5);
      // terrain
      const tx = cam.X(0), ty = cam.Y(WORLD_H), sc = cam.s / TPM;
      g.imageSmoothingEnabled = true;
      g.drawImage(this.tv.canvas, tx, ty, this.tv.w * sc, this.tv.h * sc);
      this.drawDecos(g);
      if (opts.beforeTanks) opts.beforeTanks(g);
      if (opts.tanks) opts.tanks(g);
      this.drawProjectiles(g);
      this.drawWater(g);
      this.drawFx(g);
      this.drawFloaters(g);
      this.drawAmbient(g, th);
      if (this.flash > 0) { g.fillStyle = `rgba(255,250,230,${this.flash * 0.35})`; g.fillRect(0, 0, W, H); }
    }
    layer(g, cv, f) {
      const cam = this.cam;
      const k = 1 + (cam.s / cam.minS - 1) * f * 0.35;
      const w = cv.width * k, h = cv.height * k;
      const ox = -(cam.x - WORLD_W / 2) * cam.s * f;
      const groundY = cam.Y(0);
      const bottom = H * (1 - f) + groundY * f + 40 * f;
      g.drawImage(cv, W / 2 + ox - w / 2, bottom - h, w, h);
    }
    drawSkyFx(g) {
      const th = this.theme, t = this.time;
      if (th.aurora) {
        for (let b = 0; b < 3; b++) {
          g.beginPath();
          const col = ['rgba(90,255,180,0.18)', 'rgba(120,200,255,0.14)', 'rgba(200,120,255,0.12)'][b];
          g.fillStyle = col;
          g.moveTo(0, 120 + b * 30);
          for (let x = 0; x <= W; x += 20) g.lineTo(x, 110 + b * 30 + Math.sin(x * 0.006 + t * 0.4 + b) * 40 + Math.sin(x * 0.017 - t * 0.7) * 14);
          for (let x = W; x >= 0; x -= 20) g.lineTo(x, 190 + b * 30 + Math.sin(x * 0.006 + t * 0.4 + b) * 40);
          g.closePath(); g.fill();
        }
      }
      if (th.stars) { for (let i = 0; i < 6; i++) { const a = 0.5 + 0.5 * Math.sin(t * 3 + i * 7); g.fillStyle = `rgba(255,255,255,${a})`; g.fillRect((i * 211) % W, (i * 97) % 300, 2.5, 2.5); } }
    }
    drawClouds(g) {
      const th = this.theme;
      g.fillStyle = th.cloud;
      for (const c of this.clouds) {
        g.globalAlpha = 0.75;
        const s = c.s * 30, x = c.x, y = c.y;
        g.beginPath();
        g.arc(x, y, s, 0, Math.PI * 2); g.arc(x + s * 1.1, y - s * 0.4, s * 1.2, 0, Math.PI * 2); g.arc(x + s * 2.3, y, s * 0.95, 0, Math.PI * 2);
        g.rect(x, y - s * 0.2, s * 2.3, s * 1.1);
        g.fill();
      }
      g.globalAlpha = 1;
    }
    drawDecos(g) {
      const cam = this.cam, s = cam.s, t = this.time, wind = this.m.wind.x;
      for (const d of this.tv.decos) {
        if (d.popped) { d.popped = false; for (let i = 0; i < 5; i++) this.burst({ kind: 'leaf', x: d.x, y: d.y + 0.5, vx: R(-3, 3), vy: R(2, 6), life: 1, size: 0.25, g: 4, spin: 6, color: '#8fd06a' }); }
        if (!d.alive) continue;
        const x = cam.X(d.x), y = cam.Y(d.y);
        if (x < -50 || x > W + 50) continue;
        const sway = Math.sin(t * 2 + d.x) * 0.06 + wind * 0.012;
        g.save(); g.translate(x, y); g.rotate(sway); g.scale(s * d.s / 10, s * d.s / 10);
        drawDeco(g, d.kind, d.v, t);
        g.restore();
      }
    }
    drawWater(g) {
      const cam = this.cam, th = this.theme, y = cam.Y(this.m.water);
      if (y > H) return;
      const gr = g.createLinearGradient(0, y, 0, H);
      gr.addColorStop(0, th.water[0]); gr.addColorStop(1, th.water[1]);
      g.fillStyle = gr;
      g.beginPath(); g.moveTo(0, H);
      for (let x = 0; x <= W; x += 16) g.lineTo(x, y + Math.sin(x * 0.03 + this.time * 2) * 3 + Math.sin(x * 0.011 - this.time) * 2);
      g.lineTo(W, H); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.45)'; g.lineWidth = 2;
      g.beginPath();
      for (let x = 0; x <= W; x += 16) { const yy = y + Math.sin(x * 0.03 + this.time * 2) * 3 + Math.sin(x * 0.011 - this.time) * 2; if (x === 0) g.moveTo(x, yy); else g.lineTo(x, yy); }
      g.stroke();
      if (this.themeId === 'lagoon') { // lily pads
        for (let i = 0; i < 6; i++) { const lx = ((i * 233 + this.time * 6) % (W + 80)) - 40; g.fillStyle = '#3fb65a'; g.beginPath(); g.ellipse(lx, y + 6 + (i % 3) * 5, 16, 6, 0, 0.3, Math.PI * 2 - 0.1); g.fill(); }
      }
    }
    drawProjectiles(g) {
      const cam = this.cam, s = cam.s;
      for (const p of this.m.projectiles) {
        const w = p.w;
        // trail
        if (p.trail.length > 2) {
          g.lineCap = 'round';
          for (let k = 2; k < p.trail.length; k += 2) {
            const a = k / p.trail.length;
            g.strokeStyle = w.fx === 'fire' ? `rgba(255,${120 + a * 100},40,${a * 0.6})` : w.fx === 'void' ? `rgba(160,90,255,${a * 0.5})` : `rgba(255,255,255,${a * 0.45})`;
            g.lineWidth = Math.max(1, w.size * s * a * 0.9);
            g.beginPath(); g.moveTo(cam.X(p.trail[k - 2]), cam.Y(p.trail[k - 1])); g.lineTo(cam.X(p.trail[k] ?? p.x), cam.Y(p.trail[k + 1] ?? p.y)); g.stroke();
          }
        }
        let x = cam.X(p.x), y = cam.Y(p.y);
        const r = Math.max(4, w.size * s * 0.9);
        if (y < -r) { // above the screen: arrow + height
          g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.lineWidth = 3;
          g.beginPath(); g.moveTo(x, 8); g.lineTo(x - 10, 26); g.lineTo(x + 10, 26); g.closePath(); g.stroke(); g.fill();
          g.font = 'bold 14px Fredoka, system-ui, sans-serif'; g.textAlign = 'center';
          g.strokeText(Math.round(p.y) + 'm', x, 44); g.fillText(Math.round(p.y) + 'm', x, 44);
          continue;
        }
        drawShot(g, w, x, y, r, this.time, p);
      }
    }
    drawFx(g) {
      const cam = this.cam, s = cam.s;
      for (const p of this.fx) {
        const x = cam.X(p.x), y = cam.Y(p.y), a = TD.clamp(p.life / p.max, 0, 1), sz = p.size * s;
        switch (p.kind) {
          case 'flash': { const gr = g.createRadialGradient(x, y, 0, x, y, sz * (1.4 - a * 0.4)); gr.addColorStop(0, `rgba(255,255,230,${a})`); gr.addColorStop(0.4, `rgba(255,220,120,${a * 0.8})`); gr.addColorStop(1, 'rgba(255,160,60,0)'); g.fillStyle = gr; g.beginPath(); g.arc(x, y, sz * 1.4, 0, 6.29); g.fill(); break; }
          case 'ring': g.strokeStyle = `rgba(255,255,255,${a * 0.8})`; g.lineWidth = 6 * a + 1; g.beginPath(); g.arc(x, y, sz * (1 - a) + 4, 0, 6.29); g.stroke(); break;
          case 'fire': { const gr = g.createRadialGradient(x, y, 0, x, y, sz); gr.addColorStop(0, `rgba(255,250,200,${a})`); gr.addColorStop(0.5, `rgba(255,150,40,${a * 0.9})`); gr.addColorStop(1, 'rgba(200,40,10,0)'); g.fillStyle = gr; g.beginPath(); g.arc(x, y, sz, 0, 6.29); g.fill(); break; }
          case 'smoke': g.fillStyle = `rgba(90,90,100,${a * 0.45})`; g.beginPath(); g.arc(x, y, sz * (1.6 - a * 0.6), 0, 6.29); g.fill(); break;
          case 'chunk': g.save(); g.translate(x, y); g.rotate(p.a || 0); g.fillStyle = p.color; g.fillRect(-sz, -sz, sz * 2, sz * 1.6); g.restore(); break;
          case 'leaf': g.save(); g.translate(x, y); g.rotate(p.a || 0); g.fillStyle = p.color; g.beginPath(); g.ellipse(0, 0, sz * 1.3, sz * 0.6, 0, 0, 6.29); g.fill(); g.restore(); break;
          case 'flake': g.fillStyle = `rgba(255,255,255,${a})`; g.beginPath(); g.arc(x, y, sz * 0.7, 0, 6.29); g.fill(); break;
          case 'shard': g.save(); g.translate(x, y); g.rotate(p.a || 0); g.fillStyle = `rgba(190,245,255,${a})`; g.beginPath(); g.moveTo(0, -sz * 1.5); g.lineTo(sz * 0.5, 0); g.lineTo(0, sz * 1.5); g.lineTo(-sz * 0.5, 0); g.fill(); g.restore(); break;
          case 'star': g.save(); g.translate(x, y); g.rotate(p.a || 0); g.fillStyle = p.color; g.globalAlpha = a; starPath(g, sz * 1.2); g.fill(); g.restore(); g.globalAlpha = 1; break;
          case 'bubble': g.strokeStyle = `rgba(220,250,255,${a})`; g.lineWidth = 2; g.beginPath(); g.arc(x, y, sz, 0, 6.29); g.stroke(); g.fillStyle = `rgba(255,255,255,${a * 0.7})`; g.fillRect(x - sz * 0.4, y - sz * 0.5, 2, 2); break;
          case 'blob': case 'drop': g.fillStyle = p.color; g.globalAlpha = a; g.beginPath(); g.arc(x, y, sz, 0, 6.29); g.fill(); g.globalAlpha = 1; break;
          case 'spark': case 'ember': g.fillStyle = p.color; g.globalAlpha = a; g.fillRect(x - sz * 0.4, y - sz * 0.4, sz * 0.8, sz * 0.8); g.globalAlpha = 1; break;
          case 'beam': { const w = p.size * s; const gr = g.createLinearGradient(x - w, 0, x + w, 0); gr.addColorStop(0, 'rgba(57,255,234,0)'); gr.addColorStop(0.5, `rgba(220,255,255,${a})`); gr.addColorStop(1, 'rgba(57,255,234,0)'); g.fillStyle = gr; g.fillRect(x - w, 0, w * 2, cam.Y(p.y2)); break; }
          case 'vortex': g.save(); g.translate(x, y); g.rotate(this.time * 6); g.strokeStyle = `rgba(179,107,255,${a})`; g.lineWidth = 4; for (let k = 0; k < 3; k++) { g.beginPath(); g.arc(0, 0, sz * (0.4 + k * 0.3) * (0.5 + a * 0.5), k, k + 2.5); g.stroke(); } g.restore(); break;
        }
      }
    }
    drawFloaters(g) {
      const cam = this.cam;
      g.textAlign = 'center';
      for (const f of this.floaters) {
        const k = f.t / f.life, pop = k < 0.12 ? 0.6 + k / 0.12 * 0.6 : 1.2 - Math.min(0.2, (k - 0.12));
        const half = f.word ? f.text.length * 12 * f.scale : 40;
        const x = TD.clamp(cam.X(f.x), half, W - half), y = TD.clamp(cam.Y(f.y) - k * 40, 130, H - 110);
        const size = (f.word ? 38 : 30) * f.scale * pop;
        g.globalAlpha = k > 0.75 ? (1 - k) / 0.25 : 1;
        g.font = `900 ${size | 0}px Fredoka, 'Arial Black', system-ui, sans-serif`;
        g.lineJoin = 'round'; g.lineWidth = size * 0.18; g.strokeStyle = '#1a1030';
        g.save(); if (f.word) { g.translate(x, y); g.rotate(-0.08); g.translate(-x, -y); }
        g.strokeText(f.text, x, y); g.fillStyle = f.color; g.fillText(f.text, x, y);
        g.restore();
      }
      g.globalAlpha = 1;
    }
    drawAmbient(g, th) {
      const t = this.time, kind = th.particles, wind = this.m.wind.x;
      for (const a of this.amb) {
        if (kind === 'snow') { a.y += 40 * a.v / 60; a.x += (wind * 4 + Math.sin(t + a.p) * 10) / 60; if (a.y > H) { a.y = -5; a.x = Math.random() * W; } g.fillStyle = 'rgba(255,255,255,0.85)'; g.beginPath(); g.arc(a.x % W, a.y, 1.5 + a.v * 1.5, 0, 6.29); g.fill(); }
        else if (kind === 'firefly') { const x = a.x + Math.sin(t * 0.7 + a.p) * 30, y = a.y * 0.8 + Math.cos(t * 0.5 + a.p) * 20; g.fillStyle = `rgba(255,255,150,${0.3 + 0.3 * Math.sin(t * 3 + a.p)})`; g.beginPath(); g.arc(x, y, 2, 0, 6.29); g.fill(); }
        else if (kind === 'dust') { a.x += (wind * 6 + 10) * a.v / 60; if (a.x > W) a.x = 0; if (a.x < 0) a.x = W; g.fillStyle = 'rgba(255,220,180,0.35)'; g.fillRect(a.x, a.y, 2, 2); }
        else if (kind === 'neon') { const y = (a.y - t * 20 * a.v) % H; g.fillStyle = ['rgba(57,255,234,0.6)', 'rgba(255,90,217,0.6)'][a.p > 3 ? 1 : 0]; g.fillRect(a.x, y < 0 ? y + H : y, 2, 2); }
        else if (kind === 'sprinkle') { a.y += 30 * a.v / 60; a.x += wind * 3 / 60; if (a.y > H) { a.y = -5; a.x = Math.random() * W; } g.save(); g.translate(a.x, a.y); g.rotate(a.p + t); g.fillStyle = ['#ff5a8a', '#ffe35a', '#5ab8ff', '#5de08a'][(a.p * 10 | 0) % 4]; g.fillRect(-3, -1, 6, 2.2); g.restore(); }
      }
    }
  }
  TD.WorldRenderer = WorldRenderer;

  function starPath(g, r) {
    g.beginPath();
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r; g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
    g.closePath();
  }
  TD.starPath = starPath;

  /** Projectile art. */
  function drawShot(g, w, x, y, r, t, p) {
    g.save(); g.translate(x, y);
    const glow = g.createRadialGradient(0, 0, 0, 0, 0, r * 2.4);
    glow.addColorStop(0, hexA(w.color, 0.55)); glow.addColorStop(1, hexA(w.color, 0));
    g.fillStyle = glow; g.beginPath(); g.arc(0, 0, r * 2.4, 0, 6.29); g.fill();
    const spin = t * 10;
    switch (w.fx) {
      case 'leaf': g.rotate(spin); g.fillStyle = '#3fb65a'; g.beginPath(); g.arc(0, 0, r, 0.35, Math.PI * 2 - 0.1); g.lineTo(0, 0); g.fill(); g.fillStyle = '#ff8fcf'; g.beginPath(); g.arc(r * 0.2, -r * 0.1, r * 0.35, 0, 6.29); g.fill(); break;
      case 'fire': case 'meteor': {
        const gr = g.createRadialGradient(-r * 0.3, -r * 0.3, 0, 0, 0, r); gr.addColorStop(0, '#fff6c0'); gr.addColorStop(0.5, '#ffa02a'); gr.addColorStop(1, '#d4301a');
        g.fillStyle = p && p.meteor ? '#6b3a2a' : gr; g.beginPath(); g.arc(0, 0, r, 0, 6.29); g.fill();
        if (p && p.meteor) { g.fillStyle = gr; g.globalAlpha = 0.7; g.beginPath(); g.arc(0, 0, r * 1.2, 0, 6.29); g.fill(); }
        break;
      }
      case 'snow': g.fillStyle = '#ffffff'; g.beginPath(); g.arc(0, 0, r, 0, 6.29); g.fill(); g.fillStyle = '#cfe8ff'; g.beginPath(); g.arc(r * 0.3, r * 0.3, r * 0.5, 0, 6.29); g.fill(); break;
      case 'ice': g.rotate(spin * 0.5); g.fillStyle = '#bff4ff'; g.strokeStyle = '#ffffff'; g.lineWidth = 2; g.beginPath(); for (let i = 0; i < 6; i++) { g.moveTo(0, 0); g.lineTo(Math.cos(i * 1.047) * r * 1.3, Math.sin(i * 1.047) * r * 1.3); } g.stroke(); g.beginPath(); g.arc(0, 0, r * 0.6, 0, 6.29); g.fill(); break;
      case 'spark': g.rotate(Math.atan2(-(p ? p.vy : 0), p ? p.vx : 1)); g.fillStyle = '#c0c8e0'; g.fillRect(-r * 1.3, -r * 0.5, r * 2.2, r); g.fillStyle = '#ffcf3f'; g.beginPath(); g.moveTo(r * 0.9, -r * 0.6); g.lineTo(r * 1.6, 0); g.lineTo(r * 0.9, r * 0.6); g.fill(); break;
      case 'laser': g.fillStyle = '#39ffea'; g.beginPath(); g.arc(0, 0, r, 0, 6.29); g.fill(); g.fillStyle = '#fff'; g.beginPath(); g.arc(0, 0, r * 0.5, 0, 6.29); g.fill(); break;
      case 'star': g.rotate(spin); g.fillStyle = w.color; starPath(g, r * 1.4); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.stroke(); break;
      case 'void': g.fillStyle = '#12001f'; g.beginPath(); g.arc(0, 0, r, 0, 6.29); g.fill(); g.rotate(spin); g.strokeStyle = '#b36bff'; g.lineWidth = 3; g.beginPath(); g.arc(0, 0, r * 1.3, 0, 4); g.stroke(); break;
      case 'bubble': g.fillStyle = 'rgba(180,240,255,0.35)'; g.strokeStyle = '#e8fbff'; g.lineWidth = 2; g.beginPath(); g.arc(0, 0, r, 0, 6.29); g.fill(); g.stroke(); g.fillStyle = '#fff'; g.beginPath(); g.arc(-r * 0.35, -r * 0.35, r * 0.22, 0, 6.29); g.fill(); break;
      case 'goo': g.fillStyle = '#ff8fcf'; g.beginPath(); g.arc(0, 0, r, 0, 6.29); g.fill(); g.fillStyle = '#ffd0ea'; g.beginPath(); g.arc(-r * 0.3, -r * 0.3, r * 0.3, 0, 6.29); g.fill(); break;
      case 'ring': g.fillStyle = w.color; g.beginPath(); g.arc(0, 0, r, 0, 6.29); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.arc(0, 0, r * (1.2 + 0.3 * Math.sin(t * 20)), 0, 6.29); g.stroke(); break;
      default: g.fillStyle = w.color; g.beginPath(); g.arc(0, 0, r, 0, 6.29); g.fill();
    }
    g.restore();
  }
  TD.drawShot = drawShot;
  function hexA(hex, a) { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; }
  TD.hexA = hexA;

  /** Surface decorations, drawn in a 10-units-per-metre local space with the base at (0,0). */
  function drawDeco(g, kind, v, t) {
    switch (kind) {
      case 'flower':
        if (v < 0.5) { // flower
          g.strokeStyle = '#2f8f3a'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -9); g.stroke();
          const c = ['#ff6fa8', '#ffd23f', '#ffffff', '#9b7bff'][(v * 8 | 0) % 4];
          g.fillStyle = c; for (let i = 0; i < 5; i++) { g.beginPath(); g.arc(Math.cos(i * 1.26) * 2.6, -9 + Math.sin(i * 1.26) * 2.6, 2, 0, 6.29); g.fill(); }
          g.fillStyle = '#ffb627'; g.beginPath(); g.arc(0, -9, 1.5, 0, 6.29); g.fill();
        } else if (v < 0.8) { // reeds
          g.strokeStyle = '#3c9a47'; g.lineWidth = 1.4; for (const dx of [-2, 0, 2]) { g.beginPath(); g.moveTo(dx, 0); g.quadraticCurveTo(dx, -8, dx + 1, -14 - dx); g.stroke(); }
          g.fillStyle = '#7a4a2a'; g.fillRect(-0.8, -15, 1.8, 5);
        } else { // mushroom
          g.fillStyle = '#fff1dc'; g.fillRect(-1.2, -5, 2.4, 5); g.fillStyle = '#ff4f4f'; g.beginPath(); g.arc(0, -5, 4.2, Math.PI, 0); g.fill(); g.fillStyle = '#fff'; g.beginPath(); g.arc(-1.5, -7, 0.8, 0, 6.29); g.arc(1.8, -6.5, 0.7, 0, 6.29); g.fill();
        }
        break;
      case 'cactus':
        if (v < 0.6) { g.fillStyle = '#3f9a55'; rr(g, -2, -16, 4, 16, 2); g.fill(); rr(g, -6.5, -11, 3, 7, 1.5); g.fill(); rr(g, 3.5, -13, 3, 6, 1.5); g.fill(); g.fillRect(-5, -6, 4, 2); g.fillRect(1, -8, 4, 2); if (v < 0.25) { g.fillStyle = '#ff6fa8'; g.beginPath(); g.arc(0, -16.5, 1.6, 0, 6.29); g.fill(); } }
        else { g.fillStyle = '#9a6a4a'; g.beginPath(); g.ellipse(0, -2, 5, 3, 0, 0, 6.29); g.fill(); }
        break;
      case 'pine':
        g.fillStyle = '#6b4a30'; g.fillRect(-1, -4, 2, 4);
        for (let i = 0; i < 3; i++) { g.fillStyle = '#2f6e5a'; g.beginPath(); g.moveTo(-7 + i * 1.8, -3 - i * 6); g.lineTo(0, -12 - i * 6); g.lineTo(7 - i * 1.8, -3 - i * 6); g.fill(); g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(-3 + i, -9 - i * 6); g.lineTo(0, -12 - i * 6); g.lineTo(3 - i, -9 - i * 6); g.fill(); }
        break;
      case 'lamp': {
        g.fillStyle = '#2a2050'; g.fillRect(-0.8, -20, 1.6, 20);
        const c = v < 0.5 ? '#39ffea' : '#ff5ad9';
        const gl = g.createRadialGradient(0, -21, 0, 0, -21, 10); gl.addColorStop(0, TD.hexA(c, 0.7)); gl.addColorStop(1, TD.hexA(c, 0));
        g.fillStyle = gl; g.beginPath(); g.arc(0, -21, 10, 0, 6.29); g.fill(); g.fillStyle = c; g.beginPath(); g.arc(0, -21, 2, 0, 6.29); g.fill();
        break;
      }
      case 'lolly':
        if (v < 0.55) {
          g.fillStyle = '#ffffff'; g.fillRect(-0.7, -14, 1.4, 14);
          g.save(); g.translate(0, -16); g.rotate(t * 0.3 + v * 9);
          const cs = ['#ff5a8a', '#ffffff', '#5ab8ff', '#ffe35a'];
          for (let i = 0; i < 8; i++) { g.fillStyle = cs[i % 4]; g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, 5, i * 0.785, (i + 1) * 0.785); g.fill(); }
          g.restore();
        } else {
          g.strokeStyle = '#ffffff'; g.lineWidth = 2.4; g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -12); g.arc(3, -12, 3, Math.PI, 0); g.stroke();
          g.strokeStyle = '#ff4f6a'; g.setLineDash([2, 2]); g.stroke(); g.setLineDash([]);
        }
        break;
    }
  }
  function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  TD.roundRect = rr;
})(globalThis.TD);
