/* One Piece Frog Style — stage: the deck of a caravel sailing the East Blue.
 * Layers use their own parallax factor so the sea, ship and sky move at different depths. */
'use strict';
(function (OP) {
  const { W, H } = OP;
  const Dr = OP.Draw;

  const clouds = Array.from({ length: 9 }, (_, i) => ({ x: -40 + i * 11 + Math.random() * 5, y: 170 + Math.random() * 120, s: 0.6 + Math.random() * 0.8, v: 0.08 + Math.random() * 0.1 }));
  const gulls = Array.from({ length: 4 }, () => ({ x: Math.random() * 40 - 20, y: 60 + Math.random() * 120, v: 0.6 + Math.random() * 0.8, ph: Math.random() * 6 }));

  // Projection for a layer with parallax p (0 = infinitely far, 1 = the fighting plane).
  function L(cam, p) {
    const zs = 0.35 + 0.65 * p;
    const z = cam.zoom * zs;
    return {
      z,
      x: (wx) => W / 2 + (wx - cam.x * p) * z + cam.sx * p,
      y: (wy) => cam.gy - (wy - cam.y * p) * z + cam.sy * p,
    };
  }

  function drawBack(ctx, cam, t) {
    // sky
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#3d8fe0'); g.addColorStop(0.45, '#8fd0f7'); g.addColorStop(0.62, '#d9f3ff'); g.addColorStop(1, '#d9f3ff');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // sun + halo
    const sp = L(cam, 0.02);
    const sx = sp.x(9), sy = 110 + cam.y * 4;
    const halo = ctx.createRadialGradient(sx, sy, 10, sx, sy, 180);
    halo.addColorStop(0, 'rgba(255,250,210,0.95)'); halo.addColorStop(0.2, 'rgba(255,240,170,0.5)'); halo.addColorStop(1, 'rgba(255,240,170,0)');
    ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(sx, sy, 180, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fffbe6'; ctx.beginPath(); ctx.arc(sx, sy, 34, 0, Math.PI * 2); ctx.fill();
    // clouds
    const cp = L(cam, 0.06);
    for (const c of clouds) {
      c.x += c.v * 0.004; if (c.x > 60) c.x = -60;
      const x = cp.x(c.x), y = c.y + cam.y * 6;
      cloud(ctx, x, y, 60 * c.s);
    }
    // horizon + far islands
    const hp = L(cam, 0.12);
    const hy = hp.y(3.2);
    ctx.fillStyle = '#7fb7a2';
    island(ctx, hp.x(-14), hy, 170, 38); island(ctx, hp.x(6), hy, 90, 22); island(ctx, hp.x(22), hy, 240, 52);
    // lighthouse on the big island
    const lx = hp.x(22) - 40, ly = hy - 52;
    ctx.fillStyle = '#f2efe6'; ctx.fillRect(lx, ly - 30, 8, 30); ctx.fillStyle = '#d64545'; ctx.fillRect(lx, ly - 20, 8, 6); ctx.fillStyle = '#ffeaa0'; ctx.fillRect(lx - 1, ly - 36, 10, 6);
    // sea
    const sea = ctx.createLinearGradient(0, hy, 0, H);
    sea.addColorStop(0, '#2f8fc9'); sea.addColorStop(0.5, '#1f6fa8'); sea.addColorStop(1, '#134f82');
    ctx.fillStyle = sea; ctx.fillRect(0, hy, W, H - hy);
    ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fillRect(0, hy, W, 1.5);
    // wave glints, nearer rows move faster
    for (let row = 0; row < 7; row++) {
      const p = 0.14 + row * 0.07, lp = L(cam, p);
      const y = lp.y(3.0 - row * 0.45);
      if (y < hy) continue;
      ctx.strokeStyle = `rgba(255,255,255,${0.25 + row * 0.06})`; ctx.lineWidth = 1 + row * 0.4;
      const step = 90 + row * 30;
      const off = ((t * (0.3 + row * 0.25)) + row * 37) % step;
      for (let x = -step + off - ((cam.x * p * lp.z) % step); x < W + step; x += step) {
        const yy = y + Math.sin((x + t * 2) * 0.02 + row) * (1 + row * 0.5);
        ctx.beginPath(); ctx.moveTo(x, yy); ctx.quadraticCurveTo(x + step * 0.12, yy - 3 - row * 0.4, x + step * 0.25, yy); ctx.stroke();
      }
    }
    // seagulls
    const gp = L(cam, 0.2);
    ctx.strokeStyle = '#2b3140'; ctx.lineWidth = 2;
    for (const b of gulls) {
      b.x += b.v * 0.01; if (b.x > 30) b.x = -30;
      const x = gp.x(b.x), y = b.y + Math.sin(t * 0.03 + b.ph) * 8 + cam.y * 8;
      const flap = Math.sin(t * 0.2 + b.ph) * 5;
      ctx.beginPath(); ctx.moveTo(x - 10, y - flap); ctx.quadraticCurveTo(x - 4, y - 6, x, y); ctx.quadraticCurveTo(x + 4, y - 6, x + 10, y - flap); ctx.stroke();
    }
  }

  function cloud(ctx, x, y, s) {
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.beginPath();
    ctx.arc(x, y, s * 0.5, 0, Math.PI * 2); ctx.arc(x + s * 0.45, y - s * 0.2, s * 0.42, 0, Math.PI * 2);
    ctx.arc(x + s * 0.9, y, s * 0.45, 0, Math.PI * 2); ctx.arc(x + s * 0.4, y + s * 0.12, s * 0.45, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(180,210,235,0.5)'; ctx.fillRect(x - s * 0.5, y + s * 0.2, s * 1.9, s * 0.1);
  }
  function island(ctx, x, y, w, h) {
    ctx.beginPath(); ctx.moveTo(x - w / 2, y); ctx.bezierCurveTo(x - w / 3, y - h, x + w / 4, y - h * 1.1, x + w / 2, y); ctx.fill();
  }

  // Ship structure behind the fighters (drawn in world space, y up, metres).
  function drawShip(ctx, cam, t) {
    const lp = L(cam, 0.82);
    ctx.save();
    ctx.translate(lp.x(0), lp.y(0)); ctx.scale(lp.z, -lp.z);
    const sway = Math.sin(t * 0.012) * 0.015;
    ctx.rotate(sway);
    // back rail of the deck
    ctx.fillStyle = '#7a4a26'; ctx.fillRect(-11, 0, 22, 0.35);
    ctx.fillStyle = '#9a6034'; ctx.fillRect(-11, 0.9, 22, 0.12);
    for (let x = -10.5; x <= 10.5; x += 0.7) { ctx.fillStyle = '#8b5530'; ctx.fillRect(x, 0.3, 0.07, 0.62); }
    // mast
    const mg = ctx.createLinearGradient(-0.2, 0, 0.2, 0); mg.addColorStop(0, '#6b3f1f'); mg.addColorStop(0.5, '#a36b3c'); mg.addColorStop(1, '#6b3f1f');
    ctx.fillStyle = mg; ctx.fillRect(-0.18, 0, 0.36, 13);
    ctx.fillStyle = '#5a3418'; for (const y of [2.2, 6.6, 10.4]) ctx.fillRect(-0.24, y, 0.48, 0.12);
    // yard arms + sails (billowing)
    const bil = Math.sin(t * 0.03) * 0.12;
    for (const [y, w, h] of [[7.2, 5.2, 3.2], [11.1, 3.8, 1.9]]) {
      ctx.fillStyle = '#5a3418'; ctx.fillRect(-w / 2 - 0.2, y, w + 0.4, 0.12);
      ctx.beginPath(); ctx.moveTo(-w / 2, y); ctx.lineTo(w / 2, y);
      ctx.quadraticCurveTo(w / 2 + 0.3 + bil, y - h / 2, w / 2 - 0.1, y - h);
      ctx.quadraticCurveTo(0, y - h - 0.35 - bil, -w / 2 + 0.1, y - h);
      ctx.quadraticCurveTo(-w / 2 - 0.3 - bil, y - h / 2, -w / 2, y);
      ctx.fillStyle = '#f6f1e2'; ctx.fill(); ctx.strokeStyle = '#c9bca0'; ctx.lineWidth = 0.05; ctx.stroke();
      // sheep-head sun emblem on the main sail? — a straw-hat skull emblem instead
      if (h > 3) jolly(ctx, 0, y - h * 0.5, 0.95, false);
    }
    // crow's nest
    ctx.fillStyle = '#7a4a26'; ctx.fillRect(-0.55, 12.2, 1.1, 0.5);
    // flag at the top
    const fw = Math.sin(t * 0.08);
    ctx.save(); ctx.translate(0.18, 13.4);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(0.6, 0.15 + fw * 0.1, 1.3, fw * 0.1); ctx.lineTo(1.3, -0.9 + fw * 0.1); ctx.quadraticCurveTo(0.6, -0.75 + fw * 0.1, 0, -0.9); ctx.closePath();
    ctx.fillStyle = '#141414'; ctx.fill();
    jolly(ctx, 0.62, -0.45 + fw * 0.05, 0.28, true);
    ctx.restore();
    // rigging ropes
    ctx.strokeStyle = 'rgba(60,40,25,0.8)'; ctx.lineWidth = 0.035;
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(0, 12.2); ctx.lineTo(s * 9, 0.95); ctx.moveTo(0, 7.3); ctx.lineTo(s * 7, 0.95); ctx.stroke(); }
    // stern cabin with tangerine trees (left)
    ctx.fillStyle = '#b77a44'; ctx.fillRect(-12.5, 0, 3.3, 2.3);
    ctx.fillStyle = '#8b5530'; ctx.fillRect(-12.6, 2.3, 3.5, 0.18);
    ctx.fillStyle = '#5a3418'; ctx.fillRect(-10.6, 0, 0.8, 1.5);
    for (const x of [-12.1, -11.1]) {
      ctx.fillStyle = '#6b4a2b'; ctx.fillRect(x - 0.05, 2.45, 0.1, 0.5);
      ctx.fillStyle = '#3e8f3a'; ctx.beginPath(); ctx.arc(x, 3.2, 0.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ff9a1f'; for (const [dx, dy] of [[-0.2, 0.1], [0.15, 0.3], [0.2, -0.1], [-0.1, 0.4]]) { ctx.beginPath(); ctx.arc(x + dx, 3.2 + dy, 0.08, 0, Math.PI * 2); ctx.fill(); }
    }
    // ram figurehead at the bow (right)
    ctx.save(); ctx.translate(11.6, 1.4);
    ctx.fillStyle = '#b77a44'; ctx.beginPath(); ctx.moveTo(-1.6, -1.4); ctx.lineTo(-0.2, -0.6); ctx.lineTo(-0.1, 0); ctx.lineTo(-1.6, 0); ctx.fill();
    ctx.fillStyle = '#f7f1e3'; ctx.beginPath(); ctx.arc(0.1, 0.35, 0.55, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#e6d9c0'; ctx.lineWidth = 0.18; ctx.beginPath(); ctx.arc(-0.1, 0.55, 0.3, 0.2, 5.8); ctx.stroke();
    ctx.fillStyle = '#1a1a1a'; ctx.beginPath(); ctx.arc(0.35, 0.45, 0.06, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.restore();
  }

  function jolly(ctx, x, y, s, onFlag) {
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    const bone = onFlag ? '#f4f4f4' : '#222';
    ctx.strokeStyle = bone; ctx.lineWidth = 0.16; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-0.7, -0.6); ctx.lineTo(0.7, 0.35); ctx.moveTo(0.7, -0.6); ctx.lineTo(-0.7, 0.35); ctx.stroke();
    ctx.fillStyle = bone; ctx.beginPath(); ctx.arc(0, 0.05, 0.42, 0, Math.PI * 2); ctx.fill();
    ctx.fillRect(-0.22, -0.4, 0.44, 0.2);
    ctx.fillStyle = onFlag ? '#141414' : '#f6f1e2';
    ctx.beginPath(); ctx.arc(-0.15, 0.05, 0.1, 0, Math.PI * 2); ctx.arc(0.15, 0.05, 0.1, 0, Math.PI * 2); ctx.fill();
    // the straw hat on the skull
    ctx.fillStyle = '#e8c547'; ctx.beginPath(); ctx.ellipse(0, 0.32, 0.62, 0.1, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(0, 0.42, 0.34, 0.2, 0, 0, Math.PI); ctx.fill();
    ctx.fillStyle = '#c8282b'; ctx.fillRect(-0.34, 0.36, 0.68, 0.07);
    ctx.restore();
  }

  // Deck floor with fake perspective planks.
  function drawDeck(ctx, cam) {
    const gy = cam.gy + cam.y * cam.zoom + cam.sy;
    if (gy >= H) return;
    const g = ctx.createLinearGradient(0, gy, 0, H);
    g.addColorStop(0, '#c48a55'); g.addColorStop(1, '#8a5a31');
    ctx.fillStyle = g; ctx.fillRect(0, gy, W, H - gy);
    ctx.fillStyle = 'rgba(255,230,190,0.5)'; ctx.fillRect(0, gy, W, 2);
    // plank seams converge toward a vanishing point on the horizon
    const vpx = W / 2 - cam.x * cam.zoom * 0.2, vpy = gy - 900;
    ctx.strokeStyle = 'rgba(70,40,20,0.45)'; ctx.lineWidth = 1.5;
    const sp = 1.3 * cam.zoom;
    const x0 = W / 2 - cam.x * cam.zoom + cam.sx;
    for (let i = -40; i <= 40; i++) {
      const bx = x0 + i * sp; // at the ground line
      const k = (H - gy) / (gy - vpy);
      const ex = bx + (bx - vpx) * k;
      if (Math.max(bx, ex) < -50 || Math.min(bx, ex) > W + 50) continue;
      ctx.beginPath(); ctx.moveTo(bx, gy); ctx.lineTo(ex, H); ctx.stroke();
    }
    for (let j = 1; j < 6; j++) {
      const y = gy + (H - gy) * (j * j) / 36;
      ctx.strokeStyle = 'rgba(70,40,20,0.25)'; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    // nail heads
    ctx.fillStyle = 'rgba(40,25,15,0.4)';
    for (let i = -40; i <= 40; i += 2) { const bx = x0 + i * sp + sp * 0.5; if (bx > -10 && bx < W + 10) ctx.fillRect(bx, gy + 6, 2, 2); }
  }

  // Foreground dressing (rope coil + barrel) drawn over the fighters' feet line.
  function drawFront(ctx, cam) {
    const lp = L(cam, 1.15);
    const y = lp.y(-0.55);
    if (y > H + 40) return;
    for (const wx of [-7.6, 7.9]) {
      const x = lp.x(wx);
      if (x < -120 || x > W + 120) continue;
      ctx.fillStyle = '#6b4424'; ctx.beginPath(); ctx.ellipse(x, y + 10, 55 * lp.z / 170, 70 * lp.z / 170, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#3d2614'; ctx.lineWidth = 3; ctx.stroke();
      ctx.strokeStyle = '#a07a45'; ctx.lineWidth = 4;
      for (const dy of [-30, 30]) { ctx.beginPath(); ctx.moveTo(x - 52 * lp.z / 170, y + 10 + dy * lp.z / 170); ctx.lineTo(x + 52 * lp.z / 170, y + 10 + dy * lp.z / 170); ctx.stroke(); }
    }
  }

  OP.Stage = { name: 'Going Merry — East Blue', drawBack, drawShip, drawDeck, drawFront, jolly, cloud };
})(window.OP);
