/* Tank Dynamics — computer opponents.
 *
 * The CPU "thinks" like a player who's really good at geometry: it test-fires shots through the
 * exact same physics (TD.predict), keeps the ones that land closest to an enemy, then adds a
 * difficulty-based wobble to angle and power. It then *plays* that plan through the normal input
 * bits (move, aim, hold fire, release), so a CPU turn looks and sounds exactly like a human one.
 */
'use strict';
(function (TD) {
  const B = TD.BITS;
  const LEVELS = {
    easy:   { aimErr: 6, powErr: 7, think: 70, move: false, rating: 800 },
    normal: { aimErr: 3, powErr: 3.5, think: 50, move: true, rating: 1000 },
    hard:   { aimErr: 0.6, powErr: 0.8, think: 35, move: true, rating: 1250 },
  };

  function expectedDamage(m, i, w, impact) {
    const me = m.tanks[i];
    let score = 0;
    for (const t of m.tanks) {
      if (!t.alive) continue;
      let d;
      if (impact.hit === t.i) d = 0;
      else { const dx = t.x - impact.x, dy = t.y + 0.8 - impact.y; d = Math.max(0, Math.sqrt(dx * dx + dy * dy) - TD.TANK_R * 0.7); }
      const reach = w.kind === 'blackhole' ? w.radius + 2 : w.kind === 'meteor' || w.kind === 'split' ? w.radius + 3 : w.radius;
      if (d >= reach) continue;
      const frac = 1 - d / reach;
      let dmg = w.dmg * (0.3 + 0.7 * frac) * (impact.hit === t.i ? 1.25 : 1);
      if (w.kind === 'laser') dmg += w.beamDmg * (Math.abs(t.x - impact.x) < w.beamW / 2 + TD.TANK_R ? 1 : 0);
      if (w.kind === 'meteor') dmg += w.subDmg * 1.5;
      if (w.kind === 'multi') dmg *= w.count * 0.7;
      if (w.kind === 'split') dmg *= 1.6;
      score += t.team === me.team ? -dmg * 1.5 : dmg;
    }
    // near-misses still score a little so the search has a gradient to follow
    let near = 1e9;
    for (const t of m.tanks) if (t.alive && t.team !== me.team) near = Math.min(near, Math.abs(t.x - impact.x) + Math.abs(t.y - impact.y) * 0.5);
    return score - near * 0.5;
  }

  /** Best shot for tank i: { weapon, facing, aim, power, score }. */
  function plan(m, i, level) {
    const t = m.tanks[i];
    const enemies = m.tanks.filter((o) => o.alive && o.team !== t.team);
    if (!enemies.length) return null;
    const weapons = [0];
    const w1 = t.def.weapons[1];
    if (w1.kind !== 'bounce' && w1.kind !== 'goo') weapons.push(1);
    if (t.ss >= TD.SS_MAX) weapons.push(2);
    let best = null;
    for (const wi of weapons) {
      const w = t.def.weapons[wi];
      for (const facing of [1, -1]) {
        if (!enemies.some((e) => Math.sign(e.x - t.x) === facing)) continue;
        const cands = [];
        for (let aim = t.def.aimMin; aim <= t.def.aimMax; aim += 4) {
          for (let pw = 14; pw <= 100; pw += 6) {
            const imp = TD.predict(m, i, aim, pw, wi, facing, { coarse: true });
            cands.push({ aim, power: pw, score: expectedDamage(m, i, w, imp) });
          }
        }
        cands.sort((a, b) => b.score - a.score);
        for (const c of cands.slice(0, 3)) { // refine around the best few
          for (let aim = Math.max(t.def.aimMin, c.aim - 2); aim <= Math.min(t.def.aimMax, c.aim + 2); aim++) {
            for (let pw = Math.max(1, c.power - 3); pw <= Math.min(100, c.power + 3); pw++) {
              const imp = TD.predict(m, i, aim, pw, wi, facing);
              let s = expectedDamage(m, i, w, imp);
              if (wi === 2) s *= 1.15; // use the super when it's ready
              if (wi === 1 && (w.kind === 'freeze' || w.kind === 'drill')) s *= 1.05;
              if (!best || s > best.score) best = { weapon: wi, facing, aim, power: pw, score: s };
            }
          }
        }
      }
    }
    return best;
  }

  class Brain {
    constructor(level, seed) {
      this.level = LEVELS[level] || LEVELS.normal;
      this.rnd = TD.rng(seed || 1);
      this.turnKey = -1;
    }
    reset(m) {
      this.turnKey = m.turn;
      this.stage = 'think';
      this.wait = this.level.think + this.rnd.int(0, 30);
      this.plan = null; this.moved = false; this.blocked = 0; this.lastX = null; this.tap = 0;
    }
    /** Input bits for this frame (call only while it's this CPU's turn). */
    bits(m) {
      const t = m.activeTank;
      if (this.turnKey !== m.turn) this.reset(m);
      if (this.tap > 0) { this.tap--; return 0; } // release between taps
      switch (this.stage) {
        case 'think':
          if (--this.wait > 0) return 0;
          this.plan = plan(m, t.i, this.level);
          if (!this.plan) { this.stage = 'skip'; return 0; }
          if (this.level.move && !this.moved && this.plan.score < 40 && t.fuel > 2) {
            // no good shot from here: drive a bit toward the nearest enemy and look again
            const foe = m.tanks.filter((o) => o.alive && o.team !== t.team).sort((a, b) => Math.abs(a.x - t.x) - Math.abs(b.x - t.x))[0];
            this.moveTo = TD.clamp(t.x + Math.sign(foe.x - t.x) * Math.min(t.fuel - 0.5, 6 + this.rnd.range(0, 3)), 3, TD.WORLD_W - 3);
            this.moved = true; this.stage = 'move'; this.lastX = t.x; this.blocked = 0;
            return 0;
          }
          this.jitter(t);
          this.stage = 'weapon';
          return 0;
        case 'move': {
          const d = this.moveTo - t.x;
          if (Math.abs(t.x - this.lastX) < 1e-6) this.blocked++; else this.blocked = 0;
          this.lastX = t.x;
          if (Math.abs(d) < 0.1 || t.fuel <= 0 || this.blocked > 20) { this.stage = 'think'; this.wait = 20; return 0; }
          return d > 0 ? B.RIGHT : B.LEFT;
        }
        case 'weapon':
          if (t.weapon !== this.plan.weapon) { this.tap = 3; return [B.W1, B.W2, B.W3][this.plan.weapon]; }
          this.stage = 'face'; return 0;
        case 'face':
          if (t.facing !== this.plan.facing) { this.tap = 3; return this.plan.facing > 0 ? B.RIGHT : B.LEFT; }
          this.stage = 'aim'; this.wait = 10; return 0;
        case 'aim':
          if (t.aim !== this.plan.aim) return t.aim < this.plan.aim ? B.UP : B.DOWN;
          if (--this.wait > 0) return 0;
          this.stage = 'charge'; return B.FIRE;
        case 'charge':
          if (!t.charging) return B.FIRE;
          if (t.power >= this.plan.power) { this.stage = 'done'; return 0; }
          return B.FIRE;
        case 'skip':
          this.stage = 'done'; return B.SKIP;
        default: return 0;
      }
    }
    jitter(t) {
      const L = this.level, p = this.plan;
      p.aim = TD.clamp(Math.round(p.aim + this.rnd.range(-L.aimErr, L.aimErr)), t.def.aimMin, t.def.aimMax);
      p.power = TD.clamp(Math.round(p.power + this.rnd.range(-L.powErr, L.powErr)), 1, 100);
    }
  }

  TD.AI = { LEVELS, plan, Brain, expectedDamage };
})(globalThis.TD);
