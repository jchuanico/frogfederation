/* Loads the Tank Dynamics simulation modules into a sandbox (no browser needed).
 * Used by tests/run.js and tools/playtest.js. */
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');
const SIM = ['core', 'terrain', 'tanks', 'game', 'ai', 'net'];
function load(extra = {}) {
  const sb = Object.assign({ console, Math, Date, setTimeout, clearTimeout, setInterval, clearInterval, Promise, Uint8Array, Float64Array, DataView, ArrayBuffer, JSON }, extra);
  sb.globalThis = sb;
  vm.createContext(sb);
  for (const f of SIM) {
    const file = path.join(__dirname, '..', 'js', f + '.js');
    if (fs.existsSync(file)) vm.runInContext(fs.readFileSync(file, 'utf8'), sb, { filename: file });
  }
  return sb.TD;
}
/** Run a CPU-vs-CPU match to the end; returns the match. */
function cpuMatch(TD, o) {
  const m = new TD.Match({ seed: o.seed, map: o.map, players: o.players.map((p) => Object.assign({ cpu: true }, p)), turnFrames: o.turnFrames });
  const brains = o.players.map((p, i) => new TD.AI.Brain(p.level || o.level || 'normal', (o.seed * 7 + i * 13) >>> 0));
  let f = 0; const maxF = o.maxFrames || 60 * 60 * 40;
  while (m.phase !== 'over' && f < maxF) {
    const a = m.needsInput();
    m.step(a >= 0 ? brains[a].bits(m) : 0);
    if (o.onFrame) o.onFrame(m);
    m.events.length = 0;
    f++;
  }
  m.framesRun = f;
  return m;
}
module.exports = { load, cpuMatch };
