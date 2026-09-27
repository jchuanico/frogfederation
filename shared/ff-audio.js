/* Frog Federation — shared Web Audio engine (music + sound effects, no audio files).
 *
 *   const audio = FF.Audio.create({
 *     songs: { battle: { bpm, loop, tracks: [...] } },     // song format documented below
 *     sfx:   { boom(a) { a.noise({...}); a.tone({...}); } },  // `a` = the synth API
 *     instruments: { myLead(a, t, f, dur, vol) {...} },    // optional, merged over the defaults
 *     volumes: () => ({ music: 0.8, sfx: 1 }),             // read whenever volumes are applied
 *   });
 *   audio.init();              // call from a user gesture (browsers keep audio locked until then)
 *   audio.playMusic('battle'); audio.sfx('boom'); const h = audio.loop('whistle'); h.set({f: 900}); h.stop();
 *
 * Why it's built this way (lessons from One Piece Frog Style):
 *  - Songs are pre-rendered once into AudioBuffers with an OfflineAudioContext and looped by the
 *    audio thread. Scheduling notes from a JS timer stutters as soon as the main thread is busy
 *    drawing, and creates hundreds of nodes per second. Until a render finishes the song plays live.
 *  - Every node disconnects itself when it ends, so long sessions don't pile up garbage.
 *  - `stats.created` counts nodes made on the live context (not offline renders) so a browser test
 *    can assert playback stays cheap.
 *
 * Song format — tokens are NOTE:sixteenths, "-" is a rest; chords are SYMBOL:sixteenths:
 *   { inst: 'brass', seq: 'D5:4 F5:4 A5:8 -:4' }
 *   { inst: 'strings', chords: 'Dm:16 Bb:16', arp: 'x.x.x.x.x.x.x.x.', oct: 3 }   // arpeggiated
 *   { inst: 'pad', chords: 'Dm:16 Bb:16', oct: 4 }                                 // held chords
 *   { inst: 'bass', chords: 'Dm:16 Bb:16', bassPat: 'x..x..x.x..x..x.' }            // 'o' = octave up
 *   { drums: { k: ['x...x...'], s: [...], h: [...], c: [...], taiko: [...], tom: [...] } }  // one string per bar, cycling
 *   optional per track: vol, and on the song: bpm, loop, swing (0..0.5),
 *   live: [track indices] — the lighter arrangement played while the full song is still being
 *   pre-rendered (e.g. melody + bass + drums), so the first seconds never hammer the main thread.
 */
(function (root) {
  'use strict';

  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  function noteToMidi(s) {
    const m = /^([A-G])([#b]?)(-?\d)$/.exec(s);
    if (!m) throw new Error('bad note ' + s);
    return 12 * (+m[3] + 1) + NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  }
  const CHORD_Q = { '': [0, 4, 7], m: [0, 3, 7], '7': [0, 4, 7, 10], m7: [0, 3, 7, 10], maj7: [0, 4, 7, 11], '5': [0, 7], sus4: [0, 5, 7], sus2: [0, 2, 7], dim: [0, 3, 6], add9: [0, 4, 7, 14] };
  function parseChord(sym) {
    const m = /^([A-G][#b]?)(maj7|m7|m|7|5|sus4|sus2|dim|add9)?$/.exec(sym);
    if (!m) throw new Error('bad chord ' + sym);
    const r = noteToMidi(m[1] + '0') - 12;
    return { root: ((r % 12) + 12) % 12, iv: CHORD_Q[m[2] || ''] };
  }

  /* ---------------- default instruments (a = synth API, t = time, f = Hz, d = seconds) ------- */
  const INSTRUMENTS = {
    brass(a, t, f, d, v) { // heroic horn section: two detuned saws through an opening filter
      for (const dt of [-6, 6]) a.tone({ t, f, dur: d, type: 'sawtooth', g: 0.06 * v, a: 0.05, r: 0.18, detune: dt, filter: 700, filterEnd: 2400, q: 1.5, vib: 12, dest: 'music', rev: 0.45 });
      a.tone({ t, f: f / 2, dur: d, type: 'sawtooth', g: 0.03 * v, a: 0.06, r: 0.18, filter: 900, dest: 'music', rev: 0.3 });
    },
    horn(a, t, f, d, v) { // softer french horn for counter-melodies
      a.tone({ t, f, dur: d, type: 'triangle', g: 0.12 * v, a: 0.08, r: 0.25, vib: 8, dest: 'music', rev: 0.5 });
      a.tone({ t, f, dur: d, type: 'sawtooth', g: 0.025 * v, a: 0.1, r: 0.2, filter: 1200, dest: 'music', rev: 0.4 });
    },
    lead(a, t, f, d, v) {
      a.tone({ t, f, dur: d, type: 'sawtooth', g: 0.08 * v, a: 0.01, r: 0.1, filter: 2600, q: 3, vib: 16, vibRate: 6, dest: 'music', rev: 0.35, dist: true });
      a.tone({ t, f, dur: d, type: 'square', g: 0.035 * v, a: 0.01, r: 0.08, detune: 7, filter: 3200, dest: 'music' });
    },
    strings(a, t, f, d, v) { // staccato string ostinato
      for (const dt of [-8, 8]) a.tone({ t, f, dur: Math.max(0.04, d * 0.6), type: 'sawtooth', g: 0.036 * v, a: 0.012, r: 0.09, detune: dt, filter: 2200, q: 0.8, dest: 'music', rev: 0.3 });
    },
    violins(a, t, f, d, v) { // long bowed notes
      for (const dt of [-10, 0, 10]) a.tone({ t, f, dur: d, type: 'sawtooth', g: 0.026 * v, a: 0.15, r: 0.3, detune: dt, filter: 2600, vib: 14, vibRate: 5.2, dest: 'music', rev: 0.55 });
    },
    choir(a, t, f, d, v) { // "aah" pad: formant-ish bandpassed saws
      a.tone({ t, f, dur: d, type: 'sawtooth', g: 0.07 * v, a: 0.3, r: 0.5, detune: -7, filter: 800, filterType: 'bandpass', q: 3, dest: 'music', rev: 0.7 });
      a.tone({ t, f, dur: d, type: 'sawtooth', g: 0.03 * v, a: 0.3, r: 0.5, detune: 7, filter: 1150, filterType: 'bandpass', q: 5, dest: 'music', rev: 0.7 });
    },
    pad(a, t, f, d, v) {
      for (const dt of [-8, 8]) a.tone({ t, f, dur: d, type: 'sawtooth', g: 0.026 * v, a: 0.2, r: 0.4, detune: dt, filter: 1100, dest: 'music', rev: 0.5 });
    },
    pluck(a, t, f, d, v) {
      a.tone({ t, f, dur: 0.02, type: 'triangle', g: 0.18 * v, a: 0.002, r: Math.min(0.5, d + 0.2), dest: 'music', rev: 0.3 });
      a.tone({ t, f: f * 2, dur: 0.01, type: 'sine', g: 0.05 * v, a: 0.002, r: 0.2, dest: 'music' });
    },
    bell(a, t, f, d, v) {
      a.tone({ t, f, dur: 0.01, type: 'sine', g: 0.14 * v, a: 0.002, r: 1.2, dest: 'music', rev: 0.5 });
      a.tone({ t, f: f * 2.76, dur: 0.01, type: 'sine', g: 0.04 * v, a: 0.002, r: 0.6, dest: 'music', rev: 0.5 });
    },
    bass(a, t, f, d, v) {
      a.tone({ t, f, dur: d * 0.9, type: 'triangle', g: 0.3 * v, a: 0.005, r: 0.05, dest: 'music' });
      a.tone({ t, f, dur: d * 0.8, type: 'sawtooth', g: 0.08 * v, a: 0.005, r: 0.05, filter: 500, filterEnd: 200, dest: 'music' });
    },
    guitar(a, t, f, d, v) {
      for (const m of [1, 1.5, 2]) a.tone({ t, f: f * m, dur: d * 0.7, type: 'sawtooth', g: 0.03 * v, a: 0.003, r: 0.06, filter: 1900, filterEnd: 700, dist: true, dest: 'music' });
    },
  };

  const DRUMS = {
    k(a, t, v) { a.tone({ t, f: 150, slide: 42, slideT: 0.12, dur: 0.12, type: 'sine', g: 0.75 * v, r: 0.12, dest: 'music' }); },
    s(a, t, v) {
      a.noise({ t, dur: 0.07, g: 0.3 * v, f: 1800, ft: 'bandpass', q: 0.6, r: 0.12, dest: 'music', rev: 0.3 });
      a.tone({ t, f: 210, slide: 150, dur: 0.05, type: 'triangle', g: 0.22 * v, r: 0.06, dest: 'music' });
    },
    h(a, t, v) { a.noise({ t, dur: 0.015, g: 0.09 * v, f: 8000, ft: 'highpass', r: 0.03, dest: 'music' }); },
    c(a, t, v) { a.noise({ t, dur: 0.2, g: 0.18 * v, f: 5000, ft: 'highpass', r: 1.3, dest: 'music', rev: 0.45 }); },
    tom(a, t, v) { a.tone({ t, f: 180, slide: 90, dur: 0.15, type: 'sine', g: 0.4 * v, r: 0.12, dest: 'music', rev: 0.2 }); },
    taiko(a, t, v) { // big war drum: low boom + skin slap + room
      a.tone({ t, f: 95, slide: 48, slideT: 0.25, dur: 0.22, type: 'sine', g: 0.95 * v, r: 0.35, dest: 'music', rev: 0.45 });
      a.noise({ t, dur: 0.03, g: 0.35 * v, f: 700, fEnd: 200, r: 0.18, dest: 'music', rev: 0.4 });
    },
    timp(a, t, v) { // timpani roll hit
      a.tone({ t, f: 73, dur: 0.05, type: 'sine', g: 0.6 * v, r: 0.9, dest: 'music', rev: 0.5 });
      a.tone({ t, f: 110, dur: 0.03, type: 'triangle', g: 0.15 * v, r: 0.5, dest: 'music', rev: 0.4 });
    },
    anvil(a, t, v) { for (const f of [1900, 2830, 4150]) a.tone({ t, f, dur: 0.005, type: 'triangle', g: 0.06 * v, r: 0.35, dest: 'music', rev: 0.4 }); },
  };

  function compile(song, INST) {
    const events = []; let length = 0;
    const add = (step, fn) => { (events[step] = events[step] || []).push(fn); };
    for (const tr of song.tracks) {
      const vol = tr.vol ?? 1;
      if (tr.seq) {
        let pos = 0;
        const inst = INST[tr.inst];
        if (!inst) throw new Error('unknown instrument ' + tr.inst);
        for (const tok of tr.seq.trim().split(/\s+/)) {
          const [n, d] = tok.split(':'); const dur = +d;
          if (n !== '-') { const f = mtof(noteToMidi(n)); add(pos, (a, t, sd) => inst(a, t, f, dur * sd * 0.95, vol)); }
          pos += dur;
        }
        length = Math.max(length, pos);
      }
      if (tr.chords) {
        let pos = 0;
        const inst = INST[tr.inst];
        if (!inst && !tr.bassPat) throw new Error('unknown instrument ' + tr.inst);
        for (const tok of tr.chords.trim().split(/\s+/)) {
          const [sym, d] = tok.split(':'); const dur = +d; const ch = parseChord(sym);
          const base = 12 * ((tr.oct ?? 4) + 1);
          for (let s = 0; s < dur; s++) {
            const st = pos + s;
            if (tr.bassPat) {
              const c = tr.bassPat[st % tr.bassPat.length];
              if (c === 'x' || c === 'o') {
                const f = mtof(36 + ch.root + (c === 'o' ? 12 : 0));
                const b = INST[tr.inst] || INST.bass;
                add(st, (a, t, sd) => b(a, t, f, sd * 2, vol));
              }
            } else if (tr.arp) {
              const c = tr.arp[st % tr.arp.length];
              if (c === 'x' || c === 'o') {
                const notes = tr.root ? [ch.root] : ch.iv.map((i) => ch.root + i);
                const acc = c === 'x' ? 1 : 0.6;
                add(st, (a, t, sd) => { for (const n of notes) inst(a, t, mtof(base + n), sd * 1.6, vol * acc); });
              }
            } else if (s === 0) {
              add(st, (a, t, sd) => { for (const i of ch.iv) inst(a, t, mtof(base + ch.root + i), dur * sd, vol); });
            }
          }
          pos += dur;
        }
        length = Math.max(length, pos);
      }
    }
    for (const tr of song.tracks) {
      if (!tr.drums) continue;
      const vol = tr.vol ?? 1;
      for (let st = 0; st < length; st++) {
        const bar = (st / 16) | 0;
        for (const k in tr.drums) {
          const fn = DRUMS[k];
          if (!fn) throw new Error('unknown drum ' + k);
          const pats = tr.drums[k]; const pat = pats[bar % pats.length]; const c = pat[st % 16];
          if (c === 'x' || c === 'o') { const v = (c === 'x' ? 1 : 0.55) * vol; add(st, (a, t) => fn(a, t, v)); }
        }
      }
    }
    return { events, length, bpm: song.bpm, loop: song.loop !== false, swing: song.swing || 0 };
  }

  function create(opts) {
    const SONGS = opts.songs || {};
    const SFX = opts.sfx || {};
    const LOOPS = opts.loops || {};
    const INST = Object.assign({}, INSTRUMENTS, opts.instruments || {});
    const volumes = opts.volumes || (() => ({ music: 0.8, sfx: 1 }));
    const MUSIC_GAIN = opts.musicGain ?? 0.55;
    const stats = { created: 0 };

    let ctx = null, master, comp, musicBus, sfxBus, revSend, noiseBuf, distCurve;
    // `g` is the graph instruments currently write into (the live context or an offline render).
    const g = { ctx: null, music: null, sfx: null, rev: null };

    function makeIR(c) {
      const n = Math.floor(c.sampleRate * 2.4), ir = c.createBuffer(2, n, c.sampleRate);
      for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3); }
      return ir;
    }

    function init() {
      if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return;
      try { ctx = new AC(); } catch (e) { ctx = null; return; }
      master = ctx.createGain();
      comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
      master.connect(comp); comp.connect(ctx.destination);
      musicBus = ctx.createGain(); musicBus.connect(master);
      sfxBus = ctx.createGain(); sfxBus.connect(master);
      const rev = ctx.createConvolver(); rev.buffer = makeIR(ctx);
      revSend = ctx.createGain(); revSend.gain.value = 0.22; revSend.connect(rev); rev.connect(master);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const nd = noiseBuf.getChannelData(0);
      for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
      distCurve = new Float32Array(1024);
      for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; distCurve[i] = Math.tanh(x * 6) * 0.8; }
      live();
      applyVolumes();
      setTimeout(prerenderAll, 300);
    }
    function live() { g.ctx = ctx; g.music = musicBus; g.sfx = sfxBus; g.rev = revSend; }

    function applyVolumes() {
      if (!ctx) return;
      const v = volumes();
      musicBus.gain.value = (v.music ?? 0.8) * MUSIC_GAIN;
      sfxBus.gain.value = v.sfx ?? 1;
    }

    function env(gn, t, a, peak, dur, r) {
      gn.gain.setValueAtTime(0.0001, t);
      gn.gain.linearRampToValueAtTime(peak, t + a);
      gn.gain.setValueAtTime(peak, t + Math.max(a, dur));
      gn.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(a, dur) + r);
    }
    const destOf = (d) => (d === 'music' ? g.music : d && d.connect ? d : g.sfx);
    const cleanup = (nodes) => () => { for (const n of nodes) if (n) try { n.disconnect(); } catch (e) { /* gone */ } };

    /** One enveloped oscillator voice. Options: f, t, dur, r, a, g, type, slide, slideT, detune,
     *  vib, vibRate, filter, filterEnd, filterType, q, dist, rev, dest('music'|'sfx'). */
    function tone(o) {
      const c = g.ctx, t = o.t ?? c.currentTime, dur = o.dur ?? 0.1, r = o.r ?? 0.08;
      const osc = c.createOscillator(), gn = c.createGain();
      if (c === ctx) stats.created += 2;
      osc.type = o.type || 'sine';
      osc.frequency.setValueAtTime(o.f, t);
      if (o.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.slide), t + (o.slideT ?? dur));
      if (o.detune) osc.detune.value = o.detune;
      let node = osc, lfo = null, lg = null, f = null, ws = null, send = null;
      if (o.vib) {
        lfo = c.createOscillator(); lg = c.createGain(); if (c === ctx) stats.created += 2;
        lfo.frequency.value = o.vibRate || 5.5; lg.gain.setValueAtTime(0, t);
        lg.gain.linearRampToValueAtTime(o.vib, t + Math.min(0.25, dur));
        lfo.connect(lg); lg.connect(osc.detune); lfo.start(t); lfo.stop(t + dur + r + 0.05);
      }
      if (o.filter) {
        f = c.createBiquadFilter(); if (c === ctx) stats.created++;
        f.type = o.filterType || 'lowpass'; f.Q.value = o.q ?? 1;
        f.frequency.setValueAtTime(o.filter, t);
        if (o.filterEnd) f.frequency.exponentialRampToValueAtTime(o.filterEnd, t + dur + r);
        node.connect(f); node = f;
      }
      if (o.dist) { ws = c.createWaveShaper(); ws.curve = distCurve; if (c === ctx) stats.created++; node.connect(ws); node = ws; }
      node.connect(gn);
      env(gn, t, o.a ?? 0.004, o.g ?? 0.3, dur, r);
      gn.connect(destOf(o.dest));
      if (o.rev) { send = c.createGain(); if (c === ctx) stats.created++; send.gain.value = o.rev; gn.connect(send); send.connect(g.rev); }
      osc.onended = cleanup([osc, gn, f, ws, send, lfo, lg]);
      osc.start(t); osc.stop(t + dur + r + 0.05);
    }

    /** Filtered noise burst. Options: t, dur, r, a, g, f, fEnd, ft (filter type), q, rate, rev, dest. */
    function noise(o) {
      const c = g.ctx, t = o.t ?? c.currentTime, dur = o.dur ?? 0.1, r = o.r ?? 0.05;
      const src = c.createBufferSource(), gn = c.createGain(), f = c.createBiquadFilter();
      if (c === ctx) stats.created += 3;
      src.buffer = g.noise || noiseBuf; src.playbackRate.value = o.rate || 1;
      f.type = o.ft || 'lowpass'; f.Q.value = o.q ?? 0.8;
      f.frequency.setValueAtTime(o.f ?? 2000, t);
      if (o.fEnd) f.frequency.exponentialRampToValueAtTime(o.fEnd, t + dur + r);
      src.connect(f); f.connect(gn);
      env(gn, t, o.a ?? 0.002, o.g ?? 0.3, dur, r);
      gn.connect(destOf(o.dest));
      let send = null;
      if (o.rev) { send = c.createGain(); if (c === ctx) stats.created++; send.gain.value = o.rev; gn.connect(send); send.connect(g.rev); }
      src.onended = cleanup([src, f, gn, send]);
      src.start(t, Math.random() * 1.5); src.stop(t + dur + r + 0.05);
    }

    const api = { tone, noise, get now() { return g.ctx.currentTime; }, get ctx() { return g.ctx; }, mtof, noteToMidi };

    /* ---------------- music ---------------- */
    const compiled = {}, compiledLive = {};
    const getSong = (name) => (compiled[name] = compiled[name] || compile(SONGS[name], INST));
    const getLive = (name) => {
      const s = SONGS[name];
      if (!s.live) return getSong(name);
      return (compiledLive[name] = compiledLive[name] || compile(Object.assign({}, s, { tracks: s.tracks.filter((t, i) => s.live.includes(i)) }), INST));
    };
    const stepTime = (song, st, sd) => st * sd + (st % 2 ? song.swing * sd : 0);

    const rendered = {}, rendering = {};
    const RATE = opts.renderRate || 24000;
    function renderSong(name) {
      if (rendered[name] || rendering[name]) return rendering[name];
      const OAC = root.OfflineAudioContext || root.webkitOfflineAudioContext;
      if (!OAC || !ctx || !SONGS[name]) return null;
      const song = getSong(name), sd = 60 / song.bpm / 4, len = song.length * sd, tail = 2.5;
      const loopN = Math.round(len * RATE), totalN = Math.ceil((len + tail) * RATE);
      let off;
      try { off = new OAC(2, totalN, RATE); } catch (e) { return null; }
      const bus = off.createGain(); bus.connect(off.destination);
      const rev = off.createConvolver(); rev.buffer = makeIR(off);
      const rs = off.createGain(); rs.gain.value = 0.22; rs.connect(rev); rev.connect(off.destination);
      const nb = off.createBuffer(1, off.sampleRate * 2, off.sampleRate); nb.getChannelData(0).set(noiseBuf.getChannelData(0).subarray(0, nb.length));
      g.ctx = off; g.music = bus; g.sfx = bus; g.rev = rs; g.noise = nb;
      try { for (let st = 0; st < song.length; st++) { const evs = song.events[st]; if (evs) for (const e of evs) e(api, 0.01 + stepTime(song, st, sd), sd); } }
      finally { live(); g.noise = null; }
      const done = (buf) => {
        let out = buf;
        if (song.loop) { // fold the reverb tail back onto the start so the loop is seamless
          out = ctx.createBuffer(buf.numberOfChannels, loopN, RATE);
          for (let c = 0; c < buf.numberOfChannels; c++) {
            const src = buf.getChannelData(c), dst = out.getChannelData(c);
            dst.set(src.subarray(0, loopN));
            for (let i = 0; i < totalN - loopN && i < loopN; i++) dst[i] += src[loopN + i];
          }
        }
        rendered[name] = out; delete rendering[name];
        if (curName === name && !bufSrc) switchToBuffer(name);
        return out;
      };
      const p = new Promise((res) => { off.oncomplete = (e) => res(e.renderedBuffer); const r = off.startRendering(); if (r && r.then) r.then(res, () => res(null)); });
      rendering[name] = p.then((b) => (b ? done(b) : null));
      return rendering[name];
    }
    function prerenderAll() {
      const order = [curName].concat(opts.prerender || Object.keys(SONGS)).filter((n, i, a) => n && SONGS[n] && a.indexOf(n) === i);
      order.reduce((chain, n) => chain.then(() => renderSong(n)), Promise.resolve());
    }

    let cur = null, curName = null, step = 0, nextT = 0, timer = null, tempo = 1, bufSrc = null, songStart = 0;
    function playMusic(name) {
      init(); if (!ctx || !SONGS[name]) return;
      if (curName === name) return;
      stopMusic();
      curName = name; tempo = 1;
      if (rendered[name]) { startBuffer(name, 0); return; }
      cur = getLive(name); step = 0; nextT = ctx.currentTime + 0.08; songStart = nextT;
      timer = setInterval(schedule, 25);
      schedule();
      renderSong(name);
    }
    function startBuffer(name, offset) {
      const buf = rendered[name];
      const src = ctx.createBufferSource(); stats.created++;
      src.buffer = buf; src.loop = getSong(name).loop; src.playbackRate.value = tempo;
      src.connect(musicBus);
      src.onended = () => { try { src.disconnect(); } catch (e) { /* gone */ } if (bufSrc === src) { bufSrc = null; if (!src.loop && curName === name) curName = name + ':done'; } };
      src.start(ctx.currentTime + 0.02, offset % buf.duration);
      bufSrc = src;
    }
    function switchToBuffer(name) {
      const song = getSong(name), len = song.length * 60 / song.bpm / 4;
      const pos = ctx.currentTime - songStart;
      if (!song.loop && pos >= len) return;
      if (timer) clearInterval(timer);
      timer = null; cur = null;
      startBuffer(name, song.loop ? ((pos % len) + len) % len : pos);
    }
    function schedule() {
      if (!cur) return;
      const sd = 60 / (cur.bpm * tempo) / 4;
      while (nextT < ctx.currentTime + 0.14) {
        const evs = cur.events[step];
        if (evs) for (const e of evs) e(api, nextT + (step % 2 ? cur.swing * sd : 0), sd);
        nextT += sd; step++;
        if (step >= cur.length) {
          if (cur.loop) { step = 0; songStart = nextT; } else { const n = curName; clearInterval(timer); timer = null; cur = null; curName = n + ':done'; return; }
        }
      }
    }
    function stopMusic() {
      if (timer) clearInterval(timer);
      timer = null; cur = null; curName = null;
      if (bufSrc) { const s0 = bufSrc; bufSrc = null; try { s0.stop(ctx.currentTime + 0.08); } catch (e) { /* ended */ } }
      if (ctx) {
        const gg = musicBus.gain, now = ctx.currentTime, v = (volumes().music ?? 0.8) * MUSIC_GAIN;
        gg.cancelScheduledValues(now); gg.setValueAtTime(gg.value, now); gg.linearRampToValueAtTime(0, now + 0.08);
        gg.linearRampToValueAtTime(v, now + 0.35);
      }
    }
    function setTempo(s) { tempo = s; if (bufSrc) bufSrc.playbackRate.setTargetAtTime(s, ctx.currentTime, 0.3); }
    const musicMode = () => (bufSrc ? 'buffer' : timer ? 'live' : 'none');

    /* ---------------- sound effects ---------------- */
    function sfx(name, arg) {
      if (!ctx || (volumes().sfx ?? 1) <= 0) return;
      const fn = SFX[name]; if (fn) try { fn(api, arg); } catch (e) { /* audio is best-effort */ }
    }

    /** Continuous sound whose pitch/volume the game steers (projectile whistle, treads...).
     *  loops[name] = { type, f, g, filter, q, noise:true|false }. Returns { set({f,g,filter}), stop() }. */
    function loop(name, over) {
      const spec = Object.assign({}, LOOPS[name] || {}, over || {});
      const dead = { set() {}, stop() {} };
      if (!ctx || (volumes().sfx ?? 1) <= 0) return dead;
      try {
        const gn = ctx.createGain(), f = ctx.createBiquadFilter();
        let src;
        if (spec.noise) { src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true; }
        else { src = ctx.createOscillator(); src.type = spec.type || 'sine'; src.frequency.value = spec.f || 440; }
        stats.created += 3;
        f.type = spec.filterType || 'lowpass'; f.frequency.value = spec.filter || 4000; f.Q.value = spec.q ?? 1;
        src.connect(f); f.connect(gn); gn.connect(sfxBus);
        const now = ctx.currentTime;
        gn.gain.setValueAtTime(0.0001, now); gn.gain.linearRampToValueAtTime(spec.g ?? 0.1, now + 0.04);
        src.start();
        let stopped = false;
        src.onended = cleanup([src, f, gn]);
        return {
          set(p) {
            if (stopped) return;
            const t = ctx.currentTime;
            if (p.f != null && src.frequency) src.frequency.setTargetAtTime(p.f, t, 0.03);
            if (p.g != null) gn.gain.setTargetAtTime(p.g, t, 0.04);
            if (p.filter != null) f.frequency.setTargetAtTime(p.filter, t, 0.04);
          },
          stop(fade = 0.08) {
            if (stopped) return; stopped = true;
            const t = ctx.currentTime;
            gn.gain.cancelScheduledValues(t); gn.gain.setValueAtTime(gn.gain.value, t); gn.gain.linearRampToValueAtTime(0.0001, t + fade);
            try { src.stop(t + fade + 0.02); } catch (e) { /* already */ }
          },
        };
      } catch (e) { return dead; }
    }

    function suspend() { if (ctx && ctx.state === 'running') ctx.suspend(); }
    function resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); }

    return {
      init, playMusic, stopMusic, setTempo, musicMode, sfx, loop, applyVolumes, suspend, resume, renderSong, stats,
      get ready() { return !!ctx; }, get current() { return curName; }, get context() { return ctx; },
    };
  }

  root.FF = root.FF || {};
  root.FF.Audio = { create, compile, INSTRUMENTS, DRUMS, mtof, noteToMidi, parseChord };
})(typeof window !== 'undefined' ? window : globalThis);
