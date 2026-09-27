#!/usr/bin/env node
/* Headless play-testing: every tank fights every other tank on every map, CPU vs CPU, and we
 * report win rates, match length and damage so balance problems show up as numbers.
 *
 *   node tank-dynamics/tools/playtest.js            # quick (1 seed per pairing per map)
 *   node tank-dynamics/tools/playtest.js --seeds 4  # more thorough
 *   node tank-dynamics/tools/playtest.js --json     # machine-readable
 *   node tank-dynamics/tools/playtest.js --check    # exit 1 if a tank wins <30% or >70%, or a match never ends (CI)
 */
'use strict';
const { load, cpuMatch } = require('../tests/load.js');
const args = process.argv.slice(2);
const seeds = +(args[args.indexOf('--seeds') + 1] || 0) || 1;
const level = args.includes('--hard') ? 'hard' : args.includes('--easy') ? 'easy' : 'normal';
const TD = load();

function run() {
  const res = {}; const t0 = Date.now();
  for (const t of TD.TANKS) res[t.id] = { games: 0, wins: 0, dealt: 0, taken: 0, shots: 0, hits: 0, turns: 0 };
  let games = 0, turns = 0, frames = 0, draws = 0, timeouts = 0, longest = 0, shortest = 1e9;
  for (const a of TD.TANKS) for (const b of TD.TANKS) {
    if (a.id === b.id) continue;
    for (const map of TD.MAPS) for (let s = 0; s < seeds; s++) {
      const seed = (a.id.length * 131 + b.id.length * 17 + map.id.length * 7 + s * 1009 + games) >>> 0;
      const m = cpuMatch(TD, { seed, map: map.id, level, players: [{ tank: a.id, team: 0 }, { tank: b.id, team: 1 }] });
      games++; turns += m.turn; frames += m.framesRun;
      longest = Math.max(longest, m.turn); shortest = Math.min(shortest, m.turn);
      if (m.phase !== 'over') timeouts++;
      else if (m.winner < 0) draws++;
      for (const t of m.tanks) {
        const r = res[t.id]; r.games++; r.dealt += t.stats.dealt; r.taken += t.stats.taken; r.shots += t.stats.shots; r.hits += t.stats.hits;
        if (m.winner === t.team) r.wins++;
      }
    }
  }
  return { level, games, avgTurns: turns / games, avgMinutes: frames / games / 3600, longest, shortest, draws, timeouts, ms: Date.now() - t0,
    tanks: Object.fromEntries(Object.entries(res).map(([k, r]) => [k, { winRate: r.wins / r.games, avgDealt: r.dealt / r.games, accuracy: r.hits / Math.max(1, r.shots) }])) };
}

if (require.main === module) {
  const r = run();
  if (args.includes('--json')) { console.log(JSON.stringify(r, null, 2)); process.exit(0); }
  console.log(`Tank Dynamics play-test — ${r.games} CPU matches (${r.level}) in ${(r.ms / 1000).toFixed(1)} s`);
  console.log(`  avg ${r.avgTurns.toFixed(1)} turns (${r.shortest}–${r.longest}), ~${r.avgMinutes.toFixed(1)} min of game time, ${r.draws} draws, ${r.timeouts} unfinished`);
  for (const [id, t] of Object.entries(r.tanks)) {
    const flag = t.winRate > 0.65 || t.winRate < 0.35 ? '  <-- check balance' : '';
    console.log(`  ${id.padEnd(10)} win ${(t.winRate * 100).toFixed(0).padStart(3)}%  dmg/game ${t.avgDealt.toFixed(0).padStart(5)}  accuracy ${(t.accuracy * 100).toFixed(0)}%${flag}`);
  }
  if (args.includes('--check')) {
    const bad = Object.entries(r.tanks).filter(([, t]) => t.winRate < 0.3 || t.winRate > 0.7).map(([id]) => id);
    if (bad.length || r.timeouts) { console.log(`\nBALANCE CHECK FAILED: ${bad.join(', ') || ''}${r.timeouts ? ` ${r.timeouts} unfinished matches` : ''}`); process.exit(1); }
    console.log('\nbalance check passed');
  }
}
module.exports = { run };
