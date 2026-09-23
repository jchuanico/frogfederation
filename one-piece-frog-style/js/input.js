/* One Piece Frog Style — keyboard, gamepad and touch input.
 * Every source is folded into the same raw state: directions plus six buttons
 * L (light), H (heavy), S (special), X (hyper), T (tag), A (assist). */
'use strict';
(function (OP) {
  const BTN = ['L', 'H', 'S', 'X', 'T', 'A'];
  const KEYS = {
    p1: {
      up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'],
      L: ['KeyJ'], H: ['KeyK'], S: ['KeyL'], X: ['KeyO'], T: ['KeyI'], A: ['KeyU'],
      start: ['Enter', 'Escape'],
    },
    p2: {
      up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'],
      L: ['Numpad1', 'Comma'], H: ['Numpad2', 'Period'], S: ['Numpad3', 'Slash'],
      X: ['Numpad6', 'Quote'], T: ['Numpad5', 'Semicolon'], A: ['Numpad4', 'KeyM'],
      start: ['NumpadEnter', 'Backspace'],
    },
  };
  const down = new Set();
  const tapped = new Set(); // keys pressed since the last simulation frame, so quick taps are never lost
  const GAME_KEYS = new Set(Object.values(KEYS.p1).flat().concat(Object.values(KEYS.p2).flat(), ['Space', 'KeyH', 'KeyP']));
  window.addEventListener('keydown', (e) => {
    if (GAME_KEYS.has(e.code)) e.preventDefault();
    down.add(e.code); tapped.add(e.code);
    OP.Input.lastDevice = 'keyboard';
    OP.Audio.init();
  });
  window.addEventListener('keyup', (e) => down.delete(e.code));
  window.addEventListener('blur', () => { down.clear(); for (const k in touch) touch[k] = false; });

  // Touch state is written by the on-screen controls (see main.js).
  const touch = { up: false, down: false, left: false, right: false, L: false, H: false, S: false, X: false, T: false, A: false, start: false };

  function blank() { return { up: false, down: false, left: false, right: false, L: false, H: false, S: false, X: false, T: false, A: false, start: false }; }

  function readKeys(map, into) {
    for (const k in map) if (map[k].some((c) => down.has(c) || tapped.has(c))) into[k] = true;
  }
  function readPad(i, into) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = pads && pads[i];
    if (!gp) return;
    const b = (n) => gp.buttons[n] && gp.buttons[n].pressed;
    const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
    if (b(14) || ax < -0.45) into.left = true;
    if (b(15) || ax > 0.45) into.right = true;
    if (b(12) || ay < -0.5) into.up = true;
    if (b(13) || ay > 0.5) into.down = true;
    if (b(0)) into.L = true; if (b(2)) into.H = true; if (b(1)) into.S = true; if (b(3)) into.X = true;
    if (b(5) || b(7)) into.T = true; if (b(4) || b(6)) into.A = true; if (b(9)) into.start = true;
    if (gp.buttons.some((x) => x.pressed)) OP.Input.lastDevice = 'gamepad';
  }

  // Raw state for a human slot. With one human, P1 also accepts the P2 keys and pad 2.
  function raw(slot, humans) {
    const s = blank();
    if (slot === 0) {
      readKeys(KEYS.p1, s); readPad(0, s);
      if (humans < 2) { readKeys(KEYS.p2, s); readPad(1, s); }
      for (const k in touch) if (touch[k]) s[k] = true;
    } else {
      readKeys(KEYS.p2, s); readPad(1, s);
    }
    if (s.left && s.right) s.left = s.right = false; // SOCD: neutral
    return s;
  }

  // Numpad direction notation with absolute left/right.
  function numDir(s) {
    const h = s.left ? -1 : s.right ? 1 : 0, v = s.down ? -1 : s.up ? 1 : 0;
    return 5 + h + v * 3;
  }
  const MIRROR = { 1: 3, 3: 1, 4: 6, 6: 4, 7: 9, 9: 7 };

  // Per-player controller: edge detection, a short press buffer, and a motion history.
  class Pad {
    constructor() { this.cur = blank(); this.prev = blank(); this.buf = {}; this.hist = []; this.tapT = { left: 99, right: 99 }; this.dashDir = 0; for (const b of BTN) this.buf[b] = 0; }
    update(s) {
      this.prev = this.cur; this.cur = s;
      for (const b of BTN) this.buf[b] = s[b] && !this.prev[b] ? 7 : Math.max(0, this.buf[b] - 1);
      this.hist.push(numDir(s)); if (this.hist.length > 32) this.hist.shift();
      // double-tap detection for dashes
      this.dashDir = 0;
      for (const d of ['left', 'right']) {
        if (s[d] && !this.prev[d]) { if (this.tapT[d] < 14) this.dashDir = d === 'left' ? -1 : 1; this.tapT[d] = 0; }
        else this.tapT[d]++;
      }
      this.startPressed = s.start && !this.prev.start;
    }
    pressed(b) { return this.buf[b] > 0; }
    consume(b) { this.buf[b] = 0; }
    held(b) { return !!this.cur[b]; }
    edge(k) { return this.cur[k] && !this.prev[k]; }
    // Relative direction: fwd = +1 when holding toward `facing`.
    fwd(facing) { return this.cur.right ? facing : this.cur.left ? -facing : 0; }
    // Motion detection in facing-relative numpad notation, e.g. [2,3,6] = quarter circle forward.
    motion(seq, facing, win = 16) {
      const h = this.hist.slice(-win).map((d) => (facing < 0 ? MIRROR[d] || d : d));
      let i = 0;
      for (const d of h) if (d === seq[i]) { i++; if (i === seq.length) return true; }
      return false;
    }
    // Down then up within a short window = super jump.
    superJump() {
      const h = this.hist.slice(-12);
      const iu = h.findIndex((d) => d >= 7);
      return iu > 0 && h.slice(0, iu).some((d) => d <= 3);
    }
  }

  OP.Input = { raw, Pad, touch, blank, BTN, KEYS, lastDevice: 'keyboard', isDown: (c) => down.has(c) || tapped.has(c), endFrame: () => tapped.clear() };
})(window.OP);
