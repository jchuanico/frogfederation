/* One Piece Frog Style — skeleton (FK + 2-bone IK) and cel-shaded character art.
 * Everything is drawn with canvas paths in world metres (y up), so the camera can
 * zoom right into a face during special-move cut-ins without losing detail. */
'use strict';
(function (OP) {
  const { limbDir, upDir, limbAngle, clamp, rad } = OP;
  const OUT = '#1b1216';

  // Body proportions as fractions of total height (slightly anime: bigger head).
  // Legs always use the default fractions (the IK pose cache depends on them); characters can
  // override head, torso and arm proportions — e.g. chibi Chopper's big head and short arms.
  function dims(def) {
    const H = def.height, p = def.props || {};
    return { H, thigh: 0.245 * H, shin: 0.235 * H, torso: (p.torso ?? 0.285) * H, neck: 0.03 * H, headR: (p.headR ?? 0.088) * H, ua: (p.ua ?? 0.165) * H, fa: (p.fa ?? 0.152) * H, foot: (p.foot ?? 0.075) * H };
  }

  // ---------- pose resolution ----------
  const STANCE = { lean: 8, head: -4, aF1: 30, aF2: 135, aB1: 10, aB2: 115, fF: [0.15, 0], fB: [-0.13, 0], hipH: 0.44, hx: 0 };

  function ik2(hx, hy, tx, ty, l1, l2) {
    let dx = tx - hx, dy = ty - hy; let d = Math.hypot(dx, dy);
    const maxD = l1 + l2 - 1e-4, minD = Math.abs(l1 - l2) + 1e-4;
    if (d > maxD) { dx *= maxD / d; dy *= maxD / d; d = maxD; }
    if (d < minD) d = minD;
    const base = limbAngle(dx, dy);
    const a = (Math.acos(clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1)) * 180) / Math.PI;
    const t = base + a; // knee bends forward
    const k = limbDir(t);
    const kx = hx + k[0] * l1, ky = hy + k[1] * l1;
    return [t, limbAngle(hx + dx - kx, hy + dy - ky)];
  }

  // Turn a (possibly partial, possibly IK) pose into a full FK angle set, layered on a base
  // pose (the character's stance). Everything is proportional to height, so results are
  // character-size independent and cached per (base, pose) pair.
  const caches = new WeakMap();
  const PROP = { thigh: 0.245, shin: 0.235 };
  function solve(p, base) {
    base = base || STANCE;
    let c = caches.get(base); if (!c) { c = new WeakMap(); caches.set(base, c); }
    let out = c.get(p); if (out) return out;
    const q = Object.assign({}, base, p);
    out = Object.assign({}, q);
    for (const side of ['F', 'B']) {
      const a1 = 'l' + side + '1', a2 = 'l' + side + '2', ft = 'f' + side;
      if (p[a1] != null) { out[a1] = p[a1]; out[a2] = p[a2]; }
      else if (q[ft]) { const r = ik2(q.hx, q.hipH, q[ft][0], q[ft][1], PROP.thigh, PROP.shin); out[a1] = r[0]; out[a2] = r[1]; }
    }
    delete out.fF; delete out.fB;
    c.set(p, out);
    return out;
  }

  const ANG = ['lean', 'head', 'aF1', 'aF2', 'aB1', 'aB2', 'lF1', 'lF2', 'lB1', 'lB2', 'hipH', 'hx', 'swF', 'swB', 'staff'];
  function mix(a, b, t) {
    const o = Object.assign({}, t < 0.5 ? a : b);
    for (const k of ANG) {
      const va = a[k], vb = b[k];
      if (va != null && vb != null) o[k] = va + (vb - va) * t;
    }
    return o;
  }

  // Sample a keyframe track [{f, p, ease?}] at frame `t` on top of `base`.
  function sample(keys, t, base) {
    const S = (p) => solve(p, base);
    if (t <= keys[0].f) return S(keys[0].p);
    for (let i = 1; i < keys.length; i++) {
      if (t <= keys[i].f) {
        const a = keys[i - 1], b = keys[i];
        const k = (t - a.f) / Math.max(1, b.f - a.f);
        return mix(S(a.p), S(b.p), b.ease ? OP.ease[b.ease](k) : k);
      }
    }
    return S(keys[keys.length - 1].p);
  }

  // Forward kinematics → joint positions in local space (facing +x, origin on the floor under the hip).
  function joints(def, P, st) {
    const D = dims(def), H = D.H;
    const ext = st || {};
    const hip = [P.hx * H, P.hipH * H];
    const u = upDir(P.lean);
    const neck = [hip[0] + u[0] * D.torso, hip[1] + u[1] * D.torso];
    const sh = [hip[0] + u[0] * D.torso * 0.9, hip[1] + u[1] * D.torso * 0.9];
    const hd = P.lean + P.head;
    const hu = upDir(hd);
    const nl = D.neck + D.headR * 0.9 + (ext.nk || 0); // Luffy's neck can stretch (Gomu Gomu no Bell)
    const head = [neck[0] + hu[0] * nl, neck[1] + hu[1] * nl];
    const arm = (a1, a2, e) => {
      const d1 = limbDir(a1), d2 = limbDir(a2);
      const el = [sh[0] + d1[0] * D.ua, sh[1] + d1[1] * D.ua];
      const L = D.fa + (e || 0);
      return [el, [el[0] + d2[0] * L, el[1] + d2[1] * L]];
    };
    const leg = (a1, a2, e) => {
      const d1 = limbDir(a1), d2 = limbDir(a2);
      const kn = [hip[0] + d1[0] * D.thigh, hip[1] + d1[1] * D.thigh];
      const L = D.shin + (e || 0);
      return [kn, [kn[0] + d2[0] * L, kn[1] + d2[1] * L]];
    };
    const [elF, haF] = arm(P.aF1, P.aF2, ext.aF);
    const [elB, haB] = arm(P.aB1, P.aB2, ext.aB);
    const [knF, ftF] = leg(P.lF1, P.lF2, ext.lF);
    const [knB, ftB] = leg(P.lB1, P.lB2, ext.lB);
    return { D, hip, neck, sh, head, hd, u, elF, haF, elB, haB, knF, ftF, knB, ftB, P, bulk: def.bulk || 1 };
  }

  // ---------- drawing helpers ----------
  function path(ctx, pts) { ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); }
  function stroke(ctx, pts, w, col) { path(ctx, pts); ctx.lineWidth = w; ctx.strokeStyle = col; ctx.stroke(); }
  function circle(ctx, x, y, r, fill, ol, olw) {
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    if (ol) { ctx.lineWidth = olw; ctx.strokeStyle = ol; ctx.stroke(); }
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  }
  function ell(ctx, x, y, rx, ry, rot, fill, ol, olw) {
    ctx.beginPath(); ctx.ellipse(x, y, Math.max(rx, 1e-4), Math.max(ry, 1e-4), rot || 0, 0, Math.PI * 2);
    if (ol) { ctx.lineWidth = olw; ctx.strokeStyle = ol; ctx.stroke(); }
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  }
  function poly(ctx, pts, fill, ol, olw) {
    path(ctx, pts); ctx.closePath();
    if (ol) { ctx.lineWidth = olw; ctx.strokeStyle = ol; ctx.stroke(); }
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  }
  const add = (a, b, s = 1) => [a[0] + b[0] * s, a[1] + b[1] * s];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
  const len = (a) => Math.hypot(a[0], a[1]);
  const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; };
  const perp = (a) => [a[1], -a[0]]; // rotate -90°: "forward" for an upward axis

  // A limb chain with per-segment colours, outlined once so joints don't show seams.
  function limb(ctx, pts, widths, cols, ol) {
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (let i = 0; i < pts.length - 1; i++) stroke(ctx, [pts[i], pts[i + 1]], widths[i] + ol * 2, OUT);
    for (let i = 0; i < pts.length - 1; i++) stroke(ctx, [pts[i], pts[i + 1]], widths[i], cols[i]);
  }

  // ---------- character styles ----------
  // Each style draws the parts that make a character recognisable.
  const STYLE = {};

  STYLE.luffy = {
    arm: (pal) => [pal.skin, pal.skin], armW: [0.045, 0.04],
    leg: (pal) => [pal.shorts, pal.skin], legW: [0.068, 0.047],
    shoe: (pal) => pal.sandal,
    torso(ctx, J, pal, ol) {
      const { hip, neck, u, D } = J, H = D.H, n = perp(u);
      const shape = torsoShape(J, 0.09, 0.115);
      poly(ctx, shape, pal.vest, OUT, ol * 2);
      // open cardigan: bare chest in front
      const open = [add(neck, n, 0.005 * H), add(neck, n, 0.045 * H), add(add(hip, u, D.torso * 0.62), n, 0.09 * H),
        add(add(hip, u, D.torso * 0.22), n, 0.078 * H), add(add(hip, u, D.torso * 0.22), n, 0.02 * H)];
      poly(ctx, open, pal.skin);
      // X scar on the chest (post time-skip)
      const c = add(add(hip, u, D.torso * 0.62), n, 0.06 * H);
      ctx.lineWidth = ol * 0.7; ctx.strokeStyle = '#b5654f'; ctx.lineCap = 'round';
      stroke(ctx, [add(add(c, u, 0.03 * H), n, -0.02 * H), add(add(c, u, -0.03 * H), n, 0.02 * H)], ol * 0.7, '#b5654f');
      stroke(ctx, [add(add(c, u, -0.03 * H), n, -0.02 * H), add(add(c, u, 0.03 * H), n, 0.02 * H)], ol * 0.7, '#b5654f');
      // yellow sash
      poly(ctx, [add(hip, n, -0.095 * H), add(hip, n, 0.09 * H), add(add(hip, u, D.torso * 0.16), n, 0.088 * H), add(add(hip, u, D.torso * 0.16), n, -0.1 * H)], pal.sash, OUT, ol);
      ell(ctx, hip[0], hip[1] - 0.01 * H, 0.1 * H, 0.07 * H, 0, pal.shorts);
    },
  };

  STYLE.zoro = {
    arm: (pal) => [pal.skin, pal.skin], armW: [0.05, 0.043],
    leg: (pal) => [pal.pants, pal.pants], legW: [0.072, 0.058],
    shoe: (pal) => pal.boots,
    torso(ctx, J, pal, ol, f) {
      const { hip, u, D } = J, H = D.H, n = perp(u);
      poly(ctx, torsoShape(J, 0.095, 0.125), pal.shirt, OUT, ol * 2);
      // open collar
      poly(ctx, [add(J.neck, n, -0.01 * H), add(J.neck, n, 0.05 * H), add(add(hip, u, D.torso * 0.72), n, 0.07 * H)], pal.skin);
      // haramaki
      poly(ctx, [add(hip, n, -0.1 * H), add(hip, n, 0.095 * H), add(add(hip, u, D.torso * 0.36), n, 0.1 * H), add(add(hip, u, D.torso * 0.36), n, -0.1 * H)], pal.haramaki, OUT, ol);
      ctx.lineWidth = ol * 0.5; ctx.strokeStyle = 'rgba(0,0,0,.25)';
      for (let i = 1; i < 4; i++) { const p = add(hip, u, D.torso * 0.09 * i); stroke(ctx, [add(p, n, -0.09 * H), add(p, n, 0.09 * H)], ol * 0.4, 'rgba(0,0,0,.25)'); }
      ell(ctx, hip[0], hip[1] - 0.01 * H, 0.1 * H, 0.07 * H, 0, pal.pants);
      if (!(f && f.flags.swordsOut)) sheathed(ctx, J, pal, ol);
    },
  };

  STYLE.sanji = {
    arm: (pal) => [pal.suit, pal.suit], armW: [0.046, 0.042], hand: (pal) => pal.suit, cuff: true,
    leg: (pal) => [pal.suit, pal.suit], legW: [0.066, 0.052],
    shoe: (pal) => pal.shoe,
    torso(ctx, J, pal, ol) {
      const { hip, u, D } = J, H = D.H, n = perp(u);
      // jacket tail behind the hips
      poly(ctx, [add(hip, n, -0.1 * H), add(add(hip, u, -0.13 * H), n, -0.11 * H), add(add(hip, u, -0.12 * H), n, 0.02 * H), add(hip, n, 0.06 * H)], pal.suit, OUT, ol * 2);
      poly(ctx, torsoShape(J, 0.088, 0.115), pal.suit, OUT, ol * 2);
      // shirt + tie
      const top = add(J.neck, n, 0.02 * H), mid = add(add(hip, u, D.torso * 0.45), n, 0.085 * H);
      poly(ctx, [add(top, n, -0.02 * H), add(top, n, 0.03 * H), mid, add(mid, n, -0.03 * H)], pal.shirt);
      poly(ctx, [add(top, n, 0.0), add(top, n, 0.018 * H), add(mid, n, -0.005 * H), add(add(mid, u, -0.02 * H), n, -0.012 * H)], pal.tie);
      ell(ctx, hip[0], hip[1] - 0.01 * H, 0.095 * H, 0.065 * H, 0, pal.suit);
    },
  };

  STYLE.nami = {
    arm: (pal) => [pal.skin, pal.skin], armW: [0.036, 0.032],
    leg: (pal) => [pal.pants, pal.skin], legW: [0.058, 0.04],
    shoe: (pal) => pal.sandal,
    torso(ctx, J, pal, ol) {
      const { hip, u, D } = J, H = D.H, n = perp(u);
      const shape = torsoShape(J, 0.08, 0.1);
      poly(ctx, shape, pal.skin, OUT, ol * 2);
      // striped top, clipped to the torso
      ctx.save(); path(ctx, shape); ctx.closePath(); ctx.clip();
      const t0 = add(hip, u, D.torso * 0.33);
      poly(ctx, [add(t0, n, -0.2 * H), add(t0, n, 0.2 * H), add(add(J.neck, u, 0.02 * H), n, 0.2 * H), add(add(J.neck, u, 0.02 * H), n, -0.2 * H)], pal.top);
      for (let i = 0; i < 5; i++) {
        const p = add(t0, u, D.torso * (0.08 + i * 0.13));
        stroke(ctx, [add(p, n, -0.2 * H), add(p, n, 0.2 * H)], 0.018 * H, pal.stripe);
      }
      ctx.restore();
      // tattoo on the shoulder (pinwheel + tangerine)
      const s = add(J.sh, u, -0.02 * H);
      circle(ctx, s[0], s[1], 0.012 * H, pal.tattoo);
      // belt + jeans hips
      poly(ctx, [add(hip, n, -0.09 * H), add(hip, n, 0.085 * H), add(add(hip, u, D.torso * 0.12), n, 0.085 * H), add(add(hip, u, D.torso * 0.12), n, -0.09 * H)], pal.pants, OUT, ol);
      stroke(ctx, [add(add(hip, u, D.torso * 0.1), n, -0.09 * H), add(add(hip, u, D.torso * 0.1), n, 0.085 * H)], 0.012 * H, '#6b4a2b');
    },
  };

  STYLE.usopp = {
    arm: (pal) => [pal.skin, pal.skin], armW: [0.042, 0.038],
    leg: (pal) => [pal.overalls, pal.overalls], legW: [0.064, 0.052],
    shoe: (pal) => pal.boots,
    torso(ctx, J, pal, ol) {
      const { hip, u, D } = J, H = D.H, n = perp(u);
      poly(ctx, torsoShape(J, 0.085, 0.1), pal.skin, OUT, ol * 2);
      // overall bib + straps
      const top = add(hip, u, D.torso * 0.62);
      poly(ctx, [add(hip, n, -0.09 * H), add(hip, n, 0.088 * H), add(top, n, 0.085 * H), add(top, n, -0.03 * H)], pal.overalls, OUT, ol);
      stroke(ctx, [add(top, n, 0.075 * H), add(J.neck, n, -0.01 * H)], 0.02 * H, pal.overalls);
      stroke(ctx, [add(top, n, -0.02 * H), add(J.neck, n, -0.05 * H)], 0.02 * H, shade(pal.overalls, -0.2));
      circle(ctx, add(top, n, 0.07 * H)[0], add(top, n, 0.07 * H)[1], 0.008 * H, '#d6b24a');
      // belt with a pouch of ammo
      stroke(ctx, [add(add(hip, u, D.torso * 0.12), n, -0.09 * H), add(add(hip, u, D.torso * 0.12), n, 0.088 * H)], 0.02 * H, '#4a2e18');
      const pch = add(add(hip, u, D.torso * 0.05), n, -0.08 * H);
      poly(ctx, [add(pch, n, -0.03 * H), add(pch, n, 0.02 * H), add(add(pch, n, 0.02 * H), u, -0.06 * H), add(add(pch, n, -0.03 * H), u, -0.06 * H)], '#8a5a2b', OUT, ol);
      ell(ctx, hip[0], hip[1] - 0.01 * H, 0.095 * H, 0.065 * H, 0, pal.overalls);
    },
  };

  STYLE.chopper = {
    arm: (pal) => [pal.fur, pal.fur], armW: [0.06, 0.055],
    leg: (pal) => [pal.shorts, pal.fur], legW: [0.075, 0.062],
    shoe: (pal) => pal.skin,
    torso(ctx, J, pal, ol, f) {
      const { hip, u, D } = J, H = D.H * J.bulk, n = perp(u), form = f && f.def.form;
      const shape = torsoShape(J, 0.09, 0.11);
      if (form === 'monster') { // thick shaggy mane over the shoulders and back
        const c = add(hip, u, D.torso * 0.72), tufts = [];
        for (let i = 0; i < 13; i++) {
          const a = 1.0 + (i / 12) * 3.2; // radians in body space: from the chest, over the top, down the back
          const dir = [Math.cos(a), Math.sin(a)];
          tufts.push([add(c, dir, 0.11 * H), dir, (0.1 + (i % 3) * 0.025) * H]);
        }
        for (const pass of [0, 1]) for (const [p0, d, L] of tufts) {
          const n2 = perp(d), tip = add(p0, d, L);
          poly(ctx, [add(p0, n2, 0.05 * H), tip, add(p0, n2, -0.05 * H)], pass ? shade(pal.fur, -0.22) : null, pass ? null : OUT, ol * 2);
        }
      }
      poly(ctx, shape, pal.fur, OUT, ol * 2);
      const belly = add(add(hip, u, D.torso * 0.45), n, 0.03 * H);
      ell(ctx, belly[0], belly[1], 0.06 * H, D.torso * 0.32, 0, pal.furLight);
      poly(ctx, [add(hip, n, -0.1 * H), add(hip, n, 0.095 * H), add(add(hip, u, D.torso * 0.16), n, 0.095 * H), add(add(hip, u, D.torso * 0.16), n, -0.1 * H)], pal.shorts, OUT, ol);
      ell(ctx, hip[0], hip[1] - 0.01 * H, 0.1 * H, 0.07 * H, 0, pal.shorts);
    },
  };

  // Jagged fur jutting out along a limb (Monster Point).
  function furTufts(ctx, a, b, w, col, ol) {
    const d = norm(sub(b, a)), n = perp(d), L = len(sub(b, a)), cnt = Math.max(2, Math.round(L / (w * 0.9)));
    for (const pass of [0, 1]) for (let i = 0; i < cnt; i++) {
      for (const side of [1, -1]) {
        const p0 = add(a, d, L * (i + 0.5) / cnt), base = add(p0, n, side * w * 0.42);
        const tip = add(add(base, n, side * w * 0.45), d, w * 0.35);
        poly(ctx, [add(base, d, -w * 0.28), tip, add(base, d, w * 0.28)], pass ? col : null, pass ? null : OUT, ol * 2);
      }
    }
  }

  function torsoShape(J, wh, ws) {
    const { hip, neck, u, D } = J, H = D.H * J.bulk, n = perp(u);
    const chest = add(hip, u, D.torso * 0.62);
    const pts = [];
    const push = (p) => pts.push(p);
    push(add(hip, n, -wh * H));
    push(add(hip, n, wh * H * 0.95));
    push(add(add(hip, u, D.torso * 0.35), n, wh * H));
    push(add(chest, n, ws * H));
    push(add(add(chest, u, D.torso * 0.22), n, ws * H * 0.75));
    push(add(neck, n, 0.045 * H));
    push(add(neck, n, -0.05 * H));
    push(add(add(chest, u, D.torso * 0.18), n, -ws * H * 0.95));
    push(add(chest, n, -ws * H * 0.9));
    push(add(add(hip, u, D.torso * 0.3), n, -wh * H * 1.05));
    return pts;
  }

  // ---------- weapons ----------
  const KATANA = { F: { hilt: '#b3262b', guard: '#d6b24a' }, B: { hilt: '#1c1c1c', guard: '#7a6a3a' }, M: { hilt: '#f2f2ee', guard: '#d6b24a' } };
  function katana(ctx, x, y, deg, kind, ol, scale = 1, glow = 0) {
    const d = limbDir(deg), c = KATANA[kind];
    const tip = [x + d[0] * 0.78 * scale, y + d[1] * 0.78 * scale];
    const back = [x - d[0] * 0.1, y - d[1] * 0.1];
    const bend = perp(d);
    const mid = [(x + tip[0]) / 2 + bend[0] * 0.03, (y + tip[1]) / 2 + bend[1] * 0.03];
    ctx.lineCap = 'round';
    if (glow) {
      ctx.save(); ctx.globalAlpha = 0.35 * glow; ctx.lineWidth = 0.09; ctx.strokeStyle = '#bfe8ff';
      ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(mid[0], mid[1], tip[0], tip[1]); ctx.stroke(); ctx.restore();
    }
    ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(mid[0], mid[1], tip[0], tip[1]);
    ctx.lineWidth = 0.03 + ol * 2; ctx.strokeStyle = OUT; ctx.stroke();
    ctx.lineWidth = 0.028; ctx.strokeStyle = '#e8eef4'; ctx.stroke();
    ctx.lineWidth = 0.008; ctx.strokeStyle = '#9fb1c2'; ctx.stroke();
    stroke(ctx, [back, [x + d[0] * 0.08, y + d[1] * 0.08]], 0.035 + ol * 2, OUT);
    stroke(ctx, [back, [x + d[0] * 0.08, y + d[1] * 0.08]], 0.035, c.hilt);
    const g = [x + d[0] * 0.085, y + d[1] * 0.085];
    ell(ctx, g[0], g[1], 0.022, 0.05, -rad(deg), c.guard, OUT, ol);
    return tip;
  }
  function sheathed(ctx, J, pal, ol) {
    const { hip, D } = J, H = D.H;
    const at = [hip[0] + 0.04 * H, hip[1] + 0.03 * H];
    const cols = [['#f2f2ee', '#222'], ['#b3262b', '#301818'], ['#1c1c1c', '#101010']];
    cols.forEach((c, i) => {
      const deg = -118 + i * 7;
      const d = limbDir(deg);
      const a = [at[0] - d[0] * 0.18, at[1] - d[1] * 0.18 - i * 0.012];
      const b = [at[0] + d[0] * 0.72, at[1] + d[1] * 0.72 - i * 0.012];
      stroke(ctx, [a, b], 0.034 + ol * 2, OUT); stroke(ctx, [a, b], 0.034, c[1]);
      const h = [a[0] + d[0] * 0.02, a[1] + d[1] * 0.02], h2 = [a[0] - d[0] * 0.16, a[1] - d[1] * 0.16];
      stroke(ctx, [h, h2], 0.03 + ol * 2, OUT); stroke(ctx, [h, h2], 0.03, c[0]);
    });
  }
  function staff(ctx, J, pal, ol, deg, hand = 'F', kind = 'climatact') {
    const d = limbDir(deg), h = J['ha' + hand];
    const a = [h[0] - d[0] * 0.5, h[1] - d[1] * 0.5], b = [h[0] + d[0] * 0.6, h[1] + d[1] * 0.6];
    ctx.lineCap = 'butt';
    stroke(ctx, [a, b], 0.03 + ol * 2, OUT); stroke(ctx, [a, b], 0.03, pal.staff);
    if (kind === 'kabuto') { // Usopp's Kabuto: a staff with a slingshot fork and rubber band on top
      const n = perp(d), f1 = add(add(b, n, 0.09), d, 0.16), f2 = add(add(b, n, -0.09), d, 0.16);
      ctx.lineCap = 'round';
      stroke(ctx, [b, f1], 0.028 + ol * 2, OUT); stroke(ctx, [b, f2], 0.028 + ol * 2, OUT);
      stroke(ctx, [b, f1], 0.028, pal.staff); stroke(ctx, [b, f2], 0.028, pal.staff);
      stroke(ctx, [f1, add(b, d, 0.05), f2], 0.008, '#d6b24a');
      stroke(ctx, [add(h, d, -0.12), add(h, d, 0.12)], 0.042, '#d9c89a');
      return;
    }
    for (const t of [-0.3, 0.05, 0.38]) { const p = [h[0] + d[0] * t, h[1] + d[1] * t]; stroke(ctx, [add(p, d, -0.02), add(p, d, 0.02)], 0.04, '#e9e4d0'); }
    ctx.lineCap = 'round';
    circle(ctx, b[0], b[1], 0.025, '#e9e4d0', OUT, ol);
    circle(ctx, a[0], a[1], 0.025, '#e9e4d0', OUT, ol);
  }

  // ---------- full fighter ----------
  const FLASH = new Proxy({}, { get: () => '#ffffff' });

  function drawFighter(ctx, f, J, opt = {}) {
    const def = f.def, st = STYLE[def.id], H = def.height;
    let pal = opt.flash ? FLASH : f.pal;
    if (def.form === 'monster' && !opt.flash) pal = Object.assign({}, pal, { shorts: shade(pal.fur, -0.4) }); // torn shorts buried in fur
    const ol = 0.012;
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.scale(f.facing, 1);
    const P = J.P;
    J.t = f.t || 0;

    const armCols = st.arm(pal), legCols = st.leg(pal);
    const bulk = def.bulk || 1;
    const armW = st.armW.map((w) => w * H * 0.8 * bulk), legW = st.legW.map((w) => w * H * 0.72 * bulk);
    const fist = (f.fistScale || 1);
    const drawArm = (el, ha, side, dark) => {
      const cols = dark ? armCols.map((c) => shade(c, -0.18)) : armCols;
      // rubber arms get thinner as they stretch
      const e = f.stretch && f.stretch[side === 'F' ? 'aF' : 'aB'] || 0;
      const w2 = e > 0.2 ? armW[1] * clamp(1 - e * 0.06, 0.65, 1) : armW[1];
      limb(ctx, [J.sh, el, ha], [armW[0], w2], cols, ol);
      if (def.form === 'monster') { furTufts(ctx, J.sh, el, armW[0], cols[0], ol); furTufts(ctx, el, ha, w2, cols[1], ol); }
      if (st.cuff) { const d = norm(sub(ha, el)); stroke(ctx, [add(ha, d, -0.05), add(ha, d, -0.02)], armW[1] * 1.25, '#fafafa'); }
      const fs = (side === 'F' ? fist : 1) * 0.034 * H * Math.sqrt(bulk);
      circle(ctx, ha[0], ha[1], fs, dark ? shade(pal.skin, -0.12) : pal.skin, OUT, ol * 2);
      if (fs > 0.1) { // Gear Third giant fist knuckles
        ctx.lineWidth = ol * 2; ctx.strokeStyle = OUT;
        for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.arc(ha[0] + fs * 0.55, ha[1] + i * fs * 0.35, fs * 0.25, -1.2, 1.2); ctx.stroke(); }
      }
    };
    const drawLeg = (kn, ft, dark, shinAng) => {
      const cols = dark ? legCols.map((c) => shade(c, -0.18)) : legCols;
      limb(ctx, [J.hip, kn, ft], legW, cols, ol);
      if (def.form === 'monster') furTufts(ctx, kn, ft, legW[1], cols[1], ol);
      const fd = limbDir(shinAng + 90);
      const toe = add(ft, fd, J.D.foot);
      limb(ctx, [add(ft, fd, -0.015), toe], [legW[1] * 0.9], [dark ? shade(st.shoe(pal), -0.2) : st.shoe(pal)], ol);
      if (def.id === 'luffy') { // bare toes on sandals
        circle(ctx, toe[0], toe[1] + 0.012, 0.018, dark ? shade(pal.skin, -0.18) : pal.skin, OUT, ol);
      }
    };

    // afterimages
    if (opt.ghost) { ctx.globalAlpha *= opt.ghost; }

    // far side
    if (f.flags.swordsOut && f.flags.swordB) katana(ctx, J.haB[0], J.haB[1], P.swB ?? P.aB2 + 70, 'B', ol, 1, f.flags.bladeGlow);
    drawArm(J.elB, J.haB, 'B', true);
    drawLeg(J.knB, J.ftB, true, P.lB2);
    const staffHand = def.staffHand || 'F';
    if (def.weapon && P.staff != null && staffHand === 'B') staff(ctx, J, pal, ol, P.staff, 'B', def.weapon);
    st.torso(ctx, J, pal, ol, f);
    drawLeg(J.knF, J.ftF, false, P.lF2);
    if (f.stretch && f.stretch.nk > 0.05) limb(ctx, [J.neck, J.head], [armW[0] * 0.95], [pal.skin], ol); // stretched rubber neck
    // head
    ctx.save();
    ctx.translate(J.head[0], J.head[1]);
    ctx.rotate(-rad(J.hd));
    const r = J.D.headR;
    ctx.scale(r, r);
    drawHead(ctx, def, pal, f.expr, { blink: f.blink, ol: ol / r, flags: f.flags, t: f.t || 0, r });
    ctx.restore();
    // near side
    if (def.weapon && P.staff != null && staffHand === 'F') staff(ctx, J, pal, ol, P.staff, 'F', def.weapon);
    drawArm(J.elF, J.haF, 'F', false);
    if (f.flags.swordsOut && f.flags.swordF) katana(ctx, J.haF[0], J.haF[1], P.swF ?? P.aF2 + 70, 'F', ol, 1, f.flags.bladeGlow);
    if (def.id === 'zoro' && !f.flags.bandana) { // bandana tied round the upper arm
      const m = add(J.sh, norm(sub(J.elF, J.sh)), J.D.ua * 0.35);
      const d = norm(sub(J.elF, J.sh));
      stroke(ctx, [add(m, d, -0.02), add(m, d, 0.02)], armW[0] * 1.25, OUT);
      stroke(ctx, [add(m, d, -0.018), add(m, d, 0.018)], armW[0] * 1.15, pal.bandana);
    }
    ctx.restore();
  }

  // ---------- heads & faces (unit coordinates: head radius 1, y up, facing +x) ----------
  // 3/4 view: the near eye sits left of the face centre-line, the far eye near the cheek edge.
  // `expr`: neutral | determined | shout | grin | hurt | ko | grit | intense | heart | smug | puff | win
  const FACE = { nearEye: [0.12, -0.1], farEye: [0.66, -0.08], mouth: [0.4, -0.63], ear: [-0.56, -0.14] };

  function headPath(ctx) {
    ctx.beginPath();
    ctx.moveTo(-0.95, 0.15);
    ctx.bezierCurveTo(-0.95, 1.28, 0.98, 1.28, 0.98, 0.18);
    ctx.bezierCurveTo(1.0, -0.2, 0.92, -0.5, 0.74, -0.74);
    ctx.bezierCurveTo(0.62, -0.92, 0.5, -1.04, 0.36, -1.03);
    ctx.bezierCurveTo(0.08, -1.0, -0.3, -0.88, -0.56, -0.62);
    ctx.bezierCurveTo(-0.82, -0.38, -0.95, -0.1, -0.95, 0.15);
    ctx.closePath();
  }

  function drawHead(ctx, def, pal, expr, o = {}) {
    const ol = o.ol || 0.12, id = def.id, fl = o.flags || {};
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // hair behind the head
    if (id === 'chopper') { reindeerHead(ctx, def, pal, expr, o, ol); return; }
    if (id === 'luffy') blob(ctx, pal.hair, ol, [[-0.2, 1.05], [-1.0, 0.75], [-1.32, 0.35], [-1.02, 0.12], [-1.28, -0.2], [-0.9, -0.22], [-1.0, -0.55], [-0.6, -0.3], [-0.3, 0.2]]);
    if (id === 'usopp') { // big curly mop of hair behind the head
      ctx.fillStyle = pal.hair; ctx.strokeStyle = OUT; ctx.lineWidth = ol * 2;
      const curls = [[-0.2, 1.05, 0.42], [-0.7, 0.85, 0.42], [-1.05, 0.45, 0.4], [-1.15, 0.0, 0.38], [-1.0, -0.45, 0.36], [-0.65, -0.75, 0.32], [0.3, 1.0, 0.4]];
      for (const [x, y, r] of curls) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke(); }
      for (const [x, y, r] of curls) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
    }
    if (id === 'nami') blob(ctx, shade(pal.hair, -0.08), ol, [[0.2, 1.1], [-0.9, 0.9], [-1.25, 0.1], [-1.35, -1.2], [-1.0, -2.2], [-0.55, -1.6], [-0.35, -0.6], [0.2, 0.2]], true);
    if (id === 'sanji') blob(ctx, pal.hair, ol, [[-0.1, 1.1], [-1.0, 0.7], [-1.1, -0.1], [-0.8, -0.5], [-0.5, 0.1]], true);
    // skull + jaw
    headPath(ctx);
    ctx.lineWidth = ol * 2; ctx.strokeStyle = OUT; ctx.stroke(); ctx.fillStyle = pal.skin; ctx.fill();
    // cel shadow on the back of the head and under the jaw line
    ctx.save(); headPath(ctx); ctx.clip();
    ctx.fillStyle = 'rgba(140,50,40,0.14)';
    ctx.beginPath(); ctx.ellipse(-1.0, -0.2, 0.6, 1.4, 0.1, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(0.2, -1.25, 0.9, 0.35, -0.2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    // ear
    const [ex, ey] = FACE.ear;
    ell(ctx, ex, ey, 0.16, 0.24, 0.15, pal.skin, OUT, ol);
    ctx.lineWidth = ol * 0.7; ctx.strokeStyle = shade(pal.skin, -0.3); ctx.beginPath(); ctx.arc(ex + 0.02, ey, 0.09, 2.2, 4.2); ctx.stroke();
    if (id === 'zoro') for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(ex - 0.02 + i * 0.03, ey - 0.28 - i * 0.07, 0.07, 0, Math.PI * 2); ctx.lineWidth = ol * 0.9; ctx.strokeStyle = '#e8c547'; ctx.stroke(); }
    // blush
    if (expr === 'heart' || expr === 'grin' || expr === 'win' || expr === 'smug' && id === 'nami') {
      ell(ctx, 0.08, -0.42, 0.17, 0.07, 0, 'rgba(255,90,90,0.35)'); ell(ctx, 0.72, -0.4, 0.1, 0.06, 0, 'rgba(255,90,90,0.35)');
    }

    face(ctx, id, pal, expr, o, ol);

    // hair in front / headwear
    if (id === 'luffy') {
      blob(ctx, pal.hair, ol, [[-0.95, 0.2], [-0.9, 0.95], [0.1, 1.2], [0.95, 0.75], [0.95, 0.35], [0.78, 0.5], [0.72, 0.18], [0.55, 0.42], [0.4, 0.12], [0.3, 0.42], [0.1, 0.1], [-0.05, 0.4], [-0.3, 0.2], [-0.45, 0.45], [-0.7, 0.1]]);
      if (!fl.noHat) strawHat(ctx, pal, ol);
    } else if (id === 'zoro') {
      if (fl.bandana) {
        ctx.beginPath(); ctx.moveTo(-0.96, 0.1); ctx.bezierCurveTo(-1.0, 1.36, 1.0, 1.36, 1.0, 0.36);
        ctx.bezierCurveTo(0.6, 0.5, -0.2, 0.45, -0.96, 0.1); ctx.closePath();
        ctx.lineWidth = ol * 2; ctx.strokeStyle = OUT; ctx.stroke(); ctx.fillStyle = pal.bandana; ctx.fill();
        poly(ctx, [[-0.88, 0.22], [-1.6, 0.02], [-1.5, -0.3], [-0.84, 0.02]], pal.bandana, OUT, ol * 1.5);
        poly(ctx, [[-0.88, 0.18], [-1.4, -0.5], [-1.12, -0.6], [-0.78, 0.02]], pal.bandana, OUT, ol * 1.5);
        ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = ol; ctx.beginPath(); ctx.moveTo(-0.5, 0.95); ctx.quadraticCurveTo(0.2, 1.15, 0.7, 0.8); ctx.stroke();
      } else {
        ctx.beginPath(); ctx.moveTo(-0.94, 0.1); ctx.bezierCurveTo(-1.0, 1.3, 1.0, 1.3, 0.98, 0.42);
        for (let i = 0; i < 8; i++) { const x = 0.98 - i * 0.25, y = 0.44 + Math.sin(i * 1.9) * 0.04 + (i > 5 ? -0.12 * (i - 5) : 0); ctx.lineTo(x - 0.12, y + 0.09); ctx.lineTo(x - 0.25, y); }
        ctx.closePath(); ctx.lineWidth = ol * 2; ctx.strokeStyle = OUT; ctx.stroke(); ctx.fillStyle = pal.hair; ctx.fill();
        ctx.fillStyle = shade(pal.hair, 0.25); ctx.beginPath(); ctx.ellipse(0.05, 0.92, 0.35, 0.1, 0.1, 0, Math.PI * 2); ctx.fill();
      }
      if (fl.mouthSword) mouthKatana(ctx, ol);
    } else if (id === 'sanji') {
      // swept bangs covering the near eye, far eye with the curly brow stays visible
      ctx.beginPath(); ctx.moveTo(-0.96, 0.05); ctx.bezierCurveTo(-1.05, 1.35, 0.95, 1.42, 1.02, 0.42);
      ctx.bezierCurveTo(0.9, 0.3, 0.62, 0.36, 0.44, 0.3);
      ctx.bezierCurveTo(0.42, 0.0, 0.36, -0.25, 0.22, -0.42);
      ctx.bezierCurveTo(0.05, -0.2, -0.2, -0.05, -0.45, 0.02);
      ctx.bezierCurveTo(-0.7, 0.1, -0.85, 0.05, -0.96, 0.05); ctx.closePath();
      ctx.lineWidth = ol * 2; ctx.strokeStyle = OUT; ctx.stroke(); ctx.fillStyle = pal.hair; ctx.fill();
      ctx.strokeStyle = shade(pal.hair, -0.25); ctx.lineWidth = ol * 0.8;
      for (const k of [-0.2, 0.1, 0.35]) { ctx.beginPath(); ctx.moveTo(k, 1.0); ctx.quadraticCurveTo(k + 0.25, 0.5, k + 0.05, -0.05); ctx.stroke(); }
      if (!fl.noSmoke) { // cigarette
        const [mx, my] = FACE.mouth;
        stroke(ctx, [[mx + 0.08, my - 0.02], [mx + 0.62, my + 0.1]], 0.12 + ol * 2, OUT); stroke(ctx, [[mx + 0.08, my - 0.02], [mx + 0.62, my + 0.1]], 0.12, '#f4f1ea');
        stroke(ctx, [[mx + 0.08, my - 0.02], [mx + 0.2, my]], 0.12, '#d6a45a');
        circle(ctx, mx + 0.64, my + 0.1, 0.055, (o.t || 0) % 40 < 20 ? '#ff6a2a' : '#ffae42');
      }
    } else if (id === 'usopp') {
      // long nose — his signature
      const nose = () => { ctx.beginPath(); ctx.moveTo(0.5, -0.12); ctx.quadraticCurveTo(1.2, -0.2, 1.78, -0.28); ctx.arc(1.78, -0.33, 0.06, Math.PI / 2, -Math.PI / 2, true); ctx.quadraticCurveTo(1.2, -0.38, 0.55, -0.44); ctx.closePath(); };
      nose(); ctx.lineWidth = ol * 2; ctx.strokeStyle = OUT; ctx.stroke(); ctx.fillStyle = pal.skin; ctx.fill();
      // bandana band + goggles pushed up on the forehead
      ctx.beginPath(); ctx.moveTo(-0.96, 0.32); ctx.bezierCurveTo(-0.5, 0.62, 0.5, 0.62, 1.0, 0.36); ctx.lineTo(0.98, 0.58); ctx.bezierCurveTo(0.5, 0.86, -0.5, 0.86, -0.92, 0.56); ctx.closePath();
      ctx.lineWidth = ol * 1.5; ctx.stroke(); ctx.fillStyle = pal.band; ctx.fill();
      for (const [x, r] of [[0.12, 0.2], [0.64, 0.16]]) { circle(ctx, x, 0.66, r, '#5a5a62', OUT, ol * 1.5); circle(ctx, x, 0.66, r * 0.7, pal.goggles); circle(ctx, x - r * 0.25, 0.72, r * 0.18, 'rgba(255,255,255,0.7)'); }
      ctx.fillStyle = pal.hair;
      for (const [x, y, r] of [[-0.3, 1.02, 0.3], [0.2, 1.08, 0.3], [0.62, 0.95, 0.26]]) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.lineWidth = ol * 2; ctx.stroke(); ctx.fill(); }
    } else if (id === 'nami') {
      ctx.beginPath(); ctx.moveTo(-0.96, 0.05); ctx.bezierCurveTo(-1.05, 1.4, 1.05, 1.38, 1.02, 0.3);
      ctx.lineTo(0.86, 0.12); ctx.lineTo(0.76, 0.4); ctx.lineTo(0.56, 0.1); ctx.lineTo(0.42, 0.42); ctx.lineTo(0.22, 0.08); ctx.lineTo(0.08, 0.42);
      ctx.lineTo(-0.12, 0.12); ctx.bezierCurveTo(-0.3, 0.4, -0.7, 0.35, -0.96, 0.05); ctx.closePath();
      ctx.lineWidth = ol * 2; ctx.strokeStyle = OUT; ctx.stroke(); ctx.fillStyle = pal.hair; ctx.fill();
      ctx.fillStyle = shade(pal.hair, 0.3); ctx.beginPath(); ctx.ellipse(-0.05, 0.95, 0.4, 0.1, 0.15, 0, Math.PI * 2); ctx.fill();
    }
  }

  // Chopper: round reindeer face, blue nose, antlers and the pink top hat with the white cross.
  function reindeerHead(ctx, def, pal, expr, o, ol) {
    const form = def.form || 'brain', fur = pal.fur;
    const furPal = Object.assign({}, pal, { skin: fur }, form === 'monster' ? { eye: '#ff3030' } : null);
    const ant = form === 'monster' ? 1.4 : 1;
    // antlers behind the hat
    ctx.lineCap = 'round';
    for (const s of [-1, 1]) {
      const bx = s < 0 ? -0.55 : 0.45;
      const A = (x, y) => [bx + (x - bx) * ant, 0.75 + (y - 0.75) * ant];
      const pts = [A(bx, 0.75), A(bx + s * 0.35, 1.35), A(bx + s * 0.6, 1.9)];
      const tines = [[pts[1], A(bx + s * 0.75, 1.5)], [A(bx + s * 0.48, 1.62), A(bx + s * 0.25, 2.0)]];
      stroke(ctx, pts, 0.16 + ol * 2, OUT); for (const t of tines) stroke(ctx, t, 0.12 + ol * 2, OUT);
      stroke(ctx, pts, 0.16, pal.antler); for (const t of tines) stroke(ctx, t, 0.12, pal.antler);
    }
    if (form === 'monster') blob(ctx, shade(fur, -0.2), ol, [[-1.3, 0.6], [-1.6, 0.0], [-1.35, -0.7], [-0.6, -1.3], [0.3, -1.2], [0.9, -0.9], [0.2, 0.2]], true);
    // ears
    for (const [x, y, r] of [[-0.95, 0.35, 0.5], [0.85, 0.45, -0.3]]) { ctx.save(); ctx.translate(x, y); ctx.rotate(r); ell(ctx, 0, 0, 0.18, 0.38, 0, fur, OUT, ol * 1.5); ell(ctx, 0, 0, 0.08, 0.24, 0, pal.furLight); ctx.restore(); }
    // face
    ell(ctx, 0.05, -0.05, 1.02, 0.95, 0, fur, OUT, ol * 2);
    ell(ctx, 0.42, -0.5, 0.6, 0.42, 0, pal.furLight);
    face(ctx, 'chopper', furPal, form === 'monster' && expr !== 'hurt' && expr !== 'ko' ? 'grit' : expr, o, ol);
    if (form === 'monster') { // fangs
      const [mx, my] = FACE.mouth;
      for (const dx of [-0.13, 0.13]) poly(ctx, [[mx + dx - 0.05, my - 0.02], [mx + dx + 0.05, my - 0.02], [mx + dx, my - 0.24]], '#ffffff', OUT, ol);
    }
    // big blue nose
    circle(ctx, 0.92, -0.28, 0.2, pal.nose, OUT, ol * 1.5); circle(ctx, 0.86, -0.22, 0.06, 'rgba(255,255,255,0.7)');
    // pink top hat with the white cross
    ell(ctx, 0.0, 0.72, 1.12, 0.22, 0, pal.hat, OUT, ol * 2);
    ctx.beginPath(); ctx.moveTo(-0.62, 0.74); ctx.lineTo(-0.66, 1.78); ctx.quadraticCurveTo(0, 1.92, 0.66, 1.78); ctx.lineTo(0.62, 0.74); ctx.closePath();
    ctx.lineWidth = ol * 2; ctx.strokeStyle = OUT; ctx.stroke(); ctx.fillStyle = pal.hat; ctx.fill();
    ctx.fillStyle = shade(pal.hat, -0.15); ctx.fillRect(-0.64, 0.78, 1.28, 0.16);
    ctx.save(); ctx.translate(0.05, 1.3); ctx.fillStyle = pal.hatX;
    for (const a of [0.78, -0.78]) { ctx.save(); ctx.rotate(a); ctx.fillRect(-0.3, -0.07, 0.6, 0.14); ctx.restore(); }
    ctx.restore();
  }

  // Closed smooth blob through points (used for hair masses).
  function blob(ctx, col, ol, pts, smooth) {
    ctx.beginPath();
    if (smooth) {
      const n = pts.length;
      ctx.moveTo((pts[0][0] + pts[n - 1][0]) / 2, (pts[0][1] + pts[n - 1][1]) / 2);
      for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n]; ctx.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2); }
    } else { ctx.moveTo(pts[0][0], pts[0][1]); for (const p of pts) ctx.lineTo(p[0], p[1]); }
    ctx.closePath();
    ctx.lineWidth = ol * 2; ctx.strokeStyle = OUT; ctx.stroke(); ctx.fillStyle = col; ctx.fill();
  }

  // Wado Ichimonji clenched in the teeth: white hilt in the mouth, blade out to the side.
  function mouthKatana(ctx, ol) {
    const [mx, my] = FACE.mouth;
    ctx.save(); ctx.translate(mx - 0.1, my + 0.02); ctx.rotate(-0.12);
    stroke(ctx, [[0, 0], [0.75, 0]], 0.17 + ol * 2, OUT); stroke(ctx, [[0, 0], [0.75, 0]], 0.17, '#f2f2ee');
    ctx.lineWidth = ol * 0.6; ctx.strokeStyle = '#b9b3a2';
    for (let x = 0.08; x < 0.72; x += 0.12) { ctx.beginPath(); ctx.moveTo(x, -0.08); ctx.lineTo(x + 0.06, 0.08); ctx.stroke(); }
    ell(ctx, 0.8, 0, 0.06, 0.2, 0, '#d6b24a', OUT, ol);
    ctx.beginPath(); ctx.moveTo(0.86, 0.05); ctx.quadraticCurveTo(2.6, 0.12, 4.2, 0.28); ctx.lineTo(4.25, 0.2); ctx.quadraticCurveTo(2.6, -0.04, 0.86, -0.06); ctx.closePath();
    ctx.lineWidth = ol * 1.5; ctx.strokeStyle = OUT; ctx.stroke(); ctx.fillStyle = '#e8eef4'; ctx.fill();
    stroke(ctx, [[0.9, 0.0], [4.1, 0.2]], ol * 0.5, '#9fb1c2');
    ctx.restore();
  }

  function strawHat(ctx, pal, ol) {
    ctx.save(); ctx.translate(0.02, 0.05); ctx.rotate(0.1); // cocked slightly back
    ell(ctx, 0.05, 0.62, 1.62, 0.3, 0, pal.hat, OUT, ol * 2);
    ctx.strokeStyle = shade(pal.hat, -0.22); ctx.lineWidth = ol * 0.5;
    for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.ellipse(0.05, 0.62, 1.62 - i * 0.2, 0.3 - i * 0.04, 0, Math.PI * 0.05, Math.PI * 0.95); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(-0.92, 0.66); ctx.bezierCurveTo(-0.97, 1.7, 1.07, 1.7, 1.02, 0.66); ctx.closePath();
    ctx.lineWidth = ol * 2; ctx.strokeStyle = OUT; ctx.stroke(); ctx.fillStyle = pal.hat; ctx.fill();
    ctx.beginPath(); ctx.moveTo(-0.93, 0.66); ctx.lineTo(-0.91, 0.93); ctx.bezierCurveTo(-0.3, 1.04, 0.4, 1.04, 1.01, 0.93); ctx.lineTo(1.02, 0.66); ctx.bezierCurveTo(0.4, 0.75, -0.3, 0.75, -0.93, 0.66); ctx.closePath();
    ctx.fillStyle = pal.hatBand; ctx.fill(); ctx.lineWidth = ol; ctx.strokeStyle = OUT; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.28)'; ctx.beginPath(); ctx.ellipse(0.35, 1.28, 0.3, 0.12, -0.3, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function face(ctx, id, pal, expr, o, ol) {
    const blink = o.blink && (expr === 'neutral' || expr === 'determined' || expr === 'smug');
    const E = { // eye style, brow tilt (+ = angry), mouth
      neutral: ['open', 0.05, 'line'], determined: ['narrow', 0.35, 'firm'], shout: ['wide', 0.6, 'shout'],
      grin: ['happy', -0.15, 'grin'], hurt: ['squeeze', -0.4, 'hurt'], ko: ['x', 0, 'ko'], grit: ['narrow', 0.45, 'grit'],
      intense: ['shadow', 0.65, 'grit'], heart: ['heart', -0.25, 'grin'], smug: ['narrow', 0.1, 'smirk'], puff: ['wide', 0.5, 'puff'],
      win: ['happy', -0.15, 'grin'],
    }[expr] || ['open', 0, 'line'];
    let [eye, tilt, mouth] = E;
    if (blink) eye = 'blink';
    if (id === 'luffy' && expr === 'neutral') mouth = 'smile';
    if (id === 'zoro' && expr === 'neutral') { eye = 'narrow'; tilt = 0.3; }
    if (id === 'nami' && expr === 'smug') eye = 'wink';
    const eyeCol = pal.eye || '#231a1a';
    const big = id === 'chopper' ? 1.35 : 1;
    const eyes = id === 'sanji' ? [[FACE.farEye, 0.72, true]] : [[FACE.nearEye, 1 * big, false], [FACE.farEye, 0.72 * big, true]];
    for (const [p, w, far] of eyes) drawEye(ctx, p[0], p[1], w, eye, eyeCol, ol, id, far, pal.skin);
    // brows
    for (const [p, w] of eyes) {
      const by = p[1] + (eye === 'wide' ? 0.4 : 0.34);
      const hw = 0.17 * w;
      ctx.lineWidth = ol * (id === 'zoro' ? 2.1 : 1.4); ctx.strokeStyle = id === 'sanji' ? shade(pal.hair, -0.4) : id === 'nami' ? shade(pal.hair, -0.35) : OUT;
      ctx.beginPath(); ctx.moveTo(p[0] - hw, by + tilt * 0.06); ctx.lineTo(p[0] + hw, by - tilt * 0.1); ctx.stroke();
      if (id === 'sanji') { ctx.beginPath(); ctx.arc(p[0] + hw + 0.03, by - tilt * 0.1 + 0.05, 0.055, Math.PI, Math.PI * 2.7); ctx.stroke(); } // curly brow
    }
    if (id === 'luffy') { // the scar under his left eye
      ctx.lineWidth = ol * 0.8; ctx.strokeStyle = '#8a3b2e'; const [x, y] = FACE.nearEye;
      ctx.beginPath(); ctx.moveTo(x - 0.12, y - 0.3); ctx.lineTo(x + 0.1, y - 0.27); ctx.moveTo(x - 0.08, y - 0.24); ctx.lineTo(x - 0.05, y - 0.35); ctx.moveTo(x + 0.03, y - 0.23); ctx.lineTo(x + 0.06, y - 0.34); ctx.stroke();
    }
    // nose
    ctx.lineWidth = ol * 0.9; ctx.strokeStyle = shade(pal.skin, -0.38);
    if (id !== 'usopp' && id !== 'chopper') { ctx.beginPath(); ctx.moveTo(0.56, -0.2); ctx.lineTo(0.63, -0.37); ctx.lineTo(0.55, -0.4); ctx.stroke(); }
    drawMouth(ctx, mouth, ol, id, pal);
  }

  function drawEye(ctx, x, y, w, type, col, ol, id, isFar, skin) {
    const lash = id === 'nami';
    ctx.lineCap = 'round';
    switch (type) {
      case 'blink': case 'squeeze': {
        ctx.lineWidth = ol * 1.7; ctx.strokeStyle = OUT; ctx.beginPath();
        if (type === 'blink') { ctx.moveTo(x - 0.15 * w, y); ctx.quadraticCurveTo(x, y - 0.07, x + 0.15 * w, y); }
        else if (isFar) { ctx.moveTo(x + 0.12 * w, y + 0.1); ctx.lineTo(x - 0.1 * w, y); ctx.lineTo(x + 0.12 * w, y - 0.1); }
        else { ctx.moveTo(x - 0.14 * w, y + 0.1); ctx.lineTo(x + 0.1 * w, y); ctx.lineTo(x - 0.14 * w, y - 0.1); }
        ctx.stroke(); return;
      }
      case 'happy': ctx.lineWidth = ol * 1.9; ctx.strokeStyle = OUT; ctx.beginPath(); ctx.arc(x, y - 0.08, 0.15 * w, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke(); return;
      case 'wink': if (!isFar) { ctx.lineWidth = ol * 1.9; ctx.strokeStyle = OUT; ctx.beginPath(); ctx.arc(x, y - 0.08, 0.15, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke(); return; } type = 'open'; break;
      case 'x': ctx.lineWidth = ol * 1.7; ctx.strokeStyle = OUT; ctx.beginPath();
        ctx.moveTo(x - 0.12 * w, y + 0.12); ctx.lineTo(x + 0.12 * w, y - 0.12); ctx.moveTo(x - 0.12 * w, y - 0.12); ctx.lineTo(x + 0.12 * w, y + 0.12); ctx.stroke(); return;
      case 'heart': {
        const s = 0.2 * w; ctx.fillStyle = '#ff2f6a'; ctx.strokeStyle = OUT; ctx.lineWidth = ol;
        ctx.beginPath(); ctx.moveTo(x, y - s); ctx.bezierCurveTo(x - s * 1.6, y, x - s * 0.6, y + s * 1.2, x, y + s * 0.4);
        ctx.bezierCurveTo(x + s * 0.6, y + s * 1.2, x + s * 1.6, y, x, y - s); ctx.fill(); ctx.stroke(); return;
      }
    }
    const tall = type === 'wide' ? 0.38 : type === 'narrow' || type === 'shadow' ? 0.24 : 0.32;
    const rx = 0.14 * w, ry = tall / 2 * (lash ? 1.1 : 1);
    ell(ctx, x, y, rx, ry, 0, '#fff', OUT, ol * 1.2);
    const pr = type === 'wide' ? 0.36 : 0.66;
    const px = x + (isFar ? 0.02 : 0.04) * w;
    ctx.save(); ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.clip();
    ell(ctx, px, y - 0.01, rx * pr, ry * pr * 1.1, 0, col);
    if (type !== 'wide') { ell(ctx, px, y - 0.01, rx * pr * 0.45, ry * pr * 0.5, 0, '#000'); circle(ctx, px + 0.03 * w, y + ry * 0.35, 0.035 * w, '#fff'); }
    if (type === 'narrow' || type === 'shadow') { // angry lid cuts the top of the eye
      ctx.fillStyle = skin || '#f2c29b'; ctx.beginPath(); ctx.moveTo(x - rx * 1.3, y + ry * 1.3); ctx.lineTo(x + rx * 1.3, y + ry * 1.3); ctx.lineTo(x + rx * 1.3, y - ry * 0.05); ctx.lineTo(x - rx * 1.3, y + ry * 0.55); ctx.fill();
    }
    ctx.restore();
    ctx.lineWidth = ol * (lash ? 2.6 : 2); ctx.strokeStyle = OUT; ctx.beginPath();
    if (type === 'narrow' || type === 'shadow') { ctx.moveTo(x - rx * 1.2, y + ry * 0.6); ctx.lineTo(x + rx * 1.2, y); }
    else ctx.ellipse(x, y, rx * 1.05, ry * 1.05, 0, Math.PI * 0.08, Math.PI * 0.92);
    ctx.stroke();
    if (lash) { ctx.beginPath(); ctx.moveTo(x + rx, y + ry * 0.6); ctx.lineTo(x + rx * 1.7, y + ry * 1.0); ctx.stroke(); }
    if (type === 'shadow') { // dramatic cut-in shading over the eyes with a single glint
      ctx.fillStyle = 'rgba(20,10,40,0.45)'; ctx.fillRect(x - rx * 1.6, y - ry * 0.2, rx * 3.2, ry * 1.6);
      circle(ctx, px + 0.02, y - 0.01, 0.04 * w, '#fff');
    }
  }

  function drawMouth(ctx, m, ol, id, pal) {
    const [x, y] = FACE.mouth;
    ctx.lineWidth = ol * 1.4; ctx.strokeStyle = OUT; ctx.lineCap = 'round';
    switch (m) {
      case 'line': ctx.beginPath(); ctx.moveTo(x - 0.12, y); ctx.lineTo(x + 0.12, y + 0.02); ctx.stroke(); break;
      case 'smile': ctx.beginPath(); ctx.moveTo(x - 0.18, y + 0.06); ctx.quadraticCurveTo(x, y - 0.12, x + 0.2, y + 0.06); ctx.stroke(); break;
      case 'firm': ctx.beginPath(); ctx.moveTo(x - 0.14, y - 0.02); ctx.lineTo(x + 0.14, y + 0.02); ctx.stroke(); break;
      case 'smirk': ctx.beginPath(); ctx.moveTo(x - 0.14, y); ctx.quadraticCurveTo(x + 0.05, y - 0.05, x + 0.18, y + 0.09); ctx.stroke(); break;
      case 'grin': { // big toothy Straw Hat grin
        const w = id === 'luffy' ? 0.42 : 0.26;
        const shape = () => { ctx.beginPath(); ctx.moveTo(x - w, y + 0.14); ctx.quadraticCurveTo(x - 0.05, y - 0.4, x + w * 0.85, y + 0.18); ctx.quadraticCurveTo(x, y + 0.06, x - w, y + 0.14); ctx.closePath(); };
        shape(); ctx.fillStyle = '#6b1a1a'; ctx.fill();
        ctx.save(); shape(); ctx.clip(); ctx.fillStyle = '#fff'; ctx.fillRect(x - w, y + 0.0, w * 2, 0.3); ctx.restore();
        shape(); ctx.stroke();
        break;
      }
      case 'puff': { // Gear Third: thumb clamped in the teeth, cheeks full of air
        ell(ctx, x - 0.22, y + 0.1, 0.3, 0.28, 0, pal.skin, OUT, ol * 1.2);
        ell(ctx, x + 0.2, y + 0.08, 0.24, 0.24, 0, pal.skin, OUT, ol * 1.2);
        ctx.save(); ctx.globalAlpha = 0.3; ell(ctx, x - 0.25, y + 0.14, 0.14, 0.07, 0, '#ff6a6a'); ctx.restore();
        ctx.beginPath(); ctx.moveTo(x, y - 0.12); ctx.lineTo(x + 0.32, y - 0.62); ctx.lineWidth = 0.19 + ol * 2; ctx.strokeStyle = OUT; ctx.stroke();
        ctx.lineWidth = 0.19; ctx.strokeStyle = pal.skin; ctx.stroke();
        ell(ctx, x + 0.03, y - 0.16, 0.06, 0.08, -0.5, '#fbe3d0', OUT, ol * 0.6);
        break;
      }
      case 'shout': {
        const shape = () => { ctx.beginPath(); ctx.moveTo(x - 0.22, y + 0.12); ctx.quadraticCurveTo(x - 0.18, y - 0.42, x + 0.06, y - 0.38); ctx.quadraticCurveTo(x + 0.32, y - 0.24, x + 0.28, y + 0.14); ctx.quadraticCurveTo(x + 0.03, y + 0.2, x - 0.22, y + 0.12); ctx.closePath(); };
        shape(); ctx.fillStyle = '#5a1010'; ctx.fill();
        ctx.save(); shape(); ctx.clip();
        ctx.fillStyle = '#fff'; ctx.fillRect(x - 0.3, y + 0.04, 0.65, 0.14);
        ctx.fillStyle = '#e0555a'; ctx.beginPath(); ctx.ellipse(x + 0.03, y - 0.34, 0.18, 0.09, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore(); shape(); ctx.stroke();
        break;
      }
      case 'grit': {
        ctx.beginPath(); ctx.rect(x - 0.19, y - 0.08, 0.38, 0.15); ctx.fillStyle = '#fff'; ctx.fill(); ctx.stroke();
        ctx.lineWidth = ol * 0.7; ctx.beginPath(); ctx.moveTo(x - 0.19, y - 0.005); ctx.lineTo(x + 0.19, y - 0.005);
        for (let i = -1; i <= 1; i++) { ctx.moveTo(x + i * 0.09, y - 0.08); ctx.lineTo(x + i * 0.09, y + 0.07); }
        ctx.stroke(); break;
      }
      case 'hurt': ctx.beginPath(); ctx.ellipse(x, y - 0.06, 0.12, 0.11, 0, 0, Math.PI * 2); ctx.fillStyle = '#5a1010'; ctx.fill(); ctx.stroke(); break;
      case 'ko': ctx.beginPath(); ctx.moveTo(x - 0.18, y); ctx.bezierCurveTo(x - 0.09, y + 0.09, x, y - 0.09, x + 0.09, y); ctx.bezierCurveTo(x + 0.13, y + 0.05, x + 0.16, y, x + 0.2, y - 0.02); ctx.stroke();
        ctx.fillStyle = '#e0555a'; ctx.beginPath(); ctx.ellipse(x + 0.02, y - 0.11, 0.07, 0.09, 0, 0, Math.PI * 2); ctx.fill(); break;
      default: break;
    }
  }

  function shade(hex, amt) {
    if (typeof hex !== 'string' || hex[0] !== '#') return hex;
    let n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const f = (c) => Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt);
    return '#' + ((1 << 24) | (f(r) << 16) | (f(g) << 8) | f(b)).toString(16).slice(1);
  }

  OP.Draw = { dims, STANCE, solve, mix, sample, joints, drawFighter, drawHead, katana, shade, OUT, ik2, poly, stroke, circle, ell };
})(window.OP);
