#!/usr/bin/env node
/* Tank Dynamics — engine regression suite (no browser needed).
 *   node tank-dynamics/tests/run.js            run everything
 *   node tank-dynamics/tests/run.js ballistic  only tests whose name contains "ballistic"
 * Covers the math, physics, weapons, turn system, AI, determinism, ratings, matchmaking,
 * lockstep networking, the relay server, the shared profile module and the audio data. */
'use strict';
const path = require('path');
const fs = require('fs');
const { load, cpuMatch } = require('./load.js');

const TD = load();
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
const near = (a, b, tol, msg) => assert(Math.abs(a - b) <= tol, `${msg || ''} expected ${b} ± ${tol}, got ${a}`);
const B = TD.BITS;

/** A flat test arena: ground at `h` metres everywhere (optionally a rock layer). */
function flatMatch(o = {}) {
  const m = new TD.Match({ seed: o.seed || 1, map: 'lagoon', players: o.players || [{ tank: 'froggo', team: 0 }, { tank: 'blaze', team: 1 }], turnFrames: o.turnFrames });
  const h = o.h ?? 20, t = m.terrain;
  t.cells.fill(0);
  for (let cx = 0; cx < TD.COLS; cx++) for (let cy = 0; cy < h / TD.CELL; cy++) t.cells[cy * TD.COLS + cx] = 1;
  const xs = o.xs || [30, 130];
  m.tanks.forEach((tk, i) => { tk.x = xs[i] ?? 30 + i * 20; tk.y = h; tk.tilt = 0; tk.falling = false; tk.fallFrom = h; tk.vy = 0; });
  m.wind = { x: 0, y: 0 };
  return m;
}
/** Step a match until the phase becomes `phase` (or give up). */
function until(m, pred, max = 60 * 60, bits = () => 0) { for (let i = 0; i < max && !pred(m); i++) m.step(m.needsInput() >= 0 ? bits(m) : 0); return pred(m); }
/** Fire the active tank's shot at a given angle/power/weapon via the real input path. */
function shoot(m, aim, power, weapon = 0) {
  const t = m.activeTank;
  t.aim = aim; t.weapon = weapon;
  m.step(B.FIRE); // press
  for (let i = 0; i < power; i++) m.step(B.FIRE);
  m.step(0); // release -> fire
}
const collect = (m, type) => m.events.filter((e) => e.type === type);

/* ---------------- math ---------------- */
test('deterministic trig matches Math within 1e-9', () => {
  for (let x = -20; x <= 20; x += 0.0137) {
    near(TD.dsin(x), Math.sin(x), 1e-9, 'sin'); near(TD.dcos(x), Math.cos(x), 1e-9, 'cos');
  }
  for (let y = -5; y <= 5; y += 0.37) for (let x = -5; x <= 5; x += 0.41) near(TD.datan2(y, x), Math.atan2(y, x), 1e-9, 'atan2');
});
test('seeded RNG is reproducible and in range', () => {
  const a = TD.rng(42), b = TD.rng(42), c = TD.rng(43);
  let diff = 0;
  for (let i = 0; i < 1000; i++) { const x = a.next(); assert(x >= 0 && x < 1); assert(x === b.next()); if (x !== c.next()) diff++; }
  assert(diff > 990, 'different seeds should differ');
});
test('launch angle mirrors for facing and adds tilt', () => {
  near(TD.launchAngle(1, 45, 0), Math.PI / 4, 1e-12);
  near(TD.launchAngle(-1, 45, 0), 3 * Math.PI / 4, 1e-12);
  near(TD.launchAngle(1, 30, 0.1), TD.deg(30) + 0.1, 1e-12);
});

/* ---------------- terrain ---------------- */
test('every map generates playable ground and spawns on it', () => {
  for (const map of TD.MAPS) for (const seed of [1, 99, 12345]) {
    const m = new TD.Match({ seed, map: map.id, players: [{ tank: 'froggo', team: 0 }, { tank: 'nova', team: 1 }, { tank: 'blaze', team: 0 }, { tank: 'bubbles', team: 1 }] });
    let solid = 0; for (const v of m.terrain.cells) if (v) solid++;
    assert(solid > TD.COLS * 20, map.id + ' has too little ground');
    for (const t of m.tanks) {
      assert(t.y > TD.WATER + 1, `${map.id}/${seed}: ${t.id} spawned in water at y=${t.y}`);
      assert(m.terrain.solid(t.x, t.y - 0.1), `${map.id}: ${t.id} not standing on ground`);
      assert(!m.terrain.solid(t.x, t.y + 0.3), `${map.id}: ${t.id} buried`);
    }
    const left = m.tanks.filter((t) => t.team === 0).map((t) => t.x), right = m.tanks.filter((t) => t.team === 1).map((t) => t.x);
    assert(Math.max(...left) < Math.min(...right), 'teams start on opposite sides');
  }
});
test('carving removes a circle of dirt; rock needs a hard blast', () => {
  const m = flatMatch();
  const t = m.terrain;
  const before = t.cells.reduce((a, v) => a + (v ? 1 : 0), 0);
  const n = t.carve(80, 20, 3, false);
  const expect = Math.PI * 9 / 2 / (TD.CELL * TD.CELL); // half the circle is above ground
  near(n, expect, expect * 0.06, 'crater size');
  assert(t.cells.reduce((a, v) => a + (v ? 1 : 0), 0) === before - n);
  assert(!t.solid(80, 18.5) && t.solid(80, 16.5), 'crater depth');
  for (let cy = 0; cy < 40; cy++) for (let cx = 0; cx < TD.COLS; cx++) t.cells[cy * TD.COLS + cx] = 2;
  const soft = t.carve(40, 5, 2, false); assert(soft === 0, 'soft blast should not remove rock');
  assert(t.carve(40, 5, 2, true) > 150, 'hard blast removes rock');
  assert(t.fillEllipse(80, 25, 3, 2, 3) > 100 && t.solid(80, 25), 'goo builds ground');
});
test('surfaceBelow finds the right ground level', () => {
  const m = flatMatch({ h: 20 });
  near(m.terrain.surfaceBelow(50, 40), 20, 1e-9);
  m.terrain.fillEllipse(50, 30, 2, 1, 1);
  near(m.terrain.surfaceBelow(50, 40), 31, 0.26);
  near(m.terrain.surfaceBelow(50, 28), 20, 1e-9, 'below the island');
});

/* ---------------- ballistics ---------------- */
test('ballistics: no drag matches the textbook range formula', () => {
  const k = TD.DRAG; TD.DRAG = 0;
  try {
    for (const deg of [20, 35, 45, 60, 75]) {
      const v = 30, a = TD.deg(deg);
      const p = { x: 0, y: 0, vx: v * Math.cos(a), vy: v * Math.sin(a) };
      let peak = 0, prevY = 0, prevX = 0;
      while (p.y >= 0) { prevX = p.x; prevY = p.y; TD.integrate(p, { x: 0, y: 0 }, 1, 1, 1 / 240); peak = Math.max(peak, p.y); }
      const x = prevX + (p.x - prevX) * (prevY / (prevY - p.y));
      near(x, v * v * Math.sin(2 * a) / TD.G, 0.25, `range at ${deg}°`);
      near(peak, (v * Math.sin(a)) ** 2 / (2 * TD.G), 0.1, `apex at ${deg}°`);
    }
  } finally { TD.DRAG = k; }
});
test('ballistics: drag + wind matches the analytic linear-drag solution', () => {
  const k = TD.DRAG, g = TD.G;
  for (const w of [-10, 0, 8]) {
    const vx0 = 20, vy0 = 25, p = { x: 0, y: 0, vx: vx0, vy: vy0 };
    const T = 3; const steps = T * 240;
    for (let i = 0; i < steps; i++) TD.integrate(p, { x: w, y: 0 }, 1, 1, 1 / 240);
    const e = Math.exp(-k * T);
    const x = w * T + (vx0 - w) * (1 - e) / k;
    const y = (vy0 + g / k) * (1 - e) / k - g * T / k;
    near(p.x, x, 0.1, `x with wind ${w}`); near(p.y, y, 0.1, `y with wind ${w}`);
  }
});
test('wind: tailwind carries further, headwind shorter, comet ignores it', () => {
  const m = flatMatch({ xs: [20, 150] });
  const range = (wind, wi = 0, tank) => { m.wind = wind; if (tank) m.tanks[0].def = TD.tankById(tank); return TD.predict(m, 0, 45, 60, wi, 1).x; };
  const still = range({ x: 0, y: 0 }), tail = range({ x: 10, y: 0 }), head = range({ x: -10, y: 0 });
  assert(tail > still + 3 && head < still - 3, `wind should matter: ${head} ${still} ${tail}`);
  const c0 = range({ x: 0, y: 0 }, 1, 'nova'), c1 = range({ x: 10, y: 0 }, 1, 'nova');
  near(c1, c0, 1e-9, 'comet ignores wind');
});
test('hitbox: shells hit exactly inside the tank circle and miss just outside', () => {
  const m = flatMatch({ xs: [30, 80] });
  const tgt = m.tanks[1], r = TD.TANK_R + TD.tankById('froggo').weapons[0].size * 0.5;
  const p = { owner: 0, age: 100, w: TD.tankById('froggo').weapons[0], x: tgt.x - r + 0.01, y: tgt.y + 0.8 };
  assert(m.hitTank(p) === 1, 'just inside should hit');
  p.x = tgt.x - r - 0.01; assert(m.hitTank(p) === -1, 'just outside should miss');
  p.x = tgt.x; p.y = tgt.y + 0.8 + r - 0.01; assert(m.hitTank(p) === 1, 'top of the dome');
  p.owner = 1; p.age = 5; assert(m.hitTank(p) === -1, 'shooter is safe from its own shell on launch');
});

/* ---------------- damage, falling, water ---------------- */
test('damage: direct hits, falloff, armour and friendly fire', () => {
  const m = flatMatch({ xs: [30, 80] });
  const shooter = m.tanks[0], target = m.tanks[1], w = shooter.def.weapons[0];
  const p = { owner: 0, w, child: false };
  m.explode(p, target.x, target.y + 0.8, 1);
  const direct = Math.round(w.dmg * TD.DMG_SCALE * 1.25 * (1 - target.def.armor));
  near(target.maxHp - target.hp, direct, 0, 'direct hit damage');
  const dmgAt = (d) => { const mm = flatMatch({ xs: [30, 80] }); mm.explode(p, 80 + d, 20.8, -1); return mm.tanks[1].maxHp - mm.tanks[1].hp; };
  let prev = Infinity;
  for (const d of [0.5, 1, 2, 3, 4]) { const v = dmgAt(d); assert(v <= prev, 'damage falls off with distance'); prev = v; }
  assert(dmgAt(w.radius + TD.TANK_R) === 0, 'no damage outside the blast');
  const team = flatMatch({ xs: [30, 80], players: [{ tank: 'froggo', team: 0 }, { tank: 'blaze', team: 0 }, { tank: 'nova', team: 1 }] });
  team.explode(p, 80, 20.8, 1);
  near(team.tanks[1].maxHp - team.tanks[1].hp, Math.round(direct / 2), 1, 'friendly fire is halved');
});
test('falling: blasting the ground away drops a tank and deals fall damage', () => {
  const m = flatMatch({ xs: [30, 80] });
  const t = m.tanks[1];
  for (let y = 19.5; y > 9; y -= 1) m.terrain.carve(80, y, 2.5, true); // deep pit under the tank
  m.phase = 'settle'; m.settle = 999;
  for (let i = 0; i < 200; i++) m.step(0);
  assert(!t.falling, 'tank should land');
  const drop = 20 - t.y;
  assert(drop > 8, 'fell into the pit: ' + drop);
  near(t.maxHp - t.hp, Math.round((drop - 3) * 30), 1, 'fall damage');
});
test('water: a tank with nothing underneath sinks and is knocked out', () => {
  const m = flatMatch({ xs: [30, 80], players: [{ tank: 'froggo', team: 0 }, { tank: 'blaze', team: 1 }, { tank: 'nova', team: 1 }] });
  for (let cy = 0; cy < TD.ROWS; cy++) for (let cx = Math.floor(74 / TD.CELL); cx < Math.floor(86 / TD.CELL); cx++) m.terrain.cells[cy * TD.COLS + cx] = 0;
  m.phase = 'settle'; m.settle = 999;
  for (let i = 0; i < 300; i++) m.step(0);
  assert(!m.tanks[1].alive, 'sank');
  assert(collect(m, 'drown').length === 1 && collect(m, 'ko')[0].how === 'drown');
});

/* ---------------- turn system ---------------- */
test('turns: lowest delay goes next, heavy shots cost tempo, the dead are skipped', () => {
  const m = flatMatch({ xs: [30, 130] });
  const first = m.active;
  shoot(m, 45, 10, 0);
  until(m, (mm) => mm.phase === 'aim' && mm.turn === 1);
  assert(m.active !== first, 'the other tank goes after a normal shot');
  // SS costs more delay than shot 1
  const d0 = TD.BASE_DELAY + m.tanks[first].def.weapons[0].delay, d2 = TD.BASE_DELAY + m.tanks[first].def.weapons[2].delay;
  assert(d2 > d0);
  const m3 = flatMatch({ players: [{ tank: 'froggo', team: 0 }, { tank: 'blaze', team: 1 }, { tank: 'nova', team: 2 }], xs: [20, 80, 140] });
  m3.tanks.forEach((t) => { t.delay = 0; t.lastTurn = -1; });
  m3.tanks[1].alive = false; m3.tanks[0].delay = 50;
  m3.nextTurn(false);
  assert(m3.active === 2, 'dead tank skipped, lowest delay picked');
});
test('turn timer: timing out passes with a penalty; charging auto-fires', () => {
  const m = flatMatch({ turnFrames: 120 });
  const a = m.active;
  until(m, (mm) => mm.active !== a || mm.turn > 0, 400);
  assert(collect(m, 'timeout').length === 1, 'timeout event');
  const m2 = flatMatch({ turnFrames: 60 });
  m2.step(B.FIRE);
  until(m2, (mm) => mm.phase !== 'aim', 200, () => B.FIRE);
  assert(collect(m2, 'fire').length === 1, 'auto-fired when time ran out');
});
test('SS gauge: locked until full, empties after use', () => {
  const m = flatMatch();
  const t = m.activeTank;
  m.step(B.W3); m.step(0);
  assert(t.weapon === 0 && collect(m, 'denied').length === 1, 'SS denied when empty');
  t.ss = TD.SS_MAX;
  m.step(B.W3); m.step(0);
  assert(t.weapon === 2, 'SS selectable when full');
  shoot(m, 45, 30, 2);
  assert(t.ss === 0, 'gauge spent');
});
test('movement: uses fuel, stops at walls, no driving while charging', () => {
  const m = flatMatch({ xs: [40, 130] });
  const t = m.activeTank;
  const x0 = t.x, dir = t.facing;
  const key = dir > 0 ? B.RIGHT : B.LEFT;
  for (let i = 0; i < 60; i++) m.step(key);
  near(t.x - x0, dir * t.def.speed * 60 / 60, 0.05, 'moved one second');
  near(t.fuel, t.def.fuel - t.def.speed, 0.05, 'fuel used');
  // wall
  m.terrain.fillEllipse(t.x + dir * 3, 24, 1, 5, 1);
  for (let i = 0; i < 120; i++) m.step(key);
  assert(Math.abs(t.x - (x0 + dir * t.def.speed)) < 2.5, 'blocked by the wall');
  // charging freezes movement
  const x1 = t.x; m.step(B.FIRE); m.step(B.FIRE | key); m.step(B.FIRE | key);
  near(t.x, x1, 1e-9, 'no movement while charging');
});

/* ---------------- weapons ---------------- */
function fireWeapon(tank, wi, aim = 45, power = 55, setup) {
  const m = flatMatch({ xs: [30, 75], players: [{ tank, team: 0 }, { tank: 'blaze', team: 1 }] });
  m.active = 0; m.tanks[0].facing = 1; m.tanks[0].ss = TD.SS_MAX;
  if (setup) setup(m);
  if (wi) { m.step([0, B.W2, B.W3][wi]); m.step(0); }
  shoot(m, aim, power, wi);
  const all = [...m.events];
  for (let i = 0; i < 60 * 20 && m.phase !== 'aim' && m.phase !== 'over'; i++) { m.step(0); all.push(...m.events); m.events.length = 0; }
  return { m, ev: all, of: (t) => all.filter((e) => e.type === t) };
}
test('weapon: Hop Shot bounces twice before exploding', () => {
  const r = fireWeapon('froggo', 1, 30, 40);
  assert(r.of('bounce').length === 2, 'bounces: ' + r.of('bounce').length);
  assert(r.of('explode').length === 1);
});
test('weapon: Triple Flame splits into three at the apex', () => {
  const r = fireWeapon('blaze', 1, 60, 60);
  assert(r.of('split').length === 1 && r.of('explode').length === 3, 'explosions: ' + r.of('explode').length);
});
test('weapon: Bubble Barrage fires four shells', () => {
  const r = fireWeapon('bubbles', 2, 45, 50);
  assert(r.of('explode').length === 4, 'explosions: ' + r.of('explode').length);
});
test('weapon: Drill Missile tunnels under the surface before exploding', () => {
  const r = fireWeapon('roborex', 1, 45, 45);
  const ex = r.of('explode')[0];
  assert(r.of('drill').length === 1 && ex.y < 18, 'exploded underground at y=' + ex.y);
});
test('weapon: Freeze Ray delays the enemy (and never a teammate)', () => {
  const m = flatMatch({ xs: [30, 75, 90], players: [{ tank: 'frostbite', team: 0 }, { tank: 'blaze', team: 1 }, { tank: 'nova', team: 0 }] });
  const w = m.tanks[0].def.weapons[1];
  const before = m.tanks[1].delay, mate = m.tanks[2].delay;
  m.explode({ owner: 0, w }, 75, 20.8, 1);
  assert(m.tanks[1].delay - before === w.freeze && m.tanks[1].frozen, 'enemy frozen');
  m.explode({ owner: 0, w }, 90, 20.8, 2);
  assert(m.tanks[2].delay === mate, 'teammate not frozen');
});
test('weapon: Orbital Laser digs a column straight through rock', () => {
  const m = flatMatch({ xs: [30, 75], players: [{ tank: 'roborex', team: 0 }, { tank: 'blaze', team: 1 }] });
  for (let i = 0; i < m.terrain.cells.length; i++) if (m.terrain.cells[i]) m.terrain.cells[i] = 2;
  m.explode({ owner: 0, w: m.tanks[0].def.weapons[2] }, 100, 20, -1);
  assert(!m.terrain.solid(100, 10) && !m.terrain.solid(100, 7), 'column dug');
  assert(m.terrain.solid(106, 10), 'only a narrow column');
});
test('weapon: Black Hole pulls tanks in; Mega Croak shoves them away; Goo builds', () => {
  const m = flatMatch({ xs: [30, 75], players: [{ tank: 'nova', team: 0 }, { tank: 'blaze', team: 1 }] });
  m.explode({ owner: 0, w: m.tanks[0].def.weapons[2] }, 70, 20.5, -1);
  assert(m.tanks[1].x < 75 && m.tanks[1].x >= 70, 'pulled toward the hole: ' + m.tanks[1].x);
  const f = flatMatch({ xs: [30, 75] });
  f.explode({ owner: 0, w: f.tanks[0].def.weapons[2] }, 72, 20.5, -1);
  assert(f.tanks[1].x > 75, 'pushed away: ' + f.tanks[1].x);
  const g = flatMatch({ xs: [30, 75], players: [{ tank: 'bubbles', team: 0 }, { tank: 'blaze', team: 1 }] });
  g.explode({ owner: 0, w: g.tanks[0].def.weapons[1] }, 50, 21, -1);
  assert(g.terrain.solid(50, 23) && g.terrain.cell(Math.floor(50 / TD.CELL), Math.floor(23 / TD.CELL)) === 3, 'goo hill');
});
test('weapon: Dragon Meteor rains five meteors', () => {
  const r = fireWeapon('blaze', 2, 45, 50);
  assert(r.of('meteorCall').length === 1 && r.of('explode').length === 6, 'explosions: ' + r.of('explode').length);
});
test('every weapon of every tank fires and resolves without NaN', () => {
  for (const t of TD.TANKS) for (let wi = 0; wi < 3; wi++) for (const [aim, pw] of [[20, 30], [60, 70], [85, 100]]) {
    const r = fireWeapon(t.id, wi, TD.clamp(aim, t.aimMin, t.aimMax), pw);
    assert(r.m.phase === 'aim' || r.m.phase === 'over', `${t.id}/${wi} never resolved (${r.m.phase})`);
    for (const tk of r.m.tanks) assert(Number.isFinite(tk.x) && Number.isFinite(tk.y) && Number.isFinite(tk.hp), `${t.id}/${wi} NaN`);
  }
});

/* ---------------- data sanity ---------------- */
test('tank roster data is complete and sane', () => {
  assert(TD.TANKS.length >= 6);
  const ids = new Set();
  for (const t of TD.TANKS) {
    assert(!ids.has(t.id)); ids.add(t.id);
    assert(t.weapons.length === 3, t.id + ' needs 3 weapons');
    assert(t.aimMin >= 0 && t.aimMax <= 90 && t.aimMin < t.aimMax, t.id + ' aim range');
    assert(t.hp >= 800 && t.hp <= 1300 && t.armor >= 0 && t.armor < 0.3 && t.speed > 0 && t.fuel > 0);
    for (const w of t.weapons) assert(w.name && w.desc && w.dmg > 0 && w.radius > 0 && w.color && w.fx, `${t.id}/${w.id} fields`);
  }
});

/* ---------------- AI ---------------- */
test('AI: hard CPU lands its first shot near the target on every map', () => {
  let close = 0, total = 0;
  for (const map of TD.MAPS) for (const seed of [3, 4]) {
    const m = new TD.Match({ seed, map: map.id, players: [{ tank: 'froggo', team: 0 }, { tank: 'blaze', team: 1 }] });
    const plan = TD.AI.plan(m, m.active, TD.AI.LEVELS.hard);
    const t = m.activeTank, foe = m.tanks.find((o) => o.team !== t.team);
    const imp = TD.predict(m, t.i, plan.aim, plan.power, plan.weapon, plan.facing);
    total++;
    if (imp.hit === foe.i || Math.abs(imp.x - foe.x) < 4) close++;
  }
  assert(close / total >= 0.8, `hard AI accuracy ${close}/${total}`);
});
test('AI: easy CPU misses more than hard CPU', () => {
  const score = (level) => {
    let err = 0;
    for (let s = 1; s <= 6; s++) {
      const m = cpuMatch(TD, { seed: s, map: 'lagoon', level, players: [{ tank: 'froggo', team: 0 }, { tank: 'blaze', team: 1 }], maxFrames: 1 });
      const b = new TD.AI.Brain(level, s); b.reset(m); b.wait = 0; b.stage = 'think';
      b.bits(m); if (!b.plan) continue;
      const t = m.activeTank, foe = m.tanks.find((o) => o.team !== t.team);
      err += Math.abs(TD.predict(m, t.i, b.plan.aim, b.plan.power, b.plan.weapon, b.plan.facing).x - foe.x);
    }
    return err;
  };
  assert(score('easy') > score('hard'), 'easy should be less accurate');
});

/* ---------------- full games ---------------- */
test('play-test: CPU vs CPU finishes on every map without errors', () => {
  for (const map of TD.MAPS) {
    const m = cpuMatch(TD, { seed: map.id.length * 101, map: map.id, players: [{ tank: 'froggo', team: 0 }, { tank: 'roborex', team: 1 }] });
    assert(m.phase === 'over', `${map.id} did not finish (turn ${m.turn})`);
    assert(m.winner === 0 || m.winner === 1 || m.winner === -1);
    for (const t of m.tanks) assert(Number.isFinite(t.hp) && t.hp >= 0);
    assert(m.turn >= 3 && m.turn < 80, `${map.id} match length ${m.turn} turns`);
  }
});
test('play-test: 2 vs 2 and 3-way free-for-all finish', () => {
  const a = cpuMatch(TD, { seed: 7, map: 'frost', players: [{ tank: 'nova', team: 0 }, { tank: 'bubbles', team: 1 }, { tank: 'froggo', team: 0 }, { tank: 'blaze', team: 1 }] });
  assert(a.phase === 'over', '2v2');
  const b = cpuMatch(TD, { seed: 8, map: 'neon', players: [{ tank: 'frostbite', team: 0 }, { tank: 'roborex', team: 1 }, { tank: 'blaze', team: 2 }] });
  assert(b.phase === 'over', 'ffa');
});
test('determinism: same seed + same inputs = same game, every turn', () => {
  const hashes = (seed) => { const hs = []; cpuMatch(TD, { seed, map: 'canyon', players: [{ tank: 'blaze', team: 0 }, { tank: 'nova', team: 1 }], onFrame: (m) => { if (m.events.some((e) => e.type === 'turn')) hs.push(m.turnHash); } }); return hs; };
  const a = hashes(99), b = hashes(99), c = hashes(100);
  assert(a.length > 3 && a.join() === b.join(), 'replay diverged');
  assert(a.join() !== c.join(), 'different seeds should differ');
});

/* ---------------- ratings + matchmaking ---------------- */
test('Elo: symmetric, zero-sum, upsets pay more', () => {
  near(TD.Elo.expected(1000, 1000), 0.5, 1e-12);
  near(TD.Elo.expected(1200, 1000) + TD.Elo.expected(1000, 1200), 1, 1e-12);
  const up = TD.Elo.update(1000, 1400, 1) - 1000, fav = TD.Elo.update(1400, 1000, 1) - 1400;
  assert(up > 25 && fav < 7, `upset ${up}, favourite ${fav}`);
  assert(TD.Elo.update(1000, 1000, 1) - 1000 === 1000 - TD.Elo.update(1000, 1000, 0), 'zero-sum');
});
async function mmRun(players, seconds, protocol) {
  const hub = new TD.Net.LoopbackHub();
  let now = 0;
  const found = {};
  const mms = players.map((p) => { const mm = new TD.Matchmaker(hub, p, { now: () => now }); mm.manual = true; mm.onMatch = (i) => { found[p.id] = i; }; return mm; });
  if (protocol) mms[1].announce = function () { this.link.send({ t: 'seek', id: this.me.id, name: this.me.name, rating: this.me.rating, since: this.since, v: protocol }); };
  mms.forEach((m) => m.start());
  for (let s = 0; s < seconds; s++) { now += 1000; for (const m of mms) m.tick(); await new Promise((r) => setTimeout(r, 2)); }
  return found;
}
test('matchmaking: close ratings pair right away, far ratings after the window widens', async () => {
  const f1 = await mmRun([{ id: 'a1', name: 'A', rating: 1000 }, { id: 'b1', name: 'B', rating: 1050 }], 2);
  assert(f1.a1 && f1.b1 && f1.a1.matchId === f1.b1.matchId && f1.a1.seed === f1.b1.seed && f1.a1.slot !== f1.b1.slot, 'close pair');
  const f2 = await mmRun([{ id: 'a2', name: 'A', rating: 1000 }, { id: 'b2', name: 'B', rating: 1400 }], 5);
  assert(!f2.a2, 'too far apart after 5 s (window ' + TD.ratingWindow(5) + ')');
  const f3 = await mmRun([{ id: 'a3', name: 'A', rating: 1000 }, { id: 'b3', name: 'B', rating: 1400 }], 12);
  assert(f3.a3 && f3.b3, 'matched once the window reached 400');
});
test('matchmaking: three seekers make exactly one pair (closest ratings)', async () => {
  const f = await mmRun([{ id: 'p1', name: 'A', rating: 1000 }, { id: 'p2', name: 'B', rating: 1300 }, { id: 'p3', name: 'C', rating: 1020 }], 3);
  assert(f.p1 && f.p3 && !f.p2 && f.p1.matchId === f.p3.matchId, JSON.stringify(Object.keys(f)));
});
test('matchmaking: different game versions never match', async () => {
  const f = await mmRun([{ id: 'v1', name: 'A', rating: 1000 }, { id: 'v2', name: 'B', rating: 1000 }], 20, 999);
  assert(!f.v1 && !f.v2);
});

/* ---------------- online lockstep ---------------- */
async function onlineGame(latency, tamper) {
  const hub = new TD.Net.LoopbackHub({ latency });
  const info = { matchId: 'test-' + latency, seed: 777, map: 'lagoon' };
  const sa = new TD.Session(hub, Object.assign({ slot: 0 }, info), { id: 'A', name: 'A', tank: 'froggo' }, { manual: true });
  const sb = new TD.Session(hub, Object.assign({ slot: 1 }, info), { id: 'B', name: 'B', tank: 'nova' }, { manual: true });
  await new Promise((r) => setTimeout(r, latency * 3 + 5));
  assert(sa.ready && sb.ready, 'hello handshake');
  const players = [{ tank: 'froggo', team: 0 }, { tank: 'nova', team: 1 }];
  const ma = new TD.Match({ seed: 777, map: 'lagoon', players }), mb = new TD.Match({ seed: 777, map: 'lagoon', players });
  const ba = new TD.AI.Brain('normal', 1), bb = new TD.AI.Brain('normal', 2);
  const slA = [{ kind: 'local', bits: () => ba.bits(ma) }, { kind: 'remote', session: sa }];
  const slB = [{ kind: 'remote', session: sb }, { kind: 'local', bits: () => bb.bits(mb) }];
  let desync = false; sa.onDesync = sb.onDesync = () => { desync = true; };
  for (let k = 0; k < 400000 && (ma.phase !== 'over' || mb.phase !== 'over') && !desync; k++) {
    TD.driveMatch(ma, slA, sa, 4); TD.driveMatch(mb, slB, sb, 4);
    for (const [m, s] of [[ma, sa], [mb, sb]]) { if (m.events.some((e) => e.type === 'turn')) s.sendHash(m.turn, m.turnHash); m.events.length = 0; }
    if (tamper && ma.turn === 2 && !tamper.done) { tamper.done = true; ma.tanks[1].hp -= 1; }
    if (k % 20 === 0) await new Promise((r) => setTimeout(r, latency ? 1 : 0));
  }
  if (tamper) { for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, latency + 2)); }
  return { ma, mb, desync, sent: hub.sent };
}
test('online: two clients over a laggy link play the identical game', async () => {
  const r = await onlineGame(15);
  assert(r.ma.phase === 'over' && r.mb.phase === 'over', 'both finished');
  assert(r.ma.hash() === r.mb.hash() && r.ma.winner === r.mb.winner, 'same final state');
  assert(!r.desync, 'no desync reported');
});
test('online: a tampered client is caught by the turn hash check', async () => {
  const r = await onlineGame(0, {});
  assert(r.desync, 'desync should be detected');
});
test('online: input stream only sends changes (small bandwidth)', async () => {
  const r = await onlineGame(0);
  assert(r.sent < r.ma.frame * 1.2, `messages ${r.sent} for ${r.ma.frame} frames`);
});

/* ---------------- relay server (real WebSockets) ---------------- */
test('relay: WebSocket relay forwards room messages between clients', async () => {
  if (typeof WebSocket === 'undefined') { console.log('    (skipped: this Node has no WebSocket client)'); return; }
  const { createRelay } = require('../tools/relay-server.js');
  const relay = createRelay({ port: 0, log: () => {} });
  const port = await relay.listen();
  try {
    const T = load({ WebSocket });
    const hubA = new T.Net.WebSocketHub('ws://127.0.0.1:' + port), hubB = new T.Net.WebSocketHub('ws://127.0.0.1:' + port);
    const got = [];
    hubA.join('room1', () => {});
    const lb = hubB.join('room1', (m) => got.push(m));
    const la = hubA.join('room1', () => {});
    await new Promise((r) => setTimeout(r, 200));
    la.send({ hi: 1 }); la.send({ hi: 2 });
    await new Promise((r) => setTimeout(r, 200));
    assert(got.length === 2 && got[1].hi === 2, 'relayed: ' + JSON.stringify(got));
    // full matchmaking over the relay
    let found = 0;
    const m1 = new T.Matchmaker(hubA, { id: 'r1', name: 'A', rating: 1000, tank: 'froggo' }); m1.onMatch = () => found++;
    const m2 = new T.Matchmaker(hubB, { id: 'r2', name: 'B', rating: 1010, tank: 'nova' }); m2.onMatch = () => found++;
    m1.start(); m2.start();
    for (let i = 0; i < 40 && found < 2; i++) await new Promise((r) => setTimeout(r, 100));
    m1.stop(); m2.stop(); lb.close();
    assert(found === 2, 'matched over the relay');
    for (const h of [hubA, hubB]) h.ws && h.ws.close();
  } finally { await relay.close(); }
});

/* ---------------- shared modules ---------------- */
test('profile: guest profile, per-game records, account hook', async () => {
  const store = {};
  const sb = { localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } }, crypto: require('crypto').webcrypto, Math, Date, JSON, Promise, Uint8Array, Array, String, Object, Error };
  sb.globalThis = sb; sb.window = sb;
  require('vm').createContext(sb);
  require('vm').runInContext(fs.readFileSync(path.join(__dirname, '../../shared/ff-profile.js'), 'utf8'), sb);
  const P = sb.FF.Profile;
  const p = P.get();
  assert(p.guest && /^guest-[0-9a-f]{16}$/.test(p.id) && p.name, 'guest created');
  assert(P.get().id === p.id, 'stable id');
  assert(P.rename('<b>Frog</b> King!!').name === 'bFrogb King', 'name sanitised');
  P.updateGame('tank-dynamics', (g) => { g.wins++; g.rating = 1016; }, { rating: 1000 });
  assert(P.game('tank-dynamics').wins === 1 && JSON.parse(store['ff.profile.v1']).games['tank-dynamics'].rating === 1016, 'persisted');
  let rejected = false;
  await P.signIn('federation').catch(() => { rejected = true; });
  assert(rejected && !P.providers.federation.available, 'accounts are wired but not live yet');
  P.providers.federation.signIn = () => Promise.resolve({ id: 'ff-1', name: 'Real Frog', token: 't' });
  const acct = await P.signIn('federation');
  assert(!acct.guest && acct.games['tank-dynamics'].wins === 1, 'guest progress carried into the account');
  // no storage at all (private mode) still works in memory
  const sb2 = { Math, Date, JSON, Promise, Uint8Array, Array, String, Object, Error }; sb2.globalThis = sb2;
  require('vm').createContext(sb2);
  require('vm').runInContext(fs.readFileSync(path.join(__dirname, '../../shared/ff-profile.js'), 'utf8'), sb2);
  assert(sb2.FF.Profile.get().id === sb2.FF.Profile.get().id, 'memory fallback');
});
test('audio: every song compiles with matching track lengths; every sound the game uses exists', () => {
  const sb = { Math, JSON, console }; sb.globalThis = sb;
  require('vm').createContext(sb);
  require('vm').runInContext(fs.readFileSync(path.join(__dirname, '../../shared/ff-audio.js'), 'utf8'), sb);
  sb.TD = { settings: { music: 1, sfx: 1 } };
  const src = fs.readFileSync(path.join(__dirname, '../js/audio.js'), 'utf8');
  require('vm').runInContext(src, sb);
  const A = sb.FF.Audio, S = sb.TD.SONGS;
  const len = (s) => s.trim().split(/\s+/).reduce((a, t) => a + +t.split(':')[1], 0);
  for (const [name, song] of Object.entries(S)) {
    const c = A.compile(song, A.INSTRUMENTS);
    assert(c.length % 16 === 0, name + ' length not whole bars');
    for (const tr of song.tracks) if (tr.seq || tr.chords) assert(len(tr.seq || tr.chords) === c.length, `${name}: a track is ${len(tr.seq || tr.chords)} steps, song is ${c.length}`);
  }
  const main = fs.readFileSync(path.join(__dirname, '../js/main.js'), 'utf8');
  const used = new Set([...main.matchAll(/sfx\('([a-zA-Z_]+)'\)/g)].map((m) => m[1]));
  for (const t of TD.TANKS) { used.add('voice_' + t.id); for (const w of t.weapons) used.add('fire_' + w.fx); }
  for (const n of used) assert(new RegExp('\\b' + n + '\\(a').test(src), 'missing sound effect: ' + n);
  for (const theme of Object.values({ lagoon: 'battle', canyon: 'battle2' })) assert(S[theme], 'battle music');
  for (const n of ['menu', 'battle', 'battle2', 'lobby', 'victory', 'defeat']) assert(S[n], 'song ' + n);
});

/* ---------------- runner ---------------- */
(async () => {
  const filter = process.argv[2];
  let pass = 0, fail = 0;
  const t0 = Date.now();
  for (const t of tests) {
    if (filter && !t.name.includes(filter)) continue;
    const s = Date.now();
    try { await t.fn(); pass++; console.log(`  ✓ ${t.name} (${Date.now() - s} ms)`); }
    catch (e) { fail++; console.log(`  ✗ ${t.name}\n      ${e.stack.split('\n').slice(0, 3).join('\n      ')}`); }
  }
  console.log(`\n${pass} passed, ${fail} failed in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  process.exit(fail ? 1 : 0);
})();
