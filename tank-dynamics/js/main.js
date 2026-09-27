/* Tank Dynamics — boot, screens, input, the 60 Hz loop and match orchestration
 * (vs computer, local party, online quick match with rating). */
'use strict';
(function (TD) {
  const { W, H } = TD;
  const B = TD.BITS;
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const canvas = $('#game'), ctx = canvas.getContext('2d');
  const ui = $('#ui');
  const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  const params = new URLSearchParams(location.search);
  const GAME_ID = 'tank-dynamics';
  const EMOJI = { froggo: '🐸', blaze: '🐉', frostbite: '🐧', roborex: '🦖', nova: '🦄', bubbles: '🐙' };
  const A = TD.Audio || { init() {}, playMusic() {}, stopMusic() {}, sfx() {}, loop: () => ({ set() {}, stop() {} }), applyVolumes() {}, setTempo() {}, musicMode: () => 'none', stats: { created: 0 }, suspend() {}, resume() {} };

  /* ---------------- scaling: canvas + DOM layer share the 1280×720 logical space ---------------- */
  let view = { s: 1, ox: 0, oy: 0, dpr: 1 };
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth, h = window.innerHeight;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    const s = Math.min(w / W, h / H);
    view = { s, ox: (w - W * s) / 2, oy: (h - H * s) / 2, dpr };
    ui.style.transform = `translate(${view.ox}px, ${view.oy}px) scale(${s})`;
    const portrait = isTouch && h > w;
    $('#rotate').hidden = !portrait || rotateDismissed;
  }
  let rotateDismissed = false;
  $('#rotate-dismiss').onclick = () => { rotateDismissed = true; resize(); };
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 200));

  // iOS Safari zoom guard (same fix as One Piece Frog Style: block pinch / double-tap zoom and
  // snap the viewport back if it zooms anyway, so the controls never slide off screen).
  const nopass = { passive: false };
  document.addEventListener('gesturestart', (e) => e.preventDefault(), nopass);
  document.addEventListener('gesturechange', (e) => e.preventDefault(), nopass);
  document.addEventListener('touchmove', (e) => { if (e.touches.length > 1 || (e.scale && e.scale !== 1)) e.preventDefault(); }, nopass);
  let lastTouchEnd = 0;
  document.addEventListener('touchend', (e) => { const now = Date.now(); if (now - lastTouchEnd < 400 && !(e.target.closest && e.target.closest('input'))) e.preventDefault(); lastTouchEnd = now; }, nopass);
  document.addEventListener('dblclick', (e) => e.preventDefault(), nopass);
  const vmeta = document.querySelector('meta[name=viewport]');
  const VIEWPORT = vmeta ? vmeta.content : '';
  function unzoom() {
    const vv = window.visualViewport;
    if (!vmeta || !vv || Math.abs(vv.scale - 1) < 0.01) return;
    vmeta.content = VIEWPORT + ', minimum-scale=1';
    setTimeout(() => { vmeta.content = VIEWPORT; resize(); }, 60);
  }
  if (window.visualViewport) window.visualViewport.addEventListener('resize', () => { unzoom(); resize(); });
  resize();

  /* ---------------- profile ---------------- */
  const Profile = window.FF && FF.Profile;
  const REC_DEFAULTS = { rating: TD.Elo.START, history: [], favorite: 'froggo' };
  const rec = () => (Profile ? Profile.game(GAME_ID, REC_DEFAULTS) : Object.assign({ played: 0, wins: 0, losses: 0 }, REC_DEFAULTS));
  const tabNonce = Math.random().toString(36).slice(2, 8); // two tabs of one browser share a profile
  function refreshProfile() {
    const p = Profile ? Profile.get() : { name: 'Guest', guest: true };
    const r = rec();
    $('#p-name').textContent = p.name;
    $('#p-rating').textContent = r.rating;
    $('#p-title').textContent = TD.Elo.title(r.rating);
    $('#p-stats').textContent = `${r.wins} wins · ${r.losses} losses · ${r.played} played`;
    $('#p-avatar').textContent = EMOJI[r.favorite] || '🐸';
    $('#p-badge').textContent = p.guest ? 'Guest' : 'Frog Federation';
  }
  $('#p-rename').onclick = () => {
    const n = window.prompt('Pick a player name (up to 18 letters):', Profile ? Profile.get().name : '');
    if (n && Profile) { Profile.rename(n); refreshProfile(); }
  };
  $('#p-signin').onclick = () => {
    if (!Profile) return;
    Profile.signIn('federation').then(refreshProfile, (e) => toast(e.message));
  };

  /* ---------------- screens ---------------- */
  let screen = 'title';
  function show(id) {
    screen = id;
    for (const s of $$('.screen')) s.hidden = s.id !== 's-' + id;
    if (id === 'home') { refreshProfile(); A.playMusic('menu'); }
  }
  function overlay(id, on) { const o = $('#o-' + id); if (o) o.hidden = !on; if (id === 'settings' && on) loadSettingsUI(); }
  let toastTimer = null;
  function toast(msg, ms = 2600) {
    $('#toast').textContent = msg; overlay('toast', true);
    clearTimeout(toastTimer); toastTimer = setTimeout(() => overlay('toast', false), ms);
  }
  document.addEventListener('click', (e) => {
    const el = e.target.closest && e.target.closest('button, a');
    if (!el) return;
    A.init();
    if (el.matches('button')) A.sfx(el.hasAttribute('data-back') ? 'back' : 'click');
    const go = el.getAttribute('data-go');
    if (go === 'howto' || go === 'settings') overlay(go, true);
    else if (go) startSetup(go);
    if (el.hasAttribute('data-close')) el.closest('.overlay').hidden = true;
    if (el.hasAttribute('data-back')) { if (setup.pickIdx > 0 && setup.mode === 'party') { setup.pickIdx--; setup.picks.pop(); renderSelect(); } else show('home'); }
  });

  $('#btn-start').onclick = () => { A.init(); A.sfx('start'); goFullscreen(); show('home'); };

  let fsTried = false;
  function goFullscreen() {
    if (!isTouch || fsTried) return; fsTried = true;
    const el = document.documentElement;
    try {
      const p = el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : el.webkitRequestFullscreen && el.webkitRequestFullscreen();
      if (p && p.then) p.then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => {})).catch(() => {});
    } catch (e) { /* not supported (iOS) */ }
  }

  /* ---------------- settings ---------------- */
  function loadSettingsUI() {
    $('#set-music').value = TD.settings.music; $('#set-sfx').value = TD.settings.sfx;
    $('#set-shake').checked = TD.settings.shake; $('#set-guide').checked = TD.settings.aimGuide;
  }
  const saveSet = () => {
    TD.settings.music = +$('#set-music').value; TD.settings.sfx = +$('#set-sfx').value;
    TD.settings.shake = $('#set-shake').checked; TD.settings.aimGuide = $('#set-guide').checked;
    TD.saveSettings(); A.applyVolumes();
  };
  for (const id of ['#set-music', '#set-sfx', '#set-shake', '#set-guide']) $(id).addEventListener('input', saveSet);

  /* ---------------- setup + tank select ---------------- */
  const setup = { mode: 'cpu', diff: 'normal', size: '1v1', players: 2, teams: 'ffa', map: 'random', picks: [], pickIdx: 0, sel: 0 };
  const tankCanvases = [];
  (function buildSelect() {
    const grid = $('#tank-grid');
    TD.TANKS.forEach((t, i) => {
      const b = document.createElement('button');
      b.className = 'tcard'; b.dataset.i = i;
      const c = document.createElement('canvas'); c.width = 400; c.height = 224;
      b.append(c);
      const n = document.createElement('b'); n.textContent = t.name; b.append(n);
      const r = document.createElement('small'); r.textContent = t.role; b.append(r);
      const tk = document.createElement('span'); tk.className = 'taken'; tk.hidden = true; b.append(tk);
      b.onclick = () => { setup.sel = i; A.sfx('voice_' + t.id); renderSelect(); };
      grid.append(b); tankCanvases.push(c);
    });
    const mapOpt = $('#opt-map');
    for (const m of TD.MAPS) { const b = document.createElement('button'); b.dataset.map = m.id; b.textContent = m.name; mapOpt.append(b); }
    $('#sel-options').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b || b.id === 'btn-ready') return;
      for (const k of ['diff', 'size', 'players', 'teams', 'map']) {
        if (b.dataset[k] != null) {
          setup[k] = k === 'players' ? +b.dataset[k] : b.dataset[k];
          for (const x of b.parentElement.querySelectorAll(`[data-${k}]`)) x.classList.toggle('on', x === b);
        }
      }
    });
  })();

  function startSetup(mode) {
    setup.mode = mode; setup.picks = []; setup.pickIdx = 0;
    setup.sel = Math.max(0, TD.TANKS.findIndex((t) => t.id === rec().favorite));
    $('#opt-diff').hidden = mode !== 'cpu';
    $('#opt-size').hidden = mode !== 'cpu';
    $('#opt-players').hidden = mode !== 'party';
    $('#opt-map').hidden = mode === 'quick';
    $('#btn-ready').textContent = mode === 'quick' ? 'Find match!' : 'Ready!';
    $('#sel-title').textContent = mode === 'quick' ? 'Quick Match' : mode === 'cpu' ? 'Vs Computer' : 'Local Party';
    show('select');
    renderSelect();
  }
  function renderSelect() {
    const t = TD.TANKS[setup.sel];
    $$('.tcard').forEach((c, i) => {
      c.classList.toggle('on', i === setup.sel);
      const tk = c.querySelector('.taken');
      const who = setup.picks.indexOf(TD.TANKS[i].id);
      tk.hidden = who < 0; tk.textContent = 'P' + (who + 1);
    });
    $('#d-name').textContent = t.name; $('#d-tag').textContent = t.tagline;
    const stat = (label, v) => `<span>${label}</span><i style="width:${Math.round(TD.clamp(v, 0.08, 1) * 100)}%"></i>`;
    $('#d-stats').innerHTML = stat('Health', (t.hp - 850) / 300) + stat('Armor', t.armor / 0.14) + stat('Speed', (t.speed - 1.4) / 1.4) + stat('Fuel', (t.fuel - 7) / 9) + stat('Angles', (t.aimMax - t.aimMin) / 85);
    $('#d-weapons').innerHTML = t.weapons.map((w, i) => `<li class="${i === 2 ? 'ss' : ''}"><b>${i === 2 ? 'SS' : i + 1} · ${w.name}</b> — ${w.desc}</li>`).join('');
    const who = $('#sel-who');
    if (setup.mode === 'party') { who.textContent = `Player ${setup.pickIdx + 1}, pick!`; who.style.background = TD.TEAM_COLORS[setup.pickIdx % 4]; }
    else { who.textContent = ''; who.style.background = 'none'; }
  }
  function drawSelectArt(time) {
    TD.TANKS.forEach((t, i) => {
      const c = tankCanvases[i], g = c.getContext('2d');
      g.clearRect(0, 0, c.width, c.height);
      const on = i === setup.sel;
      TD.Skins.drawPortrait(g, t, c.width / 2, c.height - 34, on ? 46 : 42, { t: time + i, mood: on ? 'happy' : 'idle', aimAng: 0.5 + Math.sin(time + i) * 0.15, team: 0 });
    });
    const d = $('#detail-art'), g = d.getContext('2d'), t = TD.TANKS[setup.sel];
    g.clearRect(0, 0, d.width, d.height);
    TD.Skins.drawPortrait(g, t, d.width / 2, d.height - 22, 44, { t: time, mood: Math.sin(time * 0.8) > 0.6 ? 'charge' : 'idle', power: 60, aimAng: 0.6 + Math.sin(time * 0.7) * 0.3, wheel: time * 3, team: 0 });
  }

  $('#btn-ready').onclick = () => {
    const tank = TD.TANKS[setup.sel].id;
    Profile && Profile.updateGame(GAME_ID, (g) => { g.favorite = tank; }, REC_DEFAULTS);
    if (setup.mode === 'quick') { startMatchmaking(tank); return; }
    if (setup.mode === 'party') {
      setup.picks.push(tank); setup.pickIdx++;
      if (setup.pickIdx < setup.players) { renderSelect(); return; }
      const players = setup.picks.map((tk, i) => ({ tank: tk, team: setup.teams === 'teams' ? i % 2 : i, name: 'Player ' + (i + 1), kind: 'local' }));
      startBattle({ mode: 'party', map: pickMap(), players });
      return;
    }
    startBattle(cpuConfig(tank, setup.diff, setup.size, false));
  };
  const pickMap = () => (setup.map === 'random' ? TD.MAPS[(Math.random() * TD.MAPS.length) | 0].id : setup.map);
  function cpuConfig(tank, diff, size, rated) {
    const p = Profile ? Profile.get() : { name: 'You' };
    const others = TD.TANKS.map((t) => t.id).filter((id) => id !== tank).sort(() => Math.random() - 0.5);
    const players = [{ tank, team: 0, name: p.name, kind: 'local' }];
    if (size === '2v2') {
      players.push({ tank: others[0], team: 1, name: 'CPU ' + TD.tankById(others[0]).name, kind: 'cpu', level: diff });
      players.push({ tank: others[1], team: 0, name: 'Ally ' + TD.tankById(others[1]).name, kind: 'cpu', level: diff });
      players.push({ tank: others[2], team: 1, name: 'CPU ' + TD.tankById(others[2]).name, kind: 'cpu', level: diff });
    } else if (size === 'ffa3') {
      players.push({ tank: others[0], team: 1, name: 'CPU ' + TD.tankById(others[0]).name, kind: 'cpu', level: diff });
      players.push({ tank: others[1], team: 2, name: 'CPU ' + TD.tankById(others[1]).name, kind: 'cpu', level: diff });
    } else players.push({ tank: others[0], team: 1, name: 'CPU ' + TD.tankById(others[0]).name, kind: 'cpu', level: diff });
    return { mode: 'cpu', map: pickMap(), players, rated, diff };
  }

  /* ---------------- matchmaking ---------------- */
  let mm = null, mmHub = null, mmTank = null, mmTimer = null, pendingSession = null;
  function startMatchmaking(tank) {
    mmTank = tank;
    const p = Profile ? Profile.get() : { id: 'guest', name: 'Guest' };
    mmHub = mmHub || TD.defaultHub();
    const me = { id: p.id + ':' + tabNonce, name: p.name, rating: rec().rating, tank };
    mm = new TD.Matchmaker(mmHub, me);
    show('mm');
    A.playMusic('lobby');
    $('#mm-cpu').hidden = true;
    $('#mm-status').textContent = 'Finding an opponent…';
    $('#mm-where').textContent = mmHub instanceof TD.Net.WebSocketHub ? 'Online via relay server' : 'Searching this device (open another tab to test online play)';
    const upd = () => {
      if (!mm || mm.state !== 'seeking') return;
      const w = Math.round(mm.window()), r = me.rating, secs = Math.floor(mm.waited());
      $('#mm-detail').textContent = `Players rated ${r - w}–${r + w} · ${secs}s · ${mm.seekers.size} searching`;
      if (secs >= 10) $('#mm-cpu').hidden = false;
    };
    mm.onUpdate = upd; upd();
    mmTimer = setInterval(upd, 500);
    mm.onMatch = (info) => {
      clearInterval(mmTimer);
      A.sfx('found');
      $('#mm-status').textContent = `Opponent found: ${info.opponent.name}!`;
      $('#mm-detail').textContent = `Rating ${info.opponent.rating} · connecting…`;
      $('#mm-cpu').hidden = true;
      const session = new TD.Session(mmHub, info, me);
      pendingSession = session;
      const giveUp = setTimeout(() => { if (pendingSession === session) { session.close(false); pendingSession = null; toast('Could not connect to that player — searching again.'); startMatchmaking(tank); } }, 8000);
      const go = () => {
        clearTimeout(giveUp); pendingSession = null;
        const opp = session.remote.hello;
        const players = [];
        players[info.slot] = { tank, team: info.slot, name: me.name, kind: 'local' };
        players[1 - info.slot] = { tank: opp.tank || info.opponent.tank, team: 1 - info.slot, name: opp.name || info.opponent.name, kind: 'remote' };
        startBattle({ mode: 'online', map: info.map, seed: info.seed, players, rated: true, session, opponentRating: info.opponent.rating });
      };
      if (session.ready) go(); else session.onReady = go;
    };
    mm.start();
  }
  function stopMatchmaking() {
    if (mm) mm.stop();
    mm = null; clearInterval(mmTimer);
    if (pendingSession) { pendingSession.close(); pendingSession = null; }
  }
  $('#mm-cancel').onclick = () => { stopMatchmaking(); show('home'); };
  $('#mm-cpu').onclick = () => {
    stopMatchmaking();
    const r = rec().rating;
    const diff = r < 950 ? 'easy' : r < 1200 ? 'normal' : 'hard';
    startBattle(cpuConfig(mmTank, diff, '1v1', true));
  };

  /* ---------------- input ---------------- */
  const KEYMAP = {
    ArrowLeft: B.LEFT, KeyA: B.LEFT, ArrowRight: B.RIGHT, KeyD: B.RIGHT, ArrowUp: B.UP, KeyW: B.UP, ArrowDown: B.DOWN, KeyS: B.DOWN,
    Space: B.FIRE, Digit1: B.W1, Digit2: B.W2, Digit3: B.W3, Numpad1: B.W1, Numpad2: B.W2, Numpad3: B.W3, KeyQ: B.SKIP,
  };
  let held = 0, tapped = 0, keyboardUsed = false;
  const heldKeys = new Map();
  function press(code, bit) { if (!heldKeys.has(code)) { heldKeys.set(code, bit); tapped |= bit; } recompute(); }
  function release(code) { heldKeys.delete(code); recompute(); }
  function recompute() { held = 0; for (const b of heldKeys.values()) held = (b & B.W3) ? (held & ~B.W3) | b : held | b; }
  window.addEventListener('keydown', (e) => {
    A.init();
    if (e.code === 'Escape') { if (battle && !battle.over) togglePause(); return; }
    if (screen === 'title' && (e.code === 'Enter' || e.code === 'Space')) { $('#btn-start').click(); e.preventDefault(); return; }
    if (screen === 'select' && !e.repeat) {
      if (e.code === 'ArrowRight' || e.code === 'ArrowLeft' || e.code === 'ArrowUp' || e.code === 'ArrowDown') {
        const d = { ArrowRight: 1, ArrowLeft: -1, ArrowUp: -3, ArrowDown: 3 }[e.code];
        setup.sel = (setup.sel + d + TD.TANKS.length) % TD.TANKS.length; A.sfx('hover'); renderSelect(); e.preventDefault(); return;
      }
      if (e.code === 'Enter') { $('#btn-ready').click(); return; }
    }
    if (screen !== 'battle') return;
    if (e.code === 'KeyZ' || e.code === 'Tab') { toggleView(); e.preventDefault(); return; }
    const bit = KEYMAP[e.code];
    if (bit) { keyboardUsed = true; if (!e.repeat) press(e.code, bit); e.preventDefault(); }
  });
  window.addEventListener('keyup', (e) => { if (heldKeys.has(e.code)) release(e.code); });
  window.addEventListener('blur', () => { heldKeys.clear(); recompute(); });
  // touch / mouse buttons that act like keys
  for (const el of $$('[data-k]')) {
    const bit = B[el.dataset.k], id = 'ui-' + el.dataset.k;
    const down = (e) => { e.preventDefault(); A.init(); el.setPointerCapture && el.setPointerCapture(e.pointerId); el.classList.add('on'); press(id, bit); };
    const up = () => { el.classList.remove('on'); release(id); };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('lostpointercapture', up);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  for (const el of $$('.wbtn')) el.addEventListener('pointerdown', (e) => { e.preventDefault(); A.init(); tapped |= [B.W1, B.W2, B.W3][+el.dataset.w]; });
  // In-battle buttons act on pointerdown: instant, and immune to the double-tap guard above
  // swallowing the click of a second quick tap.
  const onPress = (sel, fn) => $(sel).addEventListener('pointerdown', (e) => { e.preventDefault(); A.init(); A.sfx('click'); fn(); });
  onPress('#btn-skip', () => { tapped |= B.SKIP; });
  onPress('#btn-view', () => toggleView());
  onPress('#btn-pause', () => togglePause());
  /** Input bits for the next sim frame (keyboard + touch), with quick taps latched for one frame. */
  function readLocalBits() {
    // weapon keys share two bits (1, 2, 3 = 01, 10, 11), so a fresh tap wins over a held key
    const wsel = (tapped & B.W3) || (held & B.W3);
    const bits = ((held | tapped) & ~B.W3) | wsel;
    tapped = 0;
    return bits;
  }

  /* ---------------- battle ---------------- */
  let battle = null, attract = null, paused = false;

  function makeSlots(m, cfg) {
    return cfg.players.map((pl, i) => {
      if (pl.kind === 'cpu') return { kind: 'cpu', brain: new TD.AI.Brain(pl.level || 'normal', (cfg.seed ^ (i * 7919)) >>> 0) };
      if (pl.kind === 'remote') return { kind: 'remote', session: cfg.session };
      return { kind: 'local', bits: readLocalBits };
    });
  }

  function startBattle(cfg) {
    stopAttract();
    cfg.seed = cfg.seed ?? ((Math.random() * 4294967295) >>> 0);
    const m = new TD.Match({ seed: cfg.seed, map: cfg.map, players: cfg.players.map((p) => ({ tank: p.tank, team: p.team, name: p.name, cpu: p.kind === 'cpu' })) });
    const R = new TD.WorldRenderer(m);
    battle = {
      cfg, m, R, hud: new TD.Hud(), slots: makeSlots(m, cfg), session: cfg.session || null, over: false, overAt: 0,
      overview: false, stalled: 0, time: 0, lastTurn: -1, ssWas: m.tanks.map(() => false), whistle: null, treads: null, charge: null, lastTick: 0,
    };
    R.cam.overview(); R.cam.update(0, true);
    if (cfg.session) {
      const s = cfg.session;
      s.onBye = () => endOnline('left');
      s.onDisconnect = () => endOnline('lost');
      s.onDesync = () => { toast('Your games fell out of sync — this match won\'t count.'); battle.desync = true; finish(-2); };
    }
    heldKeys.clear(); recompute(); tapped = 0;
    show('battle');
    $('#touch-pad').hidden = !isTouch; $('#fire-btn').hidden = !isTouch;
    $('#btn-view').classList.remove('on');
    const th = TD.THEMES[m.terrain.map.theme];
    A.stopMusic(); A.sfx('vs');
    setTimeout(() => { if (battle && battle.m === m) A.playMusic(th.music); }, 600);
    battle.hud.say(m.terrain.map.name, '#ffffff', cfg.mode === 'online' ? 'vs ' + cfg.players.find((p) => p.kind === 'remote').name : cfg.mode === 'party' ? 'Local Party' : 'Battle start!', 2.2);
    paused = false; overlay('pause', false);
  }

  function isLocalTurn(b = battle) {
    const a = b.m.active;
    return a >= 0 && b.slots[a] && b.slots[a].kind === 'local';
  }

  function togglePause() {
    if (!battle || battle.over) return;
    paused = !paused;
    overlay('pause', paused);
    $('#pz-quit').textContent = battle.cfg.mode === 'online' ? 'Forfeit match' : 'Quit battle';
  }
  $('#pz-resume').onclick = () => togglePause();
  $('#pz-quit').onclick = () => {
    overlay('pause', false); paused = false;
    if (!battle) return;
    if (battle.cfg.mode === 'online') { battle.session.close(true); finish(1 - battle.cfg.players.findIndex((p) => p.kind === 'local'), 'You forfeited.'); }
    else if (battle.cfg.rated) finish(1, 'You left the battle.');
    else { endBattle(); show('home'); }
  };
  function toggleView() { if (!battle) return; battle.overview = !battle.overview; $('#btn-view').classList.toggle('on', battle.overview); }

  function endOnline(why) {
    if (!battle || battle.over) return;
    toast(why === 'left' ? 'Your opponent left the battle. You win!' : 'Lost connection to your opponent. You win!');
    const me = battle.cfg.players.findIndex((p) => p.kind === 'local');
    finish(battle.cfg.players[me].team, why === 'left' ? 'Opponent left.' : 'Opponent disconnected.');
  }

  function stopLoops(b) { for (const k of ['whistle', 'treads', 'charge']) if (b[k]) { b[k].stop(); b[k] = null; } }
  function endBattle() {
    if (!battle) return;
    stopLoops(battle);
    if (battle.session && !battle.session.closed) battle.session.close(!battle.over);
    battle = null;
  }

  /** winnerTeam: team number, -1 draw, -2 no contest. */
  function finish(winnerTeam, reason) {
    const b = battle;
    if (!b || b.over) return;
    b.over = true; b.overAt = b.time;
    stopLoops(b);
    const me = b.cfg.players.findIndex((p) => p.kind === 'local');
    const myTeam = me >= 0 ? b.cfg.players[me].team : -1;
    const won = winnerTeam === myTeam, draw = winnerTeam === -1, noContest = winnerTeam === -2;
    let rating = null;
    if ((b.cfg.rated) && !noContest && Profile) {
      const r = rec();
      const opp = b.cfg.mode === 'online' ? b.cfg.opponentRating : TD.AI.LEVELS[b.cfg.diff].rating;
      const k = b.cfg.mode === 'online' ? TD.Elo.K : TD.Elo.K / 2;
      const nr = TD.Elo.update(r.rating, opp, won ? 1 : draw ? 0.5 : 0, k);
      rating = { old: r.rating, now: nr };
      Profile.updateGame(GAME_ID, (g) => {
        g.rating = nr; g.played++;
        if (won) g.wins++; else if (!draw) g.losses++;
        g.history = (g.history || []).concat([{ at: Date.now(), mode: b.cfg.mode, result: won ? 'win' : draw ? 'draw' : 'loss', delta: nr - r.rating }]).slice(-20);
      }, REC_DEFAULTS);
    } else if (Profile && b.cfg.mode === 'cpu' && !noContest) {
      Profile.updateGame(GAME_ID, (g) => { g.played++; if (won) g.wins++; else if (!draw) g.losses++; }, REC_DEFAULTS);
    }
    setTimeout(() => {
      if (battle !== b) return;
      A.stopMusic();
      A.playMusic(won || b.cfg.mode === 'party' ? 'victory' : 'defeat');
      showResults(b, winnerTeam, won, rating, reason);
    }, 1800);
  }

  function showResults(b, winnerTeam, won, rating, reason) {
    const m = b.m, party = b.cfg.mode === 'party';
    const h = $('#r-title');
    const winners = m.tanks.filter((t) => t.team === winnerTeam);
    h.textContent = winnerTeam === -2 ? 'NO CONTEST' : winnerTeam === -1 ? 'DRAW!' : party ? winners.map((t) => t.name).join(' & ') + ' WIN!' : won ? 'VICTORY!' : 'DEFEAT';
    h.classList.toggle('lose', !won && !party && winnerTeam >= -1);
    $('#r-sub').textContent = reason || (won ? 'Excellent shooting, commander!' : party ? 'What a battle!' : 'So close! Check the wind and try again.');
    const rr = $('#r-rating');
    rr.hidden = !rating;
    if (rating) {
      const d = rating.now - rating.old;
      $('#r-old').textContent = rating.old; $('#r-new').textContent = rating.now;
      const de = $('#r-delta'); de.textContent = (d >= 0 ? '+' : '') + d; de.classList.toggle('neg', d < 0);
    }
    const rows = m.tanks.map((t) => `<tr class="${t.team === winnerTeam ? 'win' : ''}"><td>${escapeHtml(t.name)}</td><td>${t.def.name}</td><td>${t.stats.dealt}</td><td>${t.stats.hits}/${t.stats.shots}</td><td>${t.stats.direct}</td><td>${t.stats.kills}</td></tr>`).join('');
    $('#r-table').innerHTML = '<tr><th>Player</th><th>Tank</th><th>Damage</th><th>Hits</th><th>Direct</th><th>K.O.</th></tr>' + rows;
    $('#r-again').textContent = b.cfg.mode === 'online' ? 'Find another match' : 'Play again';
    show('results');
    $('#r-again').onclick = () => {
      const cfg = b.cfg;
      endBattle();
      if (cfg.mode === 'online') startMatchmaking(cfg.players.find((p) => p.kind === 'local').tank);
      else startBattle(Object.assign({}, cfg, { seed: undefined, map: cfg.map && setup.map !== 'random' ? cfg.map : pickMap() }));
    };
    $('#r-home').onclick = () => { endBattle(); show('home'); };
  }
  const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ---------------- events from the sim -> effects, sound, HUD ---------------- */
  function handleEvents(b, quiet) {
    const m = b.m, R = b.R, hud = b.hud;
    const sfx = quiet ? () => {} : (n) => A.sfx(n);
    for (const e of m.events) {
      switch (e.type) {
        case 'turn': {
          const t = m.tanks[e.i];
          if (b.session) b.session.sendHash(m.turn, m.turnHash);
          if (quiet) break;
          const local = isLocalTurn(b);
          const who = b.cfg.mode === 'party' ? t.name + ' (' + t.def.name + ')' : t.name;
          if (local && b.cfg.mode !== 'party') { hud.say('YOUR TURN!', '#ffe35a', windText(m.wind), 1.4); sfx('yourTurn'); }
          else { hud.say(who, TD.TEAM_COLORS[t.team % 4], local ? 'Your turn! ' + windText(m.wind) : windText(m.wind), 1.3); sfx(local ? 'yourTurn' : 'theirTurn'); }
          b.overview = false; $('#btn-view').classList.remove('on');
          break;
        }
        case 'fire': { const t = m.tanks[e.i], w = t.def.weapons[t.usedWeapon ?? t.weapon]; R.muzzle(t, w.fx, w.color); sfx('fire_' + w.fx); break; }
        case 'fire2': { const t = m.tanks[e.i], w = t.def.weapons[2]; R.muzzle(t, w.fx, w.color); sfx('fire_' + w.fx); break; }
        case 'explode': R.explosion(e); sfx(e.big ? 'explodeBig' : 'explode'); break;
        case 'damage': {
          const t = m.tanks[e.i];
          R.number(e.amount, t.x, t.y + 3.4, e.direct);
          R.tankFx[e.i].hurt = 0.9; R.tankFx[e.i].dmgShake = 0.4;
          if (e.from >= 0 && m.tanks[e.from].team !== t.team) R.tankFx[e.from].happy = 1.6;
          if (e.direct) { R.callout('DIRECT HIT!', t.x, t.y + 9, '#ff5a8a', 1.1); sfx('hitDing'); }
          break;
        }
        case 'ko': { const t = m.tanks[e.i]; R.callout(e.how === 'drown' ? 'SPLASH OUT!' : 'K.O.!', t.x, t.y + 6, '#ffe35a', 1.5); sfx('ko'); R.cam.kick(20); break; }
        case 'drown': R.splash(e.x, m.water); sfx('splash'); break;
        case 'splash': R.splash(e.x, m.water); sfx('splash'); break;
        case 'bounce': sfx('bounce'); R.burst({ kind: 'ring', x: e.x, y: e.y, life: 0.25, size: 1.5, g: 0 }); break;
        case 'split': sfx('split'); R.burst({ kind: 'flash', x: e.x, y: e.y, life: 0.2, size: 1.5, g: 0 }); break;
        case 'drill': sfx('drill'); break;
        case 'freeze': sfx('freeze'); R.callout('FROZEN!', m.tanks[e.i].x, m.tanks[e.i].y + 7.5, '#8fe8ff', 0.9); break;
        case 'laser': sfx('laser'); R.burst({ kind: 'beam', x: e.x, y: TD.WORLD_H + 20, y2: e.y, life: 0.7, size: e.w * 0.7, g: 0 }); R.cam.kick(14); break;
        case 'blackhole': sfx('blackhole'); R.burst({ kind: 'vortex', x: e.x, y: e.y, life: 0.9, size: e.r * 0.5, g: 0 }); break;
        case 'meteorCall': sfx('meteor'); R.callout('METEOR SHOWER!', e.x, e.y + 10 || 40, '#ff8a2a', 1); break;
        case 'land': if (e.drop > 1.5) { sfx('land'); R.cam.kick(Math.min(10, e.drop * 2)); } break;
        case 'suddenDeath': hud.say('SUDDEN DEATH!', '#ff4f6a', 'The water is rising!', 2.2); sfx('suddenDeath'); A.setTempo(1.08); break;
        case 'aim': if (!quiet && b.time - (b.lastAimSfx || 0) > 0.05) { b.lastAimSfx = b.time; sfx('aim'); } break;
        case 'weapon': sfx('weapon'); break;
        case 'denied': sfx('denied'); if (isLocalTurn(b)) hud.say('SS not ready!', '#b36bff', 'Deal and take damage to charge it', 1.1); break;
        case 'nofuel': sfx('nofuel'); if (isLocalTurn(b)) hud.say('Out of fuel!', '#5ab8ff', '', 0.9); break;
        case 'face': sfx('face'); break;
        case 'timeout': hud.say("Time's up!", '#ff4f6a', '', 1); break;
        case 'skip': hud.say('Pass', '#ffffff', '', 0.8); break;
        case 'miss': if (!quiet && Math.random() < 0.5) R.callout(['Whoosh!', 'So close!', 'Missed!'][(Math.random() * 3) | 0], m.tanks[e.i].x, m.tanks[e.i].y + 6, '#ffffff', 0.7); break;
        case 'over': if (!quiet) finish(e.winner); break;
      }
    }
    m.events.length = 0;
    // SS just became ready
    m.tanks.forEach((t, i) => { const r = t.alive && t.ss >= TD.SS_MAX; if (r && !b.ssWas[i] && !quiet) { sfx('ssReady'); } b.ssWas[i] = r; });
  }
  const windText = (w) => { const s = Math.sqrt(w.x * w.x + w.y * w.y); return s < 0.5 ? 'No wind' : `Wind ${s.toFixed(1)} ${w.x >= 0 ? '→' : '←'}`; };

  function updateLoops(b) {
    const m = b.m;
    // falling-shell whistle
    const p = m.projectiles.find((q) => q.main) || m.projectiles[0];
    if (p && !b.over) {
      if (!b.whistle) b.whistle = A.loop('whistle');
      const f = TD.clamp(700 + p.vy * 18, 260, 1500);
      b.whistle.set({ f, g: p.vy < 0 ? 0.05 : 0.02 });
    } else if (b.whistle) { b.whistle.stop(); b.whistle = null; }
    const t = m.activeTank;
    const moving = t && m.phase === 'aim' && t.moving;
    if (moving && !b.treads) b.treads = A.loop('treads');
    else if (!moving && b.treads) { b.treads.stop(); b.treads = null; }
    const charging = t && m.phase === 'aim' && t.charging;
    if (charging) { if (!b.charge) b.charge = A.loop('charge'); b.charge.set({ f: 160 + t.power * 9, filter: 800 + t.power * 30 }); }
    else if (b.charge) { b.charge.stop(); b.charge = null; }
  }

  function updateCamera(b, dt) {
    const m = b.m, cam = b.R.cam;
    if (b.overview || b.attract) { cam.overview(); }
    else if (m.projectiles.length) {
      let x = 0, y = 0; for (const p of m.projectiles) { x += p.x; y += p.y; }
      x /= m.projectiles.length; y /= m.projectiles.length;
      const shooter = m.activeTank;
      const spread = shooter ? Math.abs(x - shooter.x) : 0;
      cam.focus(x, Math.min(y, TD.WORLD_H), TD.clamp(1500 / (spread + 60), cam.minS, 16));
    } else if (m.phase === 'aim' && m.activeTank) {
      const t = m.activeTank;
      cam.focus(t.x + t.facing * 10, t.y + 7, 17);
    }
    cam.update(dt);
  }

  // Draw-time tank moods come from the render-side fx state.
  function drawTanks(b, g) {
    const m = b.m, R = b.R, cam = R.cam, time = R.time;
    for (const t of m.tanks) {
      if (!t.alive && !R.tankFx[t.i].sunk) {
        if (t.y < m.water) { R.tankFx[t.i].sunk = true; continue; }
      }
      if (R.tankFx[t.i].sunk) continue;
      const tf = R.tankFx[t.i];
      if (t.moving) tf.wheel += t.moving * 0.25;
      let mood = 'idle';
      if (!t.alive) mood = 'ko';
      else if (tf.hurt > 0) mood = 'hurt';
      else if (tf.scared > 0) mood = 'scared';
      else if (t.charging) mood = 'charge';
      else if (tf.happy > 0 || (m.phase === 'over' && t.team === m.winner)) mood = 'happy';
      const x = cam.X(t.x) + (tf.dmgShake > 0 ? Math.sin(time * 80) * 3 : 0), y = cam.Y(t.y);
      if (x < -80 || x > W + 80) continue;
      TD.Skins.drawTank(g, x, y, cam.s, {
        def: t.def, facing: t.facing, aimAng: TD.launchAngle(t.facing, t.aim, t.tilt), tilt: t.tilt, t: time + t.i * 1.7, mood, power: t.power,
        wheel: tf.wheel, recoil: tf.recoil, frozen: t.frozen && t.alive, team: t.team, ko: !t.alive, blink: tf.blink, windX: m.wind.x, scaredDrop: mood === 'scared',
      });
      if (t.alive) TD.Skins.drawTag(g, x, y, cam.s, t, { active: t.i === m.active && m.phase === 'aim', time });
      else if (Math.random() < 0.2) R.burst({ kind: 'smoke', x: t.x + (Math.random() - 0.5), y: t.y + 1.5, vx: 0, vy: 1.5, life: 1.5, size: 0.5, g: -0.5, wind: 0.3 });
    }
  }

  function drawAimGuide(b, g) {
    const m = b.m, t = m.activeTank;
    if (!TD.settings.aimGuide || !t || m.phase !== 'aim' || !isLocalTurn(b)) return;
    const power = t.charging ? Math.max(20, t.power) : t.lastPower > 0 ? t.lastPower : 60;
    const pr = TD.predict(m, t.i, t.aim, power, t.weapon, t.facing, { path: true, stopAfter: 14 });
    const cam = b.R.cam;
    g.fillStyle = 'rgba(255,255,255,0.85)';
    for (let k = 2; k < pr.path.length; k += 2) {
      const a = 1 - k / pr.path.length;
      g.globalAlpha = a; g.beginPath(); g.arc(cam.X(pr.path[k]), cam.Y(pr.path[k + 1]), 3, 0, 6.29); g.fill();
    }
    g.globalAlpha = 1;
  }

  function syncBattleDom(b) {
    const t = b.m.activeTank, mine = isLocalTurn(b);
    $('#s-battle').classList.toggle('theirs', !mine || b.m.phase !== 'aim');
    if (!t) return;
    $$('.wbtn').forEach((el, i) => {
      el.classList.toggle('on', t.weapon === i);
      el.querySelector('span').textContent = t.def.weapons[i].name;
      if (i === 2) { el.classList.toggle('ready', t.ss >= TD.SS_MAX); el.querySelector('.gauge').style.width = (t.ss / TD.SS_MAX * 100) + '%'; }
    });
    const waiting = b.stalled > 45;
    $('#waiting').hidden = !waiting;
  }

  /* ---------------- attract mode: a CPU battle behind the menus ---------------- */
  function startAttract() {
    const ids = TD.TANKS.map((t) => t.id).sort(() => Math.random() - 0.5);
    const seed = (Math.random() * 4294967295) >>> 0;
    const map = TD.MAPS[(Math.random() * TD.MAPS.length) | 0].id;
    const m = new TD.Match({ seed, map, players: [{ tank: ids[0], team: 0 }, { tank: ids[1], team: 1 }], turnFrames: 60 * 12 });
    attract = { m, R: new TD.WorldRenderer(m), slots: [0, 1].map((i) => ({ kind: 'cpu', brain: new TD.AI.Brain('hard', seed + i) })), attract: true, time: 0, ssWas: [false, false], overview: true, over: false };
    attract.R.cam.overview(); attract.R.cam.update(0, true);
  }
  function stopAttract() { attract = null; }

  /* ---------------- main loop ---------------- */
  let last = performance.now(), acc = 0;
  const STEP = 1000 / 60;
  function frame(now) {
    requestAnimationFrame(frame);
    const elapsed = Math.min(250, now - last); last = now;
    const speed = TD.debug.speed || 1;
    acc += elapsed * speed;
    let steps = 0;
    const b = battle || attract;
    if (!b && screen !== 'battle' && screen !== 'results') startAttract();
    while (acc >= STEP && steps < 8 * speed) {
      acc -= STEP; steps++;
      tick();
    }
    if (steps >= 8 * speed) acc = 0;
    render(elapsed / 1000);
  }
  function tick() {
    if (battle && !paused) {
      const b = battle, m = b.m;
      b.time += 1 / 60;
      if (!b.over || m.phase !== 'over') {
        const a = m.needsInput();
        const remoteTurn = a >= 0 && b.slots[a].kind === 'remote';
        const backlog = remoteTurn ? b.session.remote.upto - m.frame : 0;
        const n = TD.driveMatch(m, b.slots, null, backlog > 6 ? 4 : 1);
        if (b.session) { b.sinceFlush = (b.sinceFlush || 0) + 1; if (b.sinceFlush >= 5 || (m.needsInput() < 0 && a >= 0)) { b.session.flush(); b.sinceFlush = 0; } }
        b.stalled = n === 0 ? b.stalled + 1 : 0;
        handleEvents(b, false);
      }
    } else if (!battle && attract) {
      const b = attract;
      b.time += 1 / 60;
      TD.driveMatch(b.m, b.slots, null, 1);
      handleEvents(b, true);
      if (b.m.phase === 'over' && (b.endT = (b.endT || 0) + 1) > 180) startAttract();
    }
  }
  function render(dt) {
    const b = battle || attract;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#140c33'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!b) return;
    ctx.setTransform(view.s * view.dpr, 0, 0, view.s * view.dpr, view.ox * view.dpr, view.oy * view.dpr);
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
    if (!paused || b !== battle) {
      updateCamera(b, dt);
      b.R.update(dt);
      if (b === battle) updateLoops(b);
    }
    b.R.draw(ctx, { tanks: (g) => drawTanks(b, g), beforeTanks: (g) => b === battle && drawAimGuide(b, g) });
    if (b === battle) {
      b.hud.draw(ctx, b.m, b.R, { dt, time: b.R.time, localTurn: isLocalTurn(b), keyboardHints: keyboardUsed || !isTouch });
      syncBattleDom(b);
    }
    ctx.restore();
    if (screen === 'select') drawSelectArt(performance.now() / 1000);
  }

  // Local inputs are recorded into the online session here (so the remote player can replay them).
  const origDrive = TD.driveMatch;
  TD.driveMatch = function (m, slots, session, maxSteps) {
    if (battle && battle.m === m && battle.session) {
      const s = battle.session;
      const wrapped = slots.map((sl) => (sl.kind === 'local' ? { kind: 'local', bits: () => { const v = sl.bits(); s.pushInput(m.frame, v); return v; } } : sl));
      return origDrive(m, wrapped, null, maxSteps);
    }
    return origDrive(m, slots, session, maxSteps);
  };

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { A.suspend(); if (battle && !battle.over && battle.cfg.mode !== 'online') { paused = true; overlay('pause', true); } }
    else A.resume();
  });

  /* ---------------- debug / test hooks ---------------- */
  TD.debug = {
    speed: +(params.get('speed') || 1),
    get screen() { return screen; },
    get battle() { return battle; },
    get attract() { return attract; },
    get audio() { return A; },
    startBattle, startSetup, startMatchmaking, show, finish,
    press: (bit) => { tapped |= bit; },
    /** Let the CPU play the local player's turns (browser play-tests). Inputs still flow through
     *  the normal local path, so online matches record and send them exactly like a human's. */
    autopilot(level = 'normal') {
      const b = battle; if (!b) return false;
      b.slots.forEach((sl, i) => { if (sl.kind === 'local') { const brain = new TD.AI.Brain(level, 1000 + i); sl.bits = () => brain.bits(b.m); } });
      return true;
    },
    hold: (bit, on) => { if (on) press('dbg' + bit, bit); else release('dbg' + bit); },
    state() {
      const b = battle;
      if (!b) return { screen };
      return { screen, mode: b.cfg.mode, phase: b.m.phase, turn: b.m.turn, frame: b.m.frame, active: b.m.active, winner: b.m.winner, over: b.over, hash: b.m.hash(),
        tanks: b.m.tanks.map((t) => ({ id: t.id, hp: t.hp, x: t.x, y: t.y, alive: t.alive, aim: t.aim, power: t.power, weapon: t.weapon, ss: t.ss })) };
    },
  };

  show('title');
  requestAnimationFrame(frame);
  if (params.get('auto') === 'cpu') { A.init(); startBattle(cpuConfig('froggo', 'normal', '1v1', false)); }
})(window.TD);
