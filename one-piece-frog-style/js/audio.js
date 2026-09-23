/* One Piece Frog Style — music and sound effects.
 * Everything is synthesized live with the Web Audio API: original anime-flavoured
 * tunes and punchy SFX, no audio files and no copyrighted recordings. */
'use strict';
(function (OP) {
  let ctx = null, master, comp, musicBus, sfxBus, revSend, noiseBuf, distCurve;

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.18;
    master.connect(comp); comp.connect(ctx.destination);
    musicBus = ctx.createGain(); musicBus.connect(master);
    sfxBus = ctx.createGain(); sfxBus.connect(master);
    // Small hall reverb from a generated impulse.
    const rev = ctx.createConvolver();
    const len = ctx.sampleRate * 2.2, ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    rev.buffer = ir;
    revSend = ctx.createGain(); revSend.gain.value = 0.22;
    revSend.connect(rev); rev.connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    distCurve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; distCurve[i] = Math.tanh(x * 6) * 0.8; }
    applyVolumes();
  }

  function applyVolumes() {
    if (!ctx) return;
    musicBus.gain.value = OP.settings.music * 0.55;
    sfxBus.gain.value = OP.settings.sfx;
  }

  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  function noteToMidi(s) {
    const m = /^([A-G])([#b]?)(-?\d)$/.exec(s);
    if (!m) return null;
    return 12 * (+m[3] + 1) + NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  }

  // ---------- low-level voices ----------
  function env(g, t, a, peak, dur, r) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.setValueAtTime(peak, t + Math.max(a, dur));
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(a, dur) + r);
  }

  function tone(o) {
    const t = o.t ?? ctx.currentTime, dur = o.dur ?? 0.1, r = o.r ?? 0.08;
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f, t);
    if (o.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.slide), t + (o.slideT ?? dur));
    if (o.detune) osc.detune.value = o.detune;
    let node = osc;
    if (o.vib) {
      const lfo = ctx.createOscillator(), lg = ctx.createGain();
      lfo.frequency.value = o.vibRate || 5.5; lg.gain.setValueAtTime(0, t);
      lg.gain.linearRampToValueAtTime(o.vib, t + Math.min(0.25, dur));
      lfo.connect(lg); lg.connect(osc.detune); lfo.start(t); lfo.stop(t + dur + r + 0.05);
    }
    if (o.filter) {
      const f = ctx.createBiquadFilter();
      f.type = o.filterType || 'lowpass'; f.Q.value = o.q ?? 1;
      f.frequency.setValueAtTime(o.filter, t);
      if (o.filterEnd) f.frequency.exponentialRampToValueAtTime(o.filterEnd, t + dur + r);
      node.connect(f); node = f;
    }
    if (o.dist) { const ws = ctx.createWaveShaper(); ws.curve = distCurve; node.connect(ws); node = ws; }
    node.connect(g);
    env(g, t, o.a ?? 0.004, o.g ?? 0.3, dur, r);
    g.connect(o.dest || sfxBus);
    if (o.rev) { const s = ctx.createGain(); s.gain.value = o.rev; g.connect(s); s.connect(revSend); }
    osc.start(t); osc.stop(t + dur + r + 0.05);
  }

  function noise(o) {
    const t = o.t ?? ctx.currentTime, dur = o.dur ?? 0.1, r = o.r ?? 0.05;
    const src = ctx.createBufferSource(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    src.buffer = noiseBuf; src.playbackRate.value = o.rate || 1;
    f.type = o.ft || 'lowpass'; f.Q.value = o.q ?? 0.8;
    f.frequency.setValueAtTime(o.f ?? 2000, t);
    if (o.fEnd) f.frequency.exponentialRampToValueAtTime(o.fEnd, t + dur + r);
    src.connect(f); f.connect(g);
    env(g, t, o.a ?? 0.002, o.g ?? 0.3, dur, r);
    g.connect(o.dest || sfxBus);
    if (o.rev) { const s = ctx.createGain(); s.gain.value = o.rev; g.connect(s); s.connect(revSend); }
    src.start(t, Math.random() * 1.5); src.stop(t + dur + r + 0.05);
  }

  // ---------- instruments for the music sequencer ----------
  const INST = {
    brass(t, f, d, v) { // bright anime brass lead
      tone({ t, f, dur: d, type: 'sawtooth', g: 0.11 * v, a: 0.03, r: 0.12, filter: 900, filterEnd: 2600, q: 2, vib: 14, dest: musicBus, rev: 0.4 });
      tone({ t, f: f * 2, dur: d, type: 'square', g: 0.025 * v, a: 0.03, r: 0.1, filter: 2400, dest: musicBus });
    },
    lead(t, f, d, v) { // electric lead for the battle theme
      tone({ t, f, dur: d, type: 'sawtooth', g: 0.09 * v, a: 0.01, r: 0.1, filter: 2600, q: 3, vib: 18, vibRate: 6, dest: musicBus, rev: 0.35, dist: true });
      tone({ t, f, dur: d, type: 'square', g: 0.04 * v, a: 0.01, r: 0.08, detune: 7, filter: 3200, dest: musicBus });
    },
    pluck(t, f, d, v) {
      tone({ t, f, dur: 0.02, type: 'triangle', g: 0.18 * v, a: 0.002, r: Math.min(0.5, d + 0.2), dest: musicBus, rev: 0.3 });
      tone({ t, f: f * 2, dur: 0.01, type: 'sine', g: 0.06 * v, a: 0.002, r: 0.2, dest: musicBus });
    },
    accordion(t, f, d, v) { // shanty-ish reed with tremolo
      tone({ t, f, dur: d, type: 'square', g: 0.05 * v, a: 0.04, r: 0.1, filter: 1800, vib: 10, vibRate: 7, dest: musicBus, rev: 0.25 });
      tone({ t, f, dur: d, type: 'square', g: 0.05 * v, a: 0.04, r: 0.1, detune: 12, filter: 1800, dest: musicBus });
    },
    bass(t, f, d, v) {
      tone({ t, f, dur: d * 0.9, type: 'triangle', g: 0.32 * v, a: 0.005, r: 0.05, dest: musicBus });
      tone({ t, f, dur: d * 0.8, type: 'sawtooth', g: 0.09 * v, a: 0.005, r: 0.05, filter: 500, filterEnd: 200, dest: musicBus });
    },
    pad(t, f, d, v) {
      for (const dt of [-8, 8]) tone({ t, f, dur: d, type: 'sawtooth', g: 0.028 * v, a: 0.18, r: 0.35, detune: dt, filter: 1100, dest: musicBus, rev: 0.5 });
    },
    guitar(t, f, d, v) { // palm-muted power chord chug
      for (const m of [1, 1.5, 2]) tone({ t, f: f * m, dur: d * 0.7, type: 'sawtooth', g: 0.035 * v, a: 0.003, r: 0.06, filter: 1900, filterEnd: 700, dist: true, dest: musicBus });
    },
  };

  const DRUM = {
    k(t, v) { tone({ t, f: 150, slide: 42, slideT: 0.12, dur: 0.12, type: 'sine', g: 0.75 * v, r: 0.12, dest: musicBus }); },
    s(t, v) {
      noise({ t, dur: 0.07, g: 0.32 * v, f: 1800, ft: 'bandpass', q: 0.6, r: 0.12, dest: musicBus, rev: 0.25 });
      tone({ t, f: 210, slide: 150, dur: 0.05, type: 'triangle', g: 0.25 * v, r: 0.06, dest: musicBus });
    },
    h(t, v) { noise({ t, dur: 0.015, g: 0.11 * v, f: 8000, ft: 'highpass', r: 0.03, dest: musicBus }); },
    c(t, v) { noise({ t, dur: 0.2, g: 0.2 * v, f: 5000, ft: 'highpass', r: 1.2, dest: musicBus, rev: 0.4 }); },
    t(t, v) { tone({ t, f: 180, slide: 90, dur: 0.15, type: 'sine', g: 0.4 * v, r: 0.1, dest: musicBus }); },
  };

  // ---------- song data (original compositions) ----------
  // Melody tokens: NOTE:sixteenths, "-" is a rest. Chords: SYMBOL:sixteenths.
  const SONGS = {
    title: { // "Set Sail!" — D major, heroic
      bpm: 132, loop: true,
      tracks: [
        { inst: 'brass', seq: 'F#5:4 A5:4 A5:2 B5:2 A5:4 E5:6 C#5:2 A4:8 D5:4 F#5:4 B5:4 A5:2 F#5:2 G5:8 -:4 D5:4 ' +
          'F#5:4 A5:4 D6:4 C#6:2 B5:2 A5:6 E5:2 C#5:4 E5:4 D5:4 G5:4 B5:4 A5:2 G5:2 A5:12 -:4 ' +
          'B4:2 D5:2 F#5:4 F#5:2 E5:2 D5:4 B4:2 D5:2 G5:4 G5:2 F#5:2 E5:4 F#5:4 A5:6 F#5:2 D5:4 E5:4 C#5:4 A4:8 ' +
          'F#5:4 B5:4 A5:2 F#5:2 D5:4 G5:4 B5:4 D6:4 B5:4 E5:4 G5:4 A5:4 C#6:4 D6:12 -:4' },
        { inst: 'accordion', chords: 'D:16 A:16 Bm:16 G:16 D:16 A:16 G:16 A:16 Bm:16 G:16 D:16 A:16 Bm:16 G:16 Em:8 A:8 D:16', arp: 'x.x.x.x.x.x.x.x.', oct: 4, vol: 0.6 },
        { inst: 'bass', chords: 'D:16 A:16 Bm:16 G:16 D:16 A:16 G:16 A:16 Bm:16 G:16 D:16 A:16 Bm:16 G:16 Em:8 A:8 D:16', bassPat: 'x...x.o.x...x.o.' },
        { drums: { k: ['x.......x.x.....'], s: ['....x.......x...'], h: ['x.x.x.x.x.x.x.x.'], c: ['x...............', '................', '................', '................'] }, vol: 0.8 },
      ],
    },
    select: { // "Crew Assemble" — C major, bouncy
      bpm: 120, loop: true,
      tracks: [
        { inst: 'pluck', seq: 'E5:2 G5:2 C6:2 G5:2 E5:2 G5:2 C6:4 A5:2 C6:2 E6:2 C6:2 A5:4 E5:4 F5:2 A5:2 C6:2 A5:2 F5:2 G5:2 A5:4 B5:4 G5:4 D5:4 G5:4 ' +
          'E5:2 G5:2 C6:2 E6:2 D6:2 C6:2 G5:4 A5:2 C6:2 E6:4 D6:2 C6:2 A5:4 F5:4 A5:4 G5:2 B5:2 D6:4 C6:8 -:8' },
        { inst: 'pad', chords: 'C:16 Am:16 F:16 G:16 C:16 Am:16 Dm:8 G:8 C:16', vol: 0.8 },
        { inst: 'bass', chords: 'C:16 Am:16 F:16 G:16 C:16 Am:16 Dm:8 G:8 C:16', bassPat: 'x.....x.x.......' },
        { drums: { k: ['x.......x.......'], s: ['....x.......x...'], h: ['..x...x...x...x.'] }, vol: 0.6 },
      ],
    },
    battle: { // "Clash on the Merry" — A minor, driving rock
      bpm: 164, loop: true,
      tracks: [
        { inst: 'lead', seq: 'A4:2 C5:2 E5:4 D5:2 C5:2 D5:2 E5:2 A5:6 G5:2 E5:4 -:4 F5:2 E5:2 C5:4 F5:2 G5:2 A5:4 G5:6 F5:2 D5:4 B4:4 ' +
          'A4:2 C5:2 E5:4 A5:2 G5:2 E5:4 C6:6 B5:2 A5:4 E5:4 F5:4 A5:4 C6:4 A5:4 G#5:8 B5:4 E5:4 ' +
          'C5:2 C5:2 F5:4 A5:4 G5:2 F5:2 D5:2 D5:2 G5:4 B5:4 A5:2 G5:2 E5:2 G5:2 B5:4 E6:4 D6:2 B5:2 C6:8 A5:8 ' +
          'A5:4 F5:4 C6:4 A5:4 B5:4 G5:4 D6:4 B5:4 E6:4 D6:2 C6:2 B5:4 G#5:4 E5:4 G#5:4 B5:4 E6:4' },
        { inst: 'guitar', chords: 'A5:32 F5:16 G5:16 A5:32 F5:16 E5:16 F5:16 G5:16 E5:16 A5:16 F5:16 G5:16 E5:32', arp: 'x.xxx.xxx.xxx.xx', oct: 2, root: true, vol: 0.9 },
        { inst: 'bass', chords: 'Am:32 F:16 G:16 Am:32 F:16 E:16 F:16 G:16 Em:16 Am:16 F:16 G:16 E:32', bassPat: 'x.x.o.x.x.x.o.x.' },
        { drums: { k: ['x...x...x...x...', 'x.x...x.x.x...x.'], s: ['....x.......x...', '....x.......x.xx'], h: ['x.x.x.x.x.x.x.x.'], c: ['x...............', '................', '................', '................'] } },
      ],
    },
    victory: {
      bpm: 140, loop: false,
      tracks: [
        { inst: 'brass', seq: 'D5:2 D5:2 D5:2 G5:6 A5:2 B5:2 D6:16' },
        { inst: 'pad', chords: 'G:16 D:4 G:12' },
        { inst: 'bass', chords: 'G:16 D:4 G:12', bassPat: 'x...x...x...x...' },
        { drums: { k: ['x...x...x...x...'], s: ['..........x.x.x.', 'x...............'], c: ['x...............', 'x...............'] } },
      ],
    },
  };

  const CHORD_Q = { '': [0, 4, 7], m: [0, 3, 7], '7': [0, 4, 7, 10], m7: [0, 3, 7, 10], '5': [0, 7], sus4: [0, 5, 7] };
  function parseChord(sym) {
    const m = /^([A-G][#b]?)(m7|m|7|5|sus4)?$/.exec(sym);
    const root = noteToMidi(m[1] + '0') - 12; // pitch class as midi octave -1
    return { root: ((root % 12) + 12) % 12, iv: CHORD_Q[m[2] || ''] };
  }

  // Compile a song into per-step event lists.
  function compile(song) {
    const events = []; let length = 0;
    const add = (step, fn) => { (events[step] = events[step] || []).push(fn); };
    for (const tr of song.tracks) {
      const vol = tr.vol ?? 1;
      if (tr.seq) {
        let pos = 0;
        for (const tok of tr.seq.trim().split(/\s+/)) {
          const [n, d] = tok.split(':'); const dur = +d;
          if (n !== '-') { const f = mtof(noteToMidi(n)); const inst = INST[tr.inst]; add(pos, (t, sd) => inst(t, f, dur * sd * 0.95, vol)); }
          pos += dur;
        }
        length = Math.max(length, pos);
      }
      if (tr.chords) {
        let pos = 0;
        for (const tok of tr.chords.trim().split(/\s+/)) {
          const [sym, d] = tok.split(':'); const dur = +d; const ch = parseChord(sym);
          for (let s = 0; s < dur; s++) {
            const st = pos + s;
            if (tr.bassPat) {
              const c = tr.bassPat[st % 16];
              if (c === 'x' || c === 'o') {
                const f = mtof(36 + ch.root + (c === 'o' ? 12 : 0));
                add(st, (t, sd) => INST.bass(t, f, sd * 2, vol));
              }
            } else if (tr.arp) {
              if (tr.arp[st % 16] === 'x') {
                const notes = tr.root ? [ch.root] : ch.iv.map((i) => ch.root + i);
                const base = 12 * ((tr.oct ?? 4) + 1);
                const inst = INST[tr.inst];
                add(st, (t, sd) => { for (const n of notes) inst(t, mtof(base + n), sd * 1.6, vol); });
              }
            } else if (s === 0) {
              const base = 12 * ((tr.oct ?? 4) + 1);
              const inst = INST[tr.inst];
              add(st, (t, sd) => { for (const i of ch.iv) inst(t, mtof(base + ch.root + i), dur * sd, vol); });
            }
          }
          pos += dur;
        }
        length = Math.max(length, pos);
      }
    }
    // Drums fill the whole song length.
    for (const tr of song.tracks) {
      if (!tr.drums) continue;
      const vol = tr.vol ?? 1;
      for (let st = 0; st < length; st++) {
        const bar = (st / 16) | 0;
        for (const k in tr.drums) {
          const pats = tr.drums[k]; const pat = pats[bar % pats.length]; const c = pat[st % 16];
          if (c === 'x' || c === 'o') { const v = (c === 'x' ? 1 : 0.55) * vol; add(st, (t) => DRUM[k](t, v)); }
        }
      }
    }
    return { events, length, bpm: song.bpm, loop: song.loop };
  }

  const compiled = {};
  let cur = null, curName = null, step = 0, nextT = 0, timer = null, tempoScale = 1;

  function playMusic(name) {
    init(); if (!ctx) return;
    if (curName === name) return;
    stopMusic();
    compiled[name] = compiled[name] || compile(SONGS[name]);
    cur = compiled[name]; curName = name; step = 0; nextT = ctx.currentTime + 0.08; tempoScale = 1;
    timer = setInterval(schedule, 25);
    schedule();
  }
  function schedule() {
    if (!cur) return;
    const sd = 60 / (cur.bpm * tempoScale) / 4;
    while (nextT < ctx.currentTime + 0.14) {
      const evs = cur.events[step];
      if (evs) for (const e of evs) e(nextT, sd);
      nextT += sd; step++;
      if (step >= cur.length) {
        if (cur.loop) step = 0; else { const n = curName; clearInterval(timer); timer = null; cur = null; curName = n + ':done'; return; }
      }
    }
  }
  function stopMusic() {
    if (timer) clearInterval(timer);
    timer = null; cur = null; curName = null;
    if (ctx) { // quick fade so held notes don't hang
      const g = musicBus.gain; const now = ctx.currentTime;
      g.cancelScheduledValues(now); g.setValueAtTime(g.value, now); g.linearRampToValueAtTime(0, now + 0.08);
      g.linearRampToValueAtTime(OP.settings.music * 0.55, now + 0.35);
    }
  }
  function setTempo(s) { tempoScale = s; }

  // ---------- sound effects ----------
  const SFX = {
    cursor() { tone({ f: 880, dur: 0.03, type: 'square', g: 0.08, r: 0.04, filter: 3000 }); },
    confirm() { tone({ f: 660, dur: 0.05, type: 'square', g: 0.1, r: 0.05 }); tone({ t: ctx.currentTime + 0.06, f: 990, dur: 0.08, type: 'square', g: 0.1, r: 0.1, rev: 0.3 }); },
    back() { tone({ f: 440, slide: 220, dur: 0.1, type: 'square', g: 0.08, r: 0.05, filter: 2000 }); },
    whiff() { noise({ dur: 0.08, g: 0.16, f: 900, fEnd: 2400, ft: 'bandpass', q: 1.5, r: 0.06 }); },
    whiffH() { noise({ dur: 0.14, g: 0.22, f: 500, fEnd: 1600, ft: 'bandpass', q: 1.2, r: 0.08 }); },
    hitL() {
      noise({ dur: 0.03, g: 0.5, f: 3000, fEnd: 800, r: 0.05 });
      tone({ f: 190, slide: 70, dur: 0.06, type: 'sine', g: 0.6, r: 0.06 });
    },
    hitM() {
      noise({ dur: 0.05, g: 0.6, f: 2500, fEnd: 500, r: 0.08 });
      tone({ f: 160, slide: 50, dur: 0.1, type: 'sine', g: 0.8, r: 0.08 });
      tone({ f: 90, dur: 0.05, type: 'square', g: 0.12, r: 0.05, filter: 600 });
    },
    hitH() {
      noise({ dur: 0.08, g: 0.8, f: 3500, fEnd: 300, r: 0.15, rev: 0.3 });
      tone({ f: 140, slide: 38, dur: 0.18, type: 'sine', g: 1, r: 0.12 });
      tone({ f: 70, dur: 0.12, type: 'sawtooth', g: 0.2, r: 0.1, filter: 400, dist: true });
    },
    hitSlash() { // sword connect: shing + meat
      noise({ dur: 0.05, g: 0.5, f: 5000, ft: 'highpass', r: 0.12 });
      for (const f of [2500, 3710, 5200]) tone({ f, dur: 0.01, type: 'sine', g: 0.08, r: 0.35, rev: 0.4 });
      tone({ f: 170, slide: 60, dur: 0.08, type: 'sine', g: 0.6, r: 0.06 });
    },
    slash() { noise({ dur: 0.07, g: 0.3, f: 2000, fEnd: 9000, ft: 'bandpass', q: 2, r: 0.05 }); for (const f of [3200, 4700]) tone({ f, dur: 0.01, type: 'sine', g: 0.05, r: 0.2 }); },
    clang() { for (const f of [1800, 2700, 4100, 5600]) tone({ f, dur: 0.01, type: 'triangle', g: 0.12, r: 0.45, rev: 0.4 }); noise({ dur: 0.03, g: 0.3, f: 6000, ft: 'highpass', r: 0.05 }); },
    block() { tone({ f: 420, slide: 300, dur: 0.04, type: 'square', g: 0.14, r: 0.05, filter: 2500 }); noise({ dur: 0.04, g: 0.35, f: 1500, ft: 'bandpass', q: 2, r: 0.05 }); },
    jump() { noise({ dur: 0.05, g: 0.1, f: 600, fEnd: 1500, r: 0.04 }); },
    land() { tone({ f: 110, slide: 50, dur: 0.05, type: 'sine', g: 0.35, r: 0.05 }); noise({ dur: 0.04, g: 0.12, f: 500, r: 0.05 }); },
    dash() { noise({ dur: 0.12, g: 0.18, f: 700, fEnd: 2500, ft: 'bandpass', q: 1, r: 0.08 }); },
    stretch() { // gomu gomu "boyoing" going out
      tone({ f: 180, slide: 620, slideT: 0.18, dur: 0.18, type: 'sine', g: 0.4, r: 0.06, vib: 60, vibRate: 22 });
      tone({ f: 90, slide: 310, slideT: 0.18, dur: 0.18, type: 'triangle', g: 0.2, r: 0.05 });
    },
    snap() { tone({ f: 700, slide: 160, dur: 0.09, type: 'sine', g: 0.35, r: 0.05, vib: 40, vibRate: 30 }); },
    bounce() { tone({ f: 120, slide: 420, dur: 0.12, type: 'sine', g: 0.45, r: 0.1, vib: 50, vibRate: 18 }); },
    fire() {
      noise({ dur: 0.35, g: 0.45, f: 700, fEnd: 2500, r: 0.25, rev: 0.2 });
      for (let i = 0; i < 6; i++) noise({ t: ctx.currentTime + Math.random() * 0.35, dur: 0.01, g: 0.25, f: 4000, ft: 'highpass', r: 0.02 });
    },
    thunder() {
      noise({ dur: 0.05, g: 0.9, f: 7000, ft: 'highpass', r: 0.05 });
      noise({ t: ctx.currentTime + 0.03, dur: 0.6, g: 0.9, f: 180, fEnd: 60, r: 1.1, rev: 0.6 });
      tone({ f: 60, slide: 30, dur: 0.5, type: 'sawtooth', g: 0.25, r: 0.6, filter: 200, dist: true });
    },
    wind() { noise({ dur: 0.7, g: 0.3, f: 400, fEnd: 1400, ft: 'bandpass', q: 3, r: 0.4, rev: 0.3 }); },
    charge() { tone({ f: 200, slide: 1400, slideT: 0.45, dur: 0.45, type: 'sawtooth', g: 0.12, r: 0.1, filter: 3000 }); noise({ dur: 0.45, g: 0.15, f: 800, fEnd: 6000, ft: 'bandpass', q: 3, r: 0.1 }); },
    flash() { // super flash sting
      tone({ f: 1200, slide: 2400, dur: 0.08, type: 'square', g: 0.12, r: 0.3, rev: 0.5 });
      noise({ dur: 0.25, g: 0.35, f: 1500, fEnd: 9000, ft: 'bandpass', q: 1, r: 0.3, rev: 0.4 });
      tone({ f: 80, slide: 40, dur: 0.3, type: 'sine', g: 0.8, r: 0.3 });
    },
    special() { tone({ f: 520, slide: 1560, dur: 0.12, type: 'triangle', g: 0.18, r: 0.15, rev: 0.4 }); noise({ dur: 0.12, g: 0.18, f: 3000, ft: 'highpass', r: 0.1 }); },
    sheathe() { // the famous "chin" of a blade going home
      tone({ f: 3100, dur: 0.01, type: 'triangle', g: 0.2, r: 0.8, rev: 0.7 }); tone({ f: 4650, dur: 0.01, type: 'sine', g: 0.1, r: 0.6, rev: 0.6 });
    },
    tag() { tone({ f: 500, slide: 1400, dur: 0.12, type: 'triangle', g: 0.18, r: 0.08 }); tone({ t: ctx.currentTime + 0.1, f: 900, slide: 1800, dur: 0.1, type: 'triangle', g: 0.14, r: 0.1 }); },
    ko() {
      tone({ f: 100, slide: 28, dur: 0.9, type: 'sine', g: 1, r: 0.8 });
      noise({ dur: 0.4, g: 0.8, f: 2500, fEnd: 100, r: 1.4, rev: 0.8 });
      for (const f of [1300, 1950]) tone({ f, dur: 0.02, type: 'triangle', g: 0.1, r: 1.5, rev: 0.8 });
    },
    don() { // manga "DON!" impact sting
      tone({ f: 65, slide: 40, dur: 0.35, type: 'sine', g: 1, r: 0.5, rev: 0.4 });
      noise({ dur: 0.06, g: 0.5, f: 1200, r: 0.3, rev: 0.4 });
      tone({ f: 130, dur: 0.12, type: 'sawtooth', g: 0.2, r: 0.3, filter: 500, dist: true });
    },
    vs() { SFX.don(); tone({ f: 220, slide: 880, dur: 0.3, type: 'sawtooth', g: 0.1, r: 0.2, filter: 2500 }); },
    heart() { tone({ f: 1320, dur: 0.05, type: 'sine', g: 0.12, r: 0.1 }); tone({ t: ctx.currentTime + 0.08, f: 1760, dur: 0.08, type: 'sine', g: 0.12, r: 0.2 }); },
    counter() { tone({ f: 1500, dur: 0.03, type: 'square', g: 0.12, r: 0.1 }); tone({ t: ctx.currentTime + 0.05, f: 2000, dur: 0.05, type: 'square', g: 0.12, r: 0.15 }); },
    splash() { noise({ dur: 0.4, g: 0.35, f: 1200, fEnd: 300, r: 0.6, rev: 0.3 }); },
  };

  function sfx(name) {
    if (!ctx || OP.settings.sfx <= 0) return;
    const fn = SFX[name]; if (fn) try { fn(); } catch (e) { /* audio is best-effort */ }
  }

  // ---------- spoken callouts ----------
  let voices = [];
  function loadVoices() { try { voices = speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang)); } catch (e) { voices = []; } }
  if ('speechSynthesis' in window) { loadVoices(); speechSynthesis.onvoiceschanged = loadVoices; }
  function say(text, o = {}) {
    if (!OP.settings.voice || !('speechSynthesis' in window) || !text) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.pitch = o.pitch ?? 1; u.rate = o.rate ?? 1.1; u.volume = Math.min(1, (o.vol ?? 1) * OP.settings.sfx + 0.1);
      if (voices.length) u.voice = voices[o.voiceIdx % voices.length || 0] || voices[0];
      speechSynthesis.speak(u);
    } catch (e) { /* ignore */ }
  }

  OP.Audio = { init, playMusic, stopMusic, setTempo, sfx, say, applyVolumes, get ready() { return !!ctx; } };
})(window.OP);
