/* One Piece Frog Style — a 2-vs-2 tag match: teams, hit resolution, projectiles,
 * camera, special-move face cut-ins, particles and match flow. */
'use strict';
(function (OP) {
  const { W, H, clamp, lerp, REF_MASS } = OP;
  const Dr = OP.Draw;
  const CAN_BLOCK = new Set(['idle', 'walk', 'crouch', 'guard', 'blockstun', 'air', 'land']);
  const TAG_LINES = { luffy: 'Leave it to me!', zoro: 'Step aside.', sanji: 'Allow me.', nami: 'My turn!' };

  class Team {
    constructor(cfg, side, m) {
      this.side = side;
      this.ctrl = cfg.ctrl;
      this.members = cfg.chars.map((id, i) => new OP.Fighter(OP.RosterById[id], cfg.pal[i] || 0, this, i));
      this.pi = 0;
      this.meter = m.mode === 'training' ? 3000 : 0;
      this.pad = new OP.Input.Pad();
      this.ai = cfg.ctrl === 'cpu' ? new OP.AI(this, m.level, m.mode === 'training' ? m.dummy : null) : null;
      this.assistCD = 0; this.tagCD = 0; this.pendingEntry = 0;
      this.combo = { hits: 0, dmg: 0, t: 0, show: 0, last: 0 };
      this.lag = this.members.map((f) => f.hp);
      this.lagDelay = 0;
    }
    get point() { return this.members[this.pi]; }
    get partner() { return this.members[1 - this.pi]; }
    get alive() { return this.members.some((f) => f.alive); }
    get healthFrac() { return this.members.reduce((s, f) => s + f.hp, 0) / this.members.reduce((s, f) => s + f.maxHp, 0); }
  }

  class Match {
    constructor(cfg) {
      this.mode = cfg.mode; this.level = cfg.level ?? OP.settings.difficulty; this.dummy = cfg.dummy || { guard: 'none' };
      this.teams = cfg.teams.map((t, i) => new Team(t, i, this));
      this.humans = cfg.teams.filter((t) => t.ctrl !== 'cpu').length;
      this.proj = []; this.parts = []; this.texts = [];
      this.cam = { x: 0, y: 0, zoom: 175, gy: H * 0.86, sx: 0, sy: 0 };
      this.frame = 0; this.timer = 99 * 60; this.phase = 'intro'; this.phaseT = 0;
      this.hitstop = 0; this.slow = 0; this.cutin = null; this.shakeMag = 0; this.impact = 0; this.koCam = null;
      this.done = false; this.winner = null; this.frameInfo = null;
      const [a, b] = this.teams;
      a.point.role = 'point'; a.point.reset(-2.2, 1); a.point.state = 'intro';
      b.point.role = 'point'; b.point.reset(2.2, -1); b.point.state = 'intro';
      for (const t of this.teams) { t.partner.role = 'bench'; t.partner.x = -99; }
      if (this.mode === 'training') { this.phase = 'fight'; a.point.state = b.point.state = 'idle'; this.banner('TRAINING', '#7fe3ff', 70); }
    }

    // ---------- helpers ----------
    get fighters() { return this.teams.flatMap((t) => t.members.filter((f) => f.onScreen)); }
    enemyTeam(f) { return this.teams[1 - f.team.side]; }
    opponentOf(f) { const t = this.enemyTeam(f), p = t.point; return p.onScreen ? p : null; }
    shake(m) { this.shakeMag = Math.max(this.shakeMag, m); }
    banner(text, color, dur, size) { this.texts.push({ text, color: color || '#ffe14d', t: 0, dur: dur || 70, size: size || 110, x: W / 2, y: H * 0.42, pop: true }); }
    clampX(x) { return clamp(x, -OP.STAGE_HALF + 0.3, OP.STAGE_HALF - 0.3); }
    humanTeam(t) { return t.ctrl !== 'cpu'; }

    // Is an enemy attack or projectile about to reach f? Used for proximity guard.
    threatNear(f) {
      for (const e of this.enemyTeam(f).members) {
        if (e.onScreen && e.state === 'attack' && Math.abs(e.x - f.x) < 3.2 && e.mt < e.move.startup + e.move.active) return true;
      }
      for (const p of this.proj) if (p.team !== f.team && Math.abs(p.x - f.x) < 3.5) return true;
      return false;
    }

    // ---------- main tick ----------
    tick() {
      this.frame++;
      for (const t of this.teams) {
        let raw = t.ai ? t.ai.think(this) : OP.Input.raw(t.ctrl === 'p2' ? 1 : 0, this.humans);
        if (this.phase !== 'fight') raw = OP.Input.blank();
        t.pad.update(raw);
      }
      this.updateParticles();
      if (this.impact > 0) this.impact--;
      for (const f of this.fighters) if (f.flashT > 0 && (this.hitstop > 0 || this.cutin)) f.flashT--; // flash only the first frames of impact
      if (this.cutin) { this.updateCutin(); this.updateCamera(); return; }
      if (this.hitstop > 0) { this.hitstop--; this.updateCamera(); return; }
      if (this.slow > 0) { this.slow--; if (this.slow % 3 !== 0) { this.updateCamera(); return; } }
      this.phaseT++;
      this.flow();
      this.step();
      this.updateCamera();
    }

    flow() {
      const [a, b] = this.teams;
      if (this.phase === 'intro') {
        if (this.phaseT === 10) { a.point.say(a.point.def.quote); }
        if (this.phaseT === 60) { b.point.say(b.point.def.quote); }
        if (this.phaseT === 125) { this.banner('READY?', '#ffffff', 50, 90); OP.Audio.say('Ready?', { pitch: 0.6, rate: 0.9 }); }
        if (this.phaseT === 180) {
          this.banner('FIGHT!', '#ffe14d', 55, 140); OP.Audio.sfx('don'); OP.Audio.say('Fight!', { pitch: 0.6, rate: 1 });
          for (const t of this.teams) { t.point.state = 'idle'; t.point.st = 0; }
          this.phase = 'fight'; this.phaseT = 0;
        }
        return;
      }
      if (this.phase === 'fight' && this.mode !== 'training') {
        if (this.timer > 0) this.timer--;
        if (this.timer === 20 * 60) OP.Audio.setTempo(1.1);
        if (this.timer === 0) {
          this.phase = 'timeover'; this.phaseT = 0; this.banner('TIME OVER', '#ff8a3d', 120, 100); OP.Audio.say('Time over!', { pitch: 0.6 });
          const fa = a.healthFrac, fb = b.healthFrac;
          this.winner = fa > fb ? a : fb > fa ? b : null;
        }
      }
      if ((this.phase === 'ko' || this.phase === 'timeover') && this.phaseT === 150) {
        this.phase = 'end'; this.phaseT = 0;
        OP.Audio.playMusic('victory');
        if (this.winner) {
          const w = this.winner.point.alive ? this.winner.point : this.winner.members.find((f) => f.alive);
          if (w && !w.onScreen) { this.bringIn(this.winner, w); }
          if (w) { w.state = 'win'; w.st = 0; w.move = null; w.setExpr('win'); w.say(w.def.winLine); }
          const names = this.winner.members.map((f) => f.def.short).join(' & ');
          this.banner(names + ' WIN!', this.winner.side === 0 ? '#ffd23d' : '#7fd6ff', 400, 70);
        } else this.banner('DRAW GAME', '#ffffff', 400, 90);
      }
      if (this.phase === 'end' && this.phaseT > 210) this.done = true;
    }

    step() {
      if (this.phase === 'fight') for (const t of this.teams) this.teamActions(t);
      const fs = this.fighters;
      for (const f of fs) {
        const pad = f.role === 'point' && this.phase === 'fight' ? f.team.pad : null;
        f._opp = this.opponentOf(f);
        if (f.state === 'attack' && pad) f.tryCancel(pad, this);
        f.think(pad, this);
        if (f.role === 'assist' && !f.move && (f.state === 'idle' || f.state === 'air' || f.state === 'land')) f.leave(this);
        f.physics(this);
      }
      this.pushApart();
      this.clampSeparation();
      for (const f of this.fighters) f.buildPose();
      this.checkHits();
      for (const f of this.fighters) if (f.state === 'attack' && f.move) f.advanceMove(this);
      this.updateProjectiles();
      this.fighterFx();
      for (const t of this.teams) this.teamUpkeep(t);
    }

    // ---------- tag team ----------
    teamActions(t) {
      const p = t.point, q = t.partner, pad = t.pad;
      if (!p.alive || p.state === 'tagin') return;
      const benchReady = q.alive && q.role === 'bench';
      // Delayed Hyper Combo: tag during your hyper to chain into your partner's hyper
      if (pad.pressed('T') && p.state === 'attack' && p.move.kind === 'hyper' && p.mt >= p.move.startup && benchReady && t.meter >= 1000) {
        pad.consume('T'); this.dhc(t); return;
      }
      if (pad.pressed('T') && p.actionable() && !p.air && benchReady && t.tagCD === 0) { pad.consume('T'); this.tag(t); return; }
      if (pad.pressed('A') && benchReady && t.assistCD === 0 && ['idle', 'walk', 'crouch', 'guard', 'air', 'attack', 'dash', 'land', 'jumpsquat'].includes(p.state)) {
        pad.consume('A'); this.assist(t);
      }
    }

    tag(t) {
      const out = t.point, inn = t.partner;
      out.role = 'out'; out.leave(this);
      t.pi = 1 - t.pi;
      this.bringIn(t, inn, out.x - out.facing * 0.3, out.facing);
      t.tagCD = 150;
      OP.Audio.sfx('tag'); inn.say(TAG_LINES[inn.def.id]);
    }

    bringIn(t, inn, x, facing) {
      const opp = this.enemyTeam(inn).point;
      x = this.clampX(x ?? (this.cam.x - (t.side === 0 ? 2.5 : -2.5)));
      inn.reset(x, facing ?? (opp.x > x ? 1 : -1));
      t.pi = t.members.indexOf(inn);
      inn.role = 'point'; inn.state = 'tagin'; inn.air = true; inn.y = 3.6; inn.vy = -1.5; inn.vx = inn.facing * 1.4;
      inn.invuln = 0;
    }

    assist(t) {
      const a = t.partner, p = t.point;
      const x = this.clampX(p.x - p.facing * 1.4);
      a.reset(x, p.facing); a.role = 'assist'; a.state = 'assistIn'; a.air = true; a.y = 2.2; a.vy = 1.5; a.vx = p.facing * 2.4;
      t.assistCD = 360;
      OP.Audio.sfx('tag');
    }

    dhc(t) {
      const out = t.point, inn = t.partner, opp = this.enemyTeam(out).point;
      out.role = 'out'; out.leave(this);
      const x = this.clampX(out.x - out.facing * 0.2);
      inn.reset(x, opp.x > x ? 1 : -1);
      t.pi = 1 - t.pi; inn.role = 'point';
      this.banner('CREW COMBO!', '#ff5ad0', 60, 80);
      inn.startMove('X', this);
    }

    teamUpkeep(t) {
      if (t.assistCD > 0 && t.partner.role === 'bench') t.assistCD--;
      if (t.tagCD > 0) t.tagCD--;
      if (this.mode === 'training') {
        t.meter = 3000;
        const e = this.enemyTeam(t.point);
        if (t.ai && e.combo.t === 0) for (const f of t.members) { f.hp = Math.min(f.maxHp, f.hp + 12); f.red = 0; }
      }
      // tagged-out partner regains red health
      for (const f of t.members) {
        if (f.role === 'bench' && f.alive && f.red > 0) { const r = Math.min(f.red, 0.18); f.hp += r; f.red -= r; }
      }
      // combo timeout
      const e = this.enemyTeam(t.point);
      const victims = e.members.filter((f) => f.onScreen);
      const stunned = victims.some((f) => f.state === 'hitstun' || (f.state === 'knockdown' && f.air));
      if (t.combo.hits > 0 && !stunned) {
        if (++t.combo.t > 2) { t.combo.show = 90; t.combo.last = t.combo.hits; t.combo.lastDmg = t.combo.dmg; t.combo.hits = 0; t.combo.dmg = 0; t.combo.t = 0; }
      }
      if (t.combo.show > 0) t.combo.show--;
      // lagging damage bar
      const inCombo = e.combo.hits > 0;
      t.members.forEach((f, i) => { if (!inCombo) t.lag[i] = Math.max(f.hp, t.lag[i] - 4); if (t.lag[i] < f.hp) t.lag[i] = f.hp; });
      // replace a KO'd point
      if (t.pendingEntry > 0 && --t.pendingEntry === 0) {
        const dead = t.point; const q = t.partner;
        if (q.alive) {
          if (q.role !== 'bench') { t.pendingEntry = 10; return; }
          dead.role = 'bench'; dead.x = -99;
          this.bringIn(t, q);
          q.say(TAG_LINES[q.def.id]);
        }
      }
      // dead assist goes home
      for (const f of t.members) if (!f.alive && f.role === 'assist' && !f.air && f.st > 60) { f.role = 'bench'; f.x = -99; }
    }

    // ---------- collisions ----------
    pushApart() {
      const A = this.teams[0].point, B = this.teams[1].point;
      if (!A.onScreen || !B.onScreen) return;
      const pass = (f) => f.state === 'tagin' || f.state === 'tagout' || f.state === 'ko' || (f.move && f.move.passThrough && f.mt < f.move.startup + f.move.active + 4);
      if (pass(A) || pass(B)) return;
      const a = A.pushBox(), b = B.pushBox();
      if (!(a.y0 < b.y1 && b.y0 < a.y1)) return;
      const over = a.hw + b.hw - Math.abs(a.x - b.x);
      if (over <= 0) return;
      let dir = Math.sign(B.x - A.x);
      if (dir === 0) dir = A.facing;
      const Wl = OP.STAGE_HALF - 0.25;
      let da = -dir * over / 2, db = dir * over / 2;
      // if one fighter is pinned against a wall, the other one takes the whole push
      const na = A.x + da, nb = B.x + db;
      if (Math.abs(na) > Wl) { const fix = na - Math.sign(na) * Wl; da -= fix; db -= fix; }
      else if (Math.abs(nb) > Wl) { const fix = nb - Math.sign(nb) * Wl; da -= fix; db -= fix; }
      A.x += da; B.x += db;
    }

    clampSeparation() {
      const A = this.teams[0].point, B = this.teams[1].point;
      if (!A.onScreen || !B.onScreen || A.state === 'tagout' || B.state === 'tagout') return;
      const dx = B.x - A.x, d = Math.abs(dx);
      if (d <= OP.MAX_SEP) return;
      const ex = (d - OP.MAX_SEP) / 2, s = Math.sign(dx);
      A.x += s * ex; B.x -= s * ex;
      if (A.state === 'walk' && Math.sign(A.vx) === -s) A.vx = 0;
      if (B.state === 'walk' && Math.sign(B.vx) === s) B.vx = 0;
    }

    checkHits() {
      const fs = this.fighters;
      for (const att of fs) {
        const boxes = att.hitBoxes();
        if (!boxes.length) continue;
        const mv = boxes[0].mv;
        for (const def of this.enemyTeam(att).members) {
          if (!def.onScreen || !def.alive) continue;
          const last = att.hitList.get(def);
          if (last != null && (mv.hits <= 1 || this.frame - last < mv.every || att.hitCount >= mv.hits)) continue;
          const hurts = def.hurtBoxes();
          let contact = null;
          for (const hb of boxes) { for (const hu of hurts) { contact = OP.capsHit(hb.c, hu); if (contact) break; } if (contact) break; }
          if (contact) this.resolveHit(att, def, mv, contact, null);
        }
      }
    }

    canBlock(def, src, props) {
      if (props.guard === 'unblockable' || def.role !== 'point') return false;
      if (!CAN_BLOCK.has(def.state)) return false;
      const pad = def.team.pad;
      let away = Math.sign(def.x - src.x);
      if (away === 0) away = -def.facing;
      const back = away > 0 ? pad.cur.right : pad.cur.left;
      if (!back) return false;
      if (def.air) return true;
      const crouch = pad.cur.down;
      if (props.guard === 'low' && !crouch) return false;
      if (props.guard === 'high' && crouch) return false;
      def.crouchBlock = crouch;
      return true;
    }

    resolveHit(att, def, mv, contact, proj) {
      const src = proj || att;
      att.hitList.set(def, this.frame);
      if (proj) proj.hitList.set(def, this.frame);
      // Zoro's Toro Nagashi parries a strike and answers it
      if (!proj && def.counterArmed && def.move && def.move.counter && def.mt >= def.move.counter.from && def.mt < def.move.counter.to) {
        def.facing = Math.sign(att.x - def.x) || def.facing;
        def.startMove('counterHit', this);
        att.connected = true;
        this.hitstop = 16; this.shake(4);
        OP.Audio.sfx('clang'); OP.Audio.sfx('counter');
        this.spark(contact.x, contact.y, 'block', 1.4);
        this.popText('PARRY!', contact.x, contact.y + 0.5, '#9fe8ff');
        return;
      }
      const count = proj ? proj.hitCount : att.hitCount;
      const hits = proj ? proj.hits : mv.hits;
      const isLast = hits > 1 && count === hits - 1;
      let props = mv;
      if (isLast && mv.last) props = Object.assign({}, mv, mv.last);
      if (proj && isLast && proj.lastProps) props = Object.assign({}, mv, proj.lastProps);
      if (proj) proj.hitCount++; else att.hitCount++;
      att.connected = true;

      let dir = proj ? (Math.sign(proj.vx) || Math.sign(def.x - proj.x) || att.facing) : att.facing;
      const massK = REF_MASS / def.def.mass;
      const tAtt = att.team, tDef = def.team;

      if (this.canBlock(def, src, props)) {
        def.state = 'blockstun'; def.blockstun = props.blockstun; def.st = 0; def.move = null; def.flashT = 4;
        const chip = props.chip || 0;
        def.hp = Math.max(this.mode === 'training' ? 1 : 0, def.hp - chip);
        const push = (0.9 + props.kb[0] * 0.35) * Math.min(1.4, massK);
        def.vx = dir * push;
        if (Math.abs(def.x) > OP.STAGE_HALF - 0.5 && !att.air && !proj) att.vx = -dir * push * 0.8; // corner push-back goes to the attacker
        this.hitstop = Math.max(4, props.hitstop - 3);
        const sword = props.spark === 'slash';
        OP.Audio.sfx(sword ? 'clang' : 'block');
        this.spark(contact.x, contact.y, 'block', 1);
        tAtt.meter = Math.min(3000, tAtt.meter + props.dmg * 0.25); tDef.meter = Math.min(3000, tDef.meter + props.dmg * 0.35);
        def.setExpr('grit', 20);
        this.frameData(att, props, true);
        if (def.hp <= 0) this.onKO(def, dir);
        return;
      }

      // --- clean hit ---
      const counterHit = def.state === 'attack' && def.move && def.mt < def.move.startup;
      const combo = tAtt.combo;
      const scale = Math.max(props.kind === 'hyper' ? 0.5 : 0.3, 1 - 0.08 * Math.max(0, combo.hits - 1));
      let dmg = props.dmg * scale * (counterHit ? 1.2 : 1) * (att.motionBonus ? 1.1 : 1) * (def.role === 'assist' ? 1.5 : 1);
      if (att.def.id === 'sanji' && def.def.id === 'nami') { dmg *= 0.5; att.setExpr('heart', 70); this.hearts(att); } // he can't bring himself to kick a lady
      if (att.def.id === 'nami' && def.def.id === 'sanji') { def.setExpr('heart', 50); this.hearts(def); }
      dmg = Math.round(dmg);
      def.hp = Math.max(0, def.hp - dmg);
      def.red = Math.min(def.maxHp - def.hp, def.red + dmg * 0.55);
      if (this.mode === 'training' && def.hp < 1) def.hp = 1;
      combo.hits++; combo.dmg += dmg; combo.t = 0; combo.show = 0;
      def.comboTaken++;

      const decay = Math.max(0.55, 1 - def.comboTaken * 0.03);
      const airborne = def.air || props.launch || props.kb[1] > 0.5 || props.kb[1] < -0.5;
      def.move = null; def.state = 'hitstun'; def.st = 0; def.counterArmed = false;
      def.hitstun = Math.round(props.hitstun * (airborne ? decay : 1) + (counterHit ? 8 : 0));
      def.lowHit = props.guard === 'low';
      def.groundBounce = !!props.groundBounce; def.wallBounce = !!props.wallBounce;
      def.vx = dir * props.kb[0] * massK;
      if (airborne) {
        let vy = props.kb[1] * massK;
        if (def.air && vy >= 0) vy = Math.max(vy, 3.2); // keep juggles alive
        def.vy = vy; def.air = true;
        if (def.y <= 0 && vy > 0) def.y = 0.01;
      } else def.vy = 0;
      if (props.knockdown && !airborne) { def.vy = 3; def.air = true; def.y = 0.01; }
      def.flashT = 6; def.setExpr('hurt');
      def.fistScale = 1;

      this.hitstop = props.hitstop + (counterHit ? 4 : 0);
      if (props.shake) this.shake(props.shake);
      OP.Audio.sfx(props.hitSfx || 'hitL');
      this.spark(contact.x, contact.y, props.spark || 'punch', props.kind === 'hyper' ? 2.2 : props.dmg > 70 ? 1.4 : 1, dir);
      if (props.don || (props.kind === 'hyper' && isLast)) { this.popText('ドン!!', contact.x, contact.y + 0.9, '#fff3b0', 1.8); OP.Audio.sfx('don'); this.impact = 4; }
      if (counterHit) { this.popText('COUNTER!', def.x, def.y + 2.1, '#ff5a5a', 0.9); OP.Audio.sfx('counter'); }
      tAtt.meter = Math.min(3000, tAtt.meter + dmg * 0.9); tDef.meter = Math.min(3000, tDef.meter + dmg * 0.5);
      if (OP.settings.vibrate && navigator.vibrate && (this.humanTeam(tDef) || this.humanTeam(tAtt))) { try { navigator.vibrate(props.kind === 'hyper' ? 90 : dmg > 70 ? 35 : 15); } catch (e) { /* ignore */ } }
      this.frameData(att, props, false);
      if (def.hp <= 0) this.onKO(def, dir);
    }

    // Training-mode readout: frame advantage = stun − attacker's remaining frames.
    frameData(att, props, blocked) {
      if (this.mode !== 'training' || att.team.ai) return;
      const mv = att.move || props;
      const remain = att.move ? mv.total - att.mt : 0;
      const adv = (blocked ? props.blockstun : props.hitstun) - remain;
      this.frameInfo = { name: props.name, startup: mv.startup, active: mv.active, recovery: mv.recovery, adv, blocked, dmg: props.dmg, guard: props.guard };
    }

    onKO(f, dir) {
      f.hp = 0; f.red = 0; f.state = 'ko'; f.move = null; f.air = true; f.y = Math.max(f.y, 0.01);
      f.vy = Math.max(f.vy, 6); f.vx = dir * 3.5 * (REF_MASS / f.def.mass); f.setExpr('ko');
      const t = f.team;
      const lastStanding = !t.members.some((m) => m !== f && m.alive);
      OP.Audio.sfx('ko');
      if (lastStanding) {
        this.slow = 100; this.koCam = { f, t: 0 }; this.phase = 'ko'; this.phaseT = 0;
        this.winner = this.enemyTeam(f);
        this.banner('K.O.', '#ff3b3b', 150, 170); OP.Audio.say('K.O.!', { pitch: 0.5, rate: 0.8 });
        OP.Audio.stopMusic();
      } else {
        this.banner('K.O.', '#ff3b3b', 70, 110);
        if (f.role === 'point') t.pendingEntry = 80;
      }
    }

    // ---------- specials & cut-ins ----------
    onSpecial(f, mv) {
      if (mv.shout) f.say(mv.shout);
      const hyper = mv.kind === 'hyper';
      OP.Audio.sfx(hyper ? 'flash' : 'special');
      this.ring(f.x, f.y + 1, hyper ? '#ffe14d' : '#ffffff');
      if (f.role === 'assist') return;
      const mode = OP.settings.cutins;
      // Specials zoom to the face at most once every few seconds per fighter (and not mid-combo),
      // so the fight keeps its rhythm; hypers always get the full cinematic.
      const fresh = this.frame - (f.lastCutin || -9999) > 240 && f.team.combo.hits === 0;
      if ((hyper && mode !== 'off') || (!hyper && mode === 'all' && fresh)) {
        f.lastCutin = this.frame;
        this.cutin = { f, mv, t: 0, dur: hyper ? 84 : 26, hyper, from: Object.assign({}, this.cam) };
        f.cutPrev = f.expr;
        f.expr = mv.cutExpr || (hyper ? 'intense' : 'shout');
        if (f.def.id === 'luffy' && hyper) f.flags.noHat = false;
      }
      if (hyper) this.teams.forEach((t) => { if (t !== f.team) t.combo.t = 0; });
    }

    updateCutin() {
      const c = this.cutin;
      c.t++;
      // the camera flies into the fighter's face while time stops
      if (c.t >= c.dur) { c.f.expr = c.mv.expr || 'determined'; this.cutin = null; this.hitstop = 0; }
    }

    teleportBehind(f) {
      const o = this.opponentOf(f);
      if (!o) return;
      const side = Math.sign(f.x - o.x) || 1;
      const nx = this.clampX(o.x - side * 1.0);
      for (let i = 0; i < 6; i++) this.parts.push({ type: 'mirage', x: f.x + (Math.random() - 0.5) * 0.8, y: f.y + 0.9, vx: 0, vy: 0, life: 24, max: 24, J: f.J, facing: f.facing, f });
      f.x = nx; f.facing = o.x > nx ? 1 : -1;
    }

    // ---------- projectiles ----------
    spawnProjectile(f, mv) {
      const p = mv.proj, dir = f.facing, opp = this.opponentOf(f);
      const base = { team: f.team, owner: f, mv, kind: p.kind, t: 0, life: p.life, hits: p.hits || 1, every: p.every || 0, hitCount: 0, hitList: new Map(), dead: false, dir };
      if (p.lastKb) base.lastProps = { kb: p.lastKb, hitstun: p.lastHitstun || mv.hitstun, knockdown: true, hitstop: 14 };
      const add = (o) => this.proj.push(Object.assign({}, base, o));
      switch (p.kind) {
        case 'cloud': {
          for (const q of this.proj) if (q.owner === f && q.kind === 'cloud') q.dead = true;
          const tx = opp ? this.clampX(opp.x + opp.vx * 0.3) : f.x + dir * 2.5;
          add({ x: tx, y: p.y, vx: 0, vy: 0, r: 0.3, delay: p.delay, life: p.delay + 12 });
          break;
        }
        case 'zeus': {
          const tx = opp ? opp.x : f.x + dir * 2.5;
          p.spread.forEach((o, i) => add({ kind: 'cloud', big: true, x: this.clampX(tx + o), y: p.y + (i % 2) * 0.3, vx: 0, vy: 0, r: 0.34, delay: p.delay + i * p.stagger, life: p.delay + i * p.stagger + 12 }));
          break;
        }
        default:
          add({ x: f.x + dir * 0.7, y: p.y, vx: dir * p.vx, vy: p.vy || 0, r: p.r, len: p.len });
      }
    }

    projBox(p) {
      switch (p.kind) {
        case 'cloud': return p.t >= p.delay && p.t < p.delay + 9 ? OP.cap(p.x, p.y, p.x, 0, p.big ? 0.42 : 0.3) : null;
        case 'slash': return OP.cap(p.x, p.y - p.len / 2, p.x + p.dir * 0.1, p.y + p.len / 2, p.r);
        case 'cyclone': return OP.cap(p.x, p.y - 0.55, p.x, p.y + 0.75, p.r);
        case 'hellfire': return OP.cap(p.x, 0.35, p.x, 1.7, p.r);
        case 'lance': { const s = Math.hypot(p.vx, p.vy), ux = p.vx / s, uy = p.vy / s; return OP.cap(p.x - ux * p.len / 2, p.y - uy * p.len / 2, p.x + ux * p.len / 2, p.y + uy * p.len / 2, p.r); }
      }
      return null;
    }

    updateProjectiles() {
      for (const p of this.proj) {
        p.t++;
        p.x += p.vx * OP.DT; p.y += p.vy * OP.DT;
        if (p.kind === 'cloud' && p.t === p.delay) {
          OP.Audio.sfx('thunder'); this.shake(p.big ? 6 : 4); this.flash = 3;
          for (let i = 0; i < 8; i++) this.parts.push({ type: 'spark', kind: 'bolt', x: p.x + (Math.random() - 0.5) * 0.6, y: 0.05, vx: (Math.random() - 0.5) * 4, vy: Math.random() * 4, life: 16, max: 16, s: 0.7 });
        }
        if (p.kind === 'hellfire' && p.t % 2 === 0) this.parts.push({ type: 'fire', x: p.x + (Math.random() - 0.5) * 0.8, y: Math.random() * 1.8, vx: p.vx * 0.3, vy: 1 + Math.random() * 2, life: 26, max: 26, s: 0.25 + Math.random() * 0.25 });
        if (--p.life <= 0 || Math.abs(p.x) > OP.STAGE_HALF + 1 || p.y < -0.5 || p.y > 12) p.dead = true;
      }
      // clashes between opposing projectiles
      for (let i = 0; i < this.proj.length; i++) for (let j = i + 1; j < this.proj.length; j++) {
        const a = this.proj[i], b = this.proj[j];
        if (a.team === b.team || a.dead || b.dead) continue;
        const ca = this.projBox(a), cb = this.projBox(b);
        if (ca && cb && OP.capsHit(ca, cb)) {
          a.hits--; b.hits--; if (a.hits <= a.hitCount) a.dead = true; if (b.hits <= b.hitCount) b.dead = true;
          this.spark((a.x + b.x) / 2, (a.y + b.y) / 2, 'block', 1.3); OP.Audio.sfx('clang');
        }
      }
      for (const p of this.proj) {
        if (p.dead) continue;
        const box = this.projBox(p);
        if (!box) continue;
        for (const def of this.enemyTeam(p.owner).members) {
          if (!def.onScreen || !def.alive) continue;
          const last = p.hitList.get(def);
          if (last != null && (p.hits <= 1 || this.frame - last < p.every)) continue;
          if (p.hitCount >= p.hits) break;
          for (const hu of def.hurtBoxes()) {
            const c = OP.capsHit(box, hu);
            if (c) { this.resolveHit(p.owner, def, p.mv, c, p); if (p.hitCount >= p.hits && p.kind !== 'cloud') p.dead = true; break; }
          }
        }
      }
      this.proj = this.proj.filter((p) => !p.dead);
    }

    // ---------- particles & effects ----------
    spark(x, y, kind, s = 1, dir = 1) {
      this.parts.push({ type: 'spark', kind, x, y, vx: 0, vy: 0, life: 14, max: 14, s, dir, rot: Math.random() * Math.PI });
      const n = kind === 'block' ? 5 : 9;
      for (let i = 0; i < n * s; i++) {
        const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 5 * s;
        this.parts.push({ type: kind === 'fire' ? 'fire' : 'bit', kind, x, y, vx: Math.cos(a) * sp + dir * 1.5, vy: Math.sin(a) * sp, life: 12 + Math.random() * 10, max: 22, s: 0.05 + Math.random() * 0.06 });
      }
      if (kind === 'slash') this.parts.push({ type: 'slashline', x, y, life: 10, max: 10, rot: (Math.random() - 0.5) * 1.2 + (dir > 0 ? -0.5 : 0.5), s });
    }
    ring(x, y, col) { this.parts.push({ type: 'ring', x, y, life: 18, max: 18, col, s: 1 }); }
    dust(x, y, s = 1, wall) {
      for (let i = 0; i < 6 * s; i++) this.parts.push({ type: 'dust', x: x + (Math.random() - 0.5) * 0.4 * s, y: y + 0.05, vx: wall ? (Math.random() - 0.5) * 2 : (Math.random() - 0.5) * 3 * s, vy: Math.random() * 1.2 * s, life: 22 + Math.random() * 12, max: 34, s: 0.1 + Math.random() * 0.12 * s });
    }
    hearts(f) { OP.Audio.sfx('heart'); for (let i = 0; i < 4; i++) this.parts.push({ type: 'heart', x: f.x + (Math.random() - 0.5) * 0.5, y: f.y + 1.7, vx: (Math.random() - 0.5) * 0.8, vy: 1 + Math.random(), life: 50, max: 50, s: 0.1 + Math.random() * 0.05 }); }
    popText(text, x, y, color, s = 1) { this.parts.push({ type: 'text', text, x, y, vx: 0, vy: 0.6, life: 50, max: 50, color, s }); }

    fighterFx() {
      for (const f of this.fighters) {
        const J = f.J; if (!J) continue;
        // Sanji's cigarette smoke curls up from the mouth
        if (f.def.id === 'sanji' && f.state !== 'ko' && f.t % 12 === 0) {
          const h = f.toWorld([J.head[0] + J.D.headR * 1.3, J.head[1] - J.D.headR * 0.5]);
          this.parts.push({ type: 'smoke', x: h[0], y: h[1], vx: 0.05 * f.facing, vy: 0.25, life: 70, max: 70, s: 0.03 });
        }
        // Diable Jambe: the kicking leg blazes
        if (f.fire && f.state === 'attack' && f.mt >= f.move.startup - 8 && f.mt < f.move.startup + f.move.active + 8) {
          const a = f.toWorld(J.knF), b = f.toWorld(J.ftF);
          for (let i = 0; i < 3; i++) { const k = Math.random(); this.parts.push({ type: 'fire', x: lerp(a[0], b[0], k), y: lerp(a[1], b[1], k), vx: (Math.random() - 0.5), vy: 1 + Math.random() * 1.5, life: 18, max: 18, s: 0.1 + Math.random() * 0.12 }); }
        }
        if (f.move && f.move.fx === 'tornado' && f.state === 'attack' && f.mt % 2 === 0) {
          this.parts.push({ type: 'wind', x: f.x, y: f.y + 0.9, vx: 0, vy: 0.5, life: 16, max: 16, s: 0.7 + Math.random() * 0.3, rot: Math.random() * 6 });
        }
      }
    }

    updateParticles() {
      for (const p of this.parts) {
        p.life--;
        if (p.vx != null) { p.x += (p.vx || 0) * OP.DT; p.y += (p.vy || 0) * OP.DT; }
        if (p.type === 'bit' || p.type === 'dust') { p.vy -= (p.type === 'bit' ? 9.81 : 2) * OP.DT; }
        if (p.type === 'smoke') p.vx += Math.sin(p.life * 0.1) * 0.004;
      }
      this.parts = this.parts.filter((p) => p.life > 0);
      if (this.parts.length > 500) this.parts.splice(0, this.parts.length - 500);
      for (const t of this.texts) t.t++;
      this.texts = this.texts.filter((t) => t.t < t.dur);
      if (this.flash > 0) this.flash--;
    }

    // ---------- camera ----------
    updateCamera() {
      const c = this.cam;
      let tx, ty, tz;
      const fs = this.fighters.filter((f) => f.role !== 'bench' && f.state !== 'tagout' && Math.abs(f.x) < 20);
      if (fs.length) {
        let minX = Infinity, maxX = -Infinity, maxY = 0;
        for (const f of fs) { if (f.role === 'point' || f.role === 'assist' || f.state === 'tagin') { minX = Math.min(minX, f.x); maxX = Math.max(maxX, f.x); maxY = Math.max(maxY, f.y); } }
        if (minX === Infinity) { minX = -1; maxX = 1; }
        const width = maxX - minX + 2.8;
        tz = clamp(W / width, W / 9.2, W / 5.8);
        tx = (minX + maxX) / 2;
        ty = Math.max(0, maxY - 1.7) * 0.85;
        const half = W / 2 / tz;
        tx = clamp(tx, -OP.STAGE_HALF - 0.6 + half, OP.STAGE_HALF + 0.6 - half);
      } else { tx = 0; ty = 0; tz = 175; }
      if (this.phase === 'intro') { const k = clamp(this.phaseT / 170, 0, 1); tz = lerp(W / 5.6, tz, OP.ease.inOutSine(k)); }
      // KO: slow-motion push-in on the loser's face
      if (this.koCam) {
        const f = this.koCam.f; this.koCam.t++;
        const h = f.toWorld(f.J.head);
        const k = clamp(this.koCam.t / 40, 0, 1) * (this.koCam.t > 150 ? clamp(1 - (this.koCam.t - 150) / 40, 0, 1) : 1);
        const z = tz * 2.2;
        tx = lerp(tx, h[0], k); ty = lerp(ty, Math.max(0, h[1] - (c.gy - H * 0.5) / z), k); tz = lerp(tz, z, k);
      }
      if (this.cutin) {
        const ci = this.cutin, f = ci.f;
        const h = f.toWorld(f.J.head);
        const zin = ci.hyper ? 1.0 : 0.62; // fraction of screen height the face fills
        const z = (H * zin) / (f.J.D.headR * 2 * 2.1);
        const inT = ci.hyper ? 14 : 8, outT = ci.hyper ? 12 : 7;
        let k = ci.t < inT ? OP.ease.outCubic(ci.t / inT) : ci.t > ci.dur - outT ? 1 - OP.ease.inCubic((ci.t - (ci.dur - outT)) / outT) : 1;
        const fx = ci.hyper ? h[0] + f.facing * f.J.D.headR * 0.6 : h[0] + f.facing * f.J.D.headR * 0.9;
        const fy = h[1] - (c.gy - H * (ci.hyper ? 0.52 : 0.46)) / z;
        c.x = lerp(ci.from.x, fx, k); c.y = lerp(ci.from.y, fy, k); c.zoom = Math.exp(lerp(Math.log(ci.from.zoom), Math.log(z), k));
      } else {
        c.x = lerp(c.x, tx, 0.14); c.y = lerp(c.y, ty, 0.12); c.zoom = lerp(c.zoom, tz, 0.08);
      }
      if (this.shakeMag > 0.2) { c.sx = (Math.random() - 0.5) * this.shakeMag * 2; c.sy = (Math.random() - 0.5) * this.shakeMag * 2; this.shakeMag *= 0.86; }
      else { c.sx = c.sy = 0; this.shakeMag = 0; }
    }

    // ---------- rendering ----------
    render(ctx) {
      const c = this.cam, t = this.frame;
      OP.Stage.drawBack(ctx, c, t);
      OP.Stage.drawDeck(ctx, c);
      OP.Stage.drawShip(ctx, c, t);
      const ci = this.cutin;
      if (ci && ci.hyper) { ctx.fillStyle = `rgba(10,5,30,${0.6 * Math.min(1, ci.t / 8)})`; ctx.fillRect(0, 0, W, H); }
      ctx.save();
      ctx.translate(W / 2 - c.x * c.zoom + c.sx, c.gy + c.y * c.zoom + c.sy);
      ctx.scale(c.zoom, -c.zoom);
      // shadows
      for (const f of this.fighters) {
        const s = clamp(1 - f.y / 4, 0.3, 1);
        ctx.fillStyle = `rgba(40,20,10,${0.28 * s})`; ctx.beginPath(); ctx.ellipse(f.x, 0.005, 0.38 * s, 0.07 * s, 0, 0, Math.PI * 2); ctx.fill();
      }
      // fighters: partners/assists behind, point in front
      const order = this.fighters.slice().sort((a, b) => (a.role === 'point') - (b.role === 'point'));
      for (const f of order) this.drawFighter(ctx, f, ci);
      for (const p of this.proj) this.drawProj(ctx, p);
      this.drawParticles(ctx);
      if (OP.settings.hitboxes || this.mode === 'training' && OP.settings.hitboxes) this.drawBoxes(ctx);
      ctx.restore();
      OP.Stage.drawFront(ctx, c);
      if (this.flash > 0) { ctx.fillStyle = `rgba(255,255,230,${this.flash * 0.18})`; ctx.fillRect(0, 0, W, H); }
      if (ci) this.drawCutinOverlay(ctx, ci);
      this.drawScreenTexts(ctx);
      if (this.impact > 0) { // anime impact frame: invert everything for a few frames
        ctx.save(); ctx.globalCompositeOperation = 'difference'; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); ctx.restore();
      }
    }

    drawFighter(ctx, f, ci) {
      if (f.x < -50) return;
      const dim = ci && ci.hyper && ci.f !== f;
      if (f.trail.length) {
        for (const tr of f.trail) {
          ctx.save(); ctx.globalAlpha = (tr.life / 12) * 0.35;
          Dr.drawFighter(ctx, Object.assign(Object.create(f), { x: tr.x, y: tr.y, facing: tr.facing }), tr.J, {});
          ctx.restore();
        }
      }
      ctx.save();
      if (f.alpha < 1) ctx.globalAlpha = f.alpha;
      if (dim) ctx.globalAlpha *= 0.35;
      if (f.move && f.move.fx === 'gatling' && f.state === 'attack' && f.mt >= f.move.startup && f.mt < f.move.startup + f.move.active) this.drawGatling(ctx, f);
      Dr.drawFighter(ctx, f, f.J, { flash: f.flashT > 3 });
      ctx.restore();
      if (f.move && f.move.fx === 'tornado' && f.state === 'attack') this.drawTornado(ctx, f);
    }

    // Gomu Gomu no Gatling: a blur of stretched fists
    drawGatling(ctx, f) {
      const J = f.J, sh = f.toWorld(J.sh);
      ctx.save(); ctx.lineCap = 'round';
      for (let i = 0; i < 7; i++) {
        const ang = (Math.random() - 0.5) * 0.5, reach = 0.6 + Math.random() * 1.2;
        const ex = sh[0] + Math.cos(ang) * reach * f.facing, ey = sh[1] - 0.05 + Math.sin(ang) * reach;
        ctx.globalAlpha = 0.35 + Math.random() * 0.4;
        ctx.strokeStyle = Dr.OUT; ctx.lineWidth = 0.075; ctx.beginPath(); ctx.moveTo(sh[0], sh[1]); ctx.lineTo(ex, ey); ctx.stroke();
        ctx.strokeStyle = f.pal.skin; ctx.lineWidth = 0.05; ctx.stroke();
        ctx.fillStyle = f.pal.skin; ctx.beginPath(); ctx.arc(ex, ey, 0.075, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = Dr.OUT; ctx.lineWidth = 0.02; ctx.stroke();
      }
      ctx.restore();
    }

    drawTornado(ctx, f) {
      ctx.save(); ctx.strokeStyle = 'rgba(220,245,255,0.7)'; ctx.lineWidth = 0.04;
      for (let i = 0; i < 6; i++) {
        const y = f.y + 0.2 + i * 0.3, r = 0.35 + i * 0.1, ph = f.t * 0.6 + i;
        ctx.beginPath(); ctx.ellipse(f.x, y, r, 0.1, 0, ph % 6, (ph % 6) + 4); ctx.stroke();
      }
      ctx.restore();
    }

    drawProj(ctx, p) {
      ctx.save();
      switch (p.kind) {
        case 'slash': { // flying crescent air-blade
          ctx.translate(p.x, p.y); ctx.scale(p.dir, 1);
          for (let k = 0; k < 3; k++) {
            ctx.globalAlpha = 1 - k * 0.3;
            ctx.beginPath(); ctx.ellipse(-k * 0.15, 0, 0.18, p.len * 0.65, 0, -Math.PI / 2, Math.PI / 2);
            ctx.ellipse(-k * 0.15 - 0.05, 0, 0.08, p.len * 0.55, 0, Math.PI / 2, -Math.PI / 2, true);
            ctx.fillStyle = k ? 'rgba(160,220,255,0.6)' : '#f0fbff'; ctx.fill();
          }
          break;
        }
        case 'cyclone': {
          ctx.strokeStyle = 'rgba(235,245,255,0.85)'; ctx.lineWidth = 0.05;
          for (let i = 0; i < 7; i++) { const y = p.y - 0.6 + i * 0.22, r = 0.2 + i * 0.06, ph = p.t * 0.5 + i; ctx.beginPath(); ctx.ellipse(p.x, y, r, 0.07, 0, ph % 6, (ph % 6) + 4.2); ctx.stroke(); }
          break;
        }
        case 'hellfire': {
          const g = ctx.createRadialGradient(p.x, 1, 0.1, p.x, 1, 1.3);
          g.addColorStop(0, 'rgba(255,250,200,0.95)'); g.addColorStop(0.35, 'rgba(255,160,40,0.85)'); g.addColorStop(1, 'rgba(200,40,0,0)');
          ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(p.x, 1, 0.9 + Math.sin(p.t) * 0.05, 1.3, 0, 0, Math.PI * 2); ctx.fill();
          break;
        }
        case 'lance': {
          const s = Math.hypot(p.vx, p.vy), ux = p.vx / s, uy = p.vy / s;
          bolt(ctx, p.x - ux * 1.4, p.y - uy * 1.4, p.x + ux * 0.3, p.y + uy * 0.3, 0.05, 5);
          break;
        }
        case 'cloud': {
          const grow = clamp(p.t / 14, 0, 1), sz = (p.big ? 1.35 : 1) * grow;
          ctx.fillStyle = '#4a4f63';
          for (const [dx, dy, r] of [[-0.35, 0, 0.3], [0, 0.12, 0.38], [0.36, 0, 0.3], [0.1, -0.08, 0.3]]) { ctx.beginPath(); ctx.arc(p.x + dx * sz, p.y + dy * sz, r * sz, 0, Math.PI * 2); ctx.fill(); }
          if (p.t < p.delay && p.t % 10 < 3) { ctx.strokeStyle = '#fff7a0'; ctx.lineWidth = 0.02; ctx.beginPath(); ctx.moveTo(p.x - 0.2, p.y - 0.2); ctx.lineTo(p.x - 0.05, p.y - 0.35); ctx.lineTo(p.x + 0.1, p.y - 0.25); ctx.stroke(); }
          if (p.t < p.delay) { ctx.fillStyle = 'rgba(255,255,160,0.25)'; ctx.beginPath(); ctx.ellipse(p.x, 0.01, 0.4, 0.06, 0, 0, Math.PI * 2); ctx.fill(); }
          if (p.t >= p.delay && p.t < p.delay + 10) bolt(ctx, p.x, p.y - 0.2, p.x, 0, p.big ? 0.09 : 0.07, 9);
          break;
        }
      }
      ctx.restore();
    }

    drawParticles(ctx) {
      for (const p of this.parts) {
        const k = p.life / p.max;
        ctx.save();
        switch (p.type) {
          case 'spark': {
            const r = (1 - k) * 0.55 * p.s + 0.1;
            ctx.translate(p.x, p.y); ctx.rotate(p.rot || 0);
            const col = { punch: '#fff4a8', slash: '#e6f7ff', fire: '#ffb347', bolt: '#fff26b', block: '#8fd3ff', wind: '#e8f4ff' }[p.kind] || '#fff';
            ctx.globalAlpha = k; ctx.fillStyle = col;
            ctx.beginPath();
            for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2, rr = i % 2 ? r * 0.35 : r; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
            ctx.fill();
            if (p.kind === 'block') { ctx.strokeStyle = '#d9f2ff'; ctx.lineWidth = 0.03; ctx.beginPath(); ctx.arc(0, 0, r * 1.2, 0, Math.PI * 2); ctx.stroke(); }
            break;
          }
          case 'slashline': {
            ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.globalAlpha = k;
            ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.ellipse(0, 0, 1.1 * p.s * (1.2 - k * 0.2), 0.035 * k, 0, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = 'rgba(120,200,255,0.6)'; ctx.beginPath(); ctx.ellipse(0, 0, 1.3 * p.s, 0.08 * k, 0, 0, Math.PI * 2); ctx.fill();
            break;
          }
          case 'bit': ctx.globalAlpha = k; ctx.fillStyle = p.kind === 'slash' ? '#dff4ff' : p.kind === 'bolt' ? '#fff26b' : '#fff1b0'; ctx.fillRect(p.x - p.s / 2, p.y - p.s / 2, p.s, p.s); break;
          case 'fire': {
            ctx.globalAlpha = k; const r = p.s * (0.6 + k * 0.6);
            ctx.fillStyle = k > 0.6 ? '#fff0a0' : k > 0.3 ? '#ff9a2e' : '#d7401a';
            ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill(); break;
          }
          case 'dust': ctx.globalAlpha = k * 0.6; ctx.fillStyle = '#d9c3a0'; ctx.beginPath(); ctx.arc(p.x, p.y, p.s * (1.5 - k), 0, Math.PI * 2); ctx.fill(); break;
          case 'smoke': ctx.globalAlpha = k * 0.45; ctx.fillStyle = '#e8e8e8'; ctx.beginPath(); ctx.arc(p.x, p.y, p.s * (1 + (1 - k) * 3), 0, Math.PI * 2); ctx.fill(); break;
          case 'ring': ctx.globalAlpha = k; ctx.strokeStyle = p.col; ctx.lineWidth = 0.05 * k + 0.01; ctx.beginPath(); ctx.arc(p.x, p.y, (1 - k) * 1.6 + 0.1, 0, Math.PI * 2); ctx.stroke(); break;
          case 'wind': ctx.globalAlpha = k * 0.7; ctx.strokeStyle = '#eaf6ff'; ctx.lineWidth = 0.03; ctx.beginPath(); ctx.ellipse(p.x, p.y, p.s * (1.3 - k * 0.3), 0.15, 0, p.rot, p.rot + 3); ctx.stroke(); break;
          case 'heart': {
            ctx.globalAlpha = Math.min(1, k * 2); ctx.fillStyle = '#ff4f8b';
            const s = p.s, x = p.x, y = p.y;
            ctx.beginPath(); ctx.moveTo(x, y - s); ctx.bezierCurveTo(x - s * 1.6, y, x - s * 0.6, y + s * 1.2, x, y + s * 0.4); ctx.bezierCurveTo(x + s * 0.6, y + s * 1.2, x + s * 1.6, y, x, y - s); ctx.fill();
            break;
          }
          case 'mirage': {
            ctx.globalAlpha = k * 0.4; const f = p.f;
            Dr.drawFighter(ctx, Object.assign(Object.create(f), { x: p.x, y: 0, facing: p.facing, alpha: 1 }), p.J, {});
            break;
          }
          case 'text': {
            ctx.translate(p.x, p.y); ctx.scale(1, -1);
            const pop = 1 + Math.max(0, (k - 0.85) * 4);
            ctx.globalAlpha = Math.min(1, k * 3);
            ctx.font = `${0.42 * p.s * pop}px Bangers, Impact, "Hiragino Kaku Gothic Pro", "Noto Sans JP", sans-serif`;
            ctx.textAlign = 'center'; ctx.lineJoin = 'round';
            ctx.lineWidth = 0.08 * p.s; ctx.strokeStyle = '#1b1216'; ctx.strokeText(p.text, 0, 0);
            ctx.fillStyle = p.color; ctx.fillText(p.text, 0, 0);
            break;
          }
        }
        ctx.restore();
      }
    }

    drawBoxes(ctx) {
      const capsule = (c, fill, strokeCol) => {
        const dx = c.bx - c.ax, dy = c.by - c.ay, L = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
        ctx.save(); ctx.translate(c.ax, c.ay); ctx.rotate(a);
        ctx.beginPath(); ctx.arc(0, 0, c.r, Math.PI / 2, Math.PI * 1.5); ctx.lineTo(L, -c.r); ctx.arc(L, 0, c.r, -Math.PI / 2, Math.PI / 2); ctx.closePath();
        ctx.fillStyle = fill; ctx.fill(); ctx.lineWidth = 0.012; ctx.strokeStyle = strokeCol; ctx.stroke(); ctx.restore();
      };
      for (const f of this.fighters) {
        for (const h of f.hurtBoxes()) capsule(h, 'rgba(60,200,255,0.18)', 'rgba(60,200,255,0.9)');
        for (const h of f.hitBoxes()) capsule(h.c, 'rgba(255,40,40,0.3)', 'rgba(255,60,60,1)');
        const pb = f.pushBox();
        ctx.strokeStyle = 'rgba(255,230,60,0.9)'; ctx.lineWidth = 0.012; ctx.strokeRect(pb.x - pb.hw, pb.y0, pb.hw * 2, pb.y1 - pb.y0);
      }
      for (const p of this.proj) { const b = this.projBox(p); if (b) capsule(b, 'rgba(255,40,40,0.3)', 'rgba(255,60,60,1)'); }
    }

    drawCutinOverlay(ctx, ci) {
      const k = ci.t / ci.dur;
      const fade = Math.min(1, ci.t / 6) * Math.min(1, (ci.dur - ci.t) / 6);
      // radial speed lines around the face
      const cx = W / 2, cy = H * (ci.hyper ? 0.52 : 0.46);
      ctx.save(); ctx.globalAlpha = 0.75 * fade;
      ctx.fillStyle = ci.hyper ? '#ffffff' : '#fff8d0';
      const n = ci.hyper ? 70 : 44;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, r0 = (ci.hyper ? 330 : 250) + Math.random() * 120, w = 0.004 + Math.random() * 0.01;
        ctx.beginPath(); ctx.moveTo(cx + Math.cos(a - w) * 1400, cy + Math.sin(a - w) * 1400);
        ctx.lineTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); ctx.lineTo(cx + Math.cos(a + w) * 1400, cy + Math.sin(a + w) * 1400); ctx.fill();
      }
      ctx.restore();
      // letterbox bars + move name
      const bar = (ci.hyper ? 90 : 56) * fade;
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, bar); ctx.fillRect(0, H - bar, W, bar);
      const team = ci.f.team.side;
      const slide = OP.ease.outBack(Math.min(1, ci.t / 10));
      ctx.save();
      ctx.globalAlpha = fade;
      const bandY = ci.hyper ? H - 180 : H - 130;
      ctx.translate((team === 0 ? -1 : 1) * (1 - slide) * W, 0);
      ctx.fillStyle = team === 0 ? 'rgba(214,40,40,0.92)' : 'rgba(40,110,214,0.92)';
      ctx.beginPath(); ctx.moveTo(0, bandY); ctx.lineTo(W, bandY - 30); ctx.lineTo(W, bandY + 60); ctx.lineTo(0, bandY + 90); ctx.fill();
      ctx.fillStyle = '#ffe14d'; ctx.fillRect(0, bandY + 86, W, 4);
      ctx.font = `${ci.hyper ? 64 : 50}px Bangers, Impact, sans-serif`; ctx.textAlign = 'center'; ctx.lineJoin = 'round';
      ctx.lineWidth = 8; ctx.strokeStyle = '#1b1216';
      const name = ci.mv.name.toUpperCase();
      ctx.strokeText(name, W / 2, bandY + 52); ctx.fillStyle = '#fff'; ctx.fillText(name, W / 2, bandY + 52);
      ctx.font = '26px Bangers, Impact, sans-serif'; ctx.textAlign = team === 0 ? 'left' : 'right';
      ctx.strokeText(ci.f.def.name, team === 0 ? 40 : W - 40, bandY - 4); ctx.fillStyle = '#ffe14d'; ctx.fillText(ci.f.def.name, team === 0 ? 40 : W - 40, bandY - 4);
      ctx.restore();
      if (ci.hyper && ci.t < 4) { ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fillRect(0, 0, W, H); }
      void k;
    }

    drawScreenTexts(ctx) {
      for (const t of this.texts) {
        const k = t.t / t.dur;
        const pop = t.pop ? (t.t < 8 ? 1.6 - OP.ease.outBack(t.t / 8) * 0.6 : 1) : 1;
        const a = Math.min(1, (t.dur - t.t) / 10);
        ctx.save(); ctx.globalAlpha = a;
        ctx.translate(t.x, t.y); ctx.scale(pop, pop); ctx.rotate(-0.04);
        ctx.font = `${t.size}px Bangers, Impact, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
        ctx.lineWidth = t.size * 0.14; ctx.strokeStyle = '#1b1216'; ctx.strokeText(t.text, 0, 0);
        ctx.fillStyle = t.color; ctx.fillText(t.text, 0, 0);
        ctx.restore();
        void k;
      }
    }
  }

  function bolt(ctx, x0, y0, x1, y1, w, n) {
    const pts = [[x0, y0]];
    for (let i = 1; i < n; i++) { const k = i / n; pts.push([lerp(x0, x1, k) + (Math.random() - 0.5) * 0.25, lerp(y0, y1, k) + (Math.random() - 0.5) * 0.08]); }
    pts.push([x1, y1]);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    for (const [lw, col] of [[w * 4, 'rgba(255,240,120,0.35)'], [w * 1.6, '#fff26b'], [w * 0.6, '#ffffff']]) {
      ctx.lineWidth = lw; ctx.strokeStyle = col; ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (const p of pts) ctx.lineTo(p[0], p[1]); ctx.stroke();
    }
  }

  OP.Match = Match;
})(window.OP);
