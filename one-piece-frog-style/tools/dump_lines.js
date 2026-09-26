#!/usr/bin/env node
/* Prints every spoken line in the game as JSON (single source of truth: js/characters.js).
 * Used by make_voices.py to (re)generate the voice clips. */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const sb = { console, Math, JSON, Map, Set, WeakMap, Object, Array, Number, String, setTimeout() {}, setInterval() {}, clearInterval() {}, addEventListener() {}, navigator: {} };
sb.window = sb; vm.createContext(sb);
for (const f of ['core.js', 'audio.js', 'input.js', 'draw.js', 'characters.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), sb);
const out = {};
for (const c of sb.OP.Roster) {
  const lines = { quote: c.quoteJp, win: c.winJp, tag: c.tagJp };
  for (const [k, mv] of Object.entries(c.moves)) if (mv.jp) lines[k] = mv.jp;
  if (c.throw) lines.throw = c.throw.jp;
  out[c.id] = lines;
}
process.stdout.write(JSON.stringify(out, null, 1));
