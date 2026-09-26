/* One Piece Frog Style — a single fighter: state machine, Earth physics, pose and boxes. */
'use strict';
(function (OP) {
  const { DT, G, clamp, approach, limbDir } = OP;
  const Dr = OP.Draw, PZ = OP.Poses;

  // Rubber limb spring: ω ≈ 30 rad/s — a 3 m Pistol reaches full length in ~3 frames.
  const SPRING_K = 900, ZETA_OUT = 0.5, ZETA_BACK = 0.3;
  const DRAG = 0.5 * OP.AIR_RHO * 1.0 * 0.5; // ½ρ·Cd·A with A ≈ 0.5 m² for a tumbling body
  const FRICTION = 0.85;                     // μ between sandals and the deck planks

  class Fighter {
    constructor(def, palIdx, team, slot) {
      this.def = def;
      this.pal = def.pal[palIdx % def.pal.length];
      this.palIdx = palIdx;
      this.team = team;
      this.slot = slot;
      this.maxHp = def.hp;
      this.hp = def.hp;
      this.red = 0;          // recoverable ("red") health, regenerates while tagged out
      this.role = 'bench';
      this.flags = Object.assign({}, def.flags);
      this.t = (Math.random() * 1000) | 0;
      this.reset(0, 1);
    }

    reset(x, facing) {
      if (this.def.baseDef) this.def = this.def.baseDef; // Chopper shrinks back when he leaves the screen
      Object.assign(this, {
        x, y: 0, vx: 0, vy: 0, facing, air: false, state: 'idle', st: 0,
        move: null, mt: 0, hitstun: 0, blockstun: 0, invuln: 0, airJumps: this.def.airJumps,
        stretch: { aF: 0, aB: 0, lF: 0, lB: 0 }, stretchV: { aF: 0, aB: 0, lF: 0, lB: 0 },
        fistScale: 1, expr: 'neutral', exprT: 0, blink: false, blinkT: 120 + Math.random() * 180,
        trail: [], hitList: new Map(), connected: false, hitCount: 0, kd: false, groundBounce: false, wallBounce: false,
        lowHit: false, superJ: false, flipT: 0, dashDir: 0, walkPh: 0, counterArmed: false, alpha: 1, flashT: 0, lastTrail: 0,
        comboTaken: 0, motionBonus: false, fire: false, burn: 0, formHits: 0, bladeTrail: [],
      });
      this.flags = Object.assign({}, this.def.flags, { bandana: this.flags && this.flags.bandana });
      this.buildPose();
    }

    get D() { return Dr.dims(this.def); }
    get alive() { return this.hp > 0; }
    get onScreen() { return this.role !== 'bench'; }
    get grounded() { return !this.air; }
    get crouching() { return this.state === 'crouch' || (this.state === 'blockstun' && this.crouchBlock) || (this.state === 'attack' && this.move && (this.move.key === 'cL' || this.move.key === 'cH')); }

    actionable() {
      const s = this.state;
      return s === 'idle' || s === 'walk' || s === 'crouch' || s === 'air' || s === 'guard' || (s === 'dash' && this.st > 5) || (s === 'land' && this.st > 2);
    }

    // Play one of this character's recorded voice lines (quote, win, tag, sN…X, kiai1/2, hurt1/2, ko).
    say(key, o) { return OP.Audio.voice(this.def.id, key, o); }
    setExpr(e, t) { this.expr = e; this.exprT = t || 0; }

    // ---------- moves ----------
    startMove(key, m, bonus) {
      // Chopper: in Heavy/Monster Point his neutral special becomes Heavy Gong; no Monster Point while already a monster
      if (this.def.form && this.def.form !== 'brain') { if (key === 'sN') key = 'sN2'; if (key === 'X' && this.def.form === 'monster') return false; }
      const mv = this.def.moves[key];
      if (!mv) return false;
      if (this.air && !mv.air) return false;
      if (!this.air && mv.air && !mv.ground) return false;
      if (mv.kind === 'hyper') { if (this.team.meter < 1000) return false; this.team.meter -= 1000; }
      this.state = 'attack'; this.move = mv; this.mt = 0; this.st = 0;
      this.hitList.clear(); this.connected = false; this.hitCount = 0; this.motionBonus = !!bonus;
      this.counterArmed = !!mv.counter;
      this.fire = !!mv.fire;
      if (mv.kind !== 'normal' && this.def.id === 'zoro') this.flags.bandana = true; // getting serious
      if (!this.air) { this.vx = 0; }
      this.setExpr(mv.expr || 'determined');
      if (mv.kind !== 'normal') m.onSpecial(this, mv);
      else if ((key === 'H' || key === 'cH' || key === 'jH') && Math.random() < 0.4) this.say(Math.random() < 0.5 ? 'kiai1' : 'kiai2'); // effort shout
      return true;
    }

    // Per-frame move scripting that happens before physics.
    moveEvents(m) {
      const mv = this.move, t = this.mt;
      if (mv.vel) for (const v of mv.vel) {
        if (t >= v.from && t < v.to) {
          if (v.impulse) { if (t === v.from) { if (v.vx != null) this.vx = v.vx * this.facing; if (v.vy != null) this.vy = v.vy; this.air = this.vy > 0 || this.air; } }
          else { if (v.vx != null) this.vx = v.vx * this.facing; if (v.vy != null) { this.vy = v.vy; this.air = true; } }
        } else if (t === v.to && !v.impulse && !this.air) this.vx *= 0.3;
      }
      if (t === Math.max(0, mv.startup - 3) && mv.sfx) OP.Audio.sfx(mv.sfx);
      if (mv.proj && t === mv.proj.at) m.spawnProjectile(this, mv);
      if (mv.teleport === t) m.teleportBehind(this);
      if (mv.transform && t === mv.transform.at) this.setForm(mv.transform.form, m);
      if (mv.sheathe && t === mv.sheathe && this.connected) OP.Audio.sfx('sheathe');
      if (mv.fist) this.fistScale = t >= mv.startup - 6 && t < mv.startup + mv.active + 10 ? approach(this.fistScale, mv.fist, 1.2) : approach(this.fistScale, 1, 0.8);
      this.flags.bladeGlow = mv.glow && t < mv.startup + mv.active ? 1 : 0;
      if (mv.teleport) this.alpha = t < mv.teleport ? clamp(1 - (t - 3) / 9, 0.08, 1) : clamp((t - mv.teleport) / 10, 0.08, 1);
    }

    // Chopper's Rumble Ball forms: swap to the form's body (height, mass, hit/hurtbox scale, damage).
    setForm(form, m) {
      const d = OP.ChopperForms && OP.ChopperForms[form];
      if (!d || d === this.def) return;
      const grow = d.height > this.def.height;
      this.def = d; this.formHits = 0;
      this.buildPose();
      if (m) m.transformFx(this, grow);
    }

    advanceMove(m) {
      const mv = this.move;
      this.mt++;
      if (this.mt >= mv.total) this.endMove(m);
    }

    endMove(m) {
      const was = this.move;
      this.move = null; this.fistScale = 1; this.fire = false; this.flags.bladeGlow = 0; this.alpha = 1; this.counterArmed = false;
      if (this.role === 'assist') { this.leave(m); return; }
      if (this.air) this.state = 'air';
      else this.state = 'idle';
      this.st = 0;
      if (was && was.key === 'X') this.setExpr('smug', 60);
    }

    // Leave the screen (end of assist or tag out).
    leave(m) {
      this.state = 'tagout'; this.st = 0; this.move = null; this.air = true;
      this.vx = -this.facing * 7; this.vy = 7.5; this.invuln = 0;
    }

    // ---------- input → actions ----------
    think(pad, m) {
      this.t++;
      if (this.exprT > 0 && --this.exprT === 0) this.expr = 'neutral';
      if (--this.blinkT <= 0) { this.blink = !this.blink; this.blinkT = this.blink ? 6 : 120 + Math.random() * 200; }
      if (this.invuln > 0) this.invuln--;
      if (this.flashT > 0) this.flashT--;
      this.st++;
      const opp = m.opponentOf(this);

      switch (this.state) {
        case 'attack': if (this.move) this.moveEvents(m); break;
        case 'hitstun':
          if (--this.hitstun <= 0) {
            if (this.air) { this.state = 'air'; this.invuln = 8; this.flipT = 16; this.setExpr('grit', 30); } // air recovery flip
            else { this.state = 'idle'; this.comboTaken = 0; }
            this.st = 0;
          }
          break;
        case 'blockstun': if (--this.blockstun <= 0) { this.state = this.air ? 'air' : 'idle'; this.st = 0; } break;
        case 'jumpsquat': if (this.st >= 4) this.doJump(pad); break;
        case 'land': if (this.st >= 5) { this.state = 'idle'; this.st = 0; } break;
        case 'dash':
          if (this.st >= 16) { this.state = 'idle'; this.st = 0; }
          break;
        case 'knockdown':
          this.invuln = 2;
          if (!this.air && this.st >= 36) { this.state = 'getup'; this.st = 0; this.setExpr('grit', 30); }
          break;
        case 'getup': this.invuln = 2; if (this.st >= 22) { this.state = 'idle'; this.st = 0; this.comboTaken = 0; } break;
        case 'tagout': if (this.st > 50) { this.role = 'bench'; this.state = 'idle'; this.x = -99; } break;
        case 'throw': this.throwT++; m.updateThrow(this); break;
        case 'thrown': this.throwT++; break;
      }
      if (this.role === 'point' && pad && this.actionable()) this.handleInput(pad, m, opp);
      // auto-face the opponent when on the ground and free
      if (opp && (this.state === 'idle' || this.state === 'walk' || this.state === 'crouch' || this.state === 'guard' || this.state === 'land' || this.state === 'jumpsquat')) {
        const dx = opp.x - this.x;
        if (Math.abs(dx) > 0.05) this.facing = dx > 0 ? 1 : -1;
      }
    }

    handleInput(pad, m, opp) {
      const f = this.facing;
      const fwd = pad.fwd(f), dn = pad.held('down'), up = pad.held('up');
      // Hyper: dedicated button or Light+Heavy together
      if ((pad.pressed('X') || (pad.pressed('L') && pad.pressed('H'))) && this.team.meter >= 1000) {
        pad.consume('X'); pad.consume('L'); pad.consume('H');
        if (this.startMove('X', m)) return;
      }
      if (pad.pressed('S')) {
        pad.consume('S');
        let key = 'sN', bonus = false;
        if (pad.motion([6, 2, 3], f)) { key = 'sU'; bonus = true; }
        else if (pad.motion([2, 3, 6], f)) { key = 'sF'; bonus = true; }
        else if (pad.motion([2, 1, 4], f)) { key = 'sD'; bonus = true; }
        else if (up) key = 'sU'; else if (dn) key = 'sD'; else if (fwd > 0) key = 'sF';
        if (this.startMove(key, m, bonus)) return;
      }
      // forward + H next to a grounded opponent = throw (otherwise it's a normal heavy)
      if (pad.pressed('H') && !this.air && fwd > 0 && !dn && m.tryThrow(this)) { pad.consume('H'); return; }
      if (pad.pressed('H')) { pad.consume('H'); if (this.startMove(this.air ? 'jH' : dn ? 'cH' : 'H', m)) return; }
      if (pad.pressed('L')) { pad.consume('L'); if (this.startMove(this.air ? 'jL' : dn ? 'cL' : 'L', m)) return; }

      if (this.air) {
        // Sanji-style double jump
        if (pad.edge('up') && this.airJumps > 0 && this.st > 4) {
          this.airJumps--; this.vy = Math.sqrt(2 * G * this.def.jumpH * 0.8); this.vx = fwd * 2.4 * this.facing * (fwd ? 1 : 0);
          this.flipT = 18; OP.Audio.sfx('jump'); m.dust(this.x, this.y, 0.6);
        }
        return;
      }
      if (pad.dashDir) { this.state = 'dash'; this.st = 0; this.dashDir = pad.dashDir * f; this.vx = pad.dashDir * this.def.dash * (this.dashDir > 0 ? 1 : 0.8); OP.Audio.sfx('dash'); m.dust(this.x, 0, 0.8); return; }
      if (this.state === 'dash') return;
      if (up) { this.state = 'jumpsquat'; this.st = 0; this.superJ = pad.superJump(); this.jumpFwd = fwd; return; }
      const threatened = fwd < 0 && m.threatNear(this);
      if (dn) { this.state = 'crouch'; this.vx = 0; this.guardPose = threatened; return; }
      if (threatened) { this.state = 'guard'; this.vx = 0; return; }
      if (fwd) { this.state = 'walk'; this.vx = fwd * f * (fwd > 0 ? this.def.walk : this.def.backWalk); return; }
      this.state = 'idle'; this.vx = 0;
    }

    doJump(pad) {
      const h = this.def.jumpH * (this.superJ ? 2.05 : 1);
      this.vy = Math.sqrt(2 * G * h); // v = √(2gh): real projectile motion under 9.81 m/s²
      const fwd = pad ? pad.fwd(this.facing) : this.jumpFwd;
      this.vx = (fwd > 0 ? 2.6 : fwd < 0 ? -2.2 : 0) * this.facing * (this.superJ ? 1.2 : 1);
      this.air = true; this.state = 'air'; this.st = 0; this.airJumps = this.def.airJumps;
      OP.Audio.sfx('jump');
    }

    // Launcher → automatic super jump follow-up when up is held (MvC-style air combo).
    tryJumpCancel(pad, m) {
      if (!pad || !this.move || this.move.key !== 'cH' || !this.connected || this.mt < this.move.startup + 2) return false;
      if (!pad.held('up')) return false;
      this.move = null; this.superJ = true; this.doJump(pad); this.vx = 1.6 * this.facing; return true;
    }

    // Cancel windows: normals chain into heavier normals/specials, specials into hypers.
    tryCancel(pad, m) {
      const mv = this.move;
      if (!mv || !this.connected || this.role !== 'point' || !pad) return;
      if (this.mt < mv.startup) return;
      if (this.tryJumpCancel(pad, m)) return;
      const k = mv.key;
      const rank = mv.kind === 'hyper' ? 3 : mv.kind === 'special' ? 2 : (k === 'L' || k === 'cL' || k === 'jL') ? 0 : 1;
      if (rank < 3 && (pad.pressed('X') || (pad.pressed('L') && pad.pressed('H'))) && this.team.meter >= 1000) {
        pad.consume('X'); pad.consume('L'); pad.consume('H'); this.air = this.y > 0.01; this.startMove('X', m); return;
      }
      if (rank < 2 && pad.pressed('S')) {
        const f = this.facing; let key = 'sN';
        if (pad.motion([6, 2, 3], f) || pad.held('up')) key = 'sU'; else if (pad.motion([2, 3, 6], f) || pad.fwd(f) > 0) key = 'sF'; else if (pad.motion([2, 1, 4], f) || pad.held('down')) key = 'sD';
        const t = this.def.moves[key];
        if (t && (!this.air || t.air)) { pad.consume('S'); this.startMove(key, m); return; }
      }
      if (rank === 0 && pad.pressed('H')) {
        const key = this.air ? 'jH' : pad.held('down') ? 'cH' : 'H'; pad.consume('H'); this.startMove(key, m); return;
      }
      if (rank === 0 && pad.pressed('L') && this.mt >= mv.startup + mv.active) { // light → light rapid chain
        const key = this.air ? 'jL' : pad.held('down') ? 'cL' : 'L'; pad.consume('L'); this.startMove(key, m);
      }
    }

    // ---------- physics ----------
    physics(m) {
      if (this.state === 'thrown') return; // carried by the thrower
      if (this.state === 'throw') { this.vx = 0; }
      const mass = this.def.mass;
      if (this.air) {
        this.vy -= G * DT;
        // quadratic air drag, a = ½ρCdA·v²/m
        const sp = Math.hypot(this.vx, this.vy);
        if (sp > 0.5) { const a = (DRAG * sp * sp) / mass; this.vx -= (this.vx / sp) * a * DT; this.vy -= (this.vy / sp) * a * DT; }
      } else {
        const sliding = this.state === 'hitstun' || this.state === 'blockstun' || this.state === 'knockdown' || this.state === 'ko' || this.state === 'land' || this.state === 'getup' ||
          (this.state === 'attack' && !(this.move.vel && this.move.vel.some((v) => this.mt >= v.from && this.mt < v.to))) || this.state === 'idle' || this.state === 'crouch' || this.state === 'guard';
        if (this.state === 'dash') this.vx = approach(this.vx, 0, 9 * DT);
        else if (sliding) this.vx = approach(this.vx, 0, FRICTION * G * DT * (this.state === 'hitstun' || this.state === 'blockstun' ? 0.7 : 1.6));
      }
      this.x += this.vx * DT;
      this.y += this.vy * DT;
      if (!this.air && this.y !== 0) { this.y = 0; this.vy = 0; }
      if (this.air && this.y <= 0 && this.vy <= 0) this.land(m);
      // walls at the ship's rails
      const W = OP.STAGE_HALF - 0.25;
      if (this.x < -W || this.x > W) {
        const side = this.x < 0 ? -1 : 1;
        this.x = side * W;
        if (this.wallBounce && Math.abs(this.vx) > 3.5) {
          this.vx = -this.vx * 0.35; this.vy = Math.max(this.vy, 3); this.air = true; this.wallBounce = false;
          m.shake(6); OP.Audio.sfx('hitH'); m.dust(this.x, this.y + 0.8, 1.2, true);
        } else if (this.state !== 'tagout') this.vx = 0;
      }
      // stretch springs
      const mv = this.state === 'attack' ? this.move : null;
      for (const limb of ['aF', 'lF']) {
        let tgt = 0;
        if (mv && mv.stretch && mv.stretch.limb === limb) {
          const s = mv.stretch;
          const live = this.mt >= s.from && this.mt < mv.startup + mv.active && !(this.connected && mv.hits === 1);
          tgt = live ? s.len : 0;
          if (live && s.wobble) tgt = s.len * (0.4 + 0.6 * Math.abs(Math.sin(this.mt * 1.3)));
        }
        const len = this.stretch[limb], v = this.stretchV[limb];
        const zeta = tgt > len ? ZETA_OUT : ZETA_BACK;
        const acc = SPRING_K * (tgt - len) - 2 * zeta * Math.sqrt(SPRING_K) * v;
        let nv = v + acc * DT, nl = len + nv * DT;
        if (nl < -0.04) { nl = -0.04; nv = -nv * 0.3; }
        if (this.def.id !== 'luffy') { nl = 0; nv = 0; }
        if (tgt === 0 && Math.abs(nl) < 0.004 && Math.abs(nv) < 0.05) { nl = 0; nv = 0; }
        if (tgt === 0 && len > 0.5 && nl <= 0.5 && nv < 0) OP.Audio.sfx('snap'); // rubber snapping home
        this.stretch[limb] = nl; this.stretchV[limb] = nv;
      }
    }

    land(m) {
      const impact = -this.vy;
      this.y = 0;
      const rest = this.def.restitution;
      if (this.state === 'hitstun' || this.state === 'knockdown' || this.state === 'ko') {
        if (this.groundBounce && impact > 3) {
          this.groundBounce = false; this.vy = this.bounceVy || Math.max(5.5, impact * 0.75); this.vx *= 0.6; this.bounceVy = 0;
          m.shake(5); m.dust(this.x, 0, 1.4); OP.Audio.sfx(this.def.id === 'luffy' ? 'bounce' : 'hitM');
          return;
        }
        if (impact > 4.5 && rest > 0) { // bodies bounce once off the deck (v' = e·v)
          this.vy = impact * rest * 0.5; this.vx *= 0.7;
          if (this.state !== 'ko') { this.state = 'knockdown'; this.st = 0; this.hitstun = 0; }
          m.dust(this.x, 0, 1); OP.Audio.sfx(this.def.id === 'luffy' ? 'bounce' : 'land'); m.shake(2);
          return;
        }
        this.vy = 0; this.air = false;
        if (this.state !== 'ko') { this.state = 'knockdown'; this.st = 0; this.hitstun = 0; this.setExpr('hurt'); }
        m.dust(this.x, 0, 0.8); OP.Audio.sfx('land');
        return;
      }
      this.vy = 0; this.air = false; this.airJumps = this.def.airJumps; this.flipT = 0;
      if (this.state === 'assistIn') {
        this.state = 'idle'; this.st = 0; this.vx = 0;
        const o = m.opponentOf(this); if (o) this.facing = o.x > this.x ? 1 : -1;
        this.startMove(this.def.assist, m); m.dust(this.x, 0, 0.8); return;
      }
      if (this.state === 'tagin') { this.state = 'land'; this.st = 0; this.role = 'point'; this.move = null; m.dust(this.x, 0, 1.2); OP.Audio.sfx('land'); m.shake(3); return; }
      if (this.state === 'attack') {
        if (this.move.air || this.move.airEnd) { this.move = null; this.fistScale = 1; this.state = 'land'; this.st = -4; this.vx = 0; }
        else return; // grounded move briefly airborne (e.g. hop) keeps going
      } else if (this.state === 'blockstun') {
        // stay in blockstun on the ground
      } else if (this.state === 'tagout') {
        return;
      } else { this.state = 'land'; this.st = 0; this.vx *= 0.2; }
      m.dust(this.x, 0, 0.5); OP.Audio.sfx('land');
    }

    // ---------- pose & boxes ----------
    buildPose() {
      const def = this.def, base = def.stance, s = this.state;
      let P;
      if (s !== 'throw') this.stretch.nk = 0;
      const opp = this._opp;
      switch (s) {
        case 'attack': P = Dr.sample(this.move.keys, this.mt, base); break;
        case 'walk': {
          this.walkPh += Math.abs(this.vx) * 0.11;
          const ph = this.walkPh, dir = Math.sign(this.vx * this.facing) || 1;
          const st = def.stance;
          const sF = Math.sin(ph) * 0.1 * dir, sB = -Math.sin(ph) * 0.1 * dir;
          P = Dr.solve({ fF: [st.fF[0] + sF, Math.max(0, Math.cos(ph)) * 0.06], fB: [st.fB[0] + sB, Math.max(0, -Math.cos(ph)) * 0.06], hipH: st.hipH + Math.abs(Math.sin(ph)) * 0.01, lean: st.lean + 3 * dir }, base);
          break;
        }
        case 'crouch': P = Dr.solve(this.guardPose ? PZ.cblock : PZ.crouch, base); break;
        case 'guard': P = Dr.solve(PZ.block, base); break;
        case 'jumpsquat': P = Dr.solve(PZ.squat, base); break;
        case 'land': P = Dr.solve(PZ.land, base); break;
        case 'air': case 'tagout': {
          if (this.flipT > 0) {
            this.flipT--;
            const f = Dr.solve(PZ.flip, base);
            P = Object.assign({}, f, { lean: f.lean + (18 - this.flipT) * 20 });
          } else {
            const k = clamp(0.5 - this.vy / 8, 0, 1);
            P = Dr.mix(Dr.solve(PZ.jumpUp, base), Dr.solve(PZ.jumpFall, base), k);
          }
          break;
        }
        case 'tagin': case 'assistIn': P = Dr.solve(PZ.tagIn, base); break;
        case 'dash': P = Dr.solve(this.dashDir > 0 ? PZ.dash : PZ.backdash, base); break;
        case 'hitstun': P = Dr.solve(this.air ? PZ.hitAir : this.lowHit ? PZ.hitLow : PZ.hit, base); break;
        case 'blockstun': P = Dr.solve(this.crouchBlock ? PZ.cblock : PZ.block, base); break;
        case 'knockdown': case 'ko': P = Dr.solve(this.air ? PZ.hitAir : PZ.down, base); break;
        case 'getup': P = Dr.mix(Dr.solve(PZ.down, base), Dr.solve(PZ.getup, base), clamp(this.st / 14, 0, 1)); if (this.st > 14) P = Dr.mix(P, Dr.solve({}, base), (this.st - 14) / 8); break;
        case 'intro': P = Dr.mix(Dr.solve({}, base), Dr.solve(def.intro, base), OP.ease.inOutSine(clamp(Math.sin(this.st / 40), 0, 1))); break;
        case 'win': P = Dr.solve(def.win, base); break;
        case 'throw': {
          const T = def.throw; P = Dr.sample(T.keys, this.throwT, base);
          // Gomu Gomu no Bell: the neck stretches way back, then snaps forward into a headbutt
          const t = this.throwT;
          this.stretch.nk = T.stretchNeck ? (t < 18 ? (t / 18) * 0.75 : t < 31 ? 0.75 * (1 - (t - 18) / 13) : 0) : 0;
          break;
        }
        case 'thrown': P = Dr.solve(this.y > 0.3 ? PZ.hitAir : PZ.hit, base); break;
        default: { // idle: breathing
          const b = Math.sin(this.t * 0.07);
          const s0 = Dr.solve({}, base);
          P = Object.assign({}, s0, { hipH: s0.hipH + b * 0.005, aF2: s0.aF2 + b * 3, aB2: s0.aB2 + b * 2, lean: s0.lean + b * 0.8 });
          if (def.id === 'usopp' && this.hp < this.maxHp * 0.35) { const k = Math.sin(this.t * 1.4) * 7; P.lF2 += k; P.lB2 -= k; } // knees knocking
        }
      }
      // Monster Point hunches forward like a beast, bringing its huge reach down to human height
      if (def.form === 'monster' && s !== 'knockdown' && s !== 'ko') P = Object.assign({}, P, { lean: P.lean + 22, head: P.head - 12 });
      // hit shake
      if ((s === 'hitstun' || s === 'blockstun') && this.flashT > 0) P = Object.assign({}, P, { hx: (P.hx || 0) + (this.t % 2 ? 0.012 : -0.012) });
      this.P = P;
      this.J = Dr.joints(def, P, this.stretch);
      // sword swing trail (Zoro): hand→tip positions for the last few frames of the swing
      const mv = this.state === 'attack' ? this.move : null;
      if (mv && mv.bladeTrail && this.mt >= mv.startup - 4 && this.mt < mv.startup + mv.active + 2) {
        const e = {};
        for (const sd of mv.bladeTrail === 'both' ? ['F', 'B'] : [mv.bladeTrail]) {
          const h = this.J['ha' + sd], d = limbDir(P['sw' + sd] ?? P['a' + sd + '2'] + 70);
          e[sd] = [this.toWorld([h[0] + d[0] * 0.3, h[1] + d[1] * 0.3]), this.toWorld([h[0] + d[0] * 0.86, h[1] + d[1] * 0.86])];
        }
        this.bladeTrail.push(e); if (this.bladeTrail.length > 7) this.bladeTrail.shift();
      } else if (this.bladeTrail.length) this.bladeTrail.shift();
      // afterimage trail
      const trailing = (this.state === 'attack' && this.move.trail && this.mt < this.move.startup + this.move.active) || this.state === 'dash' || this.state === 'tagin';
      if (trailing && this.t - this.lastTrail >= 2) { this.trail.push({ x: this.x, y: this.y, facing: this.facing, J: this.J, life: 12 }); this.lastTrail = this.t; if (this.trail.length > 6) this.trail.shift(); }
      for (const tr of this.trail) tr.life--;
      this.trail = this.trail.filter((t) => t.life > 0);
    }

    toWorld(p) { return [this.x + p[0] * this.facing, this.y + p[1]]; }
    capL(a, b, r, tag) { const A = this.toWorld(a), B = this.toWorld(b); return OP.cap(A[0], A[1], B[0], B[1], r, tag); }

    // Hurtboxes follow the actual limbs — including a stretched rubber arm, which can be hit.
    hurtBoxes() {
      if (!this.onScreen || this.invuln > 0 || this.state === 'ko' || this.state === 'throw' || this.state === 'thrown' || (this.state === 'tagout' && this.st > 8)) return [];
      if (this.move && this.move.invuln && this.mt >= this.move.invuln[0] && this.mt < this.move.invuln[1]) return [];
      const J = this.J, H = this.def.height * (this.def.bulk || 1); // chubby/muscular bodies are wider
      const out = [
        this.capL(J.head, J.head, J.D.headR * 1.02, 'head'),
        this.capL(J.hip, J.neck, 0.078 * H, 'torso'),
        this.capL(J.sh, J.elF, 0.03 * H, 'arm'), this.capL(J.elF, J.haF, 0.028 * H * (this.fistScale > 1.5 ? 3 : 1), 'arm'),
        this.capL(J.sh, J.elB, 0.03 * H, 'arm'), this.capL(J.elB, J.haB, 0.028 * H, 'arm'),
        this.capL(J.hip, J.knF, 0.045 * H, 'leg'), this.capL(J.knF, J.ftF, 0.035 * H, 'leg'),
        this.capL(J.hip, J.knB, 0.045 * H, 'leg'), this.capL(J.knB, J.ftB, 0.035 * H, 'leg'),
      ];
      return out;
    }

    // Active hitboxes for the current frame.
    hitBoxes() {
      if (this.state === 'tagin') return this.vy < 0 ? [{ c: this.capL(this.J.knF, this.J.ftF, 0.14), mv: OP.TAG_ENTRY }] : [];
      if (this.state !== 'attack') return [];
      const mv = this.move, t = this.mt;
      if (mv.noBox || !mv.box || t < mv.startup || t >= mv.startup + mv.active) return [];
      const J = this.J, b = mv.box, out = [];
      const r = b.r * (this.def.boxScale || 1);
      if (b.seg) out.push(this.capL(J[b.seg[0]], J[b.seg[1]], r));
      if (b.segs) for (const sg of b.segs) out.push(this.capL(J[sg[0]], J[sg[1]], r));
      if (b.sword) {
        for (const s of b.sword === 'both' ? ['F', 'B'] : [b.sword]) {
          const h = J['ha' + s], ang = this.P['sw' + s] ?? this.P['a' + s + '2'] + 70, d = limbDir(ang);
          out.push(this.capL([h[0] + d[0] * 0.12, h[1] + d[1] * 0.12], [h[0] + d[0] * 0.86, h[1] + d[1] * 0.86], r));
        }
      }
      if (b.staff) {
        const h = J['ha' + (this.def.staffHand || 'F')], d = limbDir(this.P.staff);
        const a = b.staff === 'tip' ? 0.2 : -0.5;
        out.push(this.capL([h[0] + d[0] * a, h[1] + d[1] * a], [h[0] + d[0] * 0.64, h[1] + d[1] * 0.64], r));
      }
      if (b.custom === 'gatling') {
        const s = J.sh, reach = 0.5 + Math.max(this.stretch.aF, 0.3) + 0.4;
        out.push(this.capL([s[0] + 0.2, s[1]], [s[0] + reach, s[1] - 0.05], r));
      }
      if (b.custom === 'tableKick') {
        const h = J.hip;
        out.push(this.capL([h[0] - 0.55, h[1] + 0.25], [h[0] + 0.55, h[1] + 0.25], r));
      }
      return out.map((c) => ({ c, mv }));
    }

    // Pushbox. Airborne bodies use a shorter box that starts above the feet, so a jump that
    // clears the opponent's shoulders passes over (cross-ups) instead of sliding off their head.
    pushBox() {
      const s = this.def.height / 1.75;
      const hw = 0.2 * s * Math.sqrt(this.def.bulk || 1);
      if (this.air && this.state !== 'knockdown' && this.state !== 'ko') return { x: this.x, hw, y0: this.y + 0.35 * s, y1: this.y + 1.35 * s };
      const top = this.state === 'knockdown' || this.state === 'ko' ? 0.35 : this.crouching ? 1.0 : 1.55;
      return { x: this.x, hw, y0: this.y, y1: this.y + top * s };
    }
  }

  OP.Fighter = Fighter;
})(window.OP);
