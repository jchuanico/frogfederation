/* Tank Dynamics — heads-up display (canvas). Weapon buttons, the fire button and the touch pad are
 * DOM elements laid over the bottom bar (see main.js) so they're real, tappable buttons. */
'use strict';
(function (TD) {
  const { W, H } = TD;
  const BAR_Y = H - 92;
  const FONT = 'Fredoka, "Arial Rounded MT Bold", system-ui, sans-serif';
  TD.HUD_BAR_Y = BAR_Y;

  function panel(g, x, y, w, h, r, fill) {
    g.fillStyle = fill || 'rgba(16,12,40,0.78)';
    TD.roundRect(g, x, y, w, h, r); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.14)'; g.lineWidth = 1.5; g.stroke();
  }
  function text(g, s, x, y, size, color, align = 'left', weight = 700) {
    g.font = `${weight} ${size}px ${FONT}`; g.textAlign = align; g.fillStyle = color; g.fillText(s, x, y);
  }
  function outlined(g, s, x, y, size, color, align = 'center') {
    g.font = `900 ${size}px ${FONT}`; g.textAlign = align; g.lineJoin = 'round';
    g.lineWidth = size * 0.16; g.strokeStyle = '#1a1030'; g.strokeText(s, x, y); g.fillStyle = color; g.fillText(s, x, y);
  }
  TD.outlined = outlined;

  class Hud {
    constructor() { this.banner = null; this.powerShown = 0; }
    say(textStr, color = '#ffe35a', sub = '', dur = 1.6) { this.banner = { text: textStr, color, sub, t: 0, dur }; }

    draw(g, m, R, st) {
      const t = m.activeTank;
      this.drawBottom(g, m, t, st);
      this.drawWind(g, m, st);
      this.drawOrder(g, m, st);
      this.drawMini(g, m, R);
      if (this.banner) {
        const b = this.banner; b.t += st.dt;
        const k = b.t / b.dur;
        if (k >= 1) this.banner = null;
        else {
          const pop = k < 0.1 ? k / 0.1 : 1, a = k > 0.8 ? (1 - k) / 0.2 : 1;
          g.save(); g.globalAlpha = a; g.translate(W / 2, H * 0.36); g.scale(0.6 + 0.4 * pop, 0.6 + 0.4 * pop);
          outlined(g, b.text, 0, 0, 64, b.color);
          if (b.sub) outlined(g, b.sub, 0, 40, 24, '#ffffff');
          g.restore();
        }
      }
    }

    drawBottom(g, m, t, st) {
      panel(g, 8, BAR_Y, W - 16, 84, 18);
      if (!t) return;
      const def = t.def, mine = st.localTurn;
      // --- angle dial ---
      const cx = 66, cy = BAR_Y + 58, r = 44;
      g.save();
      g.fillStyle = 'rgba(255,255,255,0.06)'; g.beginPath(); g.arc(cx, cy, r, Math.PI, 0); g.closePath(); g.fill();
      const f = t.facing;
      const toScreen = (deg) => { const a = TD.launchAngle(f, deg, t.tilt); return [Math.cos(a), -Math.sin(a)]; };
      // allowed range
      g.strokeStyle = 'rgba(93,224,138,0.55)'; g.lineWidth = 7;
      g.beginPath();
      const a0 = TD.launchAngle(f, def.aimMin, t.tilt), a1 = TD.launchAngle(f, def.aimMax, t.tilt);
      g.arc(cx, cy, r - 5, -Math.max(a0, a1), -Math.min(a0, a1));
      g.stroke();
      // ticks
      g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 1;
      for (let d = 0; d <= 180; d += 15) { const a = TD.deg(d); g.beginPath(); g.moveTo(cx + Math.cos(a) * (r - 1), cy - Math.sin(a) * (r - 1)); g.lineTo(cx + Math.cos(a) * (r + 4), cy - Math.sin(a) * (r + 4)); g.stroke(); }
      if (t.lastAim >= 0) { const [dx, dy] = toScreen(t.lastAim); g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 3; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + dx * r, cy + dy * r); g.stroke(); }
      const [dx, dy] = toScreen(t.aim);
      g.strokeStyle = '#ffe35a'; g.lineWidth = 4; g.lineCap = 'round';
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + dx * (r + 2), cy + dy * (r + 2)); g.stroke(); g.lineCap = 'butt';
      g.fillStyle = TD.TEAM_COLORS[t.team % 4]; g.beginPath(); g.arc(cx, cy, 5, 0, 6.29); g.fill();
      g.restore();
      outlined(g, t.aim + '°', cx, BAR_Y + 30, 22, '#ffe35a');
      // --- power bar ---
      const px = 132, pw = 600, py = BAR_Y + 16, ph = 30;
      text(g, 'POWER', px, py - 3, 11, 'rgba(255,255,255,0.6)');
      g.fillStyle = 'rgba(0,0,0,0.45)'; TD.roundRect(g, px, py, pw, ph, 10); g.fill();
      this.powerShown += ((t.charging ? t.power : t.lastPower >= 0 && m.phase !== 'aim' ? t.lastPower : 0) - this.powerShown) * (t.charging ? 1 : 0.2);
      const pk = this.powerShown / 100;
      if (pk > 0.001) {
        const gr = g.createLinearGradient(px, 0, px + pw, 0);
        gr.addColorStop(0, '#5de08a'); gr.addColorStop(0.55, '#ffd23f'); gr.addColorStop(1, '#ff4f6a');
        g.fillStyle = gr; TD.roundRect(g, px + 2, py + 2, Math.max(8, (pw - 4) * pk), ph - 4, 8); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.3)'; TD.roundRect(g, px + 4, py + 4, Math.max(4, (pw - 8) * pk), 6, 3); g.fill();
      }
      g.strokeStyle = 'rgba(255,255,255,0.25)'; g.lineWidth = 1;
      for (let k = 1; k < 10; k++) { const x = px + pw * k / 10; g.beginPath(); g.moveTo(x, py + (k === 5 ? 3 : 18)); g.lineTo(x, py + ph - 3); g.stroke(); }
      if (t.lastPower >= 0) { // the famous "last shot" marker
        const x = px + pw * t.lastPower / 100;
        g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(x, py - 1); g.lineTo(x - 7, py - 10); g.lineTo(x + 7, py - 10); g.closePath(); g.fill();
        g.fillRect(x - 1, py, 2, ph);
      }
      outlined(g, Math.round(t.charging ? t.power : Math.max(0, t.lastPower)) + '', px + pw + 34, py + 25, 26, t.charging ? '#ffe35a' : 'rgba(255,255,255,0.75)');
      // fuel + turn timer
      const fy = py + ph + 12;
      text(g, 'FUEL', px, fy + 8, 11, 'rgba(255,255,255,0.6)');
      g.fillStyle = 'rgba(0,0,0,0.45)'; TD.roundRect(g, px + 40, fy, 220, 10, 5); g.fill();
      g.fillStyle = '#5ab8ff'; TD.roundRect(g, px + 40, fy, 220 * t.fuel / def.fuel, 10, 5); g.fill();
      const secs = Math.ceil(m.turnLeft / 60);
      if (m.phase === 'aim') {
        const urgent = secs <= 5;
        text(g, (mine ? 'Your turn' : t.name + "'s turn") + ' · ' + secs + 's', px + pw, fy + 9, 14, urgent ? '#ff4f6a' : 'rgba(255,255,255,0.85)', 'right');
      } else text(g, 'Delay ' + Math.round(t.delay), px + pw, fy + 9, 13, 'rgba(255,255,255,0.6)', 'right');
      if (st.keyboardHints && mine && m.phase === 'aim') text(g, '←→ move · ↑↓ angle · hold SPACE · 1 2 3 shots', px + 270, fy + 9, 12, 'rgba(255,255,255,0.45)');
    }

    drawWind(g, m, st) {
      const cx = W / 2, cy = 48, r = 34;
      panel(g, cx - 70, 8, 140, 82, 16);
      const w = m.wind, mag = Math.sqrt(w.x * w.x + w.y * w.y);
      g.strokeStyle = 'rgba(255,255,255,0.2)'; g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, r - 6, 0, 6.29); g.stroke();
      if (mag > 0.05) {
        const a = Math.atan2(-w.y, w.x);
        const len = 6 + Math.min(1, mag / 12) * (r - 8);
        g.save(); g.translate(cx, cy); g.rotate(a);
        const col = mag > 8 ? '#ff4f6a' : mag > 4 ? '#ffd23f' : '#5de08a';
        g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 5; g.lineCap = 'round';
        g.beginPath(); g.moveTo(-len, 0); g.lineTo(len - 6, 0); g.stroke();
        g.beginPath(); g.moveTo(len + 4, 0); g.lineTo(len - 8, -8); g.lineTo(len - 8, 8); g.closePath(); g.fill();
        g.restore();
        // streaks that drift with the wind
        g.strokeStyle = 'rgba(255,255,255,0.25)'; g.lineWidth = 1.5;
        for (let k = 0; k < 3; k++) { const p = ((st.time * mag * 0.12 + k / 3) % 1) - 0.5; g.beginPath(); const sx = cx + Math.cos(a) * p * 50 - Math.sin(a) * (k - 1) * 10, sy = cy + Math.sin(a) * p * 50 + Math.cos(a) * (k - 1) * 10; g.moveTo(sx, sy); g.lineTo(sx + Math.cos(a) * 8, sy + Math.sin(a) * 8); g.stroke(); }
      }
      outlined(g, mag.toFixed(1), cx, cy + 44, 16, '#fff');
      text(g, 'WIND', cx, 22, 10, 'rgba(255,255,255,0.55)', 'center');
      if (m.suddenDeath) outlined(g, 'SUDDEN DEATH', cx, 108, 16, '#ff4f6a');
    }

    drawOrder(g, m, st) {
      const list = m.tanks.filter((t) => t.alive).sort((a, b) => (a.i === m.active ? -1 : b.i === m.active ? 1 : a.delay - b.delay || a.lastTurn - b.lastTurn));
      const x = 10; let y = 10;
      for (const t of list.slice(0, 6)) {
        const act = t.i === m.active;
        panel(g, x, y, 214, 34, 12, act ? 'rgba(255,227,90,0.3)' : 'rgba(16,12,40,0.7)');
        g.save(); g.beginPath(); g.rect(x + 2, y + 1, 44, 32); g.clip();
        TD.Skins.drawPortrait(g, t.def, x + 24, y + 38, 9.5, { t: st.time, team: t.team, mood: t.frozen ? 'idle' : 'idle', frozen: t.frozen });
        g.restore();
        text(g, t.name.slice(0, 14), x + 50, y + 15, 13, TD.TEAM_COLORS[t.team % 4]);
        const k = t.hp / t.maxHp;
        g.fillStyle = 'rgba(0,0,0,0.5)'; TD.roundRect(g, x + 50, y + 21, 110, 6, 3); g.fill();
        g.fillStyle = k > 0.5 ? '#5de08a' : k > 0.25 ? '#ffd23f' : '#ff4f6a'; if (k > 0) { TD.roundRect(g, x + 50, y + 21, 110 * k, 6, 3); g.fill(); }
        text(g, act ? 'NOW' : '+' + Math.round(t.delay), x + 206, y + 22, 12, act ? '#ffe35a' : 'rgba(255,255,255,0.6)', 'right');
        // SS gauge
        g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(x + 166, y + 26, 40, 3);
        g.fillStyle = t.ss >= TD.SS_MAX ? '#ffe35a' : '#b36bff'; g.fillRect(x + 166, y + 26, 40 * t.ss / TD.SS_MAX, 3);
        y += 38;
      }
    }

    drawMini(g, m, R) {
      const mw = 176, mh = 80, x = W - mw - 58, y = 10;
      panel(g, x - 4, y - 2, mw + 8, mh + 6, 10);
      g.drawImage(R.tv.miniMap(), x, y, mw, mh);
      const sx = mw / TD.WORLD_W, sy = mh / TD.WORLD_H;
      g.fillStyle = 'rgba(80,160,255,0.5)'; g.fillRect(x, y + mh - m.water * sy, mw, m.water * sy);
      for (const t of m.tanks) {
        if (!t.alive) continue;
        g.fillStyle = TD.TEAM_COLORS[t.team % 4]; g.strokeStyle = t.i === m.active ? '#fff' : '#000'; g.lineWidth = 1.5;
        g.beginPath(); g.arc(x + t.x * sx, y + mh - (t.y + 0.8) * sy, 4, 0, 6.29); g.fill(); g.stroke();
      }
      g.fillStyle = '#fff';
      for (const p of m.projectiles) g.fillRect(x + p.x * sx - 1.5, y + Math.max(0, mh - p.y * sy) - 1.5, 3, 3);
      // camera view box
      const c = R.cam, hw = W / 2 / c.s, hh = H / 2 / c.s;
      g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 1;
      g.strokeRect(x + (c.x - hw) * sx, y + mh - (c.y + hh) * sy, hw * 2 * sx, hh * 2 * sy);
    }
  }
  TD.Hud = Hud;
})(globalThis.TD);
