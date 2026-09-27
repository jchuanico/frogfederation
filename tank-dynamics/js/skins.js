/* Tank Dynamics — tank art. Each tank is a chunky toy-like vehicle with a cartoon character for a
 * turret: big expressive eyes that blink, follow the aim, squint when charging, panic when a shot is
 * incoming, grin after a hit and go dizzy when knocked out. All vector drawing, no image files.
 *
 * Local drawing units are decimetres (10 per metre) with y pointing down and the tank's ground
 * contact at (0, 0), which matches the hit circle used by the simulation (centre 0.8 m up, r 1.4 m). */
'use strict';
(function (TD) {
  const rr = (g, x, y, w, h, r) => TD.roundRect(g, x, y, w, h, r);
  const TEAM_COLORS = ['#3fa9ff', '#ff4f6a', '#ffd23f', '#5de08a'];
  TD.TEAM_COLORS = TEAM_COLORS;

  function shadeHex(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    const f = (v) => Math.max(0, Math.min(255, Math.round(k > 0 ? v + (255 - v) * k : v * (1 + k))));
    return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
  }

  /**
   * Draw a tank. o = { def, facing, aimAng (world radians), tilt, t (time), mood, power, wheel,
   *   recoil, frozen, team, ko, blink, look: {x,y} optional, windX, scale }
   * (x, y) is the screen position of the ground contact point, s = px per metre.
   */
  function drawTank(g, x, y, s, o) {
    const def = o.def, c = def.colors, f = o.facing || 1, t = o.t || 0;
    g.save();
    g.translate(x, y);
    g.rotate(-(o.tilt || 0));
    g.scale(s / 10, s / 10);
    // squash & stretch: breathing, charge tremble, recoil
    const breathe = Math.sin(t * 2.4) * 0.02;
    const tremble = o.mood === 'charge' ? Math.sin(t * 60) * 0.2 * (o.power || 0) / 100 : 0;
    const rec = o.recoil || 0;
    g.translate(tremble - f * rec * 1.5, 0);
    g.scale(1 + rec * 0.06, 1 + breathe - rec * 0.06);
    if (o.ko) g.filter = 'grayscale(0.85) brightness(0.8)';

    // shadow
    g.fillStyle = 'rgba(0,0,0,0.22)';
    g.beginPath(); g.ellipse(0, 0.5, 16, 2.4, 0, 0, 6.29); g.fill();

    const aimLocal = (o.aimAng ?? (f > 0 ? 0.7 : Math.PI - 0.7)) - (o.tilt || 0);

    // flag on an antenna (team colour) at the back
    const back = -f * 11;
    g.strokeStyle = '#444'; g.lineWidth = 0.8;
    g.beginPath(); g.moveTo(back, -10); g.lineTo(back, -27); g.stroke();
    const flap = Math.sin(t * 6) * 1.5, wx = -(o.windX || 0) * 0.3 - f * 5;
    g.fillStyle = TEAM_COLORS[(o.team || 0) % 4];
    g.beginPath(); g.moveTo(back, -27); g.quadraticCurveTo(back + wx * 0.5, -26 + flap, back + wx, -24.5 + flap * 0.6); g.lineTo(back, -22); g.closePath(); g.fill();

    // barrel (behind the head)
    drawBarrel(g, def, aimLocal, t, rec);

    // character extras behind the body
    if (def.id === 'blaze') drawWings(g, c, f, t);
    if (def.id === 'nova') drawMane(g, c, f, t);

    // treads
    g.fillStyle = '#2b2b38';
    rr(g, -15.5, -6.5, 31, 7, 3.5); g.fill();
    g.fillStyle = '#3c3c4e';
    const wheel = o.wheel || 0;
    for (let i = 0; i < 5; i++) {
      const wx2 = -12 + i * 6;
      g.beginPath(); g.arc(wx2, -3, 2.3, 0, 6.29); g.fill();
      g.strokeStyle = '#7a7a90'; g.lineWidth = 0.6;
      g.beginPath(); g.moveTo(wx2 + Math.cos(wheel) * 2, -3 + Math.sin(wheel) * 2); g.lineTo(wx2 - Math.cos(wheel) * 2, -3 - Math.sin(wheel) * 2); g.stroke();
    }
    g.fillStyle = '#1d1d28';
    const off = ((wheel * 2.3) % 3 + 3) % 3;
    for (let k = -15 + off; k < 15; k += 3) g.fillRect(k, -7, 1.3, 1.2);
    if (def.id === 'bubbles') drawTentacles(g, c, t);

    // hull
    const hullGr = g.createLinearGradient(0, -13, 0, -5);
    hullGr.addColorStop(0, shadeHex(c.body, 0.15)); hullGr.addColorStop(1, c.dark);
    g.fillStyle = hullGr;
    g.beginPath();
    g.moveTo(-14, -6); g.lineTo(14, -6); g.lineTo(f * 15 + (f > 0 ? 0 : 0), -9); g.quadraticCurveTo(f * 13, -13.5, f * 9, -13.5);
    g.lineTo(-f * 10, -13.5); g.quadraticCurveTo(-f * 14.5, -13, -f * 14.5, -9); g.closePath(); g.fill();
    // belly stripe + shine
    g.fillStyle = c.belly; g.globalAlpha = 0.85;
    rr(g, -9, -10.2, 18, 2.4, 1.2); g.fill(); g.globalAlpha = 1;
    g.fillStyle = 'rgba(255,255,255,0.35)';
    rr(g, -9, -13, 10, 1.3, 0.6); g.fill();
    if (def.id === 'roborex') { g.fillStyle = shadeHex(c.dark, -0.3); for (let i = -12; i <= 12; i += 4) { g.beginPath(); g.arc(i, -7.3, 0.5, 0, 6.29); g.fill(); } }

    // head / turret
    drawHead(g, def, f, t, o, aimLocal);

    g.filter = 'none';
    if (o.frozen) { // ice block
      g.fillStyle = 'rgba(180,235,255,0.45)'; g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 0.8;
      rr(g, -17, -26, 34, 26, 3); g.fill(); g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.7)'; g.beginPath(); g.moveTo(-13, -22); g.lineTo(-8, -17); g.moveTo(9, -23); g.lineTo(13, -20); g.stroke();
    }
    g.restore();
  }

  function drawBarrel(g, def, a, t, rec) {
    const c = def.colors;
    g.save();
    g.translate(0, -9);
    g.rotate(-a);
    const back = -rec * 3;
    g.fillStyle = c.dark;
    rr(g, back, -1.7, 19, 3.4, 1.5); g.fill();
    g.fillStyle = shadeHex(c.body, 0.1);
    rr(g, back, -1.7, 19, 1.5, 1); g.fill();
    switch (def.id) {
      case 'froggo': g.fillStyle = c.accent; rr(g, back + 15, -2.4, 4.5, 4.8, 1.4); g.fill(); break;
      case 'blaze': g.fillStyle = '#ffb627'; g.beginPath(); g.moveTo(back + 16, -2.8); g.lineTo(back + 21, 0); g.lineTo(back + 16, 2.8); g.closePath(); g.fill(); break;
      case 'frostbite': g.fillStyle = '#ffffff'; for (const k of [5, 10, 15]) { rr(g, back + k, -2.1, 1.6, 4.2, 0.6); g.fill(); } break;
      case 'roborex': g.fillStyle = c.accent; rr(g, back + 2, -2.6, 17, 1.2, 0.5); g.fill(); rr(g, back + 2, 1.4, 17, 1.2, 0.5); g.fill(); g.fillStyle = '#39ffea'; g.globalAlpha = 0.5 + 0.5 * Math.sin(t * 6); g.fillRect(back + 18, -1, 1.4, 2); g.globalAlpha = 1; break;
      case 'nova': g.save(); g.translate(back + 19.5, 0); g.rotate(t * 2); g.fillStyle = '#ffe36b'; TD.starPath(g, 3.2); g.fill(); g.restore(); break;
      case 'bubbles': g.strokeStyle = c.accent; g.lineWidth = 1; g.beginPath(); g.arc(back + 20, 0, 2.6, 0, 6.29); g.stroke(); break;
    }
    g.restore();
  }

  function drawWings(g, c, f, t) {
    const flap = Math.sin(t * 5) * 0.25;
    g.save(); g.translate(-f * 6, -12); g.scale(-f, 1); g.rotate(-0.4 + flap);
    g.fillStyle = c.accent;
    g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(4, -12, 12, -13); g.lineTo(9, -8); g.lineTo(12, -6); g.lineTo(8, -3); g.lineTo(9, 0); g.closePath(); g.fill();
    g.restore();
    // tail
    g.fillStyle = c.body;
    g.beginPath(); g.moveTo(-f * 13, -9); g.quadraticCurveTo(-f * 21, -8 + Math.sin(t * 3) * 1.5, -f * 23, -14); g.lineTo(-f * 19, -10); g.lineTo(-f * 13, -12); g.fill();
    g.fillStyle = c.accent; g.beginPath(); g.moveTo(-f * 23, -14); g.lineTo(-f * 25, -17); g.lineTo(-f * 21, -15); g.fill();
  }
  function drawMane(g, c, f, t) {
    const cols = c.mane;
    for (let i = 0; i < 3; i++) {
      g.fillStyle = cols[i];
      g.beginPath();
      const bx = -f * (3 + i * 2.2), by = -22 + i * 3;
      g.moveTo(bx, by);
      g.quadraticCurveTo(bx - f * 9, by + 2 + Math.sin(t * 3 + i) * 1.5, bx - f * 12, by + 9 + i);
      g.quadraticCurveTo(bx - f * 5, by + 5, bx + f * 1, by + 4);
      g.closePath(); g.fill();
    }
  }
  function drawTentacles(g, c, t) {
    g.strokeStyle = c.body; g.lineWidth = 2.2; g.lineCap = 'round';
    for (let i = 0; i < 4; i++) {
      const x0 = -12 + i * 8, w = Math.sin(t * 4 + i * 1.3) * 2;
      g.beginPath(); g.moveTo(x0, -6); g.quadraticCurveTo(x0 + w, -2, x0 + 2 + w, -0.5); g.stroke();
    }
    g.lineCap = 'butt';
  }

  function drawHead(g, def, f, t, o, aim) {
    const c = def.colors, id = def.id;
    const hx = f * 0.5, hy = -16;
    // look direction: along the barrel, or at something interesting
    const lx = Math.cos(aim), ly = -Math.sin(aim);
    const lookX = o.look ? o.look.x : lx, lookY = o.look ? o.look.y : ly;
    const mood = o.ko ? 'ko' : o.mood || 'idle';
    g.save(); g.translate(hx, hy);

    if (id === 'roborex') {
      const gr = g.createLinearGradient(0, -8, 0, 7); gr.addColorStop(0, shadeHex(c.body, 0.25)); gr.addColorStop(1, c.dark);
      g.fillStyle = gr; rr(g, -8.5, -7.5, 17, 13, 3.5); g.fill();
      // jaw with teeth
      g.fillStyle = c.dark; rr(g, f * 1 - 6, 3, 12 + f * 2, 3.8, 1.5); g.fill();
      g.fillStyle = '#fff'; for (let k = -4; k <= 5; k += 2.2) { g.beginPath(); g.moveTo(k + f, 3.2); g.lineTo(k + 1 + f, 5); g.lineTo(k + 2 + f, 3.2); g.fill(); }
      // visor
      g.fillStyle = '#10142a'; rr(g, -7, -4.5, 14, 5, 2.4); g.fill();
      drawEyes(g, { x: -3.2 + f * 0.8, y: -2 }, { x: 3.2 + f * 0.8, y: -2 }, 1.9, mood, o, lookX, lookY, t, true, c.eye);
      // antenna
      g.strokeStyle = '#555'; g.lineWidth = 0.7; g.beginPath(); g.moveTo(-f * 4, -7.5); g.lineTo(-f * 6, -12); g.stroke();
      g.fillStyle = Math.sin(t * 5) > 0 ? '#ff4f6a' : '#7a2030'; g.beginPath(); g.arc(-f * 6, -12.5, 1.2, 0, 6.29); g.fill();
      g.restore(); return;
    }

    // round head/dome
    const gr = g.createRadialGradient(-2.5, -4, 1, 0, 0, 9.5);
    gr.addColorStop(0, shadeHex(c.body, 0.35)); gr.addColorStop(1, c.body);
    g.fillStyle = gr;
    if (id === 'bubbles') { // glass dome with a little octopus inside
      g.fillStyle = 'rgba(200,245,255,0.35)'; g.beginPath(); g.arc(0, -1, 8.6, 0, 6.29); g.fill();
      g.fillStyle = gr; g.beginPath(); g.arc(0, 1, 6.2, 0, 6.29); g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 0.7; g.beginPath(); g.arc(0, -1, 8.6, 0, 6.29); g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.8)'; g.beginPath(); g.ellipse(-4, -5.5, 2.2, 1.1, -0.6, 0, 6.29); g.fill();
      // periscope
      g.fillStyle = c.accent; g.fillRect(-f * 2 - 0.7, -14, 1.4, 5); g.fillRect(-f * 2 - 0.7 + (f > 0 ? 0 : -2.4), -14.5, 3.8, 1.6);
      drawEyes(g, { x: -2.3 + f, y: 0 }, { x: 2.3 + f, y: 0 }, 1.9, mood, o, lookX, lookY, t, false, c.eye);
      drawMouth(g, f * 1, 3.6, mood, 0.8);
      blush(g, -4.4 + f, 2.4, 4.4 + f, 2.4);
      g.restore(); return;
    }
    g.beginPath(); g.arc(0, 0, 8, 0, 6.29); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.ellipse(-3, -4.6, 2.8, 1.4, -0.5, 0, 6.29); g.fill();

    if (id === 'froggo') {
      // big frog eye bumps on top
      g.fillStyle = gr;
      g.beginPath(); g.arc(-3.8 + f, -6.2, 3.7, 0, 6.29); g.arc(3.8 + f, -6.2, 3.7, 0, 6.29); g.fill();
      drawEyes(g, { x: -3.8 + f, y: -6.4 }, { x: 3.8 + f, y: -6.4 }, 2.8, mood, o, lookX, lookY, t, false, c.eye);
      drawMouth(g, f * 1.2, 2.2, mood, 1.4);
      blush(g, -5 + f, 1.5, 5.4 + f, 1.5);
    } else if (id === 'blaze') {
      g.fillStyle = '#fff1c9';
      for (const s of [-1, 1]) { g.beginPath(); g.moveTo(s * 3 - 1, -7); g.quadraticCurveTo(s * 5, -12, s * 6.5, -12.5); g.quadraticCurveTo(s * 5, -9, s * 4.5, -6.5); g.fill(); }
      g.fillStyle = c.accent; for (let k = 0; k < 3; k++) { const a = -Math.PI / 2 - f * (0.7 + k * 0.45); g.beginPath(); g.moveTo(Math.cos(a - 0.2) * 7.6, Math.sin(a - 0.2) * 7.6); g.lineTo(Math.cos(a) * 10.5, Math.sin(a) * 10.5); g.lineTo(Math.cos(a + 0.2) * 7.6, Math.sin(a + 0.2) * 7.6); g.fill(); }
      g.fillStyle = c.belly; g.beginPath(); g.ellipse(f * 3.2, 2.8, 4.2, 3, 0, 0, 6.29); g.fill();
      g.fillStyle = c.dark; g.beginPath(); g.arc(f * 5, 2, 0.6, 0, 6.29); g.arc(f * 3, 2, 0.6, 0, 6.29); g.fill();
      drawEyes(g, { x: -2.6 + f * 1.2, y: -2.5 }, { x: 2.8 + f * 1.2, y: -2.5 }, 2.2, mood, o, lookX, lookY, t, false, c.eye);
      drawMouth(g, f * 2.5, 4.4, mood, 1);
      if ((t * 0.7) % 3 < 0.1) { /* puff */ }
    } else if (id === 'frostbite') {
      g.fillStyle = c.belly; g.beginPath(); g.ellipse(f * 1.2, 1, 5.8, 6, 0, 0, 6.29); g.fill();
      g.fillStyle = '#ff9f1c'; g.beginPath(); g.moveTo(f * 1.2 - 1.8, 1.5); g.lineTo(f * 1.2 + f * 5, 2.6); g.lineTo(f * 1.2 + 1.8 * (f > 0 ? -1 : 1) * -1, 3.6); g.closePath(); g.fill();
      drawEyes(g, { x: -1.9 + f * 1.2, y: -1.6 }, { x: 2.8 + f * 1.2, y: -1.6 }, 1.9, mood, o, lookX, lookY, t, false, c.eye);
      if (mood !== 'idle' && mood !== 'happy') drawMouth(g, f * 2, 5.2, mood, 0.7);
      // beanie with pom-pom
      g.fillStyle = c.scarf; g.beginPath(); g.arc(0, -3.6, 7.4, Math.PI + 0.25, -0.25); g.closePath(); g.fill();
      g.fillStyle = '#fff'; rr(g, -7.2, -5, 14.4, 2.2, 1.1); g.fill(); g.beginPath(); g.arc(0, -11.4, 2, 0, 6.29); g.fill();
      // scarf fluttering in the wind
      g.fillStyle = c.scarf; rr(g, -7.5, 5.8, 15, 2.8, 1.4); g.fill();
      const w = -(o.windX || 0) * 0.35 - f * 4;
      g.beginPath(); g.moveTo(-f * 5, 7); g.quadraticCurveTo(-f * 5 + w * 0.5, 10 + Math.sin(t * 7) * 1.2, -f * 5 + w, 9 + Math.sin(t * 7 + 1) * 1.5); g.lineTo(-f * 5 + w, 11.5); g.quadraticCurveTo(-f * 5 + w * 0.5, 12, -f * 3, 8.5); g.fill();
    } else if (id === 'nova') {
      // golden horn
      g.fillStyle = '#ffd23f'; g.beginPath(); g.moveTo(f * 1 - 2, -7); g.lineTo(f * 3, -16.5); g.lineTo(f * 1 + 2.2, -7); g.fill();
      g.strokeStyle = '#e0a800'; g.lineWidth = 0.6; for (let k = 0; k < 3; k++) { g.beginPath(); g.moveTo(f * (1 + k * 0.6) - 1.6 + k * 0.4, -8.5 - k * 2.6); g.lineTo(f * (1 + k * 0.6) + 1.6 - k * 0.4, -9.5 - k * 2.6); g.stroke(); }
      // sparkles
      for (let k = 0; k < 3; k++) { const a = t * 1.5 + k * 2.1; g.save(); g.translate(Math.cos(a) * 11, Math.sin(a) * 6 - 4); g.rotate(a); g.fillStyle = ['#fff', '#ffe36b', '#8fdcff'][k]; g.globalAlpha = 0.6 + 0.4 * Math.sin(t * 5 + k); TD.starPath(g, 1.3); g.fill(); g.restore(); g.globalAlpha = 1; }
      drawEyes(g, { x: -2.8 + f * 1.2, y: -1.2 }, { x: 3 + f * 1.2, y: -1.2 }, 2.5, mood, o, lookX, lookY, t, false, c.eye, true);
      drawMouth(g, f * 1.2, 3.8, mood, 1);
      blush(g, -5 + f, 2, 5.4 + f, 2);
    }
    if (o.scaredDrop) { g.fillStyle = '#8fdcff'; g.beginPath(); g.moveTo(-f * 7, -6); g.quadraticCurveTo(-f * 8.5, -2, -f * 7, -1.5); g.quadraticCurveTo(-f * 5.5, -2, -f * 7, -6); g.fill(); }
    g.restore();
  }

  function blush(g, x1, y1, x2, y2) {
    g.fillStyle = 'rgba(255,110,150,0.45)';
    g.beginPath(); g.ellipse(x1, y1, 1.6, 0.9, 0, 0, 6.29); g.ellipse(x2, y2, 1.6, 0.9, 0, 0, 6.29); g.fill();
  }

  function drawEyes(g, e1, e2, r, mood, o, lx, ly, t, robot, eyeColor, lashes) {
    const blink = (o.blink ?? 1) < 0;
    for (const e of [e1, e2]) {
      g.save(); g.translate(e.x, e.y);
      if (robot) {
        const col = mood === 'hurt' || mood === 'ko' ? '#ff4f6a' : eyeColor;
        g.fillStyle = col; g.shadowColor = col; g.shadowBlur = 4;
        if (mood === 'ko') { g.strokeStyle = col; g.lineWidth = 0.8; g.beginPath(); g.moveTo(-1.4, -1.4); g.lineTo(1.4, 1.4); g.moveTo(1.4, -1.4); g.lineTo(-1.4, 1.4); g.stroke(); }
        else if (mood === 'happy') { g.strokeStyle = col; g.lineWidth = 0.9; g.beginPath(); g.arc(0, 0.6, 1.4, Math.PI * 1.1, Math.PI * 1.9); g.stroke(); }
        else { const h = blink ? 0.3 : mood === 'charge' ? 0.9 : mood === 'scared' ? 2.2 : 1.6; rr(g, -1.6 + lx * 0.5, -h / 2 + ly * 0.4, 3.2, h, 0.5); g.fill(); }
        g.restore(); continue;
      }
      if (mood === 'ko') {
        g.strokeStyle = '#1a1a1a'; g.lineWidth = 0.7; g.beginPath();
        for (let a = 0; a < 12; a += 0.4) { const rad = a * 0.12 * r / 1.5; g.lineTo(Math.cos(a + t * 6) * rad, Math.sin(a + t * 6) * rad); }
        g.stroke(); g.restore(); continue;
      }
      if (mood === 'happy' || (mood === 'hurt' && e === e1) || (mood === 'hurt')) {
        g.strokeStyle = '#1a1a1a'; g.lineWidth = 0.8; g.lineCap = 'round';
        g.beginPath();
        if (mood === 'happy') g.arc(0, r * 0.35, r * 0.75, Math.PI * 1.15, Math.PI * 1.85);
        else { const s = e === e1 ? 1 : -1; g.moveTo(-r * 0.7 * s, -r * 0.6); g.lineTo(r * 0.5 * s, 0); g.lineTo(-r * 0.7 * s, r * 0.6); }
        g.stroke(); g.lineCap = 'butt'; g.restore(); continue;
      }
      // sclera
      g.fillStyle = '#fff';
      g.beginPath(); g.ellipse(0, 0, r, blink ? r * 0.12 : r * (mood === 'charge' ? 0.7 : 1), 0, 0, 6.29); g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 0.35; g.stroke();
      if (!blink) {
        const pr = mood === 'scared' ? r * 0.3 : r * 0.55;
        const px = lx * r * 0.35, py = ly * r * 0.3;
        g.fillStyle = eyeColor; g.beginPath(); g.arc(px, py, pr, 0, 6.29); g.fill();
        g.fillStyle = '#fff'; g.beginPath(); g.arc(px - pr * 0.35, py - pr * 0.4, pr * 0.38, 0, 6.29); g.fill();
        if (lashes) { g.strokeStyle = '#1a1a1a'; g.lineWidth = 0.5; for (const a of [-2.2, -1.9, -1.6]) { g.beginPath(); g.moveTo(Math.cos(a) * r, Math.sin(a) * r); g.lineTo(Math.cos(a) * r * 1.35, Math.sin(a) * r * 1.35); g.stroke(); } }
        if (mood === 'charge') { g.strokeStyle = '#1a1a1a'; g.lineWidth = 0.8; g.beginPath(); g.moveTo(-r, -r * 0.9); g.lineTo(r, -r * 0.5 * (e === e1 ? 1 : -1) - r * 0.4); g.stroke(); }
      }
      g.restore();
    }
  }

  function drawMouth(g, x, y, mood, k) {
    g.save(); g.translate(x, y); g.scale(k, k);
    g.strokeStyle = '#1a1a1a'; g.lineWidth = 0.7; g.lineCap = 'round';
    g.beginPath();
    if (mood === 'scared' || mood === 'hurt') { g.fillStyle = '#5a1a2a'; g.ellipse(0, 0.4, 1.3, 1.5, 0, 0, 6.29); g.fill(); }
    else if (mood === 'ko') { g.moveTo(-1.6, 0.4); g.quadraticCurveTo(-0.8, -0.6, 0, 0.4); g.quadraticCurveTo(0.8, 1.2, 1.6, 0.2); g.stroke(); }
    else if (mood === 'charge') { g.moveTo(-1.5, 0); g.lineTo(1.5, 0); g.stroke(); }
    else if (mood === 'happy') { g.fillStyle = '#5a1a2a'; g.moveTo(-2.2, -0.4); g.quadraticCurveTo(0, 3.4, 2.2, -0.4); g.closePath(); g.fill(); g.fillStyle = '#ff7a9a'; g.beginPath(); g.arc(0, 1.2, 0.9, 0, 3.14); g.fill(); }
    else { g.arc(0, -0.8, 2, 0.35, Math.PI - 0.35); g.stroke(); }
    g.restore();
  }

  /** Name, HP bar and turn marker above a tank (screen space). */
  function drawTag(g, x, y, s, t, o) {
    const w = 64, hpK = t.hp / t.maxHp;
    const top = y - 3.3 * s - 26;
    x = Math.max(w / 2 + 6, Math.min(TD.W - w / 2 - 6, x)); // keep the tag on screen
    g.save();
    g.font = '700 13px Fredoka, system-ui, sans-serif'; g.textAlign = 'center';
    g.lineWidth = 3; g.strokeStyle = 'rgba(10,10,30,0.8)'; g.fillStyle = TEAM_COLORS[t.team % 4];
    g.strokeText(t.name, x, top); g.fillText(t.name, x, top);
    g.fillStyle = 'rgba(10,10,30,0.7)'; TD.roundRect(g, x - w / 2 - 2, top + 4, w + 4, 9, 4); g.fill();
    g.fillStyle = hpK > 0.5 ? '#5de08a' : hpK > 0.25 ? '#ffd23f' : '#ff4f6a';
    if (hpK > 0) { TD.roundRect(g, x - w / 2, top + 6, w * hpK, 5, 2.5); g.fill(); }
    if (t.ss >= TD.SS_MAX) { g.fillStyle = '#ffe35a'; g.font = '900 12px Fredoka, system-ui'; g.fillText('★SS', x + w / 2 + 16, top + 13); }
    if (o.active) {
      const b = Math.sin(o.time * 6) * 4;
      g.fillStyle = '#ffe35a'; g.strokeStyle = '#1a1030'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(x, top - 14 + b); g.lineTo(x - 8, top - 26 + b); g.lineTo(x + 8, top - 26 + b); g.closePath(); g.fill(); g.stroke();
    }
    g.restore();
  }

  /** A standalone portrait (select screen, HUD). */
  function drawPortrait(g, def, x, y, size, o = {}) {
    drawTank(g, x, y, size, Object.assign({ def, facing: 1, aimAng: 0.6, tilt: 0, t: o.t || 0, mood: o.mood || 'idle', team: o.team || 0, blink: o.blink ?? 1, windX: 0 }, o));
  }

  TD.Skins = { drawTank, drawTag, drawPortrait, shadeHex };
})(globalThis.TD);
