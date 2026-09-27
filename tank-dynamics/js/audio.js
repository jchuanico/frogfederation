/* Tank Dynamics — soundtrack and sound effects. Original compositions, synthesized with the shared
 * Frog Federation audio engine (shared/ff-audio.js): no audio files, nothing copyrighted.
 * Songs are pre-rendered in the background and looped by the audio thread, so battles never stutter. */
'use strict';
(function (TD) {
  const SONGS = {
    // "Roll Out!" — bright, heroic title theme
    menu: {
      bpm: 116, live: [0, 3, 5],
      tracks: [
        { inst: 'brass', seq: 'G4:4 C5:4 E5:6 D5:2 D5:4 B4:4 G4:8 A4:4 C5:4 E5:4 A5:4 G5:6 F5:2 C5:8 E5:4 G5:4 C6:6 B5:2 A5:4 G5:4 D5:8 F5:4 A5:4 C6:4 A5:4 G5:8 B5:4 D6:4' },
        { inst: 'strings', chords: 'C:16 G:16 Am:16 F:16 C:16 G:16 F:16 G:16', arp: 'x.x.x.x.x.x.x.x.', oct: 4, vol: 0.7 },
        { inst: 'choir', chords: 'C:16 G:16 Am:16 F:16 C:16 G:16 F:16 G:16', oct: 4, vol: 0.5 },
        { inst: 'bass', chords: 'C:16 G:16 Am:16 F:16 C:16 G:16 F:16 G:16', bassPat: 'x...x...x.x.x...' },
        { inst: 'bell', seq: '-:48 E6:4 G6:4 C7:8 -:48 C7:4 B6:4 G6:8' , vol: 0.5 },
        { drums: { k: ['x.......x.x.....'], s: ['....x.......x...'], h: ['..x...x...x...x.'], c: ['x...............', '................', '................', '................'], taiko: ['................', '................', '................', '........x.x.x.xx'] }, vol: 0.75 },
      ],
    },
    // "Heat of Battle" — taiko, driving strings, brass heroics, choir
    battle: {
      bpm: 150, live: [0, 5, 6],
      tracks: [
        { inst: 'brass', seq: 'D5:6 A4:2 D5:4 E5:4 F5:6 E5:2 D5:4 A4:4 Bb4:6 C5:2 D5:4 F5:4 E5:8 D5:4 C5:4 C5:6 D5:2 E5:4 G5:4 F5:6 E5:2 D5:4 C5:4 E5:8 C#5:4 A4:4 A4:12 -:4 ' +
          'D5:4 F5:4 A5:8 Bb5:6 A5:2 G5:4 F5:4 A5:6 G5:2 F5:4 C5:4 E5:8 G5:8 G5:6 F5:2 D5:4 Bb4:4 D5:6 F5:2 Bb5:8 A5:6 G5:2 E5:4 C#5:4 A5:4 E5:4 C#5:4 A4:4', vol: 0.95 },
        { inst: 'violins', seq: '-:128 D6:16 F6:16 F6:16 E6:16 D6:16 D6:16 C#6:32', vol: 0.8 },
        { inst: 'strings', chords: 'Dm:32 Bb:32 C:32 A:32 Dm:16 Bb:16 F:16 C:16 Gm:16 Bb:16 A:32', arp: 'x.xxx.xxx.xxx.x.', oct: 3, root: true, vol: 1.1 },
        { inst: 'strings', chords: 'Dm:32 Bb:32 C:32 A:32 Dm:16 Bb:16 F:16 C:16 Gm:16 Bb:16 A:32', arp: 'x.....x.....x...', oct: 4, vol: 0.55 },
        { inst: 'choir', chords: 'Dm:32 Bb:32 C:32 A:32 Dm:16 Bb:16 F:16 C:16 Gm:16 Bb:16 A:32', oct: 4, vol: 0.55 },
        { inst: 'bass', chords: 'Dm:32 Bb:32 C:32 A:32 Dm:16 Bb:16 F:16 C:16 Gm:16 Bb:16 A:32', bassPat: 'x..x..x.x..x..x.' },
        { drums: {
          taiko: ['x..x..x...x.x...', 'x..x..x...xxx.xx'], k: ['x.......x.......'], s: ['....x.......x...', '....x.......x.xx'],
          h: ['..x...x...x...x.'], anvil: ['....x.......x...', '................'], c: ['x...............', '................', '................', '................'],
          timp: ['................', '................', '................', '............xxxx'],
        } },
      ],
    },
    // "Thunder Treads" — rock-orchestra hybrid for the dusk and neon maps
    battle2: {
      bpm: 140, live: [0, 3, 4],
      tracks: [
        { inst: 'lead', seq: 'E5:4 G5:4 B5:6 A5:2 G5:4 F#5:4 E5:8 C5:4 E5:4 G5:6 F#5:2 E5:8 D5:4 C5:4 D5:4 F#5:4 A5:6 G5:2 F#5:4 E5:4 D5:8 D#5:6 F#5:2 B5:8 A5:4 F#5:4 D#5:8 ' +
          'B5:6 A5:2 G5:4 E5:4 D5:4 G5:4 B5:8 C6:6 B5:2 G5:4 E5:4 F#5:6 G5:2 A5:8 A5:6 G5:2 E5:4 C5:4 E5:4 G5:4 C6:8 B5:6 A5:2 F#5:4 D#5:4 B5:12 -:4', vol: 0.9 },
        { inst: 'guitar', chords: 'E5:32 C5:32 D5:32 B5:32 E5:16 G5:16 C5:16 D5:16 A5:16 C5:16 B5:32', arp: 'x.xxx.xxx.xxx.xx', oct: 2, root: true, vol: 0.9 },
        { inst: 'choir', chords: 'Em:32 C:32 D:32 B:32 Em:16 G:16 C:16 D:16 Am:16 C:16 B:32', oct: 4, vol: 0.5 },
        { inst: 'bass', chords: 'Em:32 C:32 D:32 B:32 Em:16 G:16 C:16 D:16 Am:16 C:16 B:32', bassPat: 'x.x.o.x.x.x.o.x.' },
        { drums: {
          k: ['x...x...x...x...', 'x.x...x.x.x...x.'], s: ['....x.......x...', '....x.......x.xx'], h: ['x.x.x.x.x.x.x.x.'],
          taiko: ['x.........x.....'], c: ['x...............', '................', '................', '................'],
        } },
      ],
    },
    // matchmaking: calm, curious pulse
    lobby: {
      bpm: 104,
      tracks: [
        { inst: 'pluck', chords: 'Am:16 F:16 C:16 G:16 Am:16 F:16 C:16 E:16', arp: 'x..x..x.x..x..x.', oct: 4, vol: 0.8 },
        { inst: 'pad', chords: 'Am:16 F:16 C:16 G:16 Am:16 F:16 C:16 E:16', oct: 3, vol: 0.8 },
        { inst: 'bell', seq: 'E6:8 -:8 C6:8 -:24 G5:8 -:8 B5:8 -:8 E6:8 -:8 A6:8 -:8 G#6:16', vol: 0.45 },
        { inst: 'bass', chords: 'Am:16 F:16 C:16 G:16 Am:16 F:16 C:16 E:16', bassPat: 'x.......x.......' },
        { drums: { k: ['x.......x.......'], h: ['..x...x...x...x.'] }, vol: 0.5 },
      ],
    },
    victory: {
      bpm: 132, loop: false,
      tracks: [
        { inst: 'brass', seq: 'C5:2 C5:2 C5:2 G5:6 E5:2 G5:2 C6:16 -:16' },
        { inst: 'choir', chords: 'C:16 G:4 C:12 C:16', oct: 4 },
        { inst: 'bell', seq: '-:16 C7:4 G6:4 E6:4 C6:20' , vol: 0.6 },
        { inst: 'bass', chords: 'C:16 G:4 C:12 C:16', bassPat: 'x...x...x...x...' },
        { drums: { taiko: ['x.x.x.x.xxxxxxxx', 'x...............', '................'], c: ['................', 'x...............', '................'] } },
      ],
    },
    defeat: {
      bpm: 96, loop: false,
      tracks: [
        { inst: 'horn', seq: 'E5:4 D5:4 C5:4 B4:4 A4:16 -:16' },
        { inst: 'pad', chords: 'Am:16 F:8 Am:8 Am:16', oct: 3 },
        { drums: { timp: ['x...............', 'x...............', '................'] } },
      ],
    },
  };

  // ---------- sound effects ----------
  const boom = (a, big) => {
    const t = a.now;
    a.tone({ t, f: big ? 110 : 150, slide: 30, slideT: big ? 0.6 : 0.35, dur: big ? 0.5 : 0.3, type: 'sine', g: 1, r: big ? 0.6 : 0.35 });
    a.noise({ t, dur: big ? 0.35 : 0.2, g: 0.9, f: 2600, fEnd: 120, r: big ? 1.2 : 0.7, rev: 0.4 });
    a.noise({ t: t + 0.02, dur: 0.05, g: 0.5, f: 6000, ft: 'highpass', r: 0.15 });
    a.tone({ t, f: 60, dur: 0.3, type: 'sawtooth', g: big ? 0.3 : 0.18, r: 0.4, filter: 300, dist: true });
    if (big) for (let i = 0; i < 6; i++) a.noise({ t: t + 0.15 + i * 0.07, dur: 0.02, g: 0.25, f: 1500, fEnd: 400, r: 0.12 }); // crackle
  };
  const cannon = (a) => {
    const t = a.now;
    a.tone({ t, f: 180, slide: 45, slideT: 0.18, dur: 0.16, type: 'sine', g: 0.9, r: 0.2 });
    a.noise({ t, dur: 0.08, g: 0.6, f: 3500, fEnd: 300, r: 0.25, rev: 0.25 });
  };
  const SFX = {
    click(a) { a.tone({ f: 900, dur: 0.02, type: 'triangle', g: 0.14, r: 0.05 }); a.tone({ t: a.now + 0.03, f: 1350, dur: 0.03, type: 'triangle', g: 0.1, r: 0.08 }); },
    hover(a) { a.tone({ f: 1500, dur: 0.01, type: 'sine', g: 0.05, r: 0.03 }); },
    back(a) { a.tone({ f: 700, slide: 350, dur: 0.1, type: 'triangle', g: 0.12, r: 0.06 }); },
    start(a) { const t = a.now; [523, 659, 784, 1047].forEach((f, i) => a.tone({ t: t + i * 0.07, f, dur: 0.08, type: 'square', g: 0.08, r: 0.2, filter: 3000, rev: 0.3 })); },
    // tank "voices" on the select screen
    voice_froggo(a) { const t = a.now; for (const k of [0, 0.13]) a.tone({ t: t + k, f: 260, slide: 150, dur: 0.08, type: 'square', g: 0.14, r: 0.05, filter: 1200, vib: 80, vibRate: 30 }); },
    voice_blaze(a) { a.noise({ dur: 0.45, g: 0.5, f: 500, fEnd: 1400, ft: 'bandpass', q: 2, r: 0.2, rev: 0.3 }); a.tone({ f: 110, slide: 80, dur: 0.45, type: 'sawtooth', g: 0.2, r: 0.2, filter: 800, dist: true }); },
    voice_frostbite(a) { const t = a.now; a.tone({ t, f: 1100, slide: 1600, dur: 0.06, type: 'square', g: 0.08, r: 0.04, filter: 2500 }); a.tone({ t: t + 0.09, f: 1300, slide: 900, dur: 0.1, type: 'square', g: 0.08, r: 0.05, filter: 2500 }); a.noise({ t: t + 0.05, dur: 0.3, g: 0.12, f: 6000, ft: 'highpass', r: 0.3, rev: 0.4 }); },
    voice_roborex(a) { const t = a.now; [880, 660, 990, 440].forEach((f, i) => a.tone({ t: t + i * 0.06, f, dur: 0.045, type: 'square', g: 0.07, r: 0.02 })); a.tone({ t: t + 0.25, f: 90, slide: 60, dur: 0.3, type: 'sawtooth', g: 0.2, r: 0.2, filter: 500, dist: true }); },
    voice_nova(a) { const t = a.now; [1319, 1568, 2093, 2637].forEach((f, i) => a.tone({ t: t + i * 0.05, f, dur: 0.02, type: 'sine', g: 0.1, r: 0.5, rev: 0.6 })); },
    voice_bubbles(a) { const t = a.now; for (let i = 0; i < 4; i++) a.tone({ t: t + i * 0.07, f: 300 + i * 120, slide: 900 + i * 200, dur: 0.05, type: 'sine', g: 0.16, r: 0.04 }); },
    // firing, flavoured per weapon family
    fire_leaf(a) { cannon(a); a.tone({ f: 200, slide: 520, dur: 0.12, type: 'sine', g: 0.25, r: 0.05, vib: 60, vibRate: 20 }); },
    fire_fire(a) { cannon(a); a.noise({ dur: 0.35, g: 0.4, f: 700, fEnd: 2500, r: 0.25, rev: 0.2 }); },
    fire_snow(a) { cannon(a); a.noise({ dur: 0.12, g: 0.3, f: 5000, ft: 'highpass', r: 0.1 }); },
    fire_ice(a) { a.tone({ f: 2000, slide: 600, dur: 0.25, type: 'sawtooth', g: 0.08, r: 0.1, filter: 4000 }); for (const f of [2637, 3520]) a.tone({ f, dur: 0.01, type: 'sine', g: 0.08, r: 0.5, rev: 0.6 }); },
    fire_spark(a) { cannon(a); a.tone({ f: 1800, dur: 0.01, type: 'triangle', g: 0.12, r: 0.25, rev: 0.3 }); },
    fire_laser(a) { a.tone({ f: 300, slide: 2400, dur: 0.3, type: 'sawtooth', g: 0.1, r: 0.1, filter: 3000 }); cannon(a); },
    fire_star(a) { cannon(a); [1568, 2093].forEach((f, i) => a.tone({ t: a.now + i * 0.05, f, dur: 0.02, type: 'sine', g: 0.1, r: 0.4, rev: 0.5 })); },
    fire_void(a) { a.tone({ f: 60, slide: 30, dur: 0.6, type: 'sawtooth', g: 0.25, r: 0.4, filter: 400 }); a.noise({ dur: 0.5, g: 0.3, f: 3000, fEnd: 200, ft: 'bandpass', q: 3, r: 0.3, rev: 0.5 }); },
    fire_bubble(a) { a.tone({ f: 250, slide: 1200, dur: 0.08, type: 'sine', g: 0.35, r: 0.05 }); a.noise({ dur: 0.06, g: 0.2, f: 1200, r: 0.06 }); },
    fire_goo(a) { a.tone({ f: 140, slide: 70, dur: 0.15, type: 'square', g: 0.12, r: 0.1, filter: 600, vib: 50, vibRate: 25 }); a.noise({ dur: 0.12, g: 0.3, f: 500, r: 0.12 }); },
    fire_ring(a) { cannon(a); const t = a.now; for (const k of [0, 0.12, 0.24]) a.tone({ t: t + k, f: 140, slide: 70, dur: 0.1, type: 'square', g: 0.2, r: 0.08, filter: 700, vib: 90, vibRate: 30 }); },
    explode(a) { boom(a, false); },
    explodeBig(a) { boom(a, true); },
    bounce(a) { a.tone({ f: 160, slide: 520, dur: 0.14, type: 'sine', g: 0.45, r: 0.12, vib: 50, vibRate: 18 }); },
    split(a) { const t = a.now; for (let i = 0; i < 3; i++) a.tone({ t: t + i * 0.04, f: 900 + i * 300, dur: 0.02, type: 'square', g: 0.1, r: 0.06 }); a.noise({ dur: 0.1, g: 0.3, f: 3000, ft: 'highpass', r: 0.1 }); },
    drill(a) { a.tone({ f: 90, dur: 0.5, type: 'sawtooth', g: 0.18, r: 0.1, filter: 900, vib: 200, vibRate: 40, dist: true }); a.noise({ dur: 0.5, g: 0.25, f: 1800, ft: 'bandpass', q: 2, r: 0.1 }); },
    freeze(a) { for (const [k, f] of [[0, 2093], [0.05, 2637], [0.1, 3136], [0.15, 4186]]) a.tone({ t: a.now + k, f, dur: 0.01, type: 'sine', g: 0.12, r: 0.7, rev: 0.7 }); a.noise({ dur: 0.3, g: 0.2, f: 7000, ft: 'highpass', r: 0.3 }); },
    laser(a) { a.tone({ f: 1200, slide: 180, dur: 0.7, type: 'sawtooth', g: 0.18, r: 0.3, filter: 5000, rev: 0.4 }); a.tone({ f: 80, dur: 0.6, type: 'square', g: 0.2, r: 0.3, filter: 400 }); a.noise({ dur: 0.6, g: 0.3, f: 4000, ft: 'bandpass', q: 1, r: 0.3 }); },
    meteor(a) { a.noise({ dur: 1.2, g: 0.35, f: 300, fEnd: 2500, ft: 'bandpass', q: 1.5, r: 0.3, rev: 0.4 }); a.tone({ f: 900, slide: 200, dur: 1.2, type: 'sine', g: 0.08, r: 0.2 }); },
    blackhole(a) { a.tone({ f: 800, slide: 50, dur: 0.8, type: 'sawtooth', g: 0.15, r: 0.3, filter: 1500, filterEnd: 150, rev: 0.5 }); a.noise({ dur: 0.8, g: 0.3, f: 4000, fEnd: 150, ft: 'bandpass', q: 3, r: 0.4 }); },
    splash(a) { a.noise({ dur: 0.35, g: 0.45, f: 1400, fEnd: 300, r: 0.6, rev: 0.3 }); a.tone({ f: 500, slide: 150, dur: 0.1, type: 'sine', g: 0.2, r: 0.1 }); },
    land(a) { a.tone({ f: 120, slide: 50, dur: 0.08, type: 'sine', g: 0.5, r: 0.08 }); a.noise({ dur: 0.06, g: 0.2, f: 600, r: 0.08 }); },
    aim(a) { a.tone({ f: 2400, dur: 0.005, type: 'square', g: 0.03, r: 0.01, filter: 5000 }); },
    weapon(a) { a.tone({ f: 660, dur: 0.03, type: 'square', g: 0.08, r: 0.04 }); a.tone({ t: a.now + 0.04, f: 990, dur: 0.04, type: 'square', g: 0.08, r: 0.06 }); },
    denied(a) { a.tone({ f: 200, dur: 0.12, type: 'square', g: 0.1, r: 0.05, filter: 800 }); },
    yourTurn(a) { const t = a.now; [784, 988, 1175, 1568].forEach((f, i) => a.tone({ t: t + i * 0.06, f, dur: 0.06, type: 'triangle', g: 0.14, r: 0.25, rev: 0.4 })); },
    theirTurn(a) { const t = a.now; [659, 523].forEach((f, i) => a.tone({ t: t + i * 0.08, f, dur: 0.06, type: 'triangle', g: 0.1, r: 0.2, rev: 0.3 })); },
    tick(a) { a.tone({ f: 1800, dur: 0.01, type: 'square', g: 0.06, r: 0.03, filter: 4000 }); },
    ssReady(a) { const t = a.now; [1047, 1319, 1568, 2093, 2637].forEach((f, i) => a.tone({ t: t + i * 0.05, f, dur: 0.03, type: 'sine', g: 0.1, r: 0.4, rev: 0.6 })); },
    hitDing(a) { a.tone({ f: 1760, dur: 0.02, type: 'triangle', g: 0.14, r: 0.3, rev: 0.3 }); a.tone({ t: a.now + 0.06, f: 2349, dur: 0.02, type: 'triangle', g: 0.14, r: 0.4, rev: 0.3 }); },
    ko(a) { boom(a, true); const t = a.now; [523, 392, 330, 262].forEach((f, i) => a.tone({ t: t + 0.3 + i * 0.12, f, dur: 0.1, type: 'square', g: 0.07, r: 0.1, filter: 2000 })); },
    suddenDeath(a) { const t = a.now; for (let i = 0; i < 4; i++) a.tone({ t: t + i * 0.3, f: 880, slide: 440, dur: 0.25, type: 'sawtooth', g: 0.1, r: 0.05, filter: 2500 }); },
    nofuel(a) { a.tone({ f: 300, slide: 120, dur: 0.15, type: 'sawtooth', g: 0.08, r: 0.05, filter: 900 }); },
    face(a) { a.noise({ dur: 0.05, g: 0.08, f: 800, r: 0.04 }); },
    found(a) { const t = a.now; [523, 659, 784, 1047, 1319].forEach((f, i) => a.tone({ t: t + i * 0.07, f, dur: 0.07, type: 'triangle', g: 0.14, r: 0.3, rev: 0.4 })); },
    vs(a) { boom(a, true); a.tone({ f: 220, slide: 880, dur: 0.3, type: 'sawtooth', g: 0.1, r: 0.2, filter: 2500 }); },
  };
  const LOOPS = {
    whistle: { type: 'sine', f: 900, g: 0.045, filter: 3500 },
    treads: { noise: true, filter: 260, q: 2, g: 0.2 },
    charge: { type: 'sawtooth', f: 180, g: 0.035, filter: 1400 },
  };

  TD.Audio = (typeof FF !== 'undefined' && FF.Audio) ? FF.Audio.create({
    songs: SONGS, sfx: SFX, loops: LOOPS,
    volumes: () => ({ music: TD.settings.music, sfx: TD.settings.sfx }),
    prerender: ['battle', 'battle2', 'menu', 'victory', 'defeat', 'lobby'], // battle music first: it's the one that must never stutter
  }) : null;
  TD.SONGS = SONGS;
})(globalThis.TD);
