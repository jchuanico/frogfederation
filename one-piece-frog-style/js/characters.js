/* One Piece Frog Style — roster, frame data and animation keyframes.
 *
 * Move fields (frames are 1/60 s):
 *   startup/active/recovery  hitbox is live for frames [startup, startup+active)
 *   dmg chip hitstun blockstun hitstop
 *   kb [x, y]     knockback velocity in m/s for a 70 kg body — heavier fighters fly less (Δv = J/m)
 *   guard         'mid' | 'low' (block crouching) | 'high' (overhead: block standing) | 'unblockable'
 *   box           hitbox built from the live skeleton: { seg: [jointA, jointB], r } or { sword: 'F'|'B', r } or { staff: true, r }
 *   stretch       rubber limb: { limb: 'aF'|'lF', len (m), from, hold } — driven by a damped spring
 *   keys          pose keyframes [{ f, p }] layered on the character's stance
 *   vel           self movement [{ from, to, vx, vy }] with vx relative to facing
 *   proj          projectile spawn { at, kind, ... }
 *   hits/every    multi-hit moves
 *   kind          'normal' | 'special' | 'hyper' — specials and hypers trigger face cut-ins
 */
'use strict';
(function (OP) {
  // ---------- shared poses ----------
  const P = OP.Poses = {
    crouch: { lean: 20, head: -12, hipH: 0.27, fF: [0.2, 0], fB: [-0.17, 0], aF1: 50, aF2: 150, aB1: 30, aB2: 140 },
    block: { lean: -4, head: -10, aF1: 70, aF2: 172, aB1: 55, aB2: 165, hipH: 0.43, fF: [0.13, 0], fB: [-0.17, 0] },
    cblock: { lean: 10, head: -12, hipH: 0.27, fF: [0.2, 0], fB: [-0.17, 0], aF1: 72, aF2: 172, aB1: 60, aB2: 168 },
    jumpUp: { lean: 6, head: 0, hipH: 0.5, aF1: 60, aF2: 140, aB1: -30, aB2: 30, lF1: 85, lF2: 5, lB1: 15, lB2: -35 },
    jumpFall: { lean: 10, head: -4, hipH: 0.5, aF1: 45, aF2: 110, aB1: -40, aB2: 15, lF1: 45, lF2: -5, lB1: -5, lB2: -20 },
    flip: { lean: 90, head: 10, hipH: 0.5, aF1: 120, aF2: 60, aB1: 100, aB2: 50, lF1: 120, lF2: 30, lB1: 110, lB2: 20 },
    squat: { lean: 22, head: -8, hipH: 0.34, fF: [0.16, 0], fB: [-0.15, 0], aF1: 15, aF2: 60, aB1: -25, aB2: 20 },
    land: { lean: 18, head: -8, hipH: 0.36, fF: [0.16, 0], fB: [-0.16, 0], aF1: 40, aF2: 80, aB1: -10, aB2: 30 },
    hit: { lean: -22, head: -25, hipH: 0.43, aF1: -15, aF2: 25, aB1: -45, aB2: -10, fF: [0.18, 0], fB: [-0.18, 0] },
    hitLow: { lean: 34, head: 18, hipH: 0.37, fF: [0.12, 0], fB: [-0.2, 0], aF1: 10, aF2: 35, aB1: -15, aB2: 5 },
    hitAir: { lean: -58, head: -30, hipH: 0.5, aF1: 150, aF2: 200, aB1: -130, aB2: -160, lF1: 55, lF2: 25, lB1: 15, lB2: -20 },
    down: { lean: -88, head: -4, hipH: 0.085, hx: 0, aF1: -115, aF2: -150, aB1: -80, aB2: -95, lF1: 84, lF2: 95, lB1: 88, lB2: 100 },
    getup: { lean: 25, head: -5, hipH: 0.3, fF: [0.16, 0], fB: [-0.2, 0], aF1: 40, aF2: 60, aB1: -10, aB2: 10 },
    dash: { lean: 30, head: -14, hipH: 0.4, fF: [0.28, 0.02], fB: [-0.3, 0.07], aF1: -45, aF2: -10, aB1: -65, aB2: -30 },
    backdash: { lean: -14, head: -4, hipH: 0.46, lF1: 40, lF2: 10, lB1: -10, lB2: -40, aF1: 30, aF2: 100, aB1: -20, aB2: 20 },
    tagIn: { lean: 30, head: -10, hipH: 0.5, aF1: 110, aF2: 60, aB1: -60, aB2: -30, lF1: 70, lF2: 20, lB1: 20, lB2: -10 },
  };

  // Keyframe helper: stance → windup → hit → hold → stance.
  function K(windup, strike, startup, active, recovery, extra) {
    const k = [{ f: 0, p: {} }];
    if (windup) k.push({ f: Math.max(1, startup - 3), p: windup, ease: 'outCubic' });
    k.push({ f: startup, p: strike, ease: 'outCubic' });
    k.push({ f: startup + active + Math.min(4, recovery / 3), p: extra || strike });
    k.push({ f: startup + active + recovery, p: {}, ease: 'inOutSine' });
    return k;
  }

  const dflt = { startup: 6, active: 3, recovery: 10, dmg: 40, chip: 0, hitstun: 15, blockstun: 11, hitstop: 7, kb: [1.6, 0], guard: 'mid', kind: 'normal', hits: 1, every: 0, sfx: 'whiff', hitSfx: 'hitL', spark: 'punch', shake: 0 };
  function M(o) {
    const m = Object.assign({}, dflt, o);
    if (m.kind !== 'normal') { m.chip = m.chip || Math.round(m.dmg * 0.12); }
    m.total = m.startup + m.active + m.recovery;
    return m;
  }

  // ======================================================================
  const LUFFY = {
    id: 'luffy', name: 'Monkey D. Luffy', short: 'LUFFY', title: 'Straw Hat Captain',
    quote: "I'm gonna be King of the Pirates!", quoteJp: 'かいぞくおうに…おれはなる！',
    height: 1.74, mass: 64, hp: 1000, walk: 1.9, backWalk: 1.5, dash: 6.4, jumpH: 1.7, airJumps: 0,
    restitution: 0.55, // rubber: bounces off the deck more than anyone else
    voice: { pitch: 1.3, rate: 1.12, gender: 'm' },
    pal: [
      { skin: '#f2c29b', hair: '#161616', hat: '#e8c547', hatBand: '#c8282b', vest: '#d62828', shorts: '#2f5fb3', sash: '#f0c93a', sandal: '#8b5a2b', eye: '#1c1414' },
      { skin: '#f2c29b', hair: '#161616', hat: '#e8c547', hatBand: '#1d6fd1', vest: '#2d8a47', shorts: '#2a2a2a', sash: '#e05a2a', sandal: '#5b3a1b', eye: '#1c1414' },
    ],
    stance: { lean: 6, head: -2, aF1: 28, aF2: 125, aB1: 6, aB2: 105, fF: [0.13, 0], fB: [-0.12, 0], hipH: 0.45, hx: 0 },
    intro: { lean: -6, head: 5, aF1: 170, aF2: 180, aB1: -10, aB2: 10, fF: [0.12, 0], fB: [-0.12, 0], hipH: 0.47 },
    win: { lean: -8, head: 8, aF1: 175, aF2: 178, aB1: 150, aB2: 170, fF: [0.12, 0], fB: [-0.14, 0], hipH: 0.47 },
    winLine: 'Shishishi! Now let\'s eat some meat!', winJp: 'シシシッ！ にく、くいてぇ！', tagJp: 'おれにまかせろ！', tagLine: 'Leave it to me!',
    assist: 'sN',
    moves: {
      L: M({ name: 'Jab', startup: 5, active: 3, recovery: 8, dmg: 40, box: { seg: ['elF', 'haF'], r: 0.07 },
        stretch: { limb: 'aF', len: 0.35, from: 2 },
        keys: K({ lean: 2, aF1: 20, aF2: 150 }, { lean: 16, aF1: 88, aF2: 90, aB1: -10, aB2: 60 }, 5, 3, 8) }),
      H: M({ name: 'Gomu Gomu Bullet', startup: 10, active: 5, recovery: 18, dmg: 75, hitstun: 20, blockstun: 15, hitstop: 10, kb: [3.4, 0],
        box: { seg: ['elF', 'haF'], r: 0.08 }, stretch: { limb: 'aF', len: 1.25, from: 7 }, sfx: 'stretch', hitSfx: 'hitM', shake: 2,
        keys: K({ lean: -6, aF1: -50, aF2: -80, aB1: 40, aB2: 120 }, { lean: 22, aF1: 90, aF2: 90, aB1: -20, aB2: 40, fF: [0.26, 0], fB: [-0.18, 0], hipH: 0.4 }, 10, 5, 18) }),
      cL: M({ name: 'Snap Kick', startup: 5, active: 3, recovery: 9, dmg: 35, guard: 'low', box: { seg: ['knF', 'ftF'], r: 0.07 },
        stretch: { limb: 'lF', len: 0.25, from: 2 },
        keys: K(null, Object.assign({}, P.crouch, { lean: 8, lF1: 78, lF2: 88, fF: null }), 5, 3, 9) }),
      cH: M({ name: 'Rubber Uppercut', startup: 9, active: 5, recovery: 22, dmg: 70, hitstun: 26, hitstop: 10, kb: [0.8, 8.4], launch: true,
        box: { seg: ['elF', 'haF'], r: 0.09 }, stretch: { limb: 'aF', len: 0.9, from: 6 }, sfx: 'stretch', hitSfx: 'hitM', shake: 2,
        keys: K(Object.assign({}, P.crouch, { aF1: 20, aF2: 30 }), { lean: -2, head: 10, hipH: 0.47, aF1: 138, aF2: 150, aB1: -20, aB2: 20 }, 9, 5, 22) }),
      jL: M({ name: 'Air Jab', startup: 5, active: 5, recovery: 8, dmg: 38, air: true, kb: [1.4, 1.5], box: { seg: ['elF', 'haF'], r: 0.1 },
        stretch: { limb: 'aF', len: 0.35, from: 2 },
        keys: K(null, Object.assign({}, P.jumpFall, { lean: 22, aF1: 55, aF2: 40 }), 5, 5, 8) }),
      jH: M({ name: 'Gomu Gomu no Stamp', startup: 9, active: 6, recovery: 14, dmg: 70, air: true, guard: 'high', hitstun: 20, hitstop: 10, kb: [2.4, 2.4],
        box: { seg: ['knF', 'ftF'], r: 0.1 }, stretch: { limb: 'lF', len: 1.1, from: 6 }, sfx: 'stretch', hitSfx: 'hitM', shake: 2,
        keys: K(Object.assign({}, P.jumpUp, { lF1: 130, lF2: 20 }), Object.assign({}, P.jumpFall, { lean: -18, lF1: 62, lF2: 52 }), 9, 6, 14) }),
      sN: M({ name: 'Gomu Gomu no Pistol', shout: 'Gomu Gomu no... Pistol!', kind: 'special', startup: 13, active: 9, recovery: 22, dmg: 110, hitstun: 24, blockstun: 18, hitstop: 12,
        kb: [5.2, 2.6], knockdown: true, box: { seg: ['elF', 'haF'], r: 0.1 }, stretch: { limb: 'aF', len: 3.4, from: 10 }, sfx: 'stretch', hitSfx: 'hitH', shake: 4,
        keys: K({ lean: -10, head: -6, aF1: -70, aF2: -110, aB1: 50, aB2: 110, fB: [-0.22, 0] }, { lean: 24, aF1: 90, aF2: 90, aB1: -30, aB2: 20, fF: [0.28, 0], fB: [-0.2, 0], hipH: 0.4 }, 13, 9, 22), expr: 'shout' }),
      sF: M({ name: 'Gomu Gomu no Gatling', shout: 'Gomu Gomu no Gatling!', kind: 'special', startup: 12, active: 32, recovery: 20, dmg: 16, hits: 10, every: 3, hitstun: 12, blockstun: 8, hitstop: 3,
        kb: [0.6, 0], last: { kb: [4.2, 3.2], hitstun: 26, knockdown: true, hitstop: 12, hitSfx: 'hitH' }, fx: 'gatling', sfx: 'stretch', hitSfx: 'hitL', shake: 1,
        box: { custom: 'gatling', r: 0.34 }, stretch: { limb: 'aF', len: 0.8, from: 10, wobble: true },
        keys: K({ lean: -8, aF1: -40, aF2: -70, aB1: -40, aB2: -70 }, { lean: 18, aF1: 90, aF2: 90, aB1: 85, aB2: 95, fF: [0.28, 0], fB: [-0.2, 0], hipH: 0.4 }, 12, 32, 20), expr: 'shout' }),
      sU: M({ name: 'Gomu Gomu no Rocket', shout: 'Gomu Gomu no Rocket!', kind: 'special', startup: 8, active: 16, recovery: 16, dmg: 95, hitstun: 30, hitstop: 10, kb: [1.4, 8.8], launch: true,
        invuln: [1, 10], vel: [{ from: 8, to: 9, vx: 3.2, vy: 8.8, impulse: true }], box: { seg: ['hip', 'head'], r: 0.3 }, sfx: 'bounce', hitSfx: 'hitH', shake: 3, airEnd: true,
        keys: [{ f: 0, p: {} }, { f: 6, p: P.squat }, { f: 10, p: { lean: 10, head: 0, hipH: 0.5, aF1: 175, aF2: 180, aB1: 170, aB2: 178, lF1: -5, lF2: -10, lB1: -15, lB2: -20 } }, { f: 40, p: P.jumpFall }], expr: 'shout' }),
      sD: M({ name: 'Gomu Gomu no Whip', shout: 'Gomu Gomu no Whip!', kind: 'special', startup: 12, active: 7, recovery: 22, dmg: 90, guard: 'low', hitstun: 30, hitstop: 10, kb: [3.2, 3.2], knockdown: true,
        box: { seg: ['knF', 'ftF'], r: 0.1 }, stretch: { limb: 'lF', len: 2.1, from: 9 }, sfx: 'stretch', hitSfx: 'hitM', shake: 2,
        keys: K({ lean: -10, hipH: 0.4, lF1: -40, lF2: -60, fB: [-0.1, 0] }, { lean: -24, head: 12, hipH: 0.3, lF1: 86, lF2: 90, fB: [-0.05, 0], aF1: -60, aF2: -30, aB1: -100, aB2: -120 }, 12, 7, 22), expr: 'shout' }),
      // The giant fist drives the target into the deck; they bounce high and stay juggleable
      // (long hitstun + short recovery) so Luffy can follow up with Pistol, Rocket or an air combo.
      X: M({ name: 'Gear Third: Gigant Pistol', shout: 'Gear Third! Gomu Gomu no... Gigant Pistol!', kind: 'hyper', startup: 15, active: 12, recovery: 22, dmg: 350, chip: 45, hitstun: 85, blockstun: 26, hitstop: 22,
        kb: [4.2, -6], groundBounce: true, bounceVy: 6.8, invuln: [0, 16], box: { seg: ['elF', 'haF'], r: 0.48 }, stretch: { limb: 'aF', len: 5.2, from: 11 }, fist: 9, sfx: 'stretch', hitSfx: 'hitH', shake: 12, don: true,
        keys: K({ lean: -18, head: -10, aF1: -80, aF2: -120, aB1: 60, aB2: 120, fB: [-0.26, 0], hipH: 0.4 }, { lean: 26, aF1: 90, aF2: 90, aB1: -40, aB2: 10, fF: [0.32, 0], fB: [-0.22, 0], hipH: 0.38 }, 15, 12, 22), expr: 'shout', cutExpr: 'puff' }),
    },
  };

  // ======================================================================
  const santoryu = { swordsOut: true, swordF: true, swordB: true, mouthSword: true };
  const ZORO = {
    id: 'zoro', name: 'Roronoa Zoro', short: 'ZORO', title: 'Pirate Hunter',
    quote: 'Nothing happened.', quoteJp: 'なにも…なかった。',
    height: 1.81, mass: 85, hp: 1050, walk: 1.6, backWalk: 1.3, dash: 5.8, jumpH: 1.5, airJumps: 0, restitution: 0.25,
    voice: { pitch: 0.7, rate: 0.95, gender: 'm' },
    flags: santoryu,
    pal: [
      { skin: '#e7b88e', hair: '#3fa34d', shirt: '#f4f4f0', haramaki: '#2e8b3e', pants: '#1d1d24', boots: '#151515', bandana: '#1a1a1a', eye: '#1c1414' },
      { skin: '#e7b88e', hair: '#3fa34d', shirt: '#2f2f36', haramaki: '#7c2f8c', pants: '#3a2a1d', boots: '#241a12', bandana: '#6b1a1a', eye: '#1c1414' },
    ],
    stance: { lean: 14, head: -8, aF1: 55, aF2: 105, swF: 62, aB1: 35, aB2: 92, swB: 118, fF: [0.17, 0], fB: [-0.16, 0], hipH: 0.42, hx: 0 },
    intro: { lean: 4, head: 0, aF1: 20, aF2: 40, swF: 10, aB1: 10, aB2: 30, swB: 170, fF: [0.12, 0], fB: [-0.12, 0], hipH: 0.46 },
    win: { lean: 0, head: -6, aF1: 10, aF2: 20, swF: 175, aB1: -5, aB2: 5, swB: 185, fF: [0.12, 0], fB: [-0.14, 0], hipH: 0.47 },
    winLine: 'Nothing happened.', winJp: 'なにもなかった。', tagJp: 'どいてろ。', tagLine: 'Step aside.',
    assist: 'sU',
    moves: {
      // Light: a one-handed rising iai cut — the right-hand blade sweeps up from behind the hip.
      L: M({ name: 'Ittoryu: Iai Slash', startup: 6, active: 3, recovery: 11, dmg: 45, box: { sword: 'F', r: 0.06 }, sfx: 'slash', hitSfx: 'hitSlash', spark: 'slash', bladeTrail: 'F',
        keys: [{ f: 0, p: {} }, { f: 3, p: { lean: 4, aF1: -30, aF2: -60, swF: -140, aB1: 60, aB2: 110, swB: 130 }, ease: 'outCubic' },
          { f: 6, p: { lean: 22, aF1: 80, aF2: 82, swF: 68, aB1: 40, aB2: 90, swB: 140, fF: [0.24, 0] }, ease: 'outCubic' },
          { f: 9, p: { lean: 24, aF1: 104, aF2: 116, swF: 128, aB1: 40, aB2: 90, swB: 140, fF: [0.24, 0] } },
          { f: 13, p: { lean: 20, aF1: 110, aF2: 125, swF: 140, aB1: 40, aB2: 90, swB: 140, fF: [0.24, 0] } }, { f: 20, p: {}, ease: 'inOutSine' }] }),
      // Heavy: both swords raised overhead in both hands, then one committed downward chop with a step in.
      H: M({ name: 'Nitoryu: Double Chop', startup: 13, active: 4, recovery: 20, dmg: 95, hitstun: 22, blockstun: 16, hitstop: 12, kb: [3.6, 0], box: { sword: 'both', r: 0.07 },
        vel: [{ from: 8, to: 14, vx: 2.4 }], sfx: 'whiffH', hitSfx: 'hitSlash', spark: 'slash', shake: 4, bladeTrail: 'both',
        keys: [{ f: 0, p: {} }, { f: 9, p: { lean: -12, head: 6, aF1: 172, aF2: 200, swF: 235, aB1: 166, aB2: 196, swB: 228, fF: [0.2, 0], hipH: 0.44 }, ease: 'outCubic' },
          { f: 14, p: { lean: 34, head: -6, aF1: 102, aF2: 78, swF: 30, aB1: 96, aB2: 72, swB: 24, fF: [0.32, 0], fB: [-0.22, 0], hipH: 0.36 }, ease: 'inCubic' },
          { f: 21, p: { lean: 34, head: -6, aF1: 100, aF2: 74, swF: 26, aB1: 94, aB2: 70, swB: 20, fF: [0.32, 0], fB: [-0.22, 0], hipH: 0.36 } }, { f: 37, p: {}, ease: 'inOutSine' }] }),
      cL: M({ name: 'Low Thrust', startup: 6, active: 3, recovery: 10, dmg: 38, guard: 'low', box: { sword: 'F', r: 0.05 }, sfx: 'slash', hitSfx: 'hitSlash', spark: 'slash',
        keys: K(null, Object.assign({}, P.crouch, { lean: 26, aF1: 80, aF2: 85, swF: 92, aB1: 40, aB2: 80, swB: 110 }), 6, 3, 10) }),
      cH: M({ name: 'Rising Slash', startup: 10, active: 5, recovery: 22, dmg: 72, hitstun: 26, hitstop: 10, kb: [0.8, 8.2], launch: true, box: { sword: 'both', r: 0.06 },
        sfx: 'slash', hitSfx: 'hitSlash', spark: 'slash', shake: 2,
        // swords start low-forward and sweep up through the opponent during the active frames
        keys: [{ f: 0, p: {} }, { f: 7, p: Object.assign({}, P.crouch, { aF1: 40, aF2: 30, swF: 40, aB1: 30, aB2: 25, swB: 50 }), ease: 'outCubic' },
          { f: 10, p: { lean: 10, hipH: 0.46, aF1: 100, aF2: 105, swF: 98, aB1: 96, aB2: 100, swB: 108 }, ease: 'outCubic' },
          { f: 15, p: { lean: 0, hipH: 0.47, aF1: 140, aF2: 150, swF: 152, aB1: 132, aB2: 145, swB: 162 } }, { f: 37, p: {}, ease: 'inOutSine' }] }),
      jL: M({ name: 'Air Cut', startup: 6, active: 5, recovery: 9, dmg: 42, air: true, kb: [1.4, 1.5], box: { sword: 'F', r: 0.07 }, sfx: 'slash', hitSfx: 'hitSlash', spark: 'slash',
        keys: K(Object.assign({}, P.jumpUp, { aF1: 140, aF2: 160, swF: 170 }), Object.assign({}, P.jumpFall, { aF1: 70, aF2: 50, swF: 45 }), 6, 5, 9) }),
      jH: M({ name: 'Tora Gari', startup: 10, active: 6, recovery: 14, dmg: 75, air: true, guard: 'high', hitstun: 20, hitstop: 10, kb: [2.2, -2], groundBounce: true,
        box: { sword: 'both', r: 0.06 }, sfx: 'slash', hitSfx: 'hitSlash', spark: 'slash', shake: 3,
        keys: K(Object.assign({}, P.jumpUp, { aF1: 170, aF2: 185, swF: 200, aB1: 165, aB2: 180, swB: 195 }), Object.assign({}, P.jumpFall, { lean: 30, aF1: 60, aF2: 40, swF: 30, aB1: 55, aB2: 35, swB: 45 }), 10, 6, 14) }),
      sN: M({ name: 'Sanjuroku Pound Ho', shout: 'Sanjuroku... Pound Ho!', kind: 'special', startup: 15, active: 2, recovery: 24, dmg: 85, hitstun: 22, blockstun: 16, hitstop: 9, kb: [3.2, 1.2],
        proj: { at: 15, kind: 'slash', vx: 9.5, y: 0.62, r: 0.2, len: 0.55, life: 80 }, sfx: 'slash', hitSfx: 'hitSlash', spark: 'slash',
        keys: K({ lean: -6, aF1: -60, aF2: -30, swF: -20, aB1: -50, aB2: -20, swB: -10 }, { lean: 28, aF1: 95, aF2: 85, swF: 95, aB1: 85, aB2: 80, swB: 85, fF: [0.3, 0], hipH: 0.37 }, 15, 2, 24), expr: 'determined' }),
      sF: M({ name: 'Oni Giri', shout: 'Santoryu... Oni Giri!', kind: 'special', startup: 12, active: 12, recovery: 20, dmg: 125, hitstun: 32, blockstun: 18, hitstop: 14, kb: [1.6, 7.2], launch: true,
        vel: [{ from: 10, to: 24, vx: 10.5 }], passThrough: true, box: { seg: ['hip', 'neck'], r: 0.42 }, sfx: 'dash', hitSfx: 'hitSlash', spark: 'slash', shake: 4, trail: true,
        keys: K({ lean: 20, aF1: 20, aF2: 30, swF: -40, aB1: 10, aB2: 20, swB: -50, hipH: 0.36 }, { lean: 38, aF1: 110, aF2: 100, swF: 60, aB1: 60, aB2: 110, swB: 130, fF: [0.34, 0], fB: [-0.3, 0.05], hipH: 0.34 }, 12, 12, 20), expr: 'intense' }),
      sU: M({ name: 'Tatsumaki', shout: 'Santoryu... Tatsumaki!', kind: 'special', startup: 6, active: 22, recovery: 18, dmg: 26, hits: 5, every: 5, hitstun: 20, hitstop: 5, kb: [0.3, 4.2], launch: true,
        last: { kb: [1.2, 8], hitstun: 34, hitstop: 12, hitSfx: 'hitSlash' }, invuln: [1, 7], vel: [{ from: 6, to: 22, vx: 0.6, vy: 4.2 }], airEnd: true,
        box: { seg: ['hip', 'head'], r: 0.62 }, fx: 'tornado', sfx: 'wind', hitSfx: 'hitSlash', spark: 'slash', shake: 1,
        keys: [{ f: 0, p: {} }, { f: 5, p: Object.assign({}, P.squat, { swF: 20, swB: 10 }) },
          { f: 9, p: { lean: 0, hipH: 0.5, aF1: 90, aF2: 90, swF: 90, aB1: -90, aB2: -90, swB: -90, lF1: 10, lF2: 0, lB1: -10, lB2: -5 } },
          { f: 14, p: { lean: 0, hipH: 0.5, aF1: -90, aF2: -90, swF: -90, aB1: 90, aB2: 90, swB: 90, lF1: 10, lF2: 0, lB1: -10, lB2: -5 } },
          { f: 19, p: { lean: 0, hipH: 0.5, aF1: 90, aF2: 90, swF: 90, aB1: -90, aB2: -90, swB: -90, lF1: 10, lF2: 0, lB1: -10, lB2: -5 } },
          { f: 24, p: { lean: 0, hipH: 0.5, aF1: -90, aF2: -90, swF: -90, aB1: 90, aB2: 90, swB: 90, lF1: 10, lF2: 0, lB1: -10, lB2: -5 } },
          { f: 46, p: P.jumpFall }], expr: 'shout' }),
      sD: M({ name: 'Toro Nagashi', shout: 'Toro Nagashi.', kind: 'special', startup: 4, active: 22, recovery: 16, dmg: 0, counter: { from: 4, to: 26 }, noBox: true,
        keys: [{ f: 0, p: {} }, { f: 4, p: { lean: -4, head: -2, aF1: 20, aF2: 30, swF: -150, aB1: 10, aB2: 20, swB: -160, hipH: 0.43 } }, { f: 26, p: { lean: -4, head: -2, aF1: 20, aF2: 30, swF: -150, aB1: 10, aB2: 20, swB: -160, hipH: 0.43 } }, { f: 42, p: {} }], expr: 'determined' }),
      counterHit: M({ name: 'Toro Nagashi', kind: 'normal', startup: 2, active: 4, recovery: 16, dmg: 130, hitstun: 34, hitstop: 16, kb: [2.4, 6], launch: true, guard: 'unblockable', invuln: [0, 8],
        vel: [{ from: 0, to: 4, vx: 9 }], passThrough: true, box: { seg: ['hip', 'neck'], r: 0.45 }, sfx: 'slash', hitSfx: 'hitSlash', spark: 'slash', shake: 5,
        keys: [{ f: 0, p: { lean: 36, aF1: 110, aF2: 100, swF: 60, aB1: 60, aB2: 110, swB: 130, fF: [0.34, 0], fB: [-0.3, 0.05], hipH: 0.34 } }, { f: 22, p: {} }], expr: 'intense' }),
      X: M({ name: 'Santoryu Ogi: Sanzen Sekai', shout: 'Santoryu Ogi... Sanzen Sekai!', kind: 'hyper', startup: 14, active: 14, recovery: 36, dmg: 300, chip: 40, hitstun: 50, blockstun: 24, hitstop: 26,
        kb: [2, 9.5], launch: true, invuln: [0, 26], vel: [{ from: 12, to: 28, vx: 13 }], passThrough: true, box: { seg: ['hip', 'neck'], r: 0.5 }, sfx: 'dash', hitSfx: 'hitSlash', spark: 'slash', shake: 12, don: true, trail: true,
        glow: true, sheathe: 40,
        keys: K({ lean: 26, aF1: 150, aF2: 190, swF: 250, aB1: 20, aB2: -20, swB: -60, hipH: 0.36 }, { lean: 40, aF1: 100, aF2: 120, swF: 110, aB1: 80, aB2: 60, swB: 60, fF: [0.36, 0], fB: [-0.32, 0.05], hipH: 0.33 }, 14, 14, 36), expr: 'intense' }),
    },
  };

  // ======================================================================
  const SANJI = {
    id: 'sanji', name: 'Vinsmoke Sanji', short: 'SANJI', title: 'Black Leg',
    quote: 'A cook never lets anyone go hungry.', quoteJp: 'はらへってるやつには…めしをくわせる。それがコックだ。',
    height: 1.80, mass: 72, hp: 1000, walk: 2.0, backWalk: 1.6, dash: 6.6, jumpH: 1.8, airJumps: 1, restitution: 0.3,
    voice: { pitch: 0.95, rate: 1.05, gender: 'm' },
    pal: [
      { skin: '#f3cda8', hair: '#f5d442', suit: '#17171e', shirt: '#3a68c9', tie: '#111111', shoe: '#0e0e0e', eye: '#274a8a' },
      { skin: '#f3cda8', hair: '#f5d442', suit: '#dcdcdc', shirt: '#c33636', tie: '#2a2a2a', shoe: '#6b4a2b', eye: '#274a8a' },
    ],
    // hands in pockets — a cook never fights with his hands
    stance: { lean: 2, head: 0, aF1: -8, aF2: 38, aB1: -14, aB2: 30, fF: [0.11, 0], fB: [-0.1, 0], hipH: 0.46, hx: 0 },
    intro: { lean: 0, head: 6, aF1: -6, aF2: 36, aB1: -12, aB2: 30, fF: [0.08, 0], fB: [-0.08, 0], hipH: 0.47 },
    win: { lean: -4, head: 10, aF1: 40, aF2: 150, aB1: -12, aB2: 30, fF: [0.08, 0], fB: [-0.1, 0], hipH: 0.47 },
    winLine: 'Hmph. Dinner is served.', winJp: 'おそまつさま。', tagJp: 'おれがいく。', tagLine: 'Allow me.',
    assist: 'sF',
    moves: {
      L: M({ name: 'Snap Kick', startup: 5, active: 3, recovery: 9, dmg: 40, box: { seg: ['knF', 'ftF'], r: 0.07 },
        keys: K({ lF1: 70, lF2: -20, fF: null }, { lean: -12, lF1: 92, lF2: 96, fF: null, fB: [-0.05, 0] }, 5, 3, 9) }),
      H: M({ name: 'Collier Shoot', startup: 10, active: 4, recovery: 18, dmg: 85, hitstun: 21, blockstun: 15, hitstop: 10, kb: [3.4, 1.2], box: { seg: ['knF', 'ftF'], r: 0.08 },
        sfx: 'whiffH', hitSfx: 'hitM', shake: 2,
        keys: K({ lean: -10, lF1: 100, lF2: 20, fF: null }, { lean: -34, head: 14, lF1: 128, lF2: 132, fF: null, fB: [0.0, 0], hipH: 0.47 }, 10, 4, 18) }),
      cL: M({ name: 'Low Sweep', startup: 6, active: 3, recovery: 10, dmg: 36, guard: 'low', box: { seg: ['knF', 'ftF'], r: 0.07 },
        keys: K(null, { lean: -30, head: 10, hipH: 0.24, lF1: 84, lF2: 92, fB: [-0.12, 0], aF1: -40, aF2: -20 }, 6, 3, 10) }),
      cH: M({ name: 'Flanchet Shoot', startup: 9, active: 5, recovery: 22, dmg: 72, hitstun: 26, hitstop: 10, kb: [0.8, 8.4], launch: true, box: { seg: ['knF', 'ftF'], r: 0.09 },
        sfx: 'whiffH', hitSfx: 'hitM', shake: 2,
        keys: K(P.crouch, { lean: -30, head: 10, hipH: 0.46, lF1: 165, lF2: 172, fB: [0.02, 0] }, 9, 5, 22) }),
      jL: M({ name: 'Air Kick', startup: 5, active: 5, recovery: 8, dmg: 40, air: true, kb: [1.4, 1.5], box: { seg: ['knF', 'ftF'], r: 0.1 },
        keys: K(null, Object.assign({}, P.jumpFall, { lean: -6, lF1: 62, lF2: 48, aF1: -8, aF2: 38, aB1: -14, aB2: 30 }), 5, 5, 8) }),
      jH: M({ name: 'Concassé', startup: 10, active: 6, recovery: 14, dmg: 78, air: true, guard: 'high', hitstun: 20, hitstop: 12, kb: [1.8, -3], groundBounce: true,
        box: { seg: ['knF', 'ftF'], r: 0.1 }, sfx: 'whiffH', hitSfx: 'hitH', shake: 3,
        keys: K(Object.assign({}, P.jumpUp, { lean: -20, lF1: 175, lF2: 180 }), Object.assign({}, P.jumpFall, { lean: 18, lF1: 70, lF2: 40 }), 10, 6, 14) }),
      sN: M({ name: 'Diable Jambe: Premier Hache', shout: 'Diable Jambe... Premier Hache!', kind: 'special', startup: 14, active: 5, recovery: 22, dmg: 115, hitstun: 26, blockstun: 17, hitstop: 12, kb: [5, 2.8], knockdown: true,
        box: { seg: ['knF', 'ftF'], r: 0.11 }, fire: true, sfx: 'fire', hitSfx: 'hitH', spark: 'fire', shake: 4,
        keys: K({ lean: 10, lF1: -40, lF2: -80, fF: null, hipH: 0.44 }, { lean: -36, head: 14, lF1: 118, lF2: 122, fF: null, fB: [0.02, 0], hipH: 0.46 }, 14, 5, 22), expr: 'intense' }),
      sF: M({ name: 'Mouton Shot', shout: 'Mouton... Shot!', kind: 'special', startup: 12, active: 14, recovery: 18, dmg: 34, hits: 3, every: 5, hitstun: 16, hitstop: 6, kb: [1.2, 0],
        last: { kb: [4.6, 3], knockdown: true, hitstun: 26, hitstop: 12, hitSfx: 'hitH' }, vel: [{ from: 10, to: 26, vx: 7 }], box: { seg: ['knF', 'ftF'], r: 0.14 }, sfx: 'whiffH', hitSfx: 'hitM', shake: 2, trail: true,
        keys: K({ lean: 20, hipH: 0.36, fF: [0.2, 0] }, { lean: -84, head: 6, hipH: 0.5, lF1: 88, lF2: 90, lB1: 80, lB2: 86 }, 12, 14, 18), expr: 'determined' }),
      sU: M({ name: 'Sky Walk', shout: 'Sky Walk!', kind: 'special', startup: 5, active: 16, recovery: 14, dmg: 30, hits: 3, every: 5, hitstun: 20, hitstop: 5, kb: [0.6, 6.5], launch: true,
        last: { kb: [1.4, 7.6], hitstun: 30, hitstop: 10 }, invuln: [1, 6], air: true, ground: true, vel: [{ from: 5, to: 6, vy: 8.5, vx: 1.2, impulse: true }], airEnd: true,
        box: { seg: ['knF', 'ftF'], r: 0.12 }, sfx: 'jump', hitSfx: 'hitM', trail: true,
        keys: [{ f: 0, p: {} }, { f: 4, p: P.squat }, { f: 8, p: Object.assign({}, P.jumpUp, { lF1: 150, lF2: 160, lB1: -20, lB2: -30 }) },
          { f: 13, p: Object.assign({}, P.jumpUp, { lF1: -10, lF2: -30, lB1: 150, lB2: 160 }) }, { f: 18, p: Object.assign({}, P.jumpUp, { lF1: 150, lF2: 160, lB1: -20, lB2: -30 }) }, { f: 35, p: P.jumpFall }], expr: 'shout' }),
      sD: M({ name: 'Party Table Kick Course', shout: 'Party Table... Kick Course!', kind: 'special', startup: 10, active: 24, recovery: 18, dmg: 22, hits: 6, every: 4, hitstun: 18, hitstop: 4, kb: [0.8, 4],
        last: { kb: [3.2, 6.5], hitstun: 30, knockdown: true, hitstop: 10 }, box: { custom: 'tableKick', r: 0.5 }, sfx: 'whiffH', hitSfx: 'hitM', invuln: [3, 12],
        keys: [{ f: 0, p: {} }, { f: 8, p: { lean: 120, head: 0, hipH: 0.5, aF1: 20, aF2: 10, aB1: 10, aB2: 5, lF1: 150, lF2: 160, lB1: -100, lB2: -120 } },
          { f: 12, p: { lean: 178, head: 0, hipH: 0.58, aF1: 4, aF2: 0, aB1: -4, aB2: 0, lF1: 110, lF2: 110, lB1: -110, lB2: -110 } },
          { f: 18, p: { lean: 178, head: 0, hipH: 0.58, aF1: 4, aF2: 0, aB1: -4, aB2: 0, lF1: 160, lF2: 170, lB1: -160, lB2: -170 } },
          { f: 24, p: { lean: 178, head: 0, hipH: 0.58, aF1: 4, aF2: 0, aB1: -4, aB2: 0, lF1: 110, lF2: 110, lB1: -110, lB2: -110 } },
          { f: 30, p: { lean: 178, head: 0, hipH: 0.58, aF1: 4, aF2: 0, aB1: -4, aB2: 0, lF1: 160, lF2: 170, lB1: -160, lB2: -170 } },
          { f: 34, p: { lean: 178, head: 0, hipH: 0.58, aF1: 4, aF2: 0, aB1: -4, aB2: 0, lF1: 110, lF2: 110, lB1: -110, lB2: -110 } },
          { f: 44, p: P.getup }, { f: 52, p: {} }], expr: 'determined' }),
      X: M({ name: 'Diable Jambe: Hell Memories', shout: 'Diable Jambe... Hell Memories!', kind: 'hyper', startup: 16, active: 5, recovery: 32, dmg: 240, chip: 36, hitstun: 50, blockstun: 22, hitstop: 24,
        kb: [7.5, 5], knockdown: true, wallBounce: true, invuln: [0, 20], fire: true, burn: 300, box: { seg: ['knF', 'ftF'], r: 0.16 }, sfx: 'fire', hitSfx: 'hitH', spark: 'fire', shake: 12, don: true,
        proj: { at: 17, kind: 'fireburst', vx: 6.5, y: 1.0, r: 0.35, grow: 0.05, maxR: 1.35, life: 34, dmg: 70, burn: 300, kb: [3.5, 3], hitstun: 30, knockdown: true },
        keys: K({ lean: 10, lF1: -60, lF2: -100, fF: null, hipH: 0.44 }, { lean: -40, head: 16, lF1: 110, lF2: 120, fF: null, fB: [0.02, 0], hipH: 0.46 }, 16, 4, 34), expr: 'intense' }),
    },
  };

  // ======================================================================
  const NAMI = {
    id: 'nami', name: 'Nami', short: 'NAMI', title: 'Cat Burglar',
    quote: "Weather is science. Don't underestimate it!", quoteJp: 'てんきは…かがくよ！ なめないで！',
    height: 1.70, mass: 50, hp: 950, walk: 2.1, backWalk: 1.75, dash: 6.8, jumpH: 1.6, airJumps: 0, restitution: 0.3,
    voice: { pitch: 1.15, rate: 1.08, gender: 'f' },
    flags: { staffBack: false }, weapon: 'climatact',
    pal: [
      { skin: '#f4c7a0', hair: '#ff8a1f', top: '#ffffff', stripe: '#2a6fd6', pants: '#3a4f8f', sandal: '#c9955e', staff: '#3b82d6', tattoo: '#3a78c8', eye: '#6b3a1a' },
      { skin: '#f4c7a0', hair: '#ff5e3a', top: '#ffffff', stripe: '#e2356e', pants: '#2b2b2b', sandal: '#8a5a2e', staff: '#9b59d6', tattoo: '#3a78c8', eye: '#6b3a1a' },
    ],
    stance: { lean: 4, head: -2, aF1: 40, aF2: 100, staff: 28, aB1: 22, aB2: 80, fF: [0.13, 0], fB: [-0.12, 0], hipH: 0.45, hx: 0 },
    intro: { lean: -4, head: 8, aF1: 150, aF2: 170, staff: 180, aB1: -10, aB2: 40, fF: [0.1, 0], fB: [-0.1, 0], hipH: 0.47 },
    win: { lean: -6, head: 10, aF1: 160, aF2: 175, staff: 90, aB1: 20, aB2: 140, fF: [0.08, 0], fB: [-0.12, 0], hipH: 0.47 },
    winLine: "That'll be one hundred thousand berries!", winJp: 'じゅうまんベリー、はらってもらうわよ！', tagJp: 'わたしのばんよ！', tagLine: 'My turn!',
    assist: 'sN',
    moves: {
      L: M({ name: 'Staff Poke', startup: 5, active: 3, recovery: 9, dmg: 34, box: { staff: 'tip', r: 0.07 },
        keys: K(null, { lean: 18, aF1: 88, aF2: 90, staff: 90, aB1: 30, aB2: 70 }, 5, 3, 9) }),
      H: M({ name: 'Clima-Tact Swing', startup: 10, active: 5, recovery: 18, dmg: 72, hitstun: 20, blockstun: 15, hitstop: 9, kb: [3.2, 0.8], box: { staff: 'full', r: 0.08 },
        sfx: 'whiffH', hitSfx: 'hitM', shake: 2,
        keys: K({ lean: -6, aF1: 160, aF2: 175, staff: 190 }, { lean: 22, aF1: 80, aF2: 70, staff: 60, fF: [0.24, 0], hipH: 0.4 }, 10, 5, 18) }),
      cL: M({ name: 'Low Sweep', startup: 6, active: 3, recovery: 10, dmg: 34, guard: 'low', box: { staff: 'tip', r: 0.07 },
        keys: K(null, Object.assign({}, P.crouch, { lean: 24, aF1: 70, aF2: 60, staff: 75 }), 6, 3, 10) }),
      cH: M({ name: 'Rising Staff', startup: 9, active: 5, recovery: 22, dmg: 68, hitstun: 26, hitstop: 10, kb: [0.8, 8.4], launch: true, box: { staff: 'full', r: 0.08 },
        sfx: 'whiffH', hitSfx: 'hitM', shake: 2,
        keys: K(Object.assign({}, P.crouch, { aF1: 20, aF2: 20, staff: 20 }), { lean: -2, hipH: 0.47, aF1: 138, aF2: 145, staff: 140 }, 9, 5, 22) }),
      jL: M({ name: 'Air Poke', startup: 5, active: 5, recovery: 8, dmg: 36, air: true, kb: [1.4, 1.5], box: { staff: 'tip', r: 0.1 },
        keys: K(null, Object.assign({}, P.jumpFall, { lean: 14, aF1: 60, aF2: 48, staff: 45 }), 5, 5, 8) }),
      jH: M({ name: 'Staff Crash', startup: 9, active: 6, recovery: 14, dmg: 68, air: true, guard: 'high', hitstun: 20, hitstop: 10, kb: [2, -2.2], groundBounce: true, box: { staff: 'full', r: 0.09 },
        sfx: 'whiffH', hitSfx: 'hitM', shake: 2,
        keys: K(Object.assign({}, P.jumpUp, { aF1: 170, aF2: 180, staff: 190 }), Object.assign({}, P.jumpFall, { lean: 24, aF1: 70, aF2: 40, staff: 40 }), 9, 6, 14) }),
      sN: M({ name: 'Thunderbolt Tempo', shout: 'Thunderbolt Tempo!', kind: 'special', startup: 14, active: 2, recovery: 18, dmg: 100, hitstun: 30, blockstun: 16, hitstop: 12, kb: [0.6, 6.5], launch: true, guard: 'high',
        proj: { at: 14, kind: 'cloud', track: true, y: 3.4, delay: 42, life: 60 }, sfx: 'charge', hitSfx: 'hitH', spark: 'bolt', shake: 4, noBox: true,
        keys: K({ lean: -6, aF1: 150, aF2: 170, staff: 180 }, { lean: 0, aF1: 175, aF2: 178, staff: 178, aB1: 150, aB2: 170 }, 14, 2, 18), expr: 'determined' }),
      sF: M({ name: 'Cyclone Tempo', shout: 'Cyclone Tempo!', kind: 'special', startup: 15, active: 2, recovery: 22, dmg: 24, hits: 3, every: 8, hitstun: 22, blockstun: 12, hitstop: 5, kb: [1.2, 3.5], launch: true,
        last: { kb: [2.6, 6.5], hitstun: 32 }, proj: { at: 15, kind: 'cyclone', vx: 5.2, y: 0.8, r: 0.45, len: 0.7, life: 75, hits: 3, every: 8 }, sfx: 'wind', hitSfx: 'hitM', spark: 'wind', noBox: true,
        keys: K({ lean: -4, aF1: 40, aF2: 20, staff: 10 }, { lean: 20, aF1: 92, aF2: 90, staff: 90, fF: [0.26, 0], hipH: 0.4 }, 15, 2, 22), expr: 'determined' }),
      sU: M({ name: 'Thunder Lance Tempo', shout: 'Thunder Lance Tempo!', kind: 'special', startup: 9, active: 2, recovery: 24, dmg: 90, hitstun: 26, blockstun: 16, hitstop: 12, kb: [1.6, 7.5], launch: true, invuln: [1, 9],
        proj: { at: 9, kind: 'lance', vx: 12, vy: 12, y: 1.2, r: 0.12, len: 0.6, life: 26 }, sfx: 'thunder', hitSfx: 'hitH', spark: 'bolt', shake: 3, noBox: true,
        keys: K({ lean: 10, aF1: 30, aF2: 30, staff: 40 }, { lean: -10, aF1: 140, aF2: 135, staff: 135, fF: [0.2, 0], hipH: 0.44 }, 9, 2, 24), expr: 'shout' }),
      sD: M({ name: 'Mirage Tempo', shout: 'Mirage Tempo!', kind: 'special', startup: 12, active: 12, recovery: 10, dmg: 0, invuln: [3, 26], teleport: 13, noBox: true, sfx: 'wind',
        keys: [{ f: 0, p: {} }, { f: 10, p: { lean: 0, aF1: 175, aF2: 178, staff: 90 } }, { f: 24, p: { lean: 0, aF1: 175, aF2: 178, staff: 90 } }, { f: 34, p: {} }], expr: 'smug' }),
      X: M({ name: 'Zeus Breeze Tempo', shout: 'Zeus... Breeze Tempo!', kind: 'hyper', startup: 16, active: 2, recovery: 30, dmg: 110, chip: 20, hitstun: 44, blockstun: 16, hitstop: 12, kb: [0.6, 7.5], launch: true, guard: 'high',
        invuln: [0, 20], proj: { at: 16, kind: 'zeus', y: 3.6, delay: 16, life: 50, spread: [-1.3, 0, 1.3], stagger: 9 }, sfx: 'thunder', hitSfx: 'hitH', spark: 'bolt', shake: 8, don: true, noBox: true,
        keys: K({ lean: -10, aF1: 150, aF2: 170, staff: 180 }, { lean: -4, head: 10, aF1: 178, aF2: 180, staff: 180, aB1: 160, aB2: 175 }, 16, 2, 30), expr: 'smug' }),
    },
  };

  // ======================================================================
  // Usopp: holds the Kabuto (a staff-length slingshot) in his back hand, punches with the front.
  const aim = { lean: 6, aF1: -30, aF2: -70, aB1: 92, aB2: 92, staff: 150 };
  const release = { lean: 14, aF1: 85, aF2: 95, aB1: 92, aB2: 92, staff: 150, fF: [0.2, 0] };
  const USOPP = {
    id: 'usopp', name: 'Usopp', short: 'USOPP', title: 'King of Snipers',
    quote: 'I am Captain Usopp, brave warrior of the sea!', quoteJp: 'おれは…ゆうかんなるうみのせんし、キャプテン・ウソップだ！',
    height: 1.74, mass: 62, hp: 950, walk: 2.0, backWalk: 1.7, dash: 6.4, jumpH: 1.65, airJumps: 0, restitution: 0.3,
    voice: { pitch: 1.1, rate: 1.15, gender: 'm' },
    weapon: 'kabuto', staffHand: 'B',
    pal: [
      { skin: '#b87a4b', hair: '#1a1410', overalls: '#7a5a34', shirt: '#e9e2cf', boots: '#4a2e18', goggles: '#3fbf7f', band: '#d9c89a', staff: '#8a5a2b', eye: '#1c1414' },
      { skin: '#b87a4b', hair: '#1a1410', overalls: '#3a5a8a', shirt: '#f2d45c', boots: '#2e2e2e', goggles: '#e05a3a', band: '#e9e2cf', staff: '#5a3a1b', eye: '#1c1414' },
    ],
    stance: { lean: 4, head: -4, aF1: 30, aF2: 125, aB1: 10, aB2: 70, staff: 160, fF: [0.13, 0], fB: [-0.12, 0], hipH: 0.45, hx: 0 },
    intro: { lean: -8, head: 10, aF1: 150, aF2: 175, aB1: 20, aB2: 80, staff: 170, fF: [0.12, 0], fB: [-0.12, 0], hipH: 0.47 },
    win: { lean: -10, head: 12, aF1: 165, aF2: 178, aB1: 10, aB2: 70, staff: 165, fF: [0.1, 0], fB: [-0.14, 0], hipH: 0.47 },
    winLine: "S-see that?! It all went according to my plan!", winJp: 'み、みたか！ ぜんぶ…けいかくどおりだ！', tagJp: 'ま、まかせとけ！', tagLine: 'L-leave it to me!',
    assist: 'sN',
    moves: {
      L: M({ name: 'Punch', startup: 5, active: 3, recovery: 8, dmg: 38, box: { seg: ['elF', 'haF'], r: 0.07 },
        keys: K({ lean: 2, aF1: 20, aF2: 150 }, { lean: 16, aF1: 88, aF2: 90 }, 5, 3, 8) }),
      H: M({ name: 'Kabuto Whack', startup: 11, active: 4, recovery: 19, dmg: 80, hitstun: 21, blockstun: 15, hitstop: 11, kb: [3.3, 0.6], box: { staff: 'full', r: 0.09 },
        sfx: 'whiffH', hitSfx: 'hitM', shake: 3,
        keys: K({ lean: -10, aB1: 165, aB2: 195, staff: 205 }, { lean: 24, aB1: 96, aB2: 78, staff: 62, fF: [0.26, 0], hipH: 0.4 }, 11, 4, 19) }),
      cL: M({ name: 'Low Kick', startup: 6, active: 3, recovery: 10, dmg: 34, guard: 'low', box: { seg: ['knF', 'ftF'], r: 0.07 },
        keys: K(null, Object.assign({}, P.crouch, { lean: 6, lF1: 80, lF2: 88, fF: null, staff: 120 }), 6, 3, 10) }),
      cH: M({ name: 'Kabuto Uppercut', startup: 10, active: 5, recovery: 22, dmg: 70, hitstun: 26, hitstop: 10, kb: [0.8, 8.4], launch: true, box: { staff: 'full', r: 0.09 },
        sfx: 'whiffH', hitSfx: 'hitM', shake: 2,
        keys: K(Object.assign({}, P.crouch, { aB1: 30, aB2: 20, staff: 20 }), { lean: -2, hipH: 0.47, aB1: 138, aB2: 145, staff: 140 }, 10, 5, 22) }),
      jL: M({ name: 'Air Punch', startup: 5, active: 5, recovery: 8, dmg: 36, air: true, kb: [1.4, 1.5], box: { seg: ['elF', 'haF'], r: 0.1 },
        keys: K(null, Object.assign({}, P.jumpFall, { lean: 24, aF1: 45, aF2: 32, staff: 150 }), 5, 5, 8) }),
      jH: M({ name: 'Kabuto Crash', startup: 10, active: 6, recovery: 14, dmg: 70, air: true, guard: 'high', hitstun: 20, hitstop: 10, kb: [2, -2], groundBounce: true, box: { staff: 'full', r: 0.11 },
        sfx: 'whiffH', hitSfx: 'hitM', shake: 2,
        keys: K(Object.assign({}, P.jumpUp, { aB1: 170, aB2: 185, staff: 195 }), Object.assign({}, P.jumpFall, { lean: 24, aB1: 70, aB2: 40, staff: 40 }), 10, 6, 14) }),
      sN: M({ name: 'Hissatsu: Lead Star', shout: 'Hissatsu... Lead Star!', kind: 'special', startup: 13, active: 2, recovery: 18, dmg: 80, hitstun: 22, blockstun: 14, hitstop: 9, kb: [2.6, 1],
        proj: { at: 13, kind: 'pellet', vx: 15, y: 1.25, r: 0.08, len: 0.14, life: 50 }, sfx: 'snap', hitSfx: 'hitM', noBox: true,
        keys: K(aim, release, 13, 2, 18), expr: 'determined' }),
      sF: M({ name: 'Hissatsu: Exploding Star', shout: 'Hissatsu... Exploding Star!', kind: 'special', startup: 16, active: 2, recovery: 22, dmg: 95, hitstun: 30, blockstun: 16, hitstop: 12, kb: [4, 4], knockdown: true,
        proj: { at: 16, kind: 'pellet', explode: true, vx: 9, y: 1.2, r: 0.11, len: 0.12, life: 70 }, sfx: 'snap', hitSfx: 'hitH', spark: 'fire', shake: 4, noBox: true,
        keys: K(aim, release, 16, 2, 22), expr: 'shout' }),
      sU: M({ name: 'Hissatsu: Sky Shot', shout: 'Hissatsu... Sky Shot!', kind: 'special', startup: 11, active: 2, recovery: 22, dmg: 72, hitstun: 26, blockstun: 14, hitstop: 10, kb: [1, 6.5], launch: true,
        proj: { at: 11, kind: 'pellet', vx: 9, vy: 10.5, y: 1.4, r: 0.1, len: 0.14, life: 40 }, sfx: 'snap', hitSfx: 'hitM', noBox: true,
        keys: K(Object.assign({}, aim, { aB1: 140, aB2: 140, staff: 175 }), Object.assign({}, release, { aB1: 140, aB2: 140, aF1: 130, aF2: 135, staff: 175 }), 11, 2, 22), expr: 'determined' }),
      sD: M({ name: 'Hissatsu: Tabasco Star', shout: 'Hissatsu... Tabasco Star!', kind: 'special', startup: 14, active: 2, recovery: 20, dmg: 60, guard: 'low', hitstun: 36, blockstun: 14, hitstop: 9, kb: [1.2, 0],
        proj: { at: 14, kind: 'pellet', tabasco: true, vx: 11, y: 0.3, r: 0.09, len: 0.12, life: 60 }, sfx: 'snap', hitSfx: 'hitL', spark: 'fire', noBox: true,
        keys: K(Object.assign({}, P.crouch, { aF1: -30, aF2: -70, aB1: 80, aB2: 85, staff: 120 }), Object.assign({}, P.crouch, { aF1: 80, aF2: 88, aB1: 80, aB2: 85, staff: 120 }), 14, 2, 20), expr: 'smug' }),
      // Heat-seeking firebird: bigger than Lead Star, steers toward the opponent, hits a bit harder.
      X: M({ name: 'Hissatsu: Firebird Star', shout: 'Hissatsu... Firebird Star!', kind: 'hyper', startup: 18, active: 2, recovery: 26, dmg: 135, chip: 20, hitstun: 44, blockstun: 20, hitstop: 16, kb: [4, 5.5], knockdown: true,
        invuln: [0, 18], proj: { at: 18, kind: 'firebird', vx: 7.5, y: 1.3, r: 0.42, len: 0.5, life: 220, homing: 0.075 }, sfx: 'fire', hitSfx: 'hitH', spark: 'fire', shake: 8, don: true, noBox: true,
        keys: K(aim, release, 18, 2, 26), expr: 'intense' }),
    },
  };

  // ======================================================================
  // Chopper: three forms share one move list. Brain Point is tiny; Heavy Point (Rumble!) is a
  // big man-form with +5% damage; Monster Point is a giant beast with +25% damage and super
  // armour. Two clean hits taken in a big form shrink him back to Brain Point.
  const CHOPPER = {
    id: 'chopper', name: 'Tony Tony Chopper', short: 'CHOPPER', title: 'Cotton Candy Lover',
    quote: "I'm a reindeer... and a doctor!", quoteJp: 'おれは…トナカイで、いしゃだ！',
    height: 1.0, mass: 32, hp: 950, walk: 1.9, backWalk: 1.6, dash: 6.2, jumpH: 1.7, airJumps: 0, restitution: 0.5,
    props: { headR: 0.17, torso: 0.2, ua: 0.14, fa: 0.13, foot: 0.1 }, bulk: 1.7, boxScale: 0.8, dmgMul: 1, form: 'brain',
    voice: { pitch: 1.55, rate: 1.15, gender: 'f' },
    pal: [
      { skin: '#4a3222', fur: '#9a6a44', furLight: '#ecd0a8', shorts: '#d9546e', hat: '#ff8fb8', hatX: '#ffffff', nose: '#3a7fe0', antler: '#b5834e', eye: '#1c1414' },
      { skin: '#4a3222', fur: '#8a5a3a', furLight: '#ecd0a8', shorts: '#4a8ad9', hat: '#ffb347', hatX: '#ffffff', nose: '#3a7fe0', antler: '#b5834e', eye: '#1c1414' },
    ],
    stance: { lean: 6, head: -4, aF1: 40, aF2: 120, aB1: 20, aB2: 100, fF: [0.12, 0], fB: [-0.11, 0], hipH: 0.44, hx: 0 },
    intro: { lean: -6, head: 10, aF1: 160, aF2: 175, aB1: 150, aB2: 170, fF: [0.1, 0], fB: [-0.1, 0], hipH: 0.46 },
    win: { lean: -8, head: 12, aF1: 150, aF2: 190, aB1: 140, aB2: 175, fF: [0.12, 0], fB: [-0.12, 0], hipH: 0.46 },
    winLine: "C-calling me cute won't make me happy, jerk!", winJp: 'ほめられたって…うれしくねぇぞ、コノヤロー！', tagJp: 'おれがいく！', tagLine: "I'll go!",
    assist: 'sF',
    moves: {
      L: M({ name: 'Hoof Punch', startup: 5, active: 3, recovery: 8, dmg: 36, box: { seg: ['elF', 'haF'], r: 0.07 },
        keys: K({ lean: 2, aF1: 20, aF2: 150 }, { lean: 16, aF1: 88, aF2: 90 }, 5, 3, 8) }),
      H: M({ name: 'Claw Swipe', startup: 10, active: 5, recovery: 18, dmg: 74, hitstun: 20, blockstun: 15, hitstop: 10, kb: [3, 0.4],
        box: { segs: [['elF', 'haF'], ['elB', 'haB']], r: 0.1 }, sfx: 'whiffH', hitSfx: 'hitSlash', spark: 'slash', shake: 2,
        keys: K({ lean: -8, aF1: 155, aF2: 175, aB1: 145, aB2: 168 }, { lean: 28, aF1: 84, aF2: 42, aB1: 78, aB2: 36, fF: [0.24, 0], hipH: 0.4 }, 10, 5, 18) }),
      cL: M({ name: 'Low Hoof', startup: 6, active: 3, recovery: 10, dmg: 34, guard: 'low', box: { seg: ['knF', 'ftF'], r: 0.08 },
        keys: K(null, Object.assign({}, P.crouch, { lean: 6, lF1: 80, lF2: 88, fF: null }), 6, 3, 10) }),
      cH: M({ name: 'Antler Toss', startup: 10, active: 5, recovery: 22, dmg: 70, hitstun: 26, hitstop: 10, kb: [0.8, 8.4], launch: true, box: { segs: [['neck', 'head'], ['elF', 'haF']], r: 0.16 },
        sfx: 'whiffH', hitSfx: 'hitM', shake: 2,
        keys: K(Object.assign({}, P.crouch, { lean: 40, head: 20 }), { lean: 22, head: -35, hipH: 0.47, aF1: 130, aF2: 150, aB1: -40, aB2: -20 }, 10, 5, 22) }),
      jL: M({ name: 'Air Hoof', startup: 5, active: 5, recovery: 8, dmg: 36, air: true, kb: [1.4, 1.5], box: { seg: ['elF', 'haF'], r: 0.1 },
        keys: K(null, Object.assign({}, P.jumpFall, { lean: 22, aF1: 55, aF2: 40 }), 5, 5, 8) }),
      jH: M({ name: 'Heavy Stomp', startup: 10, active: 6, recovery: 14, dmg: 70, air: true, guard: 'high', hitstun: 20, hitstop: 11, kb: [1.8, -2.5], groundBounce: true,
        box: { segs: [['knF', 'ftF'], ['knB', 'ftB']], r: 0.11 }, sfx: 'whiffH', hitSfx: 'hitH', shake: 3,
        keys: K(Object.assign({}, P.jumpUp, { lF1: 120, lF2: 60 }), Object.assign({}, P.jumpFall, { lean: 10, lF1: 20, lF2: 5, lB1: 5, lB2: -5 }), 10, 6, 14) }),
      sN: M({ name: 'Rumble! Heavy Point', shout: 'Rumble! ... Heavy Point!', kind: 'special', startup: 18, active: 1, recovery: 12, dmg: 0, invuln: [0, 24], transform: { at: 12, form: 'heavy' }, noBox: true, sfx: 'charge',
        keys: [{ f: 0, p: {} }, { f: 10, p: { lean: 20, head: 20, aF1: 20, aF2: 10, aB1: 10, aB2: 0, hipH: 0.38 } }, { f: 16, p: { lean: -10, head: -10, aF1: 150, aF2: 170, aB1: 140, aB2: 165 } }, { f: 31, p: {} }], expr: 'shout' }),
      sN2: M({ name: 'Heavy Gong', shout: 'Heavy... Gong!', kind: 'special', startup: 13, active: 5, recovery: 22, dmg: 110, hitstun: 26, blockstun: 17, hitstop: 13, kb: [5, 2.4], knockdown: true,
        box: { seg: ['elF', 'haF'], r: 0.1 }, sfx: 'whiffH', hitSfx: 'hitH', shake: 5,
        keys: K({ lean: -10, aF1: -60, aF2: -100, fB: [-0.2, 0] }, { lean: 26, aF1: 92, aF2: 90, aB1: -30, aB2: 10, fF: [0.3, 0], hipH: 0.39 }, 13, 5, 22), expr: 'shout' }),
      sF: M({ name: 'Kokutei Roseo', shout: 'Kokutei... Roseo!', kind: 'special', startup: 11, active: 8, recovery: 20, dmg: 100, hitstun: 28, blockstun: 16, hitstop: 12, kb: [4.4, 3], knockdown: true,
        vel: [{ from: 8, to: 18, vx: 7.5 }], box: { seg: ['elF', 'haF'], r: 0.12 }, sfx: 'dash', hitSfx: 'hitH', shake: 4, trail: true,
        keys: K({ lean: 10, aF1: -50, aF2: -70, hipH: 0.38 }, { lean: 30, aF1: 92, aF2: 88, aB1: -40, aB2: -20, fF: [0.32, 0], fB: [-0.28, 0.04], hipH: 0.36 }, 11, 8, 20), expr: 'determined' }),
      sU: M({ name: 'Horn Point', shout: 'Horn Point!', kind: 'special', startup: 7, active: 14, recovery: 16, dmg: 90, hitstun: 30, hitstop: 11, kb: [1.2, 8], launch: true, invuln: [1, 9],
        vel: [{ from: 7, to: 8, vx: 1.5, vy: 6.5, impulse: true }], airEnd: true, box: { seg: ['neck', 'head'], r: 0.2 }, sfx: 'jump', hitSfx: 'hitH', shake: 3,
        keys: [{ f: 0, p: {} }, { f: 6, p: Object.assign({}, P.squat, { lean: 40, head: 25 }) }, { f: 10, p: Object.assign({}, P.jumpUp, { lean: -10, head: -25, aF1: -40, aF2: -20, aB1: -50, aB2: -30 }) }, { f: 37, p: P.jumpFall }], expr: 'shout' }),
      sD: M({ name: 'Guard Point', shout: 'Guard Point!', kind: 'special', startup: 4, active: 26, recovery: 12, dmg: 0, armor: { from: 4, to: 30, mul: 0.4 }, noBox: true, sfx: 'charge',
        keys: [{ f: 0, p: {} }, { f: 4, p: { lean: 30, head: 10, aF1: 30, aF2: 150, aB1: 20, aB2: 140, hipH: 0.34, fF: [0.14, 0], fB: [-0.14, 0] } }, { f: 30, p: { lean: 30, head: 10, aF1: 30, aF2: 150, aB1: 20, aB2: 140, hipH: 0.34, fF: [0.14, 0], fB: [-0.14, 0] } }, { f: 42, p: {} }], expr: 'grit' }),
      X: M({ name: 'Monster Point', shout: 'Rumble! ... Monster Point!', kind: 'hyper', startup: 26, active: 1, recovery: 14, dmg: 0, invuln: [0, 34], transform: { at: 18, form: 'monster' }, noBox: true, sfx: 'charge', shake: 10, don: true,
        keys: [{ f: 0, p: {} }, { f: 14, p: { lean: 30, head: 20, aF1: 10, aF2: 0, aB1: 0, aB2: -10, hipH: 0.36 } }, { f: 22, p: { lean: -16, head: -20, aF1: 160, aF2: 180, aB1: 150, aB2: 175 } }, { f: 41, p: {} }], expr: 'intense', cutExpr: 'shout' }),
    },
  };
  // Heavy Point and Monster Point: same moves, bigger body (hurt- and hitboxes scale with height).
  const HEAVY = Object.assign({}, CHOPPER, { form: 'heavy', height: 2.1, mass: 140, walk: 1.5, backWalk: 1.2, dash: 5.2, jumpH: 1.25, restitution: 0.2,
    props: null, bulk: 1.35, boxScale: 1.2, dmgMul: 1.05, formHits: 2, voice: { pitch: 0.9, rate: 1.0, gender: 'm' } });
  const MONSTER = Object.assign({}, CHOPPER, { form: 'monster', height: 3.4, mass: 420, walk: 1.15, backWalk: 0.9, dash: 4, jumpH: 0.9, restitution: 0.1,
    props: null, bulk: 1.45, boxScale: 1.9, dmgMul: 1.25, formHits: 2, armor: true, voice: { pitch: 0.5, rate: 0.9, gender: 'm' } });
  OP.ChopperForms = { brain: CHOPPER, heavy: HEAVY, monster: MONSTER };
  for (const f of [HEAVY, MONSTER]) f.baseDef = CHOPPER;

  // Japanese call-outs, spoken with a Japanese voice when the device has one.
  const JP = {
    luffy: { sN: 'ゴムゴムの…ピストル！', sF: 'ゴムゴムの…ガトリング！', sU: 'ゴムゴムの…ロケット！', sD: 'ゴムゴムの…ムチ！', X: 'ギア・サード！ ゴムゴムの…ギガント・ピストル！' },
    zoro: { sN: 'さんじゅうろく…ポンドほう！', sF: 'さんとうりゅう…おにぎり！', sU: 'さんとうりゅう…たつまき！', sD: 'とうろうながし。', X: 'さんとうりゅう、おうぎ…さんぜんせかい！' },
    sanji: { sN: 'ディアブル・ジャンブ…プルミエール・アッシ！', sF: 'ムートン…ショット！', sU: 'スカイウォーク！', sD: 'パーティーテーブル…キックコース！', X: 'ディアブル・ジャンブ…ヘル・メモリーズ！' },
    nami: { sN: 'サンダーボルト・テンポ！', sF: 'サイクロン・テンポ！', sU: 'サンダーランス・テンポ！', sD: 'ミラージュ・テンポ！', X: 'ゼウス…ブリーズ・テンポ！' },
    usopp: { sN: 'ひっさつ…なまりぼし！', sF: 'ひっさつ…かやくぼし！', sU: 'ひっさつ…そらうち！', sD: 'ひっさつ…タバスコぼし！', X: 'ひっさつ…ひのとりぼし！' },
    chopper: { sN: 'ランブル！…ヘビーポイント！', sN2: 'ヘビー…ゴング！', sF: 'こくてい…ロゼオ！', sU: 'ホーンポイント！', sD: 'ガードポイント！', X: 'ランブル！…モンスターポイント！' },
  };

  // Tag-in dive attack shared by everyone.
  const TAG_ENTRY = M({ name: 'Tag Entry', startup: 0, active: 60, recovery: 0, dmg: 50, guard: 'high', hitstun: 18, hitstop: 9, kb: [2.4, 1], box: { seg: ['knF', 'ftF'], r: 0.12 }, hitSfx: 'hitM' });

  const ROSTER = [LUFFY, ZORO, SANJI, NAMI, USOPP, CHOPPER];
  for (const c of ROSTER) {
    c.flags = c.flags || {};
    for (const k in c.moves) { c.moves[k].key = k; if (JP[c.id] && JP[c.id][k]) c.moves[k].jp = JP[c.id][k]; }
  }
  OP.Roster = ROSTER;
  OP.RosterById = Object.fromEntries(ROSTER.map((c) => [c.id, c]));
  OP.TAG_ENTRY = TAG_ENTRY;
})(window.OP);
