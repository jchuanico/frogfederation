/* One Piece Frog Style — core constants, math and collision helpers.
 * World units are metres and seconds; y points up, the deck is y = 0. */
'use strict';
window.OP = window.OP || {};
(function (OP) {
  OP.FPS = 60;
  OP.DT = 1 / 60;
  OP.G = 9.81;              // Earth gravity, m/s²
  OP.AIR_RHO = 1.225;       // sea-level air density, kg/m³
  OP.REF_MASS = 70;         // knockback values in move data are tuned for a 70 kg body
  OP.W = 1280;              // logical canvas size
  OP.H = 720;
  OP.STAGE_HALF = 8;        // walls at x = ±8 m
  OP.MAX_SEP = 6.6;         // point characters can't drift further apart than the screen

  const clamp = OP.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  OP.lerp = (a, b, t) => a + (b - a) * t;
  OP.approach = (v, t, d) => (v < t ? Math.min(v + d, t) : Math.max(v - d, t));
  OP.rand = (a, b) => a + Math.random() * (b - a);
  OP.pick = (arr) => arr[(Math.random() * arr.length) | 0];
  OP.rad = (d) => (d * Math.PI) / 180;
  OP.ease = {
    outCubic: (t) => 1 - Math.pow(1 - t, 3),
    inCubic: (t) => t * t * t,
    inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
    outBack: (t) => { const c = 1.70158, d = t - 1; return 1 + (c + 1) * d * d * d + c * d * d; },
    outElastic: (t) => t === 0 || t === 1 ? t : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI / 3)) + 1,
  };

  // Limb direction for an angle in degrees: 0 = straight down, 90 = forward, 180 = up.
  OP.limbDir = (deg) => { const r = (deg * Math.PI) / 180; return [Math.sin(r), -Math.cos(r)]; };
  // Torso/head direction: 0 = straight up, positive leans forward.
  OP.upDir = (deg) => { const r = (deg * Math.PI) / 180; return [Math.sin(r), Math.cos(r)]; };
  // Inverse of limbDir.
  OP.limbAngle = (dx, dy) => (Math.atan2(dx, -dy) * 180) / Math.PI;

  // Closest points between segments p1-q1 and p2-q2 (Ericson, RTCD 5.1.9).
  OP.segSeg = function (p1x, p1y, q1x, q1y, p2x, p2y, q2x, q2y) {
    const d1x = q1x - p1x, d1y = q1y - p1y, d2x = q2x - p2x, d2y = q2y - p2y;
    const rx = p1x - p2x, ry = p1y - p2y;
    const a = d1x * d1x + d1y * d1y, e = d2x * d2x + d2y * d2y, f = d2x * rx + d2y * ry;
    const EPS = 1e-9;
    let s, t;
    if (a <= EPS && e <= EPS) { s = t = 0; }
    else if (a <= EPS) { s = 0; t = clamp(f / e, 0, 1); }
    else {
      const c = d1x * rx + d1y * ry;
      if (e <= EPS) { t = 0; s = clamp(-c / a, 0, 1); }
      else {
        const b = d1x * d2x + d1y * d2y, den = a * e - b * b;
        s = den !== 0 ? clamp((b * f - c * e) / den, 0, 1) : 0;
        t = (b * s + f) / e;
        if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); }
        else if (t > 1) { t = 1; s = clamp((b - c) / a, 0, 1); }
      }
    }
    const cx1 = p1x + d1x * s, cy1 = p1y + d1y * s, cx2 = p2x + d2x * t, cy2 = p2y + d2y * t;
    const dx = cx1 - cx2, dy = cy1 - cy2;
    return { d2: dx * dx + dy * dy, x: (cx1 + cx2) / 2, y: (cy1 + cy2) / 2 };
  };

  // Capsule = { ax, ay, bx, by, r } in world metres. Returns the contact point or null.
  OP.capsHit = function (A, B) {
    const s = OP.segSeg(A.ax, A.ay, A.bx, A.by, B.ax, B.ay, B.bx, B.by);
    const r = A.r + B.r;
    return s.d2 <= r * r ? s : null;
  };

  OP.cap = (ax, ay, bx, by, r, tag) => ({ ax, ay, bx, by, r, tag });

  // Tiny persistent settings store; storage can be unavailable (private mode, blocked cookies).
  OP.store = {
    get(k, d) { try { const v = localStorage.getItem('opfs.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('opfs.' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
  };

  OP.settings = Object.assign({
    music: 0.55,
    sfx: 0.85,
    voice: true,          // spoken move names / announcer via the browser's speech engine
    cutins: 'all',        // 'all' | 'hypers' | 'off'
    hitboxes: false,
    difficulty: 1,        // 0 easy, 1 normal, 2 hard
    vibrate: true,
  }, OP.store.get('settings', {}));
  OP.saveSettings = () => OP.store.set('settings', OP.settings);
})(window.OP);
