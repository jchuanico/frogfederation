#!/usr/bin/env node
/* One Piece Frog Style — regression suite.
 * Runs the real game engine headlessly (no browser, no dependencies) and checks:
 *   - move data integrity and pose sanity for every character
 *   - hitboxes: every attack connects in range, whiffs out of range, contact only where
 *     capsules really overlap, invulnerability and blocking rules are respected
 *   - jump-ins, cross-ups and anti-airs
 *   - character mechanics (Luffy's bounce juggle, Sanji's burn, Usopp's homing shot,
 *     Chopper's forms, Zoro's distinct normals, Japanese call-outs)
 *   - full CPU-vs-CPU matches with every character, rendered into a mock canvas, with no
 *     crashes, no NaN state and the camera keeping the action on screen.
 * Usage: node one-piece-frog-style/tests/run.js [--quick]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const QUICK = process.argv.includes('--quick');
const ROOT = path.join(__dirname, '..', 'js');
const FILES = ['core.js', 'audio.js', 'input.js', 'draw.js', 'characters.js', 'fighter.js', 'stage.js', 'ai.js', 'match.js', 'hud.js'];

// ---------- sandbox ----------
function loadGame() {
  const noop = () => {};
  const sandbox = {
    console, Math, JSON, Date, Map, Set, WeakMap, Proxy, Object, Array, Number, String, Boolean, Error, isFinite, parseInt, parseFloat, Promise,
    setTimeout: noop, clearTimeout: noop, setInterval: () => 0, clearInterval: noop,
    addEventListener: noop, removeEventListener: noop,
    navigator: { getGamepads: () => [], maxTouchPoints: 0 },
    performance: { now: () => Date.now() },
    devicePixelRatio: 1, innerWidth: 1280, innerHeight: 720,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
  return sandbox.OP;
}

// Canvas stand-in: accepts every call and flags non-finite numeric arguments (broken geometry).
function mockCtx() {
  const stats = { calls: 0, bad: 0, where: null };
  const grad = { addColorStop() {} };
  const target = { canvas: { width: 1280, height: 720 } };
  const ctx = new Proxy(target, {
    get(t, p) {
      if (p === '__stats') return stats;
      if (p in t) return t[p];
      if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => grad;
      if (p === 'measureText') return () => ({ width: 10 });
      return (...args) => {
        stats.calls++;
        for (const a of args) if (typeof a === 'number' && !Number.isFinite(a)) { stats.bad++; stats.where = stats.where || String(p); }
      };
    },
    set(t, p, v) { t[p] = v; return true; },
  });
  return ctx;
}

// ---------- tiny test runner ----------
const results = [];
let current = null;
function test(name, fn) {
  current = { name, fails: [] };
  const t0 = Date.now();
  try { fn(); } catch (e) { current.fails.push('threw: ' + (e && e.stack || e)); }
  current.ms = Date.now() - t0;
  results.push(current);
  const ok = current.fails.length === 0;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name} (${current.ms} ms)`);
  if (!ok) for (const f of current.fails.slice(0, 8)) console.log('      - ' + f);
}
function check(cond, msg) { if (!cond) current.fails.push(msg); return !!cond; }

// ---------- helpers ----------
const OP = loadGame();
OP.settings.voice = false; OP.settings.cutins = 'off';
const IDS = OP.Roster.map((c) => c.id);
const partnerOf = (id) => (id === 'luffy' ? 'zoro' : 'luffy');

// A controlled 1-on-1: both teams take scripted input (blank by default), intro skipped.
function arena(a, b, opt = {}) {
  const m = new OP.Match({ mode: 'cpu', level: 1, teams: [
    { chars: [a, opt.pa || partnerOf(a)], pal: [0, 0], ctrl: 'cpu' },
    { chars: [b, opt.pb || partnerOf(b)], pal: [1, 1], ctrl: 'cpu' },
  ] });
  m.phase = 'fight'; m.phaseT = 0; m.timer = 60 * 60 * 30;
  for (const t of m.teams) { t.input = {}; t.ai.think = () => Object.assign(OP.Input.blank(), t.input); t.point.state = 'idle'; }
  const A = m.teams[0].point, B = m.teams[1].point;
  A.x = opt.ax ?? -0.6; B.x = opt.bx ?? 0.6; A.facing = 1; B.facing = -1;
  A.buildPose(); B.buildPose();
  const log = [];
  const orig = m.resolveHit.bind(m);
  m.resolveHit = (att, def, mv, contact, proj) => {
    const before = def.hp;
    orig(att, def, mv, contact, proj);
    log.push({ att, def, mv, proj, blocked: def.state === 'blockstun', dmg: before - def.hp, frame: m.frame });
  };
  return { m, A, B, log, ta: m.teams[0], tb: m.teams[1] };
}
function run(m, n, stop) { for (let i = 0; i < n; i++) { m.tick(); if (stop && stop()) return i; } return n; }
function putInAir(f, y, vy = 0) { f.air = true; f.y = y; f.vy = vy; f.state = 'air'; f.st = 10; }
// Perform a move and run until it (and any projectile) has played out.
function perform(env, key, opt = {}) {
  const { m, A } = env;
  if (opt.air) putInAir(A, opt.airY ?? 1.3, opt.airVy ?? 0);
  if (opt.meter) A.team.meter = 3000;
  const ok = A.startMove(key, m);
  const mv = A.def.moves[key === 'sN' && A.def.form && A.def.form !== 'brain' ? 'sN2' : key];
  run(m, (mv ? mv.total : 60) + (mv && mv.proj ? 120 : 10), () => env.log.length > 0 && !opt.all);
  return ok;
}
const HIT_KEYS = (def) => Object.keys(def.moves).filter((k) => { const mv = def.moves[k]; return k !== 'counterHit' && !mv.transform && !mv.armor && !mv.counter && !mv.teleport && (mv.box && !mv.noBox || mv.proj); });

// Independent overlap check: sample points along both capsules (no shared math with segSeg).
// Samples every ~1 cm. Sampling can only overestimate the distance (by at most half a step),
// so: strict=true proves a real overlap; otherwise half a step is added as tolerance.
function capsOverlapBrute(A, B, slack = 0.02, strict = false) {
  const la = Math.hypot(A.bx - A.ax, A.by - A.ay), lb = Math.hypot(B.bx - B.ax, B.by - B.ay);
  const na = Math.max(1, Math.min(300, Math.ceil(la / 0.01))), nb = Math.max(1, Math.min(300, Math.ceil(lb / 0.01)));
  let best = Infinity;
  for (let i = 0; i <= na; i++) {
    const ax = A.ax + (A.bx - A.ax) * i / na, ay = A.ay + (A.by - A.ay) * i / na;
    for (let j = 0; j <= nb; j++) {
      const bx = B.ax + (B.bx - B.ax) * j / nb, by = B.ay + (B.by - B.ay) * j / nb;
      const d = (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
      if (d < best) best = d;
    }
  }
  return Math.sqrt(best) <= A.r + B.r + slack + (strict ? 0 : Math.max(la / na, lb / nb) / 2);
}

console.log('One Piece Frog Style — regression suite' + (QUICK ? ' (quick)' : ''));

// =====================================================================
test('roster loads with all six crew members', () => {
  check(IDS.join(',') === 'luffy,zoro,sanji,nami,usopp,chopper', 'roster is ' + IDS.join(','));
  check(OP.ChopperForms && OP.ChopperForms.heavy && OP.ChopperForms.monster, 'Chopper forms missing');
});

test('move data is complete and consistent', () => {
  const need = ['L', 'H', 'cL', 'cH', 'jL', 'jH', 'sN', 'sF', 'sU', 'sD', 'X'];
  for (const c of OP.Roster) {
    for (const k of need) check(c.moves[k], `${c.id}: missing move ${k}`);
    check(c.moves[c.assist], `${c.id}: assist move ${c.assist} missing`);
    for (const f of ['quote', 'quoteJp', 'winLine', 'winJp', 'tagLine', 'tagJp']) check(c[f], `${c.id}: missing ${f}`);
    check(c.voice && c.voice.gender, `${c.id}: voice gender missing`);
    for (const [k, mv] of Object.entries(c.moves)) {
      const tag = `${c.id}.${k}`;
      check(mv.total === mv.startup + mv.active + mv.recovery, `${tag}: total mismatch`);
      check(mv.keys && mv.keys[0].f === 0, `${tag}: keyframes must start at frame 0`);
      for (let i = 1; i < mv.keys.length; i++) check(mv.keys[i].f >= mv.keys[i - 1].f, `${tag}: keyframes out of order`);
      check(Array.isArray(mv.kb) && mv.kb.length === 2 && mv.kb.every(Number.isFinite), `${tag}: bad kb`);
      check(mv.hits >= 1, `${tag}: hits < 1`);
      if (mv.proj) check(mv.proj.at < mv.total, `${tag}: projectile spawns after the move ends`);
      if (!mv.noBox && !mv.proj && mv.dmg > 0) check(mv.box, `${tag}: damaging move has no hitbox`);
      if (mv.kind !== 'normal' && k !== 'counterHit') check(mv.jp, `${tag}: missing Japanese call-out`);
    }
  }
});

test('every pose of every move produces finite joints (all forms)', () => {
  const defs = OP.Roster.concat([OP.ChopperForms.heavy, OP.ChopperForms.monster]);
  for (const c of defs) for (const [k, mv] of Object.entries(c.moves)) {
    for (let t = 0; t <= mv.total; t++) {
      const P = OP.Draw.sample(mv.keys, t, c.stance);
      const J = OP.Draw.joints(c, P, { aF: 1, lF: 0.5 });
      for (const [name, v] of Object.entries(J)) if (Array.isArray(v)) if (!v.every(Number.isFinite)) { check(false, `${c.id}/${c.form || ''}.${k} f${t}: joint ${name} not finite`); return; }
    }
  }
});

test('capsule collision math matches brute-force sampling', () => {
  let n = 0;
  for (let i = 0; i < (QUICK ? 300 : 1200); i++) {
    const r = () => (Math.random() - 0.5) * 4;
    const A = OP.cap(r(), r(), r(), r(), Math.random() * 0.4 + 0.01), B = OP.cap(r(), r(), r(), r(), Math.random() * 0.4 + 0.01);
    const fast = !!OP.capsHit(A, B);
    const brute = capsOverlapBrute(A, B, 0, true);
    const bruteLoose = capsOverlapBrute(A, B, 0.02);
    if (fast && !bruteLoose) { n++; if (n < 4) check(false, 'capsHit says hit but capsules are apart: ' + JSON.stringify([A, B])); }
    if (!fast && brute) { n++; if (n < 4) check(false, 'capsHit missed a real overlap: ' + JSON.stringify([A, B])); }
  }
  check(n === 0, `${n} disagreements`);
});

// =====================================================================
test('every attack connects in range and whiffs far away (hitboxes respected)', () => {
  for (const id of IDS) {
    const def = OP.RosterById[id];
    for (const k of HIT_KEYS(def)) {
      const mv = def.moves[k];
      const air = !!mv.air && !mv.ground;
      let hitAt = null;
      for (let d = 0.45; d <= 4.2 && hitAt == null; d += 0.15) {
        const env = arena(id, 'zoro', { ax: 0, bx: d });
        perform(env, k, { air, airY: 0.9, meter: true });
        if (env.log.some((h) => h.att === env.A)) hitAt = d;
      }
      check(hitAt != null, `${id}.${k} (${mv.name}) never connects at 0.45–4.2 m`);
      if (!mv.proj) {
        const env = arena(id, 'zoro', { ax: -7, bx: 7 });
        env.m.clampSeparation = () => {};
        perform(env, k, { air, airY: 0.9, meter: true, all: true });
        check(!env.log.some((h) => h.att === env.A), `${id}.${k} hit an opponent 14 m away`);
      }
    }
  }
});

test('a hit is only ever registered where hit and hurt capsules really overlap', () => {
  let checked = 0;
  for (const id of IDS) {
    const env = arena(id, 'sanji', { ax: -0.5, bx: 0.5 });
    const { m } = env;
    const orig = m.resolveHit;
    m.resolveHit = (att, def, mv, contact, proj) => {
      const hurts = def.hurtBoxes();
      const hits = proj ? [m.projBox(proj)] : att.hitBoxes().map((h) => h.c);
      checked++;
      check(hits.some((a) => hurts.some((b) => capsOverlapBrute(a, b))), `${att.def.id}.${mv.key} registered a hit without overlap`);
      orig(att, def, mv, contact, proj);
    };
    for (const k of ['L', 'H', 'cL', 'cH', 'sF']) { env.A.state = 'idle'; env.A.x = -0.5; env.B.x = 0.5; env.B.state = 'idle'; env.B.air = false; env.B.y = 0; perform(env, k, { meter: true }); run(m, 60); }
  }
  check(checked > 10, 'too few hits sampled: ' + checked);
});

test('invulnerable fighters cannot be hit', () => {
  const env = arena('luffy', 'zoro', { ax: -0.4, bx: 0.4 });
  env.B.invuln = 200;
  perform(env, 'H'); perform(env, 'L');
  check(env.log.length === 0, 'hit an invulnerable fighter');
  const env2 = arena('zoro', 'luffy', { ax: -0.6, bx: 0.3 });
  env2.B.startMove('sU', env2.m); // Gomu Gomu no Rocket has invulnerable start-up
  env2.A.startMove('L', env2.m);
  run(env2.m, 8);
  check(!env2.log.some((h) => h.def === env2.B), 'hit Luffy during Rocket invulnerability');
});

test('blocking: mids, lows and overheads follow the guard rules', () => {
  const trial = (key, crouch, air) => {
    // (returns 'hit' | 'blocked' | 'whiff')
    const env = arena(air ? 'sanji' : 'zoro', 'luffy', { ax: air ? -0.5 : -0.4, bx: 0.4 });
    env.tb.input = { right: true, down: !!crouch }; // hold back (attacker is to the left)
    run(env.m, 3);
    perform(env, key, { air, airY: 0.7 });
    const h = env.log.find((x) => x.att === env.A);
    return h ? (h.blocked ? 'blocked' : 'hit') : 'whiff';
  };
  const expect = (got, want, msg) => check(got === want, `${msg} (got ${got})`);
  expect(trial('L', false), 'blocked', 'standing block should stop a mid');
  expect(trial('L', true), 'blocked', 'crouch block should stop a mid (and standing lights must reach crouchers)');
  expect(trial('cL', false), 'hit', 'a low must beat a standing block');
  expect(trial('cL', true), 'blocked', 'crouch block should stop a low');
  expect(trial('jH', true, true), 'hit', 'an overhead jump-in must beat a crouch block');
  expect(trial('jH', false, true), 'blocked', 'standing block should stop an overhead');
});

// =====================================================================
test('jump-ins connect on standing and crouching opponents and keep them grounded', () => {
  for (const id of IDS) for (const k of ['jL', 'jH']) for (const crouch of [false, true]) {
    let ok = false, grounded = true;
    for (let i = 0; i < 26 && !ok; i++) {
      const d = 0.35 + (i % 13) * 0.1, airY = i < 13 ? 1.15 : 0.75; // descending, as at the end of a real jump
      const env = arena(id, 'zoro', { ax: 0, bx: d });
      env.tb.input = { down: crouch };
      run(env.m, 2);
      perform(env, k, { air: true, airY, airVy: -2.5 });
      const h = env.log.find((x) => x.att === env.A && !x.blocked);
      if (h) { ok = true; grounded = !env.B.air || env.B.y < 0.05; }
    }
    check(ok, `${id}.${k} jump-in never hits a ${crouch ? 'crouching' : 'standing'} opponent`);
    check(grounded, `${id}.${k} jump-in launched a grounded opponent (should stay grounded for the follow-up)`);
  }
});

test('jumping over a standing opponent crosses up instead of sliding off', () => {
  for (const id of IDS) {
    const env = arena(id, 'zoro', { ax: -0.9, bx: 0 });
    const A = env.A;
    putInAir(A, 0.01, Math.sqrt(2 * OP.G * A.def.jumpH)); A.vx = 2.6;
    run(env.m, 120, () => !A.air);
    check(A.x > env.B.x, `${id} could not jump over (landed at ${A.x.toFixed(2)} vs ${env.B.x.toFixed(2)})`);
  }
});

test('crouching launchers anti-air a jumping opponent', () => {
  for (const id of IDS) {
    let ok = false;
    for (let d = 0.3; d <= 1.2 && !ok; d += 0.15) {
      const env = arena(id, 'luffy', { ax: 0, bx: d });
      putInAir(env.B, 1.05, 0);
      env.A.startMove('cH', env.m);
      run(env.m, 30, () => env.log.length > 0);
      ok = env.log.some((h) => h.att === env.A);
    }
    check(ok, `${id}.cH never anti-airs a jumper`);
  }
});

// =====================================================================
test('Luffy: Gigant Pistol spikes, bounces the target up and allows a follow-up juggle', () => {
  const env = arena('luffy', 'zoro', { ax: -1, bx: 1 });
  perform(env, 'X', { meter: true });
  check(env.log.some((h) => h.mv.key === 'X' && !h.blocked), 'hyper did not connect');
  let bounced = false;
  run(env.m, 90, () => { if (env.B.state === 'hitstun' && env.B.vy > 4 && env.B.y < 0.8) bounced = true; return bounced; });
  check(bounced, 'target did not bounce off the deck');
  // follow up: some juggle tool (Rocket, uppercut or Pistol) must land after the bounce
  let juggled = false;
  for (const key of ['sU', 'cH', 'sN']) for (let wait = 0; wait <= 40 && !juggled; wait += 4) {
    const e = arena('luffy', 'zoro', { ax: -1, bx: 1 });
    perform(e, 'X', { meter: true });
    run(e.m, 80, () => e.A.actionable());
    run(e.m, wait);
    if (e.B.state !== 'hitstun') continue;
    const n0 = e.log.length;
    e.A.facing = e.B.x > e.A.x ? 1 : -1;
    e.A.startMove(key, e.m);
    run(e.m, 50, () => e.log.length > n0);
    if (e.log.length > n0 && e.ta.combo.hits >= 2) juggled = true;
  }
  check(juggled, 'no follow-up (Rocket / uppercut / Pistol) can juggle after the bounce');
});

test('Zoro: light is a one-sword slash, heavy a two-sword overhead chop', () => {
  const z = OP.RosterById.zoro.moves;
  check(z.L.box.sword === 'F' && z.H.box.sword === 'both', 'light should use one sword, heavy both');
  const st = OP.RosterById.zoro.stance;
  const pl = OP.Draw.sample(z.L.keys, z.L.startup - 3, st), ph = OP.Draw.sample(z.H.keys, z.H.startup - 4, st);
  check(ph.aF1 > 150 && ph.aB1 > 150, 'heavy should raise both arms overhead before the chop');
  check(pl.swF < 0, 'light should wind the blade back behind the hip (rising cut)');
  check(z.L.bladeTrail && z.H.bladeTrail, 'sword swings should leave blade trails');
});

test('Sanji: Hell Memories kick sends fire out and burns for 5 seconds', () => {
  const env = arena('sanji', 'zoro', { ax: -1, bx: 0.1 });
  perform(env, 'X', { meter: true });
  check(env.log.some((h) => h.mv.key === 'X' && !h.proj && !h.blocked), 'the kick did not connect');
  check(env.B.burn > 250, 'target is not burning after the kick');
  // fire alone (kick out of range) still ignites
  const env2 = arena('sanji', 'zoro', { ax: -1, bx: 1.3 });
  perform(env2, 'X', { meter: true, all: true });
  check(env2.log.some((h) => h.proj && h.proj.kind === 'fireburst'), 'the fire burst did not reach a target out of kick range');
  check(env2.B.burn > 0, 'fire burst did not ignite');
  // burn lasts ~5 s and deals damage over time
  const e3 = arena('sanji', 'zoro'); e3.m.ignite(e3.B, 300);
  const hp0 = e3.B.hp; run(e3.m, 299);
  check(e3.B.burn > 0 && e3.B.burn <= 2, 'burn should last 300 frames (5 s)');
  run(e3.m, 5);
  check(e3.B.burn === 0, 'burn should stop after 5 s');
  check(hp0 - e3.B.hp >= 80, `burn damage too low (${hp0 - e3.B.hp})`);
});

test('Usopp: normals, slingshot special and a heat-seeking hyper that out-damages it', () => {
  const u = OP.RosterById.usopp.moves;
  check(u.L.box.seg && u.H.box.staff, 'light should be a punch and heavy a Kabuto whack');
  check(u.sN.proj && u.X.proj && u.X.proj.homing > 0, 'special/hyper should be slingshot projectiles, hyper homing');
  check(u.X.dmg > u.sN.dmg && u.X.dmg < u.sN.dmg * 2, 'hyper should hit a bit harder than the special');
  // the firebird turns around to chase a target that moved behind Usopp
  const env = arena('usopp', 'zoro', { ax: 0, bx: 3 });
  env.A.team.meter = 3000; env.A.startMove('X', env.m);
  run(env.m, u.X.proj.at + 2);
  env.B.x = -3; env.B.facing = 1;
  run(env.m, 240, () => env.log.some((h) => h.proj && h.proj.kind === 'firebird'));
  check(env.log.some((h) => h.proj && h.proj.kind === 'firebird'), 'firebird did not home in on the moved target');
});

test('Chopper: Heavy Point grows (bigger hitbox, +5%), Monster Point (+25%, armour), two hits revert', () => {
  const dmgOf = (form) => {
    const env = arena('chopper', 'zoro', { ax: 0, bx: 0.8 });
    if (form !== 'brain') env.A.setForm(form, env.m);
    let got = null;
    for (let d = 0.4; d <= 2.2 && got == null; d += 0.1) {
      env.A.x = 0; env.B.x = d; env.B.state = 'idle'; env.B.hp = env.B.maxHp; env.log.length = 0; env.ta.combo.hits = 0;
      perform(env, 'H');
      const h = env.log.find((x) => x.att === env.A && !x.blocked);
      if (h) got = h.dmg;
      run(env.m, 40);
    }
    return got;
  };
  const b = dmgOf('brain'), hv = dmgOf('heavy'), mo = dmgOf('monster');
  check(b && hv && mo, `claw swipe did not land in every form (${b}/${hv}/${mo})`);
  check(Math.abs(hv / b - 1.05) < 0.03, `Heavy Point should do +5% (${b} → ${hv})`);
  check(Math.abs(mo / b - 1.25) < 0.03, `Monster Point should do +25% (${b} → ${mo})`);
  // transformation via the special, and a larger hurtbox
  const env = arena('chopper', 'zoro', { ax: -1.5, bx: 1.5 });
  const extent = (f) => { const hs = f.hurtBoxes(); return Math.max(...hs.map((c) => Math.max(c.ay, c.by) + c.r)) - f.y; };
  const small = extent(env.A);
  env.A.startMove('sN', env.m); run(env.m, 40);
  check(env.A.def.form === 'heavy', 'Heavy Point special did not transform');
  check(extent(env.A) > small * 1.6, 'Heavy Point hurtbox should be much bigger');
  // two clean hits revert
  for (let i = 0; i < 2; i++) { env.B.x = env.A.x + 0.9; env.B.facing = -1; env.B.state = 'idle'; env.A.facing = 1; env.B.startMove('H', env.m); run(env.m, 45); env.A.state = 'idle'; env.A.hitstun = 0; }
  check(env.A.def.form === 'brain', `two hits should shrink Heavy Point back (form ${env.A.def.form}, formHits ${env.A.formHits})`);
  // Monster Point: armour ignores the first hit, second hit shrinks
  env.A.team.meter = 3000; env.A.state = 'idle'; env.A.x = -1; env.A.startMove('X', env.m); run(env.m, 120, () => !env.A.move);
  check(env.A.def.form === 'monster', 'Monster Point hyper did not transform');
  const hitMonster = () => {
    for (const d of [1.1, 1.4, 1.7, 0.9]) {
      const n0 = env.log.filter((h) => h.def === env.A).length;
      env.A.state = 'idle'; env.A.hitstun = 0; env.A.facing = 1;
      env.B.state = 'idle'; env.B.air = false; env.B.y = 0; env.B.x = env.A.x + d; env.B.facing = -1;
      env.B.startMove('H', env.m); run(env.m, 16, () => env.log.filter((h) => h.def === env.A).length > n0);
      if (env.log.filter((h) => h.def === env.A).length > n0) return true;
      run(env.m, 30);
    }
    return false;
  };
  check(hitMonster(), 'could not land a hit on Monster Point');
  check(env.A.def.form === 'monster' && env.A.state !== 'hitstun', 'Monster Point should armour through the first hit');
  run(env.m, 40);
  check(hitMonster(), 'could not land a second hit on Monster Point');
  check(env.A.def.form === 'brain', 'second hit should shrink Monster Point back');
});

// =====================================================================
// Throws: forward + H up close. Inputs go through the real pad (team.input), like a player.
function throwEnv(a, b, d = 0.5) {
  const env = arena(a, b, { ax: 0, bx: d });
  run(env.m, 2);
  env.ta.input = { right: true, H: true };
  run(env.m, 1);
  env.ta.input = {};
  return env;
}

test('throws: forward + H up close grabs, damages and throws the opponent away (every character)', () => {
  for (const a of IDS) {
    const env = throwEnv(a, 'zoro');
    check(env.A.state === 'throw' && env.B.state === 'thrown', `${a}: forward + H next to the opponent did not grab (${env.A.state}/${env.B.state})`);
    const hp0 = env.B.hp, T = env.A.def.throw;
    run(env.m, T.dur + 5);
    const dmg = hp0 - env.B.hp;
    check(dmg >= 80 && dmg <= 140, `${a}: throw damage ${dmg} out of range`);
    run(env.m, 90, () => env.B.state === 'knockdown');
    check(env.B.state === 'knockdown' || env.B.state === 'getup', `${a}: thrown opponent was not knocked down (${env.B.state})`);
    check(Math.abs(env.B.x - env.A.x) > 1.4, `${a}: throw did not create space (${Math.abs(env.B.x - env.A.x).toFixed(2)} m)`);
  }
});

test('throws: out of reach gives a normal heavy; airborne or stunned opponents cannot be thrown', () => {
  const far = throwEnv('luffy', 'zoro', 2.2);
  check(far.A.state === 'attack' && far.A.move.key === 'H', `forward + H out of reach should be a normal heavy (got ${far.A.state})`);
  const air = arena('luffy', 'zoro', { ax: 0, bx: 0.5 }); putInAir(air.B, 0.8, 1);
  check(!air.m.tryThrow(air.A), 'grabbed an airborne opponent');
  const stun = arena('luffy', 'zoro', { ax: 0, bx: 0.5 }); stun.B.state = 'hitstun'; stun.B.hitstun = 20;
  check(!stun.m.tryThrow(stun.A), 'grabbed an opponent in hitstun');
  const mon = arena('zoro', 'chopper', { ax: 0, bx: 0.9 }); mon.B.setForm('monster', mon.m); mon.B.buildPose();
  check(!mon.m.tryThrow(mon.A), 'threw a giant Monster Point Chopper');
});

test('throws: pressing H in the break window counters — thrower knocked back, minimal damage', () => {
  for (const a of IDS) {
    const env = throwEnv(a, 'sanji');
    const hpA = env.A.hp, hpB = env.B.hp, x0 = env.A.x;
    run(env.m, 6);
    env.tb.input = { H: true }; run(env.m, 1); env.tb.input = {};
    check(env.B.state !== 'thrown', `${a}: throw was not broken by H inside the window`);
    check(env.A.state === 'hitstun', `${a}: thrower was not knocked into hitstun`);
    run(env.m, 20);
    check(Math.abs(env.A.x - x0) > 0.4, `${a}: thrower was not knocked back`);
    check(hpA - env.A.hp > 0 && hpA - env.A.hp <= 30, `${a}: counter damage should be minimal (${hpA - env.A.hp})`);
    check(env.B.hp === hpB, `${a}: the defender took damage from a broken throw`);
  }
  // too late: pressing H after the window does nothing
  const late = throwEnv('zoro', 'luffy');
  run(late.m, 16);
  late.tb.input = { H: true }; run(late.m, 1); late.tb.input = {};
  check(late.B.state === 'thrown', 'a late H still broke the throw');
});

test('Chopper buff: Monster Point roar hits nearby foes; bigger hitboxes in every form', () => {
  const env = arena('chopper', 'zoro', { ax: 0, bx: 1.6 });
  env.A.team.meter = 3000; env.A.startMove('X', env.m);
  run(env.m, 45);
  check(env.log.some((h) => h.proj && h.proj.kind === 'roar' && !h.blocked), 'the Monster Point roar did not hit a foe 1.6 m away');
  check(env.B.x - env.A.x > 2.2, 'the roar did not blast the foe away');
  const F = OP.ChopperForms;
  check(F.brain.boxScale >= 1 && F.heavy.boxScale >= 1.5 && F.monster.boxScale >= 2.5, 'Chopper hitbox scales were not buffed');
  // Monster claws now reach well beyond arm's length of a normal-sized fighter
  let reach = 0;
  for (let d = 0.8; d <= 3.4; d += 0.1) {
    const e = arena('chopper', 'zoro', { ax: 0, bx: d });
    e.A.setForm('monster', e.m); e.A.buildPose(); e.B.x = d;
    e.A.startMove('H', e.m); run(e.m, 20, () => e.log.length > 0);
    if (e.log.some((h) => h.att === e.A)) reach = d;
  }
  check(reach >= 2.2, `Monster Point claw reach only ${reach.toFixed(1)} m`);
});

test('voices: every line has a recorded clip; playback is safe without audio', () => {
  const vdir = path.join(__dirname, '..', 'voices');
  const man = JSON.parse(fs.readFileSync(path.join(vdir, 'manifest.json'), 'utf8'));
  const need = (sp, key) => {
    check(man[sp] && man[sp][key] > 0.2, `${sp}/${key} missing from voices/manifest.json`);
    const f = path.join(vdir, sp, key + '.mp3');
    check(fs.existsSync(f) && fs.statSync(f).size > 2000, `${sp}/${key}.mp3 missing or empty`);
  };
  for (const c of OP.Roster) {
    for (const k of ['quote', 'win', 'tag', 'kiai1', 'kiai2', 'hurt1', 'hurt2', 'ko', 'throw']) need(c.id, k);
    for (const [k, mv] of Object.entries(c.moves)) if (mv.jp) need(c.id, k);
    for (const k of ['sN', 'sF', 'sU', 'sD', 'X']) check(/[\u3040-\u30ff\u4e00-\u9faf]/.test(c.moves[k].jp || ''), `${c.id}.${k} has no Japanese call-out`);
  }
  for (const k of ['ready', 'fight', 'ko', 'timeover', 'draw', 'crew']) need('announcer', k);
  OP.settings.voice = true;
  try { OP.Audio.loadVoices(['luffy']); OP.Audio.voice('luffy', 'sN'); OP.Audio.announce('fight'); } finally { OP.settings.voice = false; }
});

// =====================================================================
test('full CPU matches with every character: no crashes, no NaN, clean rendering, camera on the action', () => {
  const ctx = mockCtx();
  const pairs = [];
  for (let i = 0; i < IDS.length; i++) pairs.push([[IDS[i], IDS[(i + 1) % 6]], [IDS[(i + 2) % 6], IDS[(i + 3) % 6]]]);
  if (!QUICK) for (let i = 0; i < IDS.length; i++) pairs.push([[IDS[(i + 4) % 6], IDS[i]], [IDS[(i + 5) % 6], IDS[(i + 1) % 6]]]);
  let frames = 0, off = 0, done = 0, forms = 0, burns = 0;
  const W = OP.W, H = OP.H;
  pairs.forEach(([a, b], g) => {
    const m = new OP.Match({ mode: 'cpu', level: g % 3, teams: [{ chars: a, pal: [0, 0], ctrl: 'cpu' }, { chars: b, pal: [1, 1], ctrl: 'cpu' }] });
    let f = 0;
    while (!m.done && f < 60 * 140) {
      m.tick(); f++;
      for (const t of m.teams) for (const x of t.members) {
        if (![x.x, x.y, x.vx, x.vy, x.hp].every(Number.isFinite)) { check(false, `NaN state: ${x.def.id} ${x.state}`); return; }
        if (x.def.form && x.def.form !== 'brain') forms++;
        if (x.burn > 0) burns++;
      }
      if (f % 7 === 0) { m.render(ctx); OP.HUD.draw(ctx, m); }
      if (!m.cutin && !m.koCam && m.phase === 'fight') {
        frames++;
        const c = m.cam;
        const vis = (w) => { const sx = W / 2 + (w[0] - c.x) * c.zoom, sy = c.gy - (w[1] - c.y) * c.zoom; return sx > -8 && sx < W + 8 && sy > -8 && sy < H + 8; };
        if (m.fighters.some((x) => (x.role === 'point' || x.role === 'assist') && x.state !== 'tagout' && x.J && ![x.J.head, x.J.hip, x.J.ftF].every((p) => vis(x.toWorld(p))))) off++;
      }
    }
    if (m.done) done++; else check(false, `match ${a}+ vs ${b} did not finish`);
  });
  const st = ctx.__stats;
  check(st.bad === 0, `${st.bad} canvas calls received non-finite numbers (first: ${st.where})`);
  check(st.calls > 10000, 'rendering barely ran');
  check(off / frames < 0.01, `camera lost a fighter in ${(100 * off / frames).toFixed(2)}% of frames`);
  console.log(`      ${done}/${pairs.length} matches, ${frames} fight frames, off-screen ${(100 * off / Math.max(1, frames)).toFixed(2)}%, chopper-form frames ${forms}, burning frames ${burns}, ${st.calls} draw calls`);
});

// ---------- summary ----------
const failed = results.filter((r) => r.fails.length);
console.log(`\n${results.length - failed.length}/${results.length} passed` + (failed.length ? ` — FAILED: ${failed.map((f) => f.name).join('; ')}` : ''));
process.exit(failed.length ? 1 : 0);
