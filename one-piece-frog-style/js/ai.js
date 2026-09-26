/* One Piece Frog Style — CPU opponent. It presses the same virtual buttons a player
 * would, so it obeys every rule (buffers, cancels, meter, cooldowns). */
'use strict';
(function (OP) {
  const LEVELS = [
    { react: 24, block: 0.25, aggro: 0.35, anti: 0.15, confirm: 0.4, hyper: 0.2, think: 30 },
    { react: 14, block: 0.55, aggro: 0.55, anti: 0.4, confirm: 0.75, hyper: 0.6, think: 20 },
    { react: 8, block: 0.85, aggro: 0.7, anti: 0.7, confirm: 0.95, hyper: 0.95, think: 12 },
  ];
  // Which special each character likes at each range.
  const PLAN = {
    luffy: { far: ['sN', 'approach'], mid: ['sN', 'H', 'sD', 'jumpin'], close: ['comboA', 'comboB', 'comboC'], anti: 'sU' },
    zoro: { far: ['sN', 'sN', 'approach'], mid: ['sF', 'H', 'jumpin'], close: ['comboA', 'comboB', 'counter'], anti: 'sU' },
    sanji: { far: ['approach', 'dash'], mid: ['sF', 'H', 'jumpin', 'sN'], close: ['comboA', 'comboB', 'comboC'], anti: 'sD' },
    nami: { far: ['sN', 'sF', 'sN'], mid: ['sF', 'H', 'sN'], close: ['comboA', 'teleport', 'comboB'], anti: 'sU' },
    usopp: { far: ['sN', 'sF', 'sN', 'sD'], mid: ['sN', 'H', 'sD', 'jumpin'], close: ['comboA', 'comboB', 'comboC'], anti: 'sU' },
    chopper: { far: ['sN', 'approach', 'dash'], mid: ['sF', 'H', 'jumpin', 'sN'], close: ['comboA', 'comboB', 'comboC'], anti: 'sU' },
  };

  class AI {
    constructor(team, level, dummy) {
      this.team = team; this.L = LEVELS[OP.clamp(level ?? 1, 0, 2)]; this.dummy = dummy;
      this.seq = []; this.wait = 20; this.guard = null; this.guardT = 0; this.held = {};
      this.level = level ?? 1; this.lastSpecial = -999;
    }

    think(m) {
      const out = OP.Input.blank();
      const me = this.team.point, opp = m.opponentOf(me);
      if (!me || !opp || !me.alive || me.state === 'tagin') return out;
      const face = me.facing, dx = opp.x - me.x, dist = Math.abs(dx);
      const fwdKey = dx >= 0 ? 'right' : 'left', backKey = dx >= 0 ? 'left' : 'right';

      if (this.dummy) return this.dummyThink(m, me, opp, out, fwdKey, backKey);

      // 1) keep executing a planned sequence
      if (this.seq.length) {
        const s = this.seq[0];
        if (s.cond === 'hit' && s.first !== false && !me.connected && !(opp.state === 'hitstun')) { this.seq = []; }
        else {
          if (s.first !== false) { s.first = false; if (s.b) out[s.b] = true; if (s.b2) out[s.b2] = true; }
          this.applyDir(out, s.d, me, dx);
          if (--s.w <= 0) this.seq.shift();
          return out;
        }
      }

      // 2) defence: read incoming attacks after a human-like reaction delay
      const threat = this.threat(m, me, opp, dist);
      if (threat) {
        this.guardT++;
        if (this.guardT === this.L.react) {
          const r = Math.random();
          this.guard = r < this.L.block ? threat : null;
          if (this.guard && me.def.id === 'zoro' && Math.random() < 0.15 * this.L.block && threat !== 'proj') { this.push([{ b: 'S', d: 'down', w: 20 }]); }
        }
        if (this.guard) { out[backKey] = true; if (this.guard === 'low') out.down = true; return out; }
      } else { this.guardT = 0; this.guard = null; }
      if (me.state === 'blockstun') { out[backKey] = true; out.down = me.crouchBlock; return out; }

      // 3) opportunistic team moves
      const t = this.team, q = t.partner;
      if (t.assistCD === 0 && q.alive && q.role === 'bench' && dist > 1.4 && dist < 4.5 && Math.random() < 0.004 * (1 + this.L.aggro * 3)) out.A = true;
      if (me.hp < me.maxHp * 0.3 && q.alive && q.role === 'bench' && q.hp > me.hp * 1.5 && t.tagCD === 0 && dist > 2.2 && me.actionable() && Math.random() < 0.02) { out.T = true; return out; }

      // 4) anti-air
      if (opp.air && opp.y > 0.5 && dist < 1.9 && opp.vy < 3 && me.actionable() && !me.air && Math.random() < this.L.anti * 0.2) {
        const k = PLAN[me.def.id].anti;
        this.push([{ b: 'S', d: k === 'sU' ? 'up' : 'down', w: 30 }]);
        return out;
      }

      // 5) punish a whiffed move in recovery
      if (opp.state === 'attack' && opp.mt > opp.move.startup + opp.move.active && dist < 1.7 && me.actionable() && Math.random() < this.L.aggro * 0.3) { this.combo(me, opp, dist); return out; }

      // 6) neutral game
      if (--this.wait > 0 || !me.actionable()) {
        if (this.walking) out[this.walking > 0 ? fwdKey : backKey] = true;
        return out;
      }
      this.walking = 0;
      this.wait = this.L.think + ((Math.random() * this.L.think) | 0);
      const plan = PLAN[me.def.id];
      let choice = dist > 3.3 ? OP.pick(plan.far) : dist > 1.35 ? OP.pick(plan.mid) : OP.pick(plan.close);
      // specials in neutral are spaced out; the CPU walks, jumps and pokes in between
      if (/^s[NFUD]$/.test(choice) || choice === 'counter' || choice === 'teleport') {
        if (m.frame - this.lastSpecial < 150 + (2 - OP.clamp(this.level, 0, 2)) * 60) choice = dist > 3.3 ? 'approach' : OP.pick(['H', 'jumpin', 'approach']);
        else this.lastSpecial = m.frame;
      }
      if (Math.random() > this.L.aggro && dist < 3) { this.walking = Math.random() < 0.5 ? -1 : 0; return out; }
      this.act(choice, me, opp, dist);
      return out;
    }

    applyDir(out, d, me, dx) {
      if (!d) return;
      const fwd = dx >= 0 ? 'right' : 'left', back = dx >= 0 ? 'left' : 'right';
      if (d.includes('down')) out.down = true;
      if (d.includes('up')) out.up = true;
      if (d.includes('fwd')) out[fwd] = true;
      if (d.includes('back')) out[back] = true;
    }
    push(steps) { this.seq = steps.map((s) => Object.assign({}, s)); }

    threat(m, me, opp, dist) {
      for (const e of m.enemyTeam(me).members) {
        if (!e.onScreen || e.state !== 'attack' || !e.move) continue;
        const mv = e.move;
        const reach = mv.stretch ? mv.stretch.len + 0.9 : mv.vel ? 3.2 : 1.4;
        if (Math.abs(e.x - me.x) < reach && e.mt < mv.startup + mv.active && mv.dmg > 0) return mv.guard === 'low' ? 'low' : 'high';
      }
      for (const p of m.proj) {
        if (p.team === this.team) continue;
        if (p.kind === 'cloud' ? Math.abs(p.x - me.x) < 0.8 && p.t > p.delay - 22 : Math.abs(p.x - me.x) < 2.2 && Math.sign(p.vx) === Math.sign(me.x - p.x)) return 'proj';
      }
      void dist; void opp;
      return null;
    }

    act(choice, me, opp, dist) {
      switch (choice) {
        case 'approach': this.walking = 1; this.wait = 25 + Math.random() * 25; break;
        case 'dash': this.push([{ d: 'fwd', w: 2 }, { w: 2 }, { d: 'fwd', w: 14 }]); break;
        case 'jumpin': this.push([{ d: 'up fwd', w: 6 }, { d: 'fwd', w: 16 }, { b: 'H', w: 26 }]); break;
        case 'sN': this.push([{ b: 'S', w: 30 }]); break;
        case 'sF': this.push([{ b: 'S', d: 'fwd', w: 34 }]); break;
        case 'sD': this.push([{ b: 'S', d: 'down', w: 34 }]); break;
        case 'H': this.push([{ b: 'H', w: 26 }]); break;
        case 'counter': this.push([{ b: 'S', d: 'down', w: 36 }]); break;
        case 'teleport': this.push([{ b: 'S', d: 'down', w: 36 }, { b: 'L', w: 10 }, { b: 'H', w: 20, cond: 'hit' }]); break;
        default: this.combo(me, opp, dist);
      }
    }

    // Ground combos with hit-confirms; the chosen ender depends on meter and level.
    combo(me, opp, dist) {
      const L = this.L, useHyper = this.team.meter >= 1000 && Math.random() < L.hyper;
      const confirm = Math.random() < L.confirm ? 'hit' : null;
      const ender = me.def.id === 'luffy' ? 'fwd' : me.def.id === 'nami' ? null : 'fwd';
      const r = Math.random();
      let s;
      if (r < 0.45) s = [{ b: 'L', w: 8 }, { b: 'L', w: 9, cond: confirm }, { b: 'H', w: 12, cond: confirm }, { b: 'S', d: ender, w: 16, cond: confirm }];
      else if (r < 0.8) s = [{ b: 'L', d: 'down', w: 8 }, { b: 'H', d: 'down', w: 12, cond: confirm }, { d: 'up', w: 10, cond: confirm }, { d: 'fwd', w: 4 }, { b: 'L', w: 8 }, { b: 'L', w: 8 }, { b: 'H', w: 20 }];
      else s = [{ b: 'H', w: 12 }, { b: 'S', d: ender, w: 20, cond: confirm }];
      if (useHyper) s.push({ b: 'X', w: 40, cond: 'hit' });
      this.push(s);
      void dist; void opp;
    }

    // Training dummy behaviours.
    dummyThink(m, me, opp, out, fwdKey, backKey) {
      const d = this.dummy.guard;
      if (d === 'crouch') out.down = true;
      if (d === 'jump') out.up = true;
      if (d === 'block') {
        const th = this.threat(m, me, opp, 0);
        if (th || me.state === 'blockstun') { out[backKey] = true; if (th === 'low' || (me.state === 'blockstun' && me.crouchBlock)) out.down = true; }
      }
      void fwdKey;
      return out;
    }
  }

  OP.AI = AI;
})(window.OP);
