/* Tank Dynamics — the deterministic battle simulation.
 *
 *   const m = new TD.Match({ seed, map: 'lagoon', players: [{ tank: 'froggo', team: 0, name }, ...] });
 *   each frame:  if (m.needsInput() >= 0) m.step(bitsForThatPlayer); else m.step(0);
 *
 * Only the active player's input matters and it's a small bit field, so online play just streams
 * those bits; every client runs the same `step` and ends up in the same state (see hash()).
 * Rendering and audio read `m.events` (and clear them) — the sim never depends on them.
 *
 * Physics (all SI units): projectiles feel gravity and linear air drag relative to the wind,
 *     a = (0, −g) + k · (wind − v)
 * integrated with semi-implicit Euler at 240 Hz. Tanks rest on the ground, slide down with it when
 * it's blown away and take fall damage past 3 m. Turn order is GunBound's "delay" system: every
 * action costs delay and whoever has the least delay goes next, so heavy shots cost you tempo.
 */
'use strict';
(function (TD) {
  const B = TD.BITS = { LEFT: 1, RIGHT: 2, UP: 4, DOWN: 8, FIRE: 16, W1: 32, W2: 64, W3: 96, SKIP: 128 };
  const WMASK = 96;
  const FALL_SAFE = 3.0, FALL_DMG = 30;         // metres, hp per metre beyond safe
  const SUDDEN_DEATH_TURN = 26;
  const WIND_MAX = 12;

  /** Launch direction for a tank's current aim (world radians). */
  TD.launchAngle = (facing, aimDeg, tilt) => (facing > 0 ? TD.deg(aimDeg) + tilt : TD.PI - TD.deg(aimDeg) + tilt);

  /** Advance one projectile substep (shared by the sim, the AI and the tests). */
  TD.integrate = function (p, wind, windMul, grav, dt) {
    const k = TD.DRAG;
    const ax = k * (wind.x * windMul - p.vx);
    const ay = -TD.G * grav + k * (wind.y * windMul - p.vy);
    p.vx += ax * dt; p.vy += ay * dt;
    p.x += p.vx * dt; p.y += p.vy * dt;
  };

  let pid = 0;

  class Match {
    constructor(o) {
      this.seed = o.seed >>> 0;
      this.rng = TD.rng(this.seed);
      this.mapId = o.map || 'lagoon';
      this.terrain = new TD.Terrain(this.mapId, this.seed);
      this.turnFrames = o.turnFrames || TD.TURN_FRAMES;
      this.frame = 0;
      this.turn = 0;
      this.phase = 'aim';
      this.events = [];
      this.projectiles = [];
      this.pending = [];       // queued shots (multi-shot weapons)
      this.water = TD.WATER;
      this.suddenDeath = false;
      this.winner = null;      // team number, or -1 for a draw
      this.settle = 0;
      this.log = [];
      this.tanks = o.players.map((pl, i) => this.makeTank(pl, i));
      this.wind = { x: 0, y: 0 };
      this.active = -1;
      this.nextTurn(true);
    }

    makeTank(pl, i) {
      const def = TD.tankById(pl.tank);
      // Alternate sides of the map (teams are listed alternately), jittered so rematches differ.
      const side = i % 2, lane = Math.floor(i / 2);
      const base = side === 0 ? 0.1 + lane * 0.17 : 0.9 - lane * 0.17;
      let x = TD.clamp((base + this.rng.range(-0.04, 0.04)) * TD.WORLD_W, 6, TD.WORLD_W - 6);
      x = this.findLanding(x);
      const y = Math.max(this.terrain.top(x), 0);
      return {
        i, def, id: def.id, team: pl.team ?? i, name: pl.name || def.name, cpu: !!pl.cpu,
        x, y, vy: 0, fallFrom: y, facing: x < TD.WORLD_W / 2 ? 1 : -1, aim: 45, tilt: 0,
        power: 0, lastPower: -1, lastAim: -1, charging: false, weapon: 0,
        hp: def.hp, maxHp: def.hp, alive: true, delay: this.rng.int(0, 60), lastTurn: -1,
        ss: 0, fuel: def.fuel, moveUsed: 0, frozen: 0, heldAim: 0, prevBits: 0, moving: 0,
        stats: { shots: 0, hits: 0, direct: 0, dealt: 0, taken: 0, kills: 0 },
      };
    }
    /** Nudge a spawn x until it's over solid ground (not a chasm). */
    findLanding(x) {
      for (let d = 0; d < 40; d += 0.5) {
        for (const s of [1, -1]) {
          const xx = TD.clamp(x + d * s, 4, TD.WORLD_W - 4);
          if (this.terrain.top(xx) > TD.WATER + 2 && this.terrain.top(xx - 1) > 0 && this.terrain.top(xx + 1) > 0) return xx;
        }
      }
      return x;
    }

    emit(e) { this.events.push(e); }
    get activeTank() { return this.tanks[this.active]; }
    /** Index of the tank whose input the sim needs this frame, or -1. */
    needsInput() { return this.phase === 'aim' ? this.active : -1; }
    aliveTeams() { const s = new Set(); for (const t of this.tanks) if (t.alive) s.add(t.team); return s; }

    nextTurn(first) {
      if (!first) {
        const a = this.activeTank;
        if (a) a.lastTurn = this.turn;
        this.turn++;
      }
      if (this.checkOver()) return;
      // lowest delay goes next; ties go to whoever waited longest
      let best = null;
      for (const t of this.tanks) {
        if (!t.alive) continue;
        if (!best || t.delay < best.delay || (t.delay === best.delay && t.lastTurn < best.lastTurn)) best = t;
      }
      this.active = best.i;
      // normalise delays so they don't grow forever
      const min = best.delay;
      for (const t of this.tanks) t.delay -= min;
      best.fuel = best.def.fuel; best.moveUsed = 0; best.power = 0; best.charging = false; best.heldAim = 0;
      best.prevBits = 0; best.frozen = 0;
      // new wind every turn, gusty but not silly
      const strength = this.turn < 2 ? this.rng.range(0, 4) : this.rng.range(0, WIND_MAX);
      const ang = this.rng.range(0, 2 * TD.PI);
      this.wind = { x: Math.round(strength * TD.dcos(ang) * 10) / 10, y: Math.round(strength * TD.dsin(ang) * 0.35 * 10) / 10 };
      if (this.turn >= SUDDEN_DEATH_TURN && !this.suddenDeath) { this.suddenDeath = true; this.emit({ type: 'suddenDeath' }); }
      if (this.suddenDeath) this.water = Math.min(this.water + 1.2, 30);
      this.phase = 'aim';
      this.turnLeft = this.turnFrames;
      this.turnHash = this.hash(); // online clients compare this to catch desyncs
      this.emit({ type: 'turn', i: best.i, turn: this.turn, wind: this.wind });
    }

    checkOver() {
      const teams = this.aliveTeams();
      if (teams.size <= 1) {
        this.phase = 'over';
        this.winner = teams.size ? [...teams][0] : -1;
        this.emit({ type: 'over', winner: this.winner });
        return true;
      }
      return false;
    }

    /** One simulation frame. `bits` = the active player's input (ignored outside the aim phase). */
    step(bits) {
      if (this.phase === 'over') return;
      this.frame++;
      if (this.phase === 'aim') this.stepAim(bits | 0);
      else if (this.phase === 'fly') this.stepFly();
      this.stepTanks();
      if (this.phase === 'fly' && !this.projectiles.length && !this.pending.length) { this.phase = 'settle'; this.settle = 50; }
      if (this.phase === 'settle') {
        const falling = this.tanks.some((t) => t.alive && t.falling);
        if (!falling && --this.settle <= 0) this.endTurn();
      }
    }

    stepAim(bits) {
      const t = this.activeTank;
      if (!t || !t.alive) { this.endTurn(); return; }
      const pressed = bits & ~t.prevBits;
      // weapon select
      const w = bits & WMASK;
      if (w && (pressed & WMASK)) {
        const wi = (w >> 5) - 1;
        if (wi === 2 && t.ss < TD.SS_MAX) this.emit({ type: 'denied', i: t.i });
        else if (wi !== t.weapon) { t.weapon = wi; this.emit({ type: 'weapon', i: t.i, w: wi }); }
      }
      // aim: 1° per tap, then 30°/s while held
      const aimDir = (bits & B.UP ? 1 : 0) - (bits & B.DOWN ? 1 : 0);
      if (aimDir && !t.charging) {
        if (t.heldAim === 0 || (t.heldAim >= 12 && t.heldAim % 2 === 0)) {
          const na = TD.clamp(t.aim + aimDir, t.def.aimMin, t.def.aimMax);
          if (na !== t.aim) { t.aim = na; this.emit({ type: 'aim', i: t.i }); }
        }
        t.heldAim++;
      } else t.heldAim = 0;
      // move (can't move while charging a shot)
      const mv = (bits & B.RIGHT ? 1 : 0) - (bits & B.LEFT ? 1 : 0);
      t.moving = 0;
      if (mv && !t.charging && !t.falling) {
        if (t.facing !== mv) { t.facing = mv; this.emit({ type: 'face', i: t.i }); }
        else if (t.fuel > 0) this.moveTank(t, mv);
        else if (pressed & (B.LEFT | B.RIGHT)) this.emit({ type: 'nofuel', i: t.i });
      }
      // fire: hold to charge, release to shoot (auto-fires if the timer runs out mid-charge)
      if (bits & B.FIRE) {
        if (!t.charging && (pressed & B.FIRE)) { t.charging = true; t.power = 0; this.emit({ type: 'charge', i: t.i }); }
        else if (t.charging) t.power = Math.min(100, t.power + 1);
      } else if (t.charging) {
        this.fire(t);
        t.prevBits = bits;
        return;
      }
      if ((pressed & B.SKIP) && !t.charging) { this.emit({ type: 'skip', i: t.i }); t.delay += 120; this.endTurn(); t.prevBits = bits; return; }
      t.prevBits = bits;
      if (--this.turnLeft <= 0) {
        if (t.charging) this.fire(t);
        else { this.emit({ type: 'timeout', i: t.i }); t.delay += 150; this.endTurn(); }
      }
    }

    moveTank(t, dir) {
      const step = t.def.speed * TD.DT;
      const nx = TD.clamp(t.x + dir * step, 1.5, TD.WORLD_W - 1.5);
      if (nx === t.x) return;
      const g = this.terrain.surfaceBelow(nx, t.y + 1.0);
      const ahead = this.terrain.surfaceBelow(t.x + dir * 0.6, t.y + 1.5);
      if (ahead - t.y > 1.0 || this.terrain.solid(nx + dir * 1.0, t.y + 1.6)) { // steeper than ~60° or a wall
        if (!t.blocked) this.emit({ type: 'blocked', i: t.i });
        t.blocked = true;
        return;
      }
      t.blocked = false;
      t.x = nx;
      if (g > t.y) t.y = g; // climb
      t.fuel = Math.max(0, t.fuel - step);
      t.moveUsed += step;
      t.moving = dir;
    }

    muzzle(t) {
      const ang = TD.launchAngle(t.facing, t.aim, t.tilt);
      const cx = t.x, cy = t.y + 0.9;
      return { x: cx + TD.dcos(ang) * 1.9, y: cy + TD.dsin(ang) * 1.9, ang };
    }

    fire(t) {
      const w = t.def.weapons[t.weapon];
      const power = TD.clamp(t.power, 0, 100);
      t.charging = false; t.lastPower = power; t.lastAim = t.aim;
      t.stats.shots++;
      t.usedWeapon = t.weapon;
      if (t.weapon === 2) t.ss = 0;
      this.phase = 'fly';
      this.shotHit = false;
      const count = w.kind === 'multi' ? w.count : 1;
      for (let k = 0; k < count; k++) {
        const jit = w.kind === 'multi' ? [0, 1, -1, 2, -2][k % 5] * (w.jitter || 0) : 0;
        this.pending.push({ at: this.frame + k * (w.gap || 0), owner: t.i, w, power: power * (1 + jit), n: k });
      }
      this.emit({ type: 'fire', i: t.i, w: w.id, power, kind: w.kind });
      this.launchPending();
    }

    launchPending() {
      for (let k = this.pending.length - 1; k >= 0; k--) {
        const p = this.pending[k];
        if (p.at > this.frame) continue;
        this.pending.splice(k, 1);
        const t = this.tanks[p.owner];
        if (!t.alive) continue;
        const m = this.muzzle(t);
        const sp = (p.power / 100) * TD.MAX_SPEED * p.w.speed;
        this.spawn({ x: m.x, y: m.y, vx: TD.dcos(m.ang) * sp, vy: TD.dsin(m.ang) * sp, owner: t.i, w: p.w, main: true });
        if (p.n > 0) this.emit({ type: 'fire2', i: t.i, w: p.w.id });
      }
    }

    spawn(o) {
      const p = Object.assign({ id: ++pid, age: 0, bounces: o.w.bounces || 0, drill: 0, split: false, vyPrev: o.vy, trail: [] }, o);
      this.projectiles.push(p);
      return p;
    }

    stepFly() {
      this.launchPending();
      const n = TD.SUBSTEPS, dt = TD.DT / n;
      for (let k = this.projectiles.length - 1; k >= 0; k--) {
        const p = this.projectiles[k];
        if (!p) continue;
        p.age++;
        let dead = false;
        for (let s = 0; s < n && !dead; s++) dead = this.substep(p, dt);
        if (!dead && p.age > 60 * 20) { dead = true; this.emit({ type: 'lost', x: p.x, y: p.y }); }
        if (dead) { const j = this.projectiles.indexOf(p); if (j >= 0) this.projectiles.splice(j, 1); continue; }
        // splitting shells burst at the top of their arc
        if (p.w.kind === 'split' && !p.split && p.vyPrev > 0 && p.vy <= 0) {
          const j = this.projectiles.indexOf(p); if (j >= 0) this.projectiles.splice(j, 1);
          const nSplit = p.w.split;
          for (let c = 0; c < nSplit; c++) {
            const off = (c - (nSplit - 1) / 2) * (p.w.spread * 2 / Math.max(1, nSplit - 1));
            this.spawn({ x: p.x, y: p.y, vx: p.vx + off, vy: p.vy, owner: p.owner, w: Object.assign({}, p.w, { kind: 'normal' }), split: true, child: true });
          }
          this.emit({ type: 'split', x: p.x, y: p.y, w: p.w.id });
          continue;
        }
        p.vyPrev = p.vy;
        if (p.age % 2 === 0) { p.trail.push(p.x, p.y); if (p.trail.length > 60) p.trail.splice(0, 2); }
      }
    }

    /** Returns true when the projectile is finished. */
    substep(p, dt) {
      const px = p.x, py = p.y;
      if (p.drilling) { // straight line through the ground
        p.x += p.dx * dt * 22; p.y += p.dy * dt * 22;
        p.drill -= 22 * dt;
        if (((p.age * 4) | 0) % 3 === 0) this.terrain.carve(p.x, p.y, 0.8, true);
        if (this.hitTank(p) >= 0 || p.drill <= 0 || p.y < 0) { this.explode(p, p.x, p.y, this.hitTank(p)); return true; }
        return false;
      }
      TD.integrate(p, this.wind, p.w.wind, p.w.grav, dt);
      if (p.x < -30 || p.x > TD.WORLD_W + 30) { this.emit({ type: 'lost', x: p.x, y: p.y }); return true; }
      if (p.y < this.water - 0.3) { this.emit({ type: 'splash', x: p.x, y: this.water }); return true; }
      const ti = this.hitTank(p);
      if (ti >= 0) { this.explode(p, p.x, p.y, ti); return true; }
      if (this.terrain.solid(p.x, p.y)) {
        if (p.w.kind === 'bounce' && p.bounces > 0) {
          const nrm = this.normalAt(p.x, p.y);
          p.x = px; p.y = py;
          const dot = p.vx * nrm.x + p.vy * nrm.y;
          p.vx = (p.vx - 2 * dot * nrm.x) * 0.62; p.vy = (p.vy - 2 * dot * nrm.y) * 0.62;
          p.bounces--;
          this.emit({ type: 'bounce', x: p.x, y: p.y });
          return false;
        }
        if (p.w.kind === 'drill' && !p.drilling) {
          const sp = Math.sqrt(p.vx * p.vx + p.vy * p.vy) || 1;
          p.drilling = true; p.dx = p.vx / sp; p.dy = p.vy / sp; p.drill = p.w.drill;
          this.emit({ type: 'drill', x: p.x, y: p.y });
          return false;
        }
        // back off to the surface so the crater centres where it touched
        p.x = (p.x + px) / 2; p.y = (p.y + py) / 2;
        this.explode(p, p.x, p.y, -1);
        return true;
      }
      return false;
    }

    /** Index of a tank the projectile is touching, or -1. The shooter is safe for its first 0.3 s. */
    hitTank(p) {
      for (const t of this.tanks) {
        if (!t.alive) continue;
        if (t.i === p.owner && p.age < 18 && !p.child) continue;
        const dx = p.x - t.x, dy = p.y - (t.y + 0.8);
        const r = TD.TANK_R + p.w.size * 0.5;
        if (dx * dx + dy * dy < r * r) return t.i;
      }
      return -1;
    }

    /** Outward surface normal from the terrain mask around (x, y). */
    normalAt(x, y) {
      let nx = 0, ny = 0;
      for (let a = 0; a < 16; a++) {
        const ang = a * TD.PI / 8, dx = TD.dcos(ang), dy = TD.dsin(ang);
        if (!this.terrain.solid(x + dx * 1.0, y + dy * 1.0)) { nx += dx; ny += dy; }
      }
      const l = Math.sqrt(nx * nx + ny * ny);
      return l > 0 ? { x: nx / l, y: ny / l } : { x: 0, y: 1 };
    }

    explode(p, x, y, directIdx) {
      const w = p.w, owner = this.tanks[p.owner];
      const kind = p.child ? 'normal' : w.kind;
      // special effects before damage
      if (kind === 'blackhole') {
        for (const t of this.tanks) {
          if (!t.alive) continue;
          const dx = x - t.x;
          if (Math.abs(dx) < w.pullR) { const mv = TD.clamp(dx, -w.pull, w.pull) * 0.8; t.x = TD.clamp(t.x + mv, 1.5, TD.WORLD_W - 1.5); this.unbury(t); }
        }
        this.emit({ type: 'blackhole', x, y, r: w.pullR });
      }
      if (kind === 'goo') {
        this.terrain.fillEllipse(x, y, w.gooR, w.gooR * 0.75, 3);
        for (const t of this.tanks) if (t.alive) this.unbury(t, 6);
      } else {
        this.terrain.carve(x, y, w.carve || w.radius, kind === 'laser' || kind === 'drill');
      }
      this.emit({ type: 'explode', x, y, r: w.radius, fx: w.fx, color: w.color, kind, big: w.radius > 4 || w.dmg > 350, owner: p.owner });

      const mult = this.suddenDeath ? 1.4 : 1;
      let hitAny = false;
      for (const t of this.tanks) {
        if (!t.alive) continue;
        const dx = t.x - x, dy = t.y + 0.8 - y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const d = Math.max(0, dist - TD.TANK_R * 0.7);
        const direct = t.i === directIdx;
        if (!direct && d >= w.radius) continue;
        const frac = direct ? 1 : 1 - d / w.radius;
        let dmg = w.dmg * TD.DMG_SCALE * (0.3 + 0.7 * frac) * (direct ? 1.25 : 1) * mult * (1 - t.def.armor);
        if (t.team === owner.team) dmg *= 0.5; // friendly (and self) fire hurts half
        dmg = Math.round(dmg);
        this.damage(t, dmg, owner, direct);
        if (t.team !== owner.team) hitAny = true;
        if (w.freeze && t.team !== owner.team) { t.delay += w.freeze; t.frozen = 1; this.emit({ type: 'freeze', i: t.i }); }
        if (kind === 'shock' && dist > 0.01) {
          const push = w.push * frac * (dx >= 0 ? 1 : -1);
          t.x = TD.clamp(t.x + push, 1.5, TD.WORLD_W - 1.5);
          this.unbury(t);
        }
      }
      if (hitAny) { this.shotHit = true; owner.stats.hits++; if (directIdx >= 0 && this.tanks[directIdx].team !== owner.team) owner.stats.direct++; }
      if (kind === 'laser') {
        const top = TD.WORLD_H, bottom = Math.max(0, y - 14);
        this.terrain.carveColumn(x, w.beamW / 2, top, bottom);
        for (const t of this.tanks) {
          if (!t.alive) continue;
          if (Math.abs(t.x - x) < w.beamW / 2 + TD.TANK_R) this.damage(t, Math.round(w.beamDmg * TD.DMG_SCALE * mult * (1 - t.def.armor) * (t.team === owner.team ? 0.5 : 1)), owner, false);
        }
        this.emit({ type: 'laser', x, y: bottom, w: w.beamW });
      }
      if (kind === 'meteor') {
        const sub = Object.assign({}, w, { kind: 'normal', dmg: w.subDmg, radius: 2.8, size: 0.6 });
        for (let k = 0; k < w.count; k++) {
          const mx = x + (k / (w.count - 1) - 0.5) * 2 * w.spreadM + this.rng.range(-1.2, 1.2);
          this.spawn({ x: mx - 6, y: TD.WORLD_H + 12 + k * 7, vx: 3, vy: -18, owner: p.owner, w: sub, child: true, meteor: true });
        }
        this.emit({ type: 'meteorCall', x });
      }
    }
    /** Lift a tank out of ground that appeared inside it (goo, being shoved into a hill). */
    unbury(t, up = 4) {
      const g = this.terrain.surfaceBelow(t.x, t.y + up);
      if (g > t.y) { t.y = g; if (t.falling) t.fallFrom = Math.max(t.fallFrom, g); }
    }

    damage(t, dmg, from, direct) {
      if (dmg <= 0 || !t.alive) return;
      t.hp = Math.max(0, t.hp - dmg);
      t.stats.taken += dmg;
      t.ss = Math.min(TD.SS_MAX, t.ss + dmg / 7);
      if (from && from.team !== t.team) { from.stats.dealt += dmg; from.ss = Math.min(TD.SS_MAX, from.ss + dmg / 4.5); }
      this.emit({ type: 'damage', i: t.i, amount: dmg, direct, from: from ? from.i : -1 });
      if (t.hp <= 0) this.kill(t, from, 'boom');
    }

    kill(t, from, how) {
      if (!t.alive) return;
      t.alive = false; t.hp = 0; t.charging = false;
      if (from && from.team !== t.team) from.stats.kills++;
      this.emit({ type: 'ko', i: t.i, how, by: from ? from.i : -1 });
    }

    /** Tank gravity, landing, fall damage, drowning. */
    stepTanks() {
      for (const t of this.tanks) {
        if (!t.alive) continue;
        let support = -1;
        for (const ox of [-0.9, 0, 0.9]) support = Math.max(support, this.terrain.surfaceBelow(t.x + ox, t.y + 0.35));
        if (support > t.y && support - t.y < 0.4) t.y = support; // ground pushed up under us
        if (support < t.y - 0.02) {
          if (!t.falling) { t.falling = true; t.fallFrom = t.y; }
          t.vy -= TD.G * TD.DT;
          t.y += t.vy * TD.DT;
          if (support >= 0 && t.y <= support) this.land(t, support);
        } else if (t.falling) this.land(t, support);
        if (t.y < this.water - 0.4) { this.emit({ type: 'drown', i: t.i, x: t.x }); this.kill(t, null, 'drown'); if (this.phase === 'aim' && t.i === this.active) this.endTurn(); continue; }
        // body tilt follows the ground under the treads (eased so it doesn't jitter)
        const target = TD.clamp(this.terrain.slope(t.x, t.y), -0.7, 0.7);
        t.tilt += (target - t.tilt) * 0.25;
      }
    }
    land(t, y) {
      const drop = (t.fallFrom ?? y) - y;
      t.y = y; t.vy = 0; t.falling = false; t.fallFrom = y;
      if (drop > 0.5) this.emit({ type: 'land', i: t.i, drop });
      if (drop > FALL_SAFE) this.damage(t, Math.round((drop - FALL_SAFE) * FALL_DMG), null, false);
    }

    endTurn() {
      if (this.phase === 'over') return;
      const t = this.activeTank;
      if (t) {
        const w = t.usedWeapon != null ? t.def.weapons[t.usedWeapon] : null;
        t.delay += TD.BASE_DELAY + (w ? w.delay : 0) + Math.round(t.moveUsed * 6);
        t.usedWeapon = null;
        if (this.phase !== 'aim' && !this.shotHit) this.emit({ type: 'miss', i: t.i });
      }
      this.projectiles.length = 0; this.pending.length = 0;
      this.nextTurn(false);
    }

    /** Checksum of everything that matters, for desync detection. */
    hash() {
      const h = TD.hasher();
      h.int(this.frame).int(this.turn).int(this.active).int(this.rng.state).num(this.wind.x).num(this.wind.y).num(this.water);
      for (const t of this.tanks) h.num(t.x).num(t.y).num(t.hp).num(t.delay).num(t.ss).num(t.aim).int(t.alive ? 1 : 0);
      this.terrain.hash(h);
      return h.value;
    }
  }
  TD.Match = Match;

  /** Fly a shot on a copy of the physics without touching the match (AI + aim guide). Returns
   *  { x, y, hit (tank index or -1), t (frames), path } */
  TD.predict = function (m, shooter, aim, power, weaponIdx, facing, opts = {}) {
    const t = m.tanks[shooter], w = t.def.weapons[weaponIdx];
    const ang = TD.launchAngle(facing, aim, t.tilt);
    const cx = t.x, cy = t.y + 0.9;
    const sp = (power / 100) * TD.MAX_SPEED * w.speed;
    const p = { x: cx + TD.dcos(ang) * 1.9, y: cy + TD.dsin(ang) * 1.9, vx: TD.dcos(ang) * sp, vy: TD.dsin(ang) * sp };
    const sub = opts.coarse ? 2 : TD.SUBSTEPS, dt = TD.DT / sub, path = opts.path ? [] : null;
    const maxF = opts.frames || 900;
    const windMul = w.wind;
    for (let f = 0; f < maxF; f++) {
      for (let s = 0; s < sub; s++) {
        TD.integrate(p, m.wind, windMul, w.grav, dt);
        if (p.x < -30 || p.x > TD.WORLD_W + 30 || p.y < m.water - 0.3) return { x: p.x, y: p.y, hit: -1, t: f, path, out: true };
        for (const o of m.tanks) {
          if (!o.alive || (o.i === shooter && f < 18)) continue;
          const dx = p.x - o.x, dy = p.y - (o.y + 0.8), r = TD.TANK_R + w.size * 0.5;
          if (dx * dx + dy * dy < r * r) return { x: p.x, y: p.y, hit: o.i, t: f, path };
        }
        if (m.terrain.solid(p.x, p.y)) return { x: p.x, y: p.y, hit: -1, t: f, path };
      }
      if (path && f % 2 === 0) path.push(p.x, p.y);
      if (opts.stopAfter && path && path.length / 2 >= opts.stopAfter) return { x: p.x, y: p.y, hit: -1, t: f, path, partial: true };
    }
    return { x: p.x, y: p.y, hit: -1, t: maxF, path };
  };
})(globalThis.TD);
