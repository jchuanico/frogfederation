#!/usr/bin/env node
/* One Piece Frog Style — browser regression suite (real page in headless Chromium).
 * Covers what the engine suite can't: audio, the page shell and mobile/touch behaviour.
 *   - no page errors while booting, menus and fights
 *   - music moves to the pre-rendered loop (no timer-driven notes → no stutter)
 *   - audio node churn stays low during a long fight (no build-up that makes iOS stutter)
 *   - recorded voice clips actually play
 *   - on a phone: touch controls show, pause sits in the corner and works, and rapid taps
 *     never zoom the page (the iOS Safari bug that hid the buttons)
 * Needs Playwright + Chromium:  npm i --no-save playwright && npx playwright install chromium
 * Usage: node one-piece-frog-style/tests/browser.js
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

function loadPlaywright() {
  try { return require('playwright'); } catch (e) { /* fall through */ }
  try { return require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright')); } catch (e) { /* fall through */ }
  console.error('Playwright not found. Install it with: npm i --no-save playwright && npx playwright install chromium');
  process.exit(2);
}
const { chromium, devices } = loadPlaywright();

// Tiny static server for the repo root (the game fetches voices/ and fonts relative to itself).
const ROOT = path.join(__dirname, '..', '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.mp3': 'audio/mpeg', '.png': 'image/png' };
function serve() {
  return new Promise((res) => {
    const srv = http.createServer((req, rsp) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p.endsWith('/')) p += 'index.html';
      const f = path.join(ROOT, p);
      if (!f.startsWith(ROOT) || !fs.existsSync(f)) { rsp.writeHead(404); rsp.end(); return; }
      rsp.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(rsp);
    });
    srv.listen(0, '127.0.0.1', () => res(srv));
  });
}

const results = [];
async function test(name, fn) {
  const fails = [];
  const t0 = Date.now();
  try { await fn((c, m) => { if (!c) fails.push(m); }); } catch (e) { fails.push('threw: ' + (e && e.stack || e)); }
  results.push({ name, fails });
  console.log(`${fails.length ? '  ✗' : '  ✓'} ${name} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  for (const f of fails) console.log('      - ' + f);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(page, fn, timeout, arg) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { if (await page.evaluate(fn, arg)) return true; await sleep(250); }
  return false;
}

// Count audio nodes created by the live AudioContext (offline pre-rendering is excluded).
const INSTRUMENT = () => {
  window.__nodes = 0;
  const AC = window.AudioContext || window.webkitAudioContext;
  for (const m of ['createOscillator', 'createGain', 'createBiquadFilter', 'createBufferSource', 'createWaveShaper']) {
    const orig = AC.prototype[m] || Object.getPrototypeOf(AC.prototype)[m];
    AC.prototype[m] = function () { window.__nodes++; return orig.apply(this, arguments); };
  }
};

(async () => {
  const srv = await serve();
  const URL = `http://127.0.0.1:${srv.address().port}/one-piece-frog-style/`;
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  console.log('One Piece Frog Style — browser regression suite');

  await test('desktop: boots, music switches to the pre-rendered loop, fight audio stays light', async (check) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(INSTRUMENT);
    await page.goto(URL);
    await sleep(500);
    await page.keyboard.press('Enter'); // user gesture: starts audio + title music
    check(await waitFor(page, () => OP.Audio.musicMode() === 'buffer', 45000), 'title music never moved to the pre-rendered loop');
    // a CPU fight with voices on
    await page.evaluate(() => {
      OP.settings.voice = true; OP.settings.cutins = 'all';
      window.__voice = { played: 0, skipped: 0 };
      const v = OP.Audio.voice;
      OP.Audio.voice = (sp, k, o) => { const r = v(sp, k, o); window.__voice[r ? 'played' : 'skipped']++; return r; };
      OP.debug.startFight({ mode: 'cpu', level: 2, teams: [{ chars: ['luffy', 'usopp'], pal: [0, 0], ctrl: 'cpu' }, { chars: ['zoro', 'chopper'], pal: [0, 0], ctrl: 'cpu' }] });
    });
    check(await waitFor(page, () => OP.Audio.musicMode() === 'buffer', 45000), 'battle music never moved to the pre-rendered loop');
    const f0 = await page.evaluate(() => ({ n: window.__nodes, frame: OP.debug.Fight.m.frame }));
    await sleep(10000);
    const f1 = await page.evaluate(() => ({ n: window.__nodes, frame: OP.debug.Fight.m.frame, mode: OP.Audio.musicMode(), voice: window.__voice }));
    const rate = (f1.n - f0.n) / 10;
    check(f1.frame - f0.frame > 60, `the fight barely advanced (${f1.frame - f0.frame} frames in 10 s)`);
    check(rate < 80, `audio nodes created ${rate.toFixed(0)}/s during the fight (was ~220/s before the stutter fix)`);
    check(f1.mode === 'buffer', `music fell back to ${f1.mode} mid-fight`);
    check(f1.voice.played >= 3, `only ${f1.voice.played} voice lines played`);
    check(f1.voice.skipped <= 1, `${f1.voice.skipped} voice lines were skipped (clips not loaded)`);
    check(errors.length === 0, 'page errors: ' + errors.join(' | '));
    console.log(`      audio nodes ${rate.toFixed(0)}/s, voice lines played ${f1.voice.played}, skipped ${f1.voice.skipped}`);
    await page.close();
  });

  await test('phone: touch controls, corner pause button, rapid taps never zoom the page', async (check) => {
    const ctx = await browser.newContext({ ...devices['iPhone 13 landscape'] });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(URL);
    await sleep(500);
    await page.evaluate(() => { OP.settings.voice = false; OP.debug.startFight({ mode: 'cpu', level: 0, teams: [{ chars: ['luffy', 'nami'], pal: [0, 0], ctrl: 'p1' }, { chars: ['sanji', 'chopper'], pal: [0, 0], ctrl: 'cpu' }] }); });
    await sleep(800);
    const vp = page.viewportSize();
    check(await page.evaluate(() => !document.getElementById('touch').hidden), 'touch controls are hidden on a phone');
    const pb = await page.locator('#pause-btn').boundingBox();
    check(pb && pb.x > vp.width * 0.8 && pb.y < vp.height * 0.2, `pause button isn't in the top-right corner (${pb && pb.x.toFixed(0)},${pb && pb.y.toFixed(0)})`);
    check(pb && pb.width <= 48 && pb.height <= 40, 'pause button is too big to be discreet');
    await page.touchscreen.tap(pb.x + pb.width / 2, pb.y + pb.height / 2); await sleep(250);
    check(await page.evaluate(() => OP.debug.Fight.paused === true), 'tapping pause did not pause');
    await page.touchscreen.tap(pb.x + pb.width / 2, pb.y + pb.height / 2); await sleep(250);
    check(await page.evaluate(() => OP.debug.Fight.paused === false), 'tapping pause again did not resume');
    // mash every action button: the page must stay at 1x and the buttons must stay on screen
    for (const sel of ['.b-l', '.b-h', '.b-s', '.b-x', '.b-a', '.b-t']) {
      const bx = await page.locator('#touch ' + sel).boundingBox();
      check(bx && bx.x + bx.width <= vp.width + 1 && bx.y + bx.height <= vp.height + 1, `${sel} is off screen`);
      for (let i = 0; i < 5; i++) { await page.touchscreen.tap(bx.x + bx.width / 2, bx.y + bx.height / 2); await sleep(70); }
    }
    const scale = await page.evaluate(() => (window.visualViewport ? visualViewport.scale : 1));
    check(Math.abs(scale - 1) < 0.01, `page zoomed to ${scale}x after rapid taps`);
    check(errors.length === 0, 'page errors: ' + errors.join(' | '));
    await ctx.close();
  });

  await browser.close();
  srv.close();
  const failed = results.filter((r) => r.fails.length);
  console.log(`\n${results.length - failed.length}/${results.length} passed` + (failed.length ? ` — FAILED: ${failed.map((f) => f.name).join('; ')}` : ''));
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
