/* One Piece Frog Style — boot, scenes (title, menus, character select, VS, fight,
 * results), fixed 60 Hz loop, canvas scaling and on-screen touch controls. */
'use strict';
(function (OP) {
  const { W, H, clamp } = OP;
  const { text, portrait, FONT } = OP.HUD;
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

  // ---------- canvas scaling (letterboxed 16:9) ----------
  let view = { s: 1, ox: 0, oy: 0, dpr: 1 };
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth, h = window.innerHeight;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    const s = Math.min(w / W, h / H);
    view = { s, ox: (w - W * s) / 2, oy: (h - H * s) / 2, dpr };
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 200));
  resize();

  // ---------- iOS Safari zoom guard ----------
  // Safari ignores user-scalable=no, so rapid button taps (double-tap zoom) or a pinch
  // zoom the whole page and push the controls off screen. Block those gestures, and if
  // the page still ends up zoomed, re-apply the viewport to snap it back to 1×.
  const opts = { passive: false };
  document.addEventListener('gesturestart', (e) => e.preventDefault(), opts);
  document.addEventListener('gesturechange', (e) => e.preventDefault(), opts);
  document.addEventListener('touchmove', (e) => { if (e.touches.length > 1 || (e.scale && e.scale !== 1)) e.preventDefault(); }, opts);
  let lastTouchEnd = 0;
  document.addEventListener('touchend', (e) => { const now = Date.now(); if (now - lastTouchEnd < 400) e.preventDefault(); lastTouchEnd = now; }, opts);
  document.addEventListener('dblclick', (e) => e.preventDefault(), opts);
  const vmeta = document.querySelector('meta[name=viewport]');
  const VIEWPORT = vmeta ? vmeta.content : '';
  function unzoom() {
    const vv = window.visualViewport;
    if (!vmeta || !vv || Math.abs(vv.scale - 1) < 0.01) return;
    vmeta.content = VIEWPORT + ', minimum-scale=1';
    setTimeout(() => { vmeta.content = VIEWPORT; resize(); }, 60);
  }
  if (window.visualViewport) window.visualViewport.addEventListener('resize', () => { unzoom(); resize(); });
  window.addEventListener('orientationchange', () => setTimeout(unzoom, 250));


  let regions = [], nextRegions = [];
  function region(x, y, w, h, fn, id) { nextRegions.push({ x, y, w, h, fn, id }); }
  let hoverId = null;
  function toLogical(e) { return { x: (e.clientX - view.ox) / view.s, y: (e.clientY - view.oy) / view.s }; }
  canvas.addEventListener('pointerdown', (e) => {
    OP.Audio.init(); goFullscreen();
    const p = toLogical(e);
    for (let i = regions.length - 1; i >= 0; i--) {
      const r = regions[i];
      if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) { r.fn(); return; }
    }
    if (scene.tap) scene.tap(p);
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = toLogical(e); hoverId = null;
    for (const r of regions) if (r.id != null && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) hoverId = r.id;
  });

  let fsTried = false;
  function goFullscreen() {
    if (!isTouch || fsTried) return; fsTried = true;
    const el = document.documentElement;
    try {
      const p = el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : el.webkitRequestFullscreen && el.webkitRequestFullscreen();
      if (p && p.then) p.then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => {})).catch(() => {});
    } catch (e) { /* not supported (iOS) */ }
  }

  // ---------- menu navigation from keyboard / pads ----------
  const navPad = new OP.Input.Pad();
  const keyPrev = {};
  function keyEdge(code) { const d = OP.Input.isDown(code), e = d && !keyPrev[code]; keyPrev[code] = d; return e; }
  function readNav() {
    navPad.update(OP.Input.raw(0, 1));
    const enter = keyEdge('Enter'), space = keyEdge('Space'), esc = keyEdge('Escape'), bs = keyEdge('Backspace'), pk = keyEdge('KeyP');
    return {
      up: navPad.edge('up'), down: navPad.edge('down'), left: navPad.edge('left'), right: navPad.edge('right'),
      ok: navPad.edge('L') || enter || space || navPad.edge('S'), back: navPad.edge('H') || esc || bs,
      start: enter || esc || pk || navPad.edge('start') || touchPause,
    };
  }
  let touchPause = false;

  // ---------- shared menu drawing ----------
  let T = 0;
  function backdrop(dim = 0.45) {
    const cam = { x: Math.sin(T * 0.002) * 3, y: 0.4, zoom: 150, gy: H * 0.9, sx: 0, sy: 0 };
    OP.Stage.drawBack(ctx, cam, T); OP.Stage.drawDeck(ctx, cam); OP.Stage.drawShip(ctx, cam, T);
    ctx.fillStyle = `rgba(8,10,30,${dim})`; ctx.fillRect(0, 0, W, H);
  }
  function button(x, y, w, h, label, sel, fn, id, sub) {
    const hov = hoverId === id;
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(w, 0); ctx.lineTo(w - 14, h); ctx.lineTo(0, h); ctx.closePath();
    ctx.fillStyle = sel ? '#d62828' : hov ? 'rgba(60,60,90,0.95)' : 'rgba(20,20,40,0.85)'; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = sel ? '#ffe14d' : '#1b1216'; ctx.stroke();
    ctx.restore();
    text(ctx, label, x + w / 2, y + h / 2 + 11, 30, sel ? '#ffe14d' : '#ffffff', 'center');
    if (sub && sel) text(ctx, sub, W / 2, H - 70, 22, '#ffffff', 'center');
    region(x, y, w, h, fn, id);
  }
  function disclaimer(y = H - 16) {
    ctx.font = `14px ${FONT}`; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText('Unofficial fan game — not for profit. ONE PIECE © Eiichiro Oda / Shueisha, Toei Animation. Not affiliated with or endorsed by the rights holders.', W / 2, y);
  }

  // Frog mascot wearing a straw hat — Frog Federation meets the Grand Line.
  function frog(x, y, s, t) {
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    const bob = Math.sin(t * 0.08) * 3;
    ctx.translate(0, bob);
    ctx.lineWidth = 5; ctx.strokeStyle = '#1b1216';
    // body
    ctx.fillStyle = '#4caf50'; ctx.beginPath(); ctx.ellipse(0, 40, 70, 52, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#b8e986'; ctx.beginPath(); ctx.ellipse(0, 55, 42, 32, 0, 0, Math.PI * 2); ctx.fill();
    // red vest
    ctx.fillStyle = '#d62828'; ctx.beginPath(); ctx.moveTo(-62, 20); ctx.lineTo(-30, 10); ctx.lineTo(-38, 80); ctx.lineTo(-60, 70); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(62, 20); ctx.lineTo(30, 10); ctx.lineTo(38, 80); ctx.lineTo(60, 70); ctx.fill(); ctx.stroke();
    // head
    ctx.fillStyle = '#4caf50'; ctx.beginPath(); ctx.ellipse(0, -10, 80, 48, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    for (const sx of [-1, 1]) {
      ctx.fillStyle = '#4caf50'; ctx.beginPath(); ctx.arc(sx * 42, -48, 26, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(sx * 42, -48, 17, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#1b1216'; ctx.beginPath(); ctx.arc(sx * 42 + 4, -46, 8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(sx * 42 + 7, -50, 3, 0, Math.PI * 2); ctx.fill();
    }
    // grin + scar
    ctx.fillStyle = '#6b1a1a'; ctx.beginPath(); ctx.moveTo(-50, 0); ctx.quadraticCurveTo(0, 42, 50, 0); ctx.quadraticCurveTo(0, 14, -50, 0); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(-44, 3); ctx.quadraticCurveTo(0, 16, 44, 3); ctx.quadraticCurveTo(0, 22, -44, 3); ctx.fill();
    ctx.strokeStyle = '#8a3b2e'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-36, -22); ctx.lineTo(-20, -20); ctx.moveTo(-32, -17); ctx.lineTo(-30, -26); ctx.moveTo(-25, -16); ctx.lineTo(-23, -25); ctx.stroke();
    // straw hat
    ctx.lineWidth = 5; ctx.strokeStyle = '#1b1216';
    ctx.fillStyle = '#e8c547'; ctx.beginPath(); ctx.ellipse(0, -70, 110, 20, -0.08, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-58, -72); ctx.bezierCurveTo(-60, -140, 60, -145, 58, -78); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#c8282b'; ctx.beginPath(); ctx.moveTo(-58, -74); ctx.lineTo(-59, -92); ctx.bezierCurveTo(-20, -100, 20, -102, 58, -96); ctx.lineTo(58, -79); ctx.bezierCurveTo(20, -84, -20, -82, -58, -74); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  function logo(x, y, s) {
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s); ctx.rotate(-0.04);
    text(ctx, 'ONE PIECE', 0, -40, 64, '#ffffff', 'center', '#1b1216', 12);
    ctx.font = `150px ${FONT}`; ctx.textAlign = 'center'; ctx.lineJoin = 'round';
    const g = ctx.createLinearGradient(0, -20, 0, 110);
    g.addColorStop(0, '#fff27a'); g.addColorStop(0.5, '#ffb81c'); g.addColorStop(1, '#e0561c');
    ctx.lineWidth = 26; ctx.strokeStyle = '#1b1216'; ctx.strokeText('FROG STYLE', 0, 100);
    ctx.lineWidth = 10; ctx.strokeStyle = '#d62828'; ctx.strokeText('FROG STYLE', 0, 100);
    ctx.fillStyle = g; ctx.fillText('FROG STYLE', 0, 100);
    text(ctx, 'TAG BATTLE ON THE GRAND LINE', 0, 142, 26, '#9fe8ff', 'center', '#1b1216', 6);
    ctx.restore();
  }

  // ---------- scenes ----------
  let scene = null;
  function go(s) { scene = s; if (s.enter) s.enter(); updateTouchUI(); }

  const Title = {
    t: 0,
    enter() { this.t = 0; if (OP.Audio.ready) OP.Audio.playMusic('title'); },
    update(n) { this.t++; if (n.ok || n.start) this.next(); },
    tap() { this.next(); },
    next() { OP.Audio.init(); OP.Audio.playMusic('title'); OP.Audio.sfx('confirm'); go(Menu); },
    render() {
      backdrop(0.25);
      frog(W * 0.8, H * 0.52 + 20, 1.05, T);
      logo(W * 0.38, H * 0.3, 1);
      if (this.t % 60 < 42) text(ctx, isTouch ? 'TAP TO SET SAIL' : 'PRESS ENTER TO SET SAIL', W * 0.38, H * 0.68, 40, '#ffffff', 'center');
      text(ctx, 'a Frog Federation fan creation', W * 0.38, H * 0.75, 22, '#b8ffc6', 'center');
      disclaimer();
    },
  };

  const MENU_ITEMS = [
    { label: 'ARCADE', sub: 'Pick a crew of two and battle the CPU', fn: () => startSelect('cpu') },
    { label: 'VERSUS', sub: 'Two players on one keyboard or two gamepads', fn: () => startSelect('versus') },
    { label: 'TRAINING', sub: 'Practice combos, see hitboxes and frame data', fn: () => startSelect('training') },
    { label: 'HOW TO PLAY', sub: 'Controls and every character\'s move list', fn: () => go(Controls) },
    { label: 'OPTIONS', sub: 'Volume, voices, cut-ins, difficulty, hitboxes', fn: () => go(Options) },
    { label: 'CREDITS', sub: 'Fan-work notice and thanks', fn: () => go(Credits) },
    { label: 'ALL GAMES', sub: 'Back to the Frog Federation games menu', fn: () => { OP.Audio.stopMusic(); window.location.href = '../games/'; } },
  ];
  const Menu = {
    sel: 0,
    enter() { OP.Audio.playMusic('title'); },
    update(n) {
      if (n.up) { this.sel = (this.sel + MENU_ITEMS.length - 1) % MENU_ITEMS.length; OP.Audio.sfx('cursor'); }
      if (n.down) { this.sel = (this.sel + 1) % MENU_ITEMS.length; OP.Audio.sfx('cursor'); }
      if (n.ok) { OP.Audio.sfx('confirm'); MENU_ITEMS[this.sel].fn(); }
      if (n.back) { OP.Audio.sfx('back'); go(Title); }
    },
    render() {
      backdrop(0.5);
      logo(W * 0.5, 110, 0.55);
      frog(W - 150, H - 170, 0.55, T);
      MENU_ITEMS.forEach((it, i) => button(W / 2 - 180, 202 + i * 58, 360, 48, it.label, i === this.sel, () => { this.sel = i; OP.Audio.sfx('confirm'); it.fn(); }, 'm' + i, it.sub));
      disclaimer();
    },
  };

  // ---------- character select ----------
  let lastCfg = null;
  function startSelect(mode) { Select.mode = mode; go(Select); }
  const Select = {
    mode: 'cpu',
    enter() {
      this.t = 0; this.cur = [0, 3]; this.picks = [[], []]; this.pads = [new OP.Input.Pad(), new OP.Input.Pad()]; this.out = 0;
      this.ctrl = [this.mode === 'versus' ? 'p1' : 'p1', this.mode === 'versus' ? 'p2' : 'cpu'];
      OP.Audio.playMusic('select');
    },
    humanSides() { return this.mode === 'versus' ? [0, 1] : [0]; },
    update(n) {
      this.t++;
      const humans = this.mode === 'versus' ? 2 : 1;
      const R = OP.Roster.length;
      for (const side of this.humanSides()) {
        const pad = this.pads[side];
        pad.update(OP.Input.raw(side, humans));
        if (this.picks[side].length >= 2) { if (pad.edge('H')) { this.picks[side].pop(); OP.Audio.sfx('back'); } continue; }
        if (pad.edge('left')) { this.cur[side] = (this.cur[side] + R - 1) % R; OP.Audio.sfx('cursor'); }
        if (pad.edge('right')) { this.cur[side] = (this.cur[side] + 1) % R; OP.Audio.sfx('cursor'); }
        const okKey = side === 0 ? (n.ok && humans === 1) || pad.edge('L') || pad.edge('start') : pad.edge('L') || pad.edge('start');
        if (okKey) this.pick(side, this.cur[side]);
        if (pad.edge('H') || (side === 0 && n.back && humans === 1)) {
          if (this.picks[side].length) { this.picks[side].pop(); OP.Audio.sfx('back'); }
          else if (side === 0) { OP.Audio.sfx('back'); go(Menu); return; }
        }
      }
      if (this.mode !== 'versus' && this.picks[0].length === 2 && this.picks[1].length < 2 && this.t % 14 === 0) {
        // CPU picks a crew, preferring characters the player didn't take
        const pool = OP.Roster.map((c, i) => i).filter((i) => !this.picks[1].includes(i));
        const fresh = pool.filter((i) => !this.picks[0].includes(i));
        const i = OP.pick(fresh.length ? fresh : pool);
        this.cur[1] = i; this.picks[1].push(i); OP.Audio.sfx('cursor');
      }
      if (this.picks[0].length === 2 && this.picks[1].length === 2) { if (++this.out > 40) this.launch(); }
      else this.out = 0;
    },
    pick(side, i) {
      if (this.picks[side].includes(i)) { OP.Audio.sfx('back'); return; }
      this.picks[side].push(i); OP.Audio.sfx('confirm');
      const c = OP.Roster[i]; OP.Audio.speak({ en: c.short, jp: c.quoteJp, pitch: c.voice.pitch, rate: c.voice.rate, gender: c.voice.gender });
    },
    launch() {
      const ids = this.picks.map((p) => p.map((i) => OP.Roster[i].id));
      const pal = [[0, 0], ids[1].map((id) => (ids[0].includes(id) ? 1 : 0))];
      lastCfg = {
        mode: this.mode, level: OP.settings.difficulty, dummy: { guard: 'none' },
        teams: [{ chars: ids[0], pal: pal[0], ctrl: 'p1' }, { chars: ids[1], pal: pal[1], ctrl: this.mode === 'versus' ? 'p2' : 'cpu' }],
      };
      go(this.mode === 'training' ? Fight : VS);
    },
    tap(p) { void p; },
    render() {
      backdrop(0.55);
      text(ctx, this.mode === 'training' ? 'TRAINING — PICK YOUR CREW' : 'CHOOSE YOUR CREW', W / 2, 62, 54, '#ffe14d', 'center');
      text(ctx, 'Pick two: first is on point, second is your partner', W / 2, 94, 22, '#ffffff', 'center');
      const R = OP.Roster, cw = 150, gap = 12, x0 = W / 2 - (R.length * cw + (R.length - 1) * gap) / 2, y0 = 300;
      R.forEach((c, i) => {
        const x = x0 + i * (cw + gap);
        const hov = this.cur.map((v, s) => v === i && (s === 0 || this.mode === 'versus' || this.picks[0].length === 2));
        ctx.save();
        ctx.fillStyle = 'rgba(15,15,35,0.9)'; ctx.fillRect(x, y0, cw, 230);
        ctx.lineWidth = 5;
        ctx.strokeStyle = hov[0] && hov[1] ? '#ff5ad0' : hov[0] ? '#ff4040' : hov[1] ? '#40a0ff' : '#1b1216';
        ctx.strokeRect(x, y0, cw, 230);
        ctx.restore();
        const fake = { def: c, pal: c.pal[0], expr: hov[0] || hov[1] ? 'grin' : 'neutral', flags: Object.assign({}, c.flags), t: T, blink: T % 200 < 6, alive: true, team: { side: 0 } };
        portrait(ctx, fake, x + cw / 2, y0 + 82, 60, false);
        text(ctx, c.short, x + cw / 2, y0 + 186, 32, '#ffffff', 'center');
        text(ctx, c.title.toUpperCase(), x + cw / 2, y0 + 214, 15, '#ffe14d', 'center');
        this.picks.forEach((p, s) => p.forEach((pi, k) => {
          if (pi === i) text(ctx, (s === 0 ? 'P1' : this.mode === 'versus' ? 'P2' : 'CPU') + (k === 0 ? ' ★' : ' ✦'), x + (s === 0 ? 8 : cw - 8), y0 + 24 + k * 22, 20, s === 0 ? '#ff7070' : '#70b8ff', s === 0 ? 'left' : 'right');
        }));
        region(x, y0, cw, 230, () => { this.cur[0] = i; if (this.picks[0].length < 2) this.pick(0, i); }, 'c' + i);
      });
      // full-body previews
      for (const s of [0, 1]) {
        const c = R[this.cur[s]];
        if (s === 1 && this.mode !== 'versus' && this.picks[0].length < 2) continue;
        this.preview(c, s === 0 ? 78 : W - 78, 600, s === 0 ? 1 : -1, s && this.picks[0].includes(this.cur[1]) ? 1 : 0);
        const crew = this.picks[s].map((i) => R[i].short).join(' + ') || '—';
        text(ctx, (s === 0 ? 'P1: ' : this.mode === 'versus' ? 'P2: ' : 'CPU: ') + crew, s === 0 ? 30 : W - 30, 140, 28, s === 0 ? '#ff8080' : '#80c0ff', s === 0 ? 'left' : 'right');
      }
      const c = R[this.cur[0]];
      text(ctx, `"${c.quote}"`, W / 2, 580, 24, '#ffffff', 'center');
      button(20, H - 64, 150, 46, 'BACK', false, () => { if (this.picks[0].length) this.picks[0].pop(); else go(Menu); }, 'back');
      disclaimer();
    },
    preview(def, x, y, facing, palIdx) {
      const f = new OP.Fighter(def, palIdx, { side: 0, meter: 0 }, 0);
      f.t = T; f.facing = facing; f.x = 0; f.y = 0; f.state = 'idle'; f.expr = 'determined';
      if (def.id === 'zoro') f.flags.bandana = true;
      f.buildPose();
      ctx.save(); ctx.translate(x, y); ctx.scale(100, -100);
      OP.Draw.drawFighter(ctx, f, f.J, {});
      ctx.restore();
    },
  };

  const VS = {
    enter() { this.t = 0; OP.Audio.stopMusic(); OP.Audio.sfx('vs'); },
    update(n) { this.t++; if (this.t > 170 || (this.t > 30 && (n.ok || n.start))) go(Fight); },
    tap() { if (this.t > 30) go(Fight); },
    render() {
      backdrop(0.3);
      const k = OP.ease.outCubic(clamp(this.t / 20, 0, 1));
      ctx.fillStyle = '#d62828'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(W * 0.55 * k, 0); ctx.lineTo(W * 0.45 * k, H); ctx.lineTo(0, H); ctx.fill();
      ctx.fillStyle = '#2a6fd6'; ctx.beginPath(); ctx.moveTo(W, 0); ctx.lineTo(W - W * 0.45 * k, 0); ctx.lineTo(W - W * 0.55 * k, H); ctx.lineTo(W, H); ctx.fill();
      lastCfg.teams.forEach((tc, s) => tc.chars.forEach((id, i) => {
        const def = OP.RosterById[id];
        const fake = { def, pal: def.pal[tc.pal[i]], expr: 'determined', flags: Object.assign({}, def.flags, { bandana: true }), t: T, alive: true, team: { side: s } };
        const x = s === 0 ? 170 + i * 200 : W - 170 - i * 200, y = 300 + i * 150;
        const slide = (1 - k) * (s === 0 ? -400 : 400);
        portrait(ctx, fake, x + slide, y, i === 0 ? 120 : 80, s === 1);
        text(ctx, def.short, x + slide, y + (i === 0 ? 160 : 112), i === 0 ? 48 : 34, '#ffffff', 'center');
      }));
      const p = this.t < 26 ? 3 - OP.ease.outBack(clamp((this.t - 16) / 10, 0, 1)) * 2 : 1;
      if (this.t > 16) { ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(p, p); text(ctx, 'VS', 0, 40, 170, '#ffe14d', 'center', '#1b1216', 22); ctx.restore(); }
      text(ctx, OP.Stage.name.toUpperCase(), W / 2, H - 50, 30, '#ffffff', 'center');
      disclaimer();
    },
  };

  // ---------- fight + pause ----------
  const DUMMY = ['none', 'crouch', 'block', 'jump'];
  const Fight = {
    enter() {
      this.m = new OP.Match(lastCfg); this.paused = false; this.psel = 0; this.showHelp = isTouch ? 240 : 0;
      OP.Audio.playMusic('battle'); OP.Audio.setTempo(1);
    },
    pauseItems() {
      const items = [
        { label: 'RESUME', fn: () => { this.paused = false; } },
        { label: 'HITBOXES: ' + (OP.settings.hitboxes ? 'ON' : 'OFF'), fn: () => { OP.settings.hitboxes = !OP.settings.hitboxes; OP.saveSettings(); } },
        { label: 'CUT-INS: ' + OP.settings.cutins.toUpperCase(), fn: () => { const o = ['all', 'hypers', 'off']; OP.settings.cutins = o[(o.indexOf(OP.settings.cutins) + 1) % 3]; OP.saveSettings(); } },
      ];
      if (this.m.mode === 'training') items.push({ label: 'DUMMY: ' + this.m.dummy.guard.toUpperCase(), fn: () => { this.m.dummy.guard = DUMMY[(DUMMY.indexOf(this.m.dummy.guard) + 1) % DUMMY.length]; } });
      items.push({ label: 'RESTART', fn: () => go(Fight) });
      items.push({ label: 'QUIT TO MENU', fn: () => go(Menu) });
      return items;
    },
    update(n) {
      if (n.start) { this.paused = !this.paused; OP.Audio.sfx(this.paused ? 'back' : 'confirm'); touchPause = false; }
      if (this.paused) {
        const items = this.pauseItems();
        if (n.up) { this.psel = (this.psel + items.length - 1) % items.length; OP.Audio.sfx('cursor'); }
        if (n.down) { this.psel = (this.psel + 1) % items.length; OP.Audio.sfx('cursor'); }
        if (n.ok) { OP.Audio.sfx('confirm'); items[this.psel].fn(); }
        return;
      }
      if (this.showHelp > 0) this.showHelp--;
      if (OP.Input.isDown('KeyH') && !this.hPrev) { OP.settings.hitboxes = !OP.settings.hitboxes; OP.saveSettings(); }
      this.hPrev = OP.Input.isDown('KeyH');
      this.m.tick();
      if (this.m.done) go(Results);
    },
    render() {
      this.m.render(ctx);
      OP.HUD.draw(ctx, this.m);
      if (this.showHelp > 0 && this.m.phase !== 'intro') {
        ctx.save(); ctx.globalAlpha = Math.min(1, this.showHelp / 30);
        text(ctx, 'Stick: move · SP + direction: specials · HYPER needs 1 bar · TAG swaps · ASSIST calls your partner', W / 2, 150, 22, '#ffffff', 'center');
        ctx.restore();
      }
      if (this.paused) {
        ctx.fillStyle = 'rgba(5,5,20,0.7)'; ctx.fillRect(0, 0, W, H);
        text(ctx, 'PAUSED', W / 2, 150, 80, '#ffe14d', 'center');
        this.pauseItems().forEach((it, i) => button(W / 2 - 200, 200 + i * 62, 400, 50, it.label, i === this.psel, () => { this.psel = i; OP.Audio.sfx('confirm'); it.fn(); }, 'p' + i));
        disclaimer();
      } else if (!isTouch) {
        region(W - 60, H - 60, 50, 50, () => { this.paused = true; }, 'pz');
      }
    },
  };

  const Results = {
    sel: 0,
    enter() { this.t = 0; this.w = Fight.m.winner; },
    items() {
      return [
        { label: 'REMATCH', fn: () => go(Fight) },
        { label: 'CHARACTER SELECT', fn: () => startSelect(lastCfg.mode) },
        { label: 'MAIN MENU', fn: () => go(Menu) },
      ];
    },
    update(n) {
      this.t++; Fight.m.tick();
      const it = this.items();
      if (n.up) { this.sel = (this.sel + it.length - 1) % it.length; OP.Audio.sfx('cursor'); }
      if (n.down) { this.sel = (this.sel + 1) % it.length; OP.Audio.sfx('cursor'); }
      if (n.ok) { OP.Audio.sfx('confirm'); it[this.sel].fn(); }
    },
    render() {
      Fight.m.render(ctx);
      ctx.fillStyle = 'rgba(5,5,20,0.55)'; ctx.fillRect(0, 0, W, H);
      const w = this.w;
      if (w) {
        const names = w.members.map((f) => f.def.short).join(' & ');
        text(ctx, names, W / 2, 120, 64, w.side === 0 ? '#ffd23d' : '#7fd6ff', 'center');
        text(ctx, 'WIN!', W / 2, 190, 80, '#ffffff', 'center');
        const f = w.members.find((x) => x.alive) || w.point;
        text(ctx, `"${f.def.winLine}"`, W / 2, 240, 28, '#ffffff', 'center');
        portrait(ctx, f, W / 2, 360, 90, w.side === 1);
      } else text(ctx, 'DRAW GAME', W / 2, 150, 80, '#ffffff', 'center');
      this.items().forEach((it, i) => button(W / 2 - 200, 480 + i * 62, 400, 50, it.label, i === this.sel, () => { this.sel = i; it.fn(); }, 'r' + i));
      disclaimer();
    },
  };

  // ---------- how to play ----------
  const MOVE_INPUT = { L: 'L', H: 'H', cL: '↓ + L', cH: '↓ + H  (launcher)', jL: 'air L', jH: 'air H', sN: 'SP', sF: '→ + SP  or  ↓↘→ + SP', sU: '↑ + SP  or  →↓↘ + SP', sD: '↓ + SP  or  ↓↙← + SP', X: 'HYPER  or  L + H  (1 bar)' };
  const Controls = {
    ci: 0,
    update(n) {
      if (n.left) { this.ci = (this.ci + OP.Roster.length - 1) % OP.Roster.length; OP.Audio.sfx('cursor'); }
      if (n.right) { this.ci = (this.ci + 1) % OP.Roster.length; OP.Audio.sfx('cursor'); }
      if (n.back || n.ok) { OP.Audio.sfx('back'); go(Menu); }
    },
    render() {
      backdrop(0.75);
      text(ctx, 'HOW TO PLAY', W / 2, 60, 54, '#ffe14d', 'center');
      const rows = [
        ['', 'KEYBOARD P1', 'KEYBOARD P2', 'GAMEPAD'],
        ['Move / jump / crouch', 'W A S D', 'Arrow keys', 'D-pad / stick'],
        ['Light (L)', 'J', 'Num1  or  ,', 'A / Cross'],
        ['Heavy (H)', 'K', 'Num2  or  .', 'X / Square'],
        ['Special (SP)', 'L', 'Num3  or  /', 'B / Circle'],
        ['Hyper', 'O', 'Num6  or  \'', 'Y / Triangle'],
        ['Tag partner', 'I', 'Num5  or  ;', 'RB / RT'],
        ['Call assist', 'U', 'Num4  or  M', 'LB / LT'],
        ['Pause', 'Enter / Esc', 'Num Enter', 'Start'],
      ];
      rows.forEach((r, i) => r.forEach((c, j) => text(ctx, c, 40 + [0, 230, 380, 540][j], 120 + i * 30, i === 0 ? 20 : 19, i === 0 ? '#ffe14d' : j === 0 ? '#b8ffc6' : '#ffffff', 'left', '#1b1216', 4)));
      const tips = [
        'Hold BACK to block — crouch-block lows, stand-block overheads (H in the air).',
        'Chain L → H → Special → Hyper. ↓+H launches: hold ↑ to super-jump after them.',
        'Tap forward twice to dash. ↓ then ↑ = super jump. Motion inputs add +10% damage.',
        'TAG swaps characters. Your partner heals red health while resting.',
        'Tag during a Hyper to chain your partner\'s Hyper (Crew Combo, 1 more bar).',
        'Touch: left thumb = stick, right thumb = buttons. H key toggles hitboxes.',
      ];
      tips.forEach((s, i) => text(ctx, '• ' + s, 40, 410 + i * 30, 19, '#ffffff', 'left', '#1b1216', 4));
      // move list
      const c = OP.Roster[this.ci];
      const x = 800;
      ctx.fillStyle = 'rgba(15,15,35,0.85)'; ctx.fillRect(x - 20, 96, 470, 560);
      text(ctx, '◀  ' + c.name.toUpperCase() + '  ▶', x + 215, 132, 30, '#ffe14d', 'center');
      region(x - 20, 100, 80, 50, () => { this.ci = (this.ci + OP.Roster.length - 1) % OP.Roster.length; });
      region(x + 370, 100, 80, 50, () => { this.ci = (this.ci + 1) % OP.Roster.length; });
      let y = 170;
      for (const k of ['sN', 'sF', 'sU', 'sD', 'X', 'L', 'H', 'cL', 'cH', 'jL', 'jH']) {
        const mv = c.moves[k]; if (!mv) continue;
        text(ctx, mv.name, x, y, mv.kind === 'normal' ? 18 : 21, mv.kind === 'hyper' ? '#ff9af0' : mv.kind === 'special' ? '#ffe14d' : '#ffffff', 'left', '#1b1216', 4);
        text(ctx, MOVE_INPUT[k], x + 440, y, 17, '#9fe8ff', 'right', '#1b1216', 4);
        y += 40;
      }
      text(ctx, 'Assist: ' + c.moves[c.assist].name, x, y + 4, 18, '#b8ffc6', 'left', '#1b1216', 4);
      button(20, H - 64, 150, 46, 'BACK', false, () => go(Menu), 'back');
    },
  };

  // ---------- options ----------
  const Options = {
    sel: 0,
    items() {
      const s = OP.settings, pct = (v) => Math.round(v * 100) + '%';
      const cyc = (k, opts) => (d) => { s[k] = opts[(opts.indexOf(s[k]) + (d || 1) + opts.length) % opts.length]; };
      const vol = (k) => (d) => { s[k] = clamp(Math.round((s[k] + 0.1 * (d || 1)) * 10) / 10, 0, 1); if (s[k] > 1) s[k] = 0; OP.Audio.applyVolumes(); };
      return [
        { label: 'MUSIC', val: pct(s.music), fn: vol('music') },
        { label: 'SOUND FX', val: pct(s.sfx), fn: vol('sfx') },
        { label: 'VOICE CALLOUTS', val: s.voice ? 'ON' : 'OFF', fn: () => { s.voice = !s.voice; } },
        { label: 'SPECIAL CUT-INS', val: s.cutins.toUpperCase(), fn: cyc('cutins', ['all', 'hypers', 'off']) },
        { label: 'CPU LEVEL', val: ['EASY', 'NORMAL', 'HARD'][s.difficulty], fn: cyc('difficulty', [0, 1, 2]) },
        { label: 'SHOW HITBOXES', val: s.hitboxes ? 'ON' : 'OFF', fn: () => { s.hitboxes = !s.hitboxes; } },
        { label: 'VIBRATION', val: s.vibrate ? 'ON' : 'OFF', fn: () => { s.vibrate = !s.vibrate; } },
      ];
    },
    update(n) {
      const it = this.items();
      if (n.up) { this.sel = (this.sel + it.length - 1) % it.length; OP.Audio.sfx('cursor'); }
      if (n.down) { this.sel = (this.sel + 1) % it.length; OP.Audio.sfx('cursor'); }
      if (n.left || n.right || n.ok) { it[this.sel].fn(n.left ? -1 : 1); OP.saveSettings(); OP.Audio.sfx('cursor'); }
      if (n.back) { OP.Audio.sfx('back'); go(Menu); }
    },
    render() {
      backdrop(0.7);
      text(ctx, 'OPTIONS', W / 2, 80, 60, '#ffe14d', 'center');
      this.items().forEach((it, i) => {
        button(W / 2 - 300, 130 + i * 66, 600, 54, it.label + ':  ' + it.val, i === this.sel, () => { this.sel = i; it.fn(1); OP.saveSettings(); OP.Audio.sfx('cursor'); }, 'o' + i);
      });
      text(ctx, '← → or tap to change', W / 2, H - 70, 22, '#ffffff', 'center');
      button(20, H - 64, 150, 46, 'BACK', false, () => go(Menu), 'back');
    },
  };

  const Credits = {
    update(n) { if (n.back || n.ok) { OP.Audio.sfx('back'); go(Menu); } },
    render() {
      backdrop(0.8);
      text(ctx, 'CREDITS & FAN-WORK NOTICE', W / 2, 80, 50, '#ffe14d', 'center');
      const lines = [
        'ONE PIECE FROG STYLE is an unofficial, non-commercial fan creation made for fun.',
        '',
        'ONE PIECE and its characters, names, techniques and imagery belong to',
        'Eiichiro Oda / Shueisha and Toei Animation. This project is not affiliated with,',
        'sponsored by, or endorsed by them, and nobody makes any money from it.',
        '',
        'All art is drawn live in code and all music and sound effects are original',
        'synthesized tributes — no official artwork, audio or recordings are included.',
        '',
        'Please support the official release: read the manga and watch the anime.',
        '',
        'Game design & code: built for the Frog Federation.',
      ];
      lines.forEach((s, i) => text(ctx, s, W / 2, 150 + i * 36, 24, '#ffffff', 'center', '#1b1216', 5));
      frog(W - 130, H - 150, 0.5, T);
      button(20, H - 64, 150, 46, 'BACK', false, () => go(Menu), 'back');
    },
  };

  // ---------- touch controls ----------
  const touchEl = document.getElementById('touch');
  function updateTouchUI() {
    const show = isTouch && scene === Fight;
    touchEl.hidden = !show;
    document.body.classList.toggle('touching', show);
  }
  (function setupTouch() {
    const zone = document.getElementById('stick-zone'), base = document.getElementById('stick'), knob = document.getElementById('knob');
    const tIn = OP.Input.touch;
    let id = null, ox = 0, oy = 0;
    const setDir = (dx, dy) => {
      const mag = Math.hypot(dx, dy), R = 56;
      const k = mag > R ? R / mag : 1;
      knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
      const dead = 16;
      tIn.left = tIn.right = tIn.up = tIn.down = false;
      if (mag < dead) return;
      const ux = dx / mag, uy = dy / mag;
      if (ux > 0.38) tIn.right = true; if (ux < -0.38) tIn.left = true;
      if (uy < -0.5) tIn.up = true; if (uy > 0.5) tIn.down = true;
    };
    zone.addEventListener('pointerdown', (e) => {
      e.preventDefault(); OP.Audio.init(); goFullscreen();
      id = e.pointerId; zone.setPointerCapture(id);
      const r = zone.getBoundingClientRect();
      ox = e.clientX; oy = e.clientY;
      base.style.left = (ox - r.left) + 'px'; base.style.top = (oy - r.top) + 'px'; base.classList.add('on');
      setDir(0, 0);
    });
    zone.addEventListener('pointermove', (e) => { if (e.pointerId === id) setDir(e.clientX - ox, e.clientY - oy); });
    const end = (e) => { if (e.pointerId !== id) return; id = null; base.classList.remove('on'); setDir(0, 0); knob.style.transform = ''; };
    zone.addEventListener('pointerup', end); zone.addEventListener('pointercancel', end);
    for (const b of document.querySelectorAll('#touch [data-b]')) {
      const key = b.dataset.b;
      const on = (e) => { e.preventDefault(); OP.Audio.init(); tIn[key] = true; OP.Input.tapTouch(key); b.classList.add('on'); try { b.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ } };
      const off = () => { tIn[key] = false; b.classList.remove('on'); };
      b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('lostpointercapture', off);
    }
    document.getElementById('pause-btn').addEventListener('pointerdown', (e) => { e.preventDefault(); touchPause = true; });
    document.addEventListener('contextmenu', (e) => { if (e.target.closest && e.target.closest('#touch, canvas')) e.preventDefault(); });
  })();

  // ---------- rotate hint ----------
  const rotate = document.getElementById('rotate');
  document.getElementById('rotate-dismiss').addEventListener('click', () => { rotate.dataset.dismissed = '1'; rotate.hidden = true; });
  function checkRotate() {
    const portraitMode = isTouch && window.innerHeight > window.innerWidth;
    rotate.hidden = !portraitMode || rotate.dataset.dismissed === '1';
  }
  window.addEventListener('resize', checkRotate); checkRotate();

  // ---------- main loop (fixed 60 Hz simulation) ----------
  let acc = 0, last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    let dt = (now - last) / 1000; last = now;
    if (dt > 0.25) dt = 0.25;
    acc += dt;
    let steps = 0;
    if (OP.debug.freeze) acc = 0;
    while (acc >= OP.DT && steps < 5) {
      const n = readNav();
      touchPause = false;
      scene.update(n);
      OP.Input.endFrame();
      T++; acc -= OP.DT; steps++;
    }
    if (steps === 5) acc = 0;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#05060f'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    const k = view.dpr * view.s;
    ctx.setTransform(k, 0, 0, k, view.ox * view.dpr, view.oy * view.dpr);
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
    nextRegions = [];
    scene.render();
    regions = nextRegions;
    ctx.restore();
  }

  OP.debug = { freeze: false, get scene() { return scene; }, go, Fight, Select, Menu, Title, startFight(cfg) { lastCfg = cfg; go(Fight); } };
  go(Title);
  const start = () => requestAnimationFrame(frame);
  if (document.fonts && document.fonts.ready) { Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]).then(start); } else start();
})(window.OP);
