/* Tank Dynamics — the tank roster and their weapons.
 *
 * Every tank has three shots: Shot 1 (reliable), Shot 2 (tricky), and an SS "super shot" that
 * charges as you deal and take damage. All numbers here are gameplay data — tune freely, then run
 *   node tank-dynamics/tools/playtest.js
 * to check no tank wins much more than its share.
 *
 * Weapon fields: dmg (at the centre), radius (blast, m), carve (crater radius, defaults to radius),
 * delay (turn delay cost), speed (muzzle speed multiplier), wind (how much wind pushes it),
 * kind: normal | bounce | split | multi | drill | freeze | meteor | laser | blackhole | goo | shock.
 */
'use strict';
(function (TD) {
  const W = (o) => Object.assign({ kind: 'normal', dmg: 250, radius: 3.2, delay: 0, speed: 1, wind: 1, grav: 1, size: 0.45 }, o);

  TD.TANKS = [
    {
      id: 'froggo', name: 'Froggo', tagline: 'The hoppiest hero in the Federation!',
      role: 'All-rounder', hp: 1000, armor: 0.05, speed: 2.4, fuel: 14, aimMin: 10, aimMax: 80,
      colors: { body: '#39c46a', dark: '#1f7a3f', accent: '#ffd23f', belly: '#c8f2a2', eye: '#1a1a1a' },
      weapons: [
        W({ id: 'lily', name: 'Lily Bomb', desc: 'A trusty lily-pad bomb.', dmg: 270, radius: 3.3, fx: 'leaf', color: '#5de08a' }),
        W({ id: 'hop', name: 'Hop Shot', desc: 'Bounces twice before popping. Great over hills!', kind: 'bounce', bounces: 2, dmg: 230, radius: 3.0, delay: 60, fx: 'leaf', color: '#9df06a' }),
        W({ id: 'croak', name: 'MEGA CROAK', desc: 'A huge sonic boom that knocks tanks away.', kind: 'shock', dmg: 420, radius: 5.8, push: 7, delay: 180, size: 0.8, fx: 'ring', color: '#b6ff5a' }),
      ],
    },
    {
      id: 'blaze', name: 'Blaze', tagline: 'A baby dragon with a big, fiery sneeze.',
      role: 'Heavy hitter', hp: 980, armor: 0.02, speed: 2.0, fuel: 12, aimMin: 15, aimMax: 75,
      colors: { body: '#ff5a3c', dark: '#a8241a', accent: '#ffb627', belly: '#ffe09a', eye: '#1a1a1a' },
      weapons: [
        W({ id: 'fireball', name: 'Fireball', desc: 'Hot, fast and hard-hitting.', dmg: 285, radius: 3.0, fx: 'fire', color: '#ff8a2a' }),
        W({ id: 'triple', name: 'Triple Flame', desc: 'Splits into three flames at the top of its arc.', kind: 'split', split: 3, spread: 5.5, dmg: 160, radius: 2.6, delay: 80, fx: 'fire', color: '#ffb02a' }),
        W({ id: 'meteor', name: 'DRAGON METEOR', desc: 'Calls five meteors down around the impact.', kind: 'meteor', count: 5, spreadM: 9, dmg: 180, radius: 3.0, subDmg: 150, delay: 200, size: 0.7, fx: 'fire', color: '#ff4a1a' }),
      ],
    },
    {
      id: 'frostbite', name: 'Frostbite', tagline: 'A cool penguin who keeps enemies frozen.',
      role: 'Controller', hp: 1040, armor: 0.08, speed: 2.2, fuel: 13, aimMin: 20, aimMax: 85,
      colors: { body: '#47b8ff', dark: '#1d5f9e', accent: '#ffffff', belly: '#eaf8ff', eye: '#1a1a1a', scarf: '#ff4f7b' },
      weapons: [
        W({ id: 'snowball', name: 'Snowball', desc: 'A packed snowball. Ouch!', dmg: 245, radius: 3.2, fx: 'snow', color: '#dff4ff' }),
        W({ id: 'freeze', name: 'Freeze Ray', desc: 'Freezes tanks it hits — they wait longer for their turn.', kind: 'freeze', freeze: 350, dmg: 160, radius: 3.6, delay: 60, wind: 0.5, fx: 'ice', color: '#8fe8ff' }),
        W({ id: 'blizzard', name: 'BLIZZARD', desc: 'A giant snowball that bursts into a freezing storm.', kind: 'split', split: 5, spread: 8, freeze: 250, dmg: 150, radius: 3.0, delay: 200, size: 0.8, fx: 'ice', color: '#c9f1ff' }),
      ],
    },
    {
      id: 'roborex', name: 'Robo Rex', tagline: 'Part robot, part T-rex, all awesome.',
      role: 'Digger', hp: 1060, armor: 0.08, speed: 1.8, fuel: 10, aimMin: 5, aimMax: 70,
      colors: { body: '#a0a8c0', dark: '#4a5068', accent: '#7c4dff', belly: '#d8dcf0', eye: '#39ffea' },
      weapons: [
        W({ id: 'bolt', name: 'Mega Bolt', desc: 'A heavy steel bolt.', dmg: 250, radius: 3.0, speed: 1.02, fx: 'spark', color: '#c0c8e0' }),
        W({ id: 'drill', name: 'Drill Missile', desc: 'Drills through the ground, then explodes underneath!', kind: 'drill', drill: 7, dmg: 270, radius: 3.0, delay: 70, fx: 'spark', color: '#ffcf3f' }),
        W({ id: 'laser', name: 'ORBITAL LASER', desc: 'A space laser blasts straight down where it lands.', kind: 'laser', beamW: 2.2, dmg: 200, radius: 2.4, beamDmg: 330, delay: 220, fx: 'laser', color: '#39ffea' }),
      ],
    },
    {
      id: 'nova', name: 'Nova', tagline: 'A sparkly star-unicorn from the galaxy.',
      role: 'Sharpshooter', hp: 940, armor: 0.04, speed: 2.6, fuel: 15, aimMin: 10, aimMax: 88,
      colors: { body: '#b36bff', dark: '#5b2aa8', accent: '#ff7ad9', belly: '#f3d9ff', eye: '#1a1a1a', mane: ['#ff7ad9', '#ffd23f', '#5de0ff'] },
      weapons: [
        W({ id: 'star', name: 'Star Shot', desc: 'A twinkling star.', dmg: 250, radius: 3.2, fx: 'star', color: '#ffe36b' }),
        W({ id: 'comet', name: 'Comet', desc: 'Ignores the wind completely. Pure aim!', wind: 0, dmg: 240, radius: 3.0, delay: 40, fx: 'star', color: '#8fdcff' }),
        W({ id: 'blackhole', name: 'BLACK HOLE', desc: 'Sucks nearby tanks toward it, then pops.', kind: 'blackhole', pull: 6, pullR: 14, dmg: 350, radius: 4.4, delay: 200, size: 0.7, fx: 'void', color: '#2a0f4a' }),
      ],
    },
    {
      id: 'bubbles', name: 'Bubbles', tagline: 'A bubbly octo-sub who loves a splash.',
      role: 'Builder', hp: 1080, armor: 0.07, speed: 2.2, fuel: 13, aimMin: 10, aimMax: 80,
      colors: { body: '#ff7eb6', dark: '#b8336f', accent: '#5de0ff', belly: '#ffe0ef', eye: '#1a1a1a' },
      weapons: [
        W({ id: 'bubble', name: 'Bubble Bomb', desc: 'Pop!', dmg: 265, radius: 3.5, fx: 'bubble', color: '#aef0ff' }),
        W({ id: 'goo', name: 'Goo Wall', desc: 'Builds a sticky hill where it lands — make your own cover.', kind: 'goo', gooR: 4.2, dmg: 90, radius: 2.2, delay: 40, fx: 'goo', color: '#ff9ed2' }),
        W({ id: 'barrage', name: 'BUBBLE BARRAGE', desc: 'Fires four bubble bombs in a row.', kind: 'multi', count: 4, gap: 14, jitter: 0.05, dmg: 140, radius: 2.8, delay: 200, fx: 'bubble', color: '#7fe6ff' }),
      ],
    },
  ];
  TD.tankById = (id) => TD.TANKS.find((t) => t.id === id) || TD.TANKS[0];
})(globalThis.TD);
