/* Tank Dynamics — destructible terrain.
 *
 * The ground is a bitmask: one byte per 0.25 m cell (0 = air, 1 = dirt, 2 = hard rock that only
 * drills and lasers can dig, 3 = goo that Bubbles builds). Explosions carve circles out of it, goo adds circles back. Every
 * operation is integer/arithmetic only, so the mask stays identical on every client.
 * Each map is generated from its seed + a shape recipe, so the network only sends a seed.
 */
'use strict';
(function (TD) {
  const { COLS, ROWS, CELL } = TD;

  // Map recipes. `shape(u, r)` returns the ground height (m) at u = x / WORLD_W (0..1).
  // Sines here run once at map creation through the deterministic dsin, so maps are identical everywhere.
  const S = (x) => TD.dsin(x);
  TD.MAPS = [
    { id: 'lagoon', name: 'Lily Pad Lagoon', theme: 'lagoon', blurb: 'Rolling green hills over a sparkling pond.',
      shape: (u, r) => 22 + 7 * S(u * 9.4 + r.a) + 4 * S(u * 23 + r.b) + 1.2 * S(u * 61 + r.c) + 5 * S(u * 3.1 + r.d) },
    { id: 'canyon', name: 'Sunset Canyon', theme: 'canyon', blurb: 'Tall mesas and a deep ravine in the middle.',
      shape: (u, r) => { const mesa = Math.min(1, Math.abs(u - 0.5) * 5.2); return 12 + 26 * mesa * mesa + 2.5 * S(u * 31 + r.a) + 1.5 * S(u * 73 + r.b); },
      rock: 0.18 },
    { id: 'frost', name: 'Frost Peaks', theme: 'frost', blurb: 'Jagged icy mountains. Mind the big peak!',
      shape: (u, r) => 18 + 16 * Math.max(0, 1 - Math.abs(u - 0.5 - (r.a - 3) * 0.01) * 3.4) + 5 * Math.abs(S(u * 14 + r.b)) + 2 * S(u * 47 + r.c) },
    { id: 'neon', name: 'Neon Nights', theme: 'neon', blurb: 'A glowing city skyline with floating islands.',
      shape: (u, r) => 16 + 6 * S(u * 7 + r.a) + 3 * S(u * 19 + r.b), islands: 3 },
    { id: 'candy', name: 'Candy Clouds', theme: 'candy', blurb: 'Sweet floating dessert islands. Don\'t fall off!',
      shape: (u, r) => 20 + 6 * S(u * 11 + r.a) + 3 * S(u * 29 + r.b), gaps: true, islands: 2 },
  ];
  TD.mapById = (id) => TD.MAPS.find((m) => m.id === id) || TD.MAPS[0];

  class Terrain {
    constructor(mapId, seed) {
      this.map = TD.mapById(mapId);
      this.cells = new Uint8Array(COLS * ROWS);
      this.dirty = { x0: 0, y0: 0, x1: COLS - 1, y1: ROWS - 1 }; // for the renderer
      this.version = 0;
      const rnd = TD.rng(seed ^ 0x51ed);
      const r = { a: rnd.range(0, 6.28), b: rnd.range(0, 6.28), c: rnd.range(0, 6.28), d: rnd.range(0, 6.28) };
      const m = this.map;
      const heights = new Float64Array(COLS);
      for (let cx = 0; cx < COLS; cx++) {
        const u = (cx + 0.5) / COLS;
        let h = m.shape(u, r);
        if (m.gaps) { // candy map: two chasms that drop into the void
          for (const g of [0.3, 0.7]) if (Math.abs(u - g - (r.a - 3) * 0.004) < 0.025) h = 0;
        }
        heights[cx] = TD.clamp(h, 0, TD.WORLD_H - 14);
      }
      for (let cx = 0; cx < COLS; cx++) {
        const top = Math.floor(heights[cx] / CELL);
        for (let cy = 0; cy < top; cy++) this.cells[cy * COLS + cx] = 1;
      }
      if (m.rock) { // bedrock strata along the bottom of canyons
        for (let cx = 0; cx < COLS; cx++) {
          const top = Math.floor(heights[cx] * m.rock / CELL) + 8;
          for (let cy = 0; cy < top; cy++) if (this.cells[cy * COLS + cx]) this.cells[cy * COLS + cx] = 2;
        }
      }
      if (m.islands) { // floating islands: flattened ellipses high in the sky
        for (let i = 0; i < m.islands; i++) {
          const cx = (0.2 + 0.6 * (i + 0.5) / m.islands + rnd.range(-0.05, 0.05)) * TD.WORLD_W;
          const cy = rnd.range(40, 50), rx = rnd.range(6, 9), ry = rnd.range(1.6, 2.4);
          this.fillEllipse(cx, cy, rx, ry, 1);
        }
      }
      this.version++;
    }

    idx(cx, cy) { return cy * COLS + cx; }
    cell(cx, cy) { return cx < 0 || cx >= COLS || cy < 0 || cy >= ROWS ? 0 : this.cells[cy * COLS + cx]; }
    /** Is the point (metres) inside solid ground? */
    solid(x, y) {
      if (y < 0) return false; // below the map is the void/water
      const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
      return this.cell(cx, cy) !== 0;
    }
    /** Height of the highest solid cell top at or below `fromY` in column x (m), or -1 if none. */
    surfaceBelow(x, fromY) {
      const cx = Math.floor(x / CELL);
      if (cx < 0 || cx >= COLS) return -1;
      let cy = Math.min(ROWS - 1, Math.floor(fromY / CELL));
      for (; cy >= 0; cy--) if (this.cells[cy * COLS + cx]) return (cy + 1) * CELL;
      return -1;
    }
    /** Highest ground in the column (m), -1 if the column is empty. */
    top(x) { return this.surfaceBelow(x, TD.WORLD_H); }

    markDirty(x0, y0, x1, y1) {
      const d = this.dirty;
      if (!d) this.dirty = { x0, y0, x1, y1 };
      else { d.x0 = Math.min(d.x0, x0); d.y0 = Math.min(d.y0, y0); d.x1 = Math.max(d.x1, x1); d.y1 = Math.max(d.y1, y1); }
      this.version++;
    }

    /** Remove ground in a circle. hard=true also removes rock. Returns cells removed. */
    carve(x, y, radius, hard) {
      const c0 = Math.floor((x - radius) / CELL), c1 = Math.ceil((x + radius) / CELL);
      const r0 = Math.floor((y - radius) / CELL), r1 = Math.ceil((y + radius) / CELL);
      const rr = radius * radius;
      let n = 0;
      for (let cy = Math.max(0, r0); cy <= Math.min(ROWS - 1, r1); cy++) {
        const dy = (cy + 0.5) * CELL - y;
        for (let cx = Math.max(0, c0); cx <= Math.min(COLS - 1, c1); cx++) {
          const dx = (cx + 0.5) * CELL - x;
          if (dx * dx + dy * dy > rr) continue;
          const i = cy * COLS + cx, v = this.cells[i];
          if (v === 1 || v === 3 || (v === 2 && hard)) { this.cells[i] = 0; n++; }
          else if (v === 2 && dx * dx + dy * dy < rr * 0.3) { this.cells[i] = 1; } // rock cracks to dirt at the core
        }
      }
      if (n) this.markDirty(Math.max(0, c0), Math.max(0, r0), Math.min(COLS - 1, c1), Math.min(ROWS - 1, r1));
      return n;
    }
    /** Add dirt in an ellipse (goo, islands). */
    fillEllipse(x, y, rx, ry, v = 1) {
      const c0 = Math.floor((x - rx) / CELL), c1 = Math.ceil((x + rx) / CELL);
      const r0 = Math.floor((y - ry) / CELL), r1 = Math.ceil((y + ry) / CELL);
      let n = 0;
      for (let cy = Math.max(0, r0); cy <= Math.min(ROWS - 1, r1); cy++) {
        const dy = ((cy + 0.5) * CELL - y) / ry;
        for (let cx = Math.max(0, c0); cx <= Math.min(COLS - 1, c1); cx++) {
          const dx = ((cx + 0.5) * CELL - x) / rx;
          if (dx * dx + dy * dy > 1) continue;
          const i = cy * COLS + cx;
          if (!this.cells[i]) { this.cells[i] = v; n++; }
        }
      }
      if (n) this.markDirty(Math.max(0, c0), Math.max(0, r0), Math.min(COLS - 1, c1), Math.min(ROWS - 1, r1));
      return n;
    }
    /** Carve a vertical column (laser). */
    carveColumn(x, halfW, yTop, yBottom) {
      let n = 0;
      for (let y = yTop; y >= yBottom; y -= CELL) n += this.carve(x, y, halfW, true);
      return n;
    }
    /** Surface slope angle (radians, + = rising to the right) around x, from ground at height ~y. */
    slope(x, y) {
      const a = this.surfaceBelow(x - 1, y + 1.5), b = this.surfaceBelow(x + 1, y + 1.5);
      if (a < 0 || b < 0) return 0;
      return TD.datan2(b - a, 2);
    }
    hash(h) {
      for (let i = 0; i < this.cells.length; i += 4) h.int(this.cells[i] | (this.cells[i + 1] << 2) | (this.cells[i + 2] << 4) | (this.cells[i + 3] << 6));
      return h;
    }
  }
  TD.Terrain = Terrain;
})(globalThis.TD);
