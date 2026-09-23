/* One Piece Frog Style — in-fight HUD: health (with red recoverable health and a
 * lagging damage bar), partner status, assist lamp, hyper meter, timer, combo counter. */
'use strict';
(function (OP) {
  const { W, H, clamp } = OP;
  const FONT = 'Bangers, Impact, sans-serif';

  function text(ctx, s, x, y, size, fill, align = 'left', stroke = '#1b1216', lw) {
    ctx.font = `${size}px ${FONT}`; ctx.textAlign = align; ctx.textBaseline = 'alphabetic'; ctx.lineJoin = 'round';
    ctx.lineWidth = lw ?? size * 0.18; ctx.strokeStyle = stroke; ctx.strokeText(s, x, y);
    ctx.fillStyle = fill; ctx.fillText(s, x, y);
  }

  // Head portrait inside a circle; mirrors for the right-hand team.
  function portrait(ctx, f, x, y, r, mirror, dim) {
    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    const g = ctx.createRadialGradient(x, y - r * 0.3, r * 0.1, x, y, r);
    g.addColorStop(0, '#fff6d8'); g.addColorStop(1, f.team.side === 0 ? '#f0a35a' : '#6aa9e8');
    ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = 4; ctx.strokeStyle = '#1b1216'; ctx.stroke();
    ctx.clip();
    ctx.translate(x - (mirror ? -1 : 1) * r * 0.1, y + r * 0.2);
    const s = r * 0.62;
    ctx.scale(mirror ? -s : s, -s);
    OP.Draw.drawHead(ctx, f.def, f.pal, f.alive ? f.expr : 'ko', { ol: 0.09, flags: f.flags, t: f.t, blink: f.blink, r: 0.16 });
    ctx.restore();
    if (dim) { ctx.save(); ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fill(); ctx.restore(); }
  }

  // Slanted bar: fills from the portrait outward.
  function bar(ctx, x, y, w, h, side, parts) {
    const sk = h * 0.6;
    const shape = (x0, x1) => {
      ctx.beginPath();
      if (side === 0) { ctx.moveTo(x + x0, y); ctx.lineTo(x + x1 + sk, y); ctx.lineTo(x + x1, y + h); ctx.lineTo(x + x0 - (x0 === 0 ? 0 : sk), y + h); }
      else { ctx.moveTo(x + w - x0, y); ctx.lineTo(x + w - x1 - sk, y); ctx.lineTo(x + w - x1, y + h); ctx.lineTo(x + w - x0 + (x0 === 0 ? 0 : sk), y + h); }
      ctx.closePath();
    };
    shape(0, w); ctx.fillStyle = 'rgba(20,10,20,0.75)'; ctx.fill();
    for (const [frac, col] of parts) { if (frac <= 0) continue; shape(0, w * clamp(frac, 0, 1)); ctx.fillStyle = col; ctx.fill(); }
    shape(0, w); ctx.lineWidth = 3; ctx.strokeStyle = '#1b1216'; ctx.stroke();
  }

  function draw(ctx, m) {
    for (const t of m.teams) team(ctx, m, t);
    // timer
    const cx = W / 2;
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, 52, 42, 0, Math.PI * 2); ctx.fillStyle = '#1b1216'; ctx.fill();
    ctx.lineWidth = 4; ctx.strokeStyle = '#e8c547'; ctx.stroke();
    ctx.restore();
    if (m.mode === 'training') text(ctx, '∞', cx, 72, 56, '#ffe14d', 'center');
    else {
      const s = Math.ceil(m.timer / 60);
      text(ctx, String(s).padStart(2, '0'), cx, 72, 54, s <= 10 && m.frame % 30 < 15 ? '#ff5a5a' : '#ffe14d', 'center');
    }
    if (m.mode === 'training') training(ctx, m);
  }

  function team(ctx, m, t) {
    const side = t.side, mir = side === 1;
    const X = (x) => (mir ? W - x : x);
    const p = t.point.alive || t.partner.role === 'bench' || !t.partner.alive ? t.point : t.partner;
    const q = p === t.members[0] ? t.members[1] : t.members[0];
    const pi = t.members.indexOf(p), qi = 1 - pi;
    // point portrait + bar
    portrait(ctx, p, X(62), 64, 46, mir, !p.alive);
    const bw = 430, bx = side === 0 ? 112 : W - 112 - bw;
    const hpF = p.hp / p.maxHp, redF = (p.hp + p.red) / p.maxHp, lagF = t.lag[pi] / p.maxHp;
    const hpCol = hpF > 0.3 ? '#ffd23d' : (m.frame % 20 < 10 ? '#ff7a2d' : '#ffd23d');
    bar(ctx, bx, 36, bw, 26, side, [[redF, '#c81e1e'], [lagF, '#fff2d0'], [hpF, hpCol]]);
    text(ctx, p.def.name.toUpperCase(), side === 0 ? bx + 6 : bx + bw - 6, 28, 24, '#ffffff', side === 0 ? 'left' : 'right');
    // partner portrait + small bar + assist lamp
    portrait(ctx, q, X(134), 96, 20, mir, !q.alive || q.role === 'bench' && false);
    const sw = 190, sx = side === 0 ? 160 : W - 160 - sw;
    bar(ctx, sx, 84, sw, 12, side, [[(q.hp + q.red) / q.maxHp, '#c81e1e'], [t.lag[qi] / q.maxHp, '#fff2d0'], [q.hp / q.maxHp, '#ffd23d']]);
    const ready = q.alive && t.assistCD === 0 && q.role === 'bench';
    const lampX = side === 0 ? sx + sw + 24 : sx - 24;
    ctx.beginPath(); ctx.arc(lampX, 90, 10, 0, Math.PI * 2); ctx.fillStyle = ready ? (m.frame % 40 < 30 ? '#6dff8c' : '#b8ffc6') : '#444'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = '#1b1216'; ctx.stroke();
    if (!ready && q.alive) { ctx.beginPath(); ctx.moveTo(lampX, 90); ctx.arc(lampX, 90, 10, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - t.assistCD / 360)); ctx.fillStyle = '#2f9a4a'; ctx.fill(); }
    text(ctx, 'ASSIST', side === 0 ? lampX + 16 : lampX - 16, 97, 18, ready ? '#b8ffc6' : '#888', side === 0 ? 'left' : 'right');
    if (!q.alive) text(ctx, 'K.O.', X(134), 104, 18, '#ff5a5a', 'center');
    // hyper meter
    const lv = Math.floor(t.meter / 1000), fr = (t.meter % 1000) / 1000;
    const mw = 330, mx = side === 0 ? 96 : W - 96 - mw, my = H - 46;
    bar(ctx, mx, my, mw, 18, side, [[lv >= 3 ? 1 : fr, lv >= 3 ? '#ff5ad0' : ['#3fb5ff', '#4dff9a', '#ffd23d'][lv]]]);
    ctx.save(); ctx.beginPath(); ctx.arc(X(62), H - 38, 30, 0, Math.PI * 2); ctx.fillStyle = '#1b1216'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = lv > 0 ? '#ffe14d' : '#555'; ctx.stroke(); ctx.restore();
    text(ctx, String(lv), X(62), H - 22, 44, lv > 0 ? '#ffe14d' : '#777', 'center');
    text(ctx, lv >= 1 ? 'HYPER READY' : 'HYPER', side === 0 ? mx + 4 : mx + mw - 4, my - 6, 18, lv >= 1 ? '#ffe14d' : '#cccccc', side === 0 ? 'left' : 'right');
    // combo counter
    const c = t.combo;
    const hits = c.hits || (c.show > 0 ? c.last : 0);
    if (hits >= 2) {
      const a = c.hits ? 1 : clamp(c.show / 30, 0, 1);
      ctx.save(); ctx.globalAlpha = a;
      const cx = side === 0 ? 40 : W - 40, al = side === 0 ? 'left' : 'right';
      ctx.font = `86px ${FONT}`;
      const nw = ctx.measureText(String(hits)).width;
      text(ctx, String(hits), cx, 250, 86, '#ffe14d', al);
      text(ctx, 'HITS', side === 0 ? cx + nw + 10 : cx - nw - 10, 250, 40, '#ffffff', al);
      text(ctx, `${c.hits ? c.dmg : c.lastDmg || 0} DMG`, cx, 284, 26, '#ffb3b3', al);
      ctx.restore();
    }
    if (t.tagCD > 0 && t.point.alive && q.alive && q.role === 'bench' && m.mode !== 'training') { /* tag recharging */ }
  }

  function training(ctx, m) {
    const fi = m.frameInfo;
    ctx.save();
    ctx.fillStyle = 'rgba(10,10,20,0.7)'; ctx.fillRect(W / 2 - 250, H - 128, 500, 72);
    ctx.restore();
    if (fi) {
      text(ctx, fi.name.toUpperCase(), W / 2, H - 104, 24, '#ffe14d', 'center');
      const adv = (fi.adv >= 0 ? '+' : '') + fi.adv;
      text(ctx, `STARTUP ${fi.startup}   ACTIVE ${fi.active}   RECOVERY ${fi.recovery}   DMG ${fi.dmg}   ${fi.guard.toUpperCase()}`, W / 2, H - 80, 18, '#ffffff', 'center');
      text(ctx, `${fi.blocked ? 'ON BLOCK' : 'ON HIT'} ${adv}`, W / 2, H - 60, 20, fi.adv >= 0 ? '#6dff8c' : '#ff7a7a', 'center');
    } else text(ctx, 'HIT THE DUMMY TO SEE FRAME DATA', W / 2, H - 84, 22, '#ffffff', 'center');
  }

  OP.HUD = { draw, portrait, text, bar, FONT };
})(window.OP);
