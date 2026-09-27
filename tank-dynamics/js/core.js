/* Tank Dynamics — core constants and deterministic math.
 *
 * The battle simulation must produce bit-identical results on every player's device (online
 * matches only send inputs, never positions). So simulation code only uses + - * / and
 * Math.sqrt/floor/abs/min/max, which IEEE-754 pins down exactly. Math.sin/cos/atan2/exp/pow are
 * allowed to differ between browsers in the last bit, so the sim uses the polynomial versions here.
 */
'use strict';
(function (root) {
  const TD = (root.TD = root.TD || {});

  TD.VERSION = '1.0.0';
  TD.PROTOCOL = 1;          // bump when the sim changes in a way that would desync older clients

  // World: metres, y up. The whole battlefield is visible at once (8 px per metre on a 1280 wide
  // screen), so nobody on a phone has to hunt for their opponent.
  TD.W = 1280; TD.H = 720;          // logical screen
  TD.WORLD_W = 160; TD.WORLD_H = 72; // metres
  TD.PX = 8;                        // logical px per metre
  TD.CELL = 0.25;                   // terrain resolution, metres
  TD.COLS = TD.WORLD_W / TD.CELL;   // 640
  TD.ROWS = TD.WORLD_H / TD.CELL;   // 288
  TD.WATER = 2.0;                   // anything that sinks below this height is lost
  TD.G = 9.81;                      // gravity, m/s²
  TD.DRAG = 0.07;                   // linear drag constant k (1/s): a = g + k·(wind − v)
  TD.FPS = 60; TD.DT = 1 / 60;
  TD.SUBSTEPS = 4;                  // projectile integration substeps per frame
  TD.MAX_SPEED = 44;                // muzzle speed at 100% power, m/s
  TD.TANK_R = 1.4;                  // tank collision radius (m)
  TD.TURN_FRAMES = 20 * 60;         // 20 s per turn
  TD.BASE_DELAY = 500;              // GunBound-style delay added after every turn
  TD.SS_MAX = 100;
  TD.DMG_SCALE = 0.8;               // global damage knob used by balance passes

  const PI = 3.141592653589793;
  TD.PI = PI;
  TD.deg = (d) => d * PI / 180;
  TD.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  TD.lerp = (a, b, t) => a + (b - a) * t;

  // --- deterministic trig (max error ~1e-9 over the whole range) ---
  function sinCore(x) { // |x| <= pi/2, Taylor to x^15
    const x2 = x * x;
    return x * (1 - x2 / 6 * (1 - x2 / 20 * (1 - x2 / 42 * (1 - x2 / 72 * (1 - x2 / 110 * (1 - x2 / 156 * (1 - x2 / 210)))))));
  }
  function dsin(x) {
    const TWO = 2 * PI;
    x = x - TWO * Math.floor((x + PI) / TWO); // -> [-pi, pi)
    if (x > PI / 2) x = PI - x; else if (x < -PI / 2) x = -PI - x;
    return sinCore(x);
  }
  const dcos = (x) => dsin(x + PI / 2);
  function atanCore(x) { // |x| <= 1: argument halving twice, then series
    for (let i = 0; i < 2; i++) x = x / (1 + Math.sqrt(1 + x * x));
    const x2 = x * x;
    let s = 0, term = x;
    for (let n = 0; n < 12; n++) { s += term / (2 * n + 1); term *= -x2; }
    return s * 4;
  }
  function datan2(y, x) {
    if (x === 0 && y === 0) return 0;
    const ax = Math.abs(x), ay = Math.abs(y);
    let a = ay <= ax ? atanCore(ay / ax) : PI / 2 - atanCore(ax / ay);
    if (x < 0) a = PI - a;
    return y < 0 ? -a : a;
  }
  TD.dsin = dsin; TD.dcos = dcos; TD.datan2 = datan2;

  // --- seeded RNG (mulberry32) — the only randomness the sim may use ---
  TD.rng = function (seed) {
    let s = seed >>> 0;
    const next = () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return {
      next,
      range: (a, b) => a + (b - a) * next(),
      int: (a, b) => a + Math.floor(next() * (b - a + 1)),
      pick: (arr) => arr[Math.floor(next() * arr.length)],
      get state() { return s; }, set state(v) { s = v >>> 0; },
    };
  };

  // FNV-1a over numbers, for desync checks.
  TD.hasher = function () {
    let h = 0x811c9dc5;
    const buf = new DataView(new ArrayBuffer(8));
    return {
      num(v) { buf.setFloat64(0, v); for (let i = 0; i < 8; i++) { h ^= buf.getUint8(i); h = Math.imul(h, 16777619) >>> 0; } return this; },
      int(v) { h ^= v & 0xff; h = Math.imul(h, 16777619) >>> 0; h ^= (v >>> 8) & 0xff; h = Math.imul(h, 16777619) >>> 0; return this; },
      get value() { return h >>> 0; },
    };
  };

  // Settings shared by the UI (not the sim).
  const SKEY = 'td.settings.v1';
  const defaults = { music: 0.7, sfx: 0.9, shake: true, aimGuide: true };
  let saved = {};
  try { saved = JSON.parse(root.localStorage && root.localStorage.getItem(SKEY)) || {}; } catch (e) { saved = {}; }
  TD.settings = Object.assign({}, defaults, saved);
  TD.saveSettings = function () { try { root.localStorage.setItem(SKEY, JSON.stringify(TD.settings)); } catch (e) { /* memory only */ } };
})(typeof window !== 'undefined' ? window : globalThis);
