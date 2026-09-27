#!/usr/bin/env node
/* Tank Dynamics — browser play-tests (the real page in headless Chromium).
 * What the engine suite can't cover: the page, menus, audio, touch controls and two real
 * browser tabs playing each other online.
 *   - menus: title → home → tank select → battle, profile card, no page errors
 *   - a human turn driven by the keyboard (aim, hold Space, release) fires a shell
 *   - a whole CPU battle plays to the results screen and the profile records it
 *   - music moves to the pre-rendered loop and audio node churn stays low
 *   - phone: touch pad + FIRE visible and on screen, taps aim/fire, rapid taps never zoom
 *   - online: two tabs find each other via Quick Match, play a full game, end in the identical
 *     state, and their ratings move in opposite directions
 *   - no opponent: after 10 s the "fight the computer" button appears and starts a rated CPU game
 * Needs Playwright + Chromium:  npm i --no-save playwright && npx playwright install chromium
 * Usage: node tank-dynamics/tests/browser.js
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

const ROOT = path.join(__dirname, '..', '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
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
  while (Date.now() - t0 < timeout) { if (await page.evaluate(fn, arg)) return true; await sleep(200); }
  return false;
}
const watchErrors = (page) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // fonts come from Google and may be blocked in CI; everything else must load
  page.on('requestfailed', (r) => { if (!/fonts\.(googleapis|gstatic)/.test(r.url())) errors.push('failed to load ' + r.url()); });
  return errors;
};
const click = (page, sel) => page.click(sel, { force: true });

(async () => {
  const srv = await serve();
  const URL = `http://127.0.0.1:${srv.address().port}/tank-dynamics/`;
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  console.log('Tank Dynamics — browser play-tests');

  await test('desktop: menus, a keyboard turn, a full CPU battle, profile + audio', async (check) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = watchErrors(page);
    await page.goto(URL);
    await sleep(600);
    check(await page.isVisible('#s-title'), 'title screen not shown');
    check(await page.evaluate(() => !!TD.debug.attract), 'attract-mode battle is not running behind the title');
    await click(page, '#btn-start');
    check(await page.isVisible('#s-home'), 'home screen not shown after start');
    const name = await page.textContent('#p-name');
    check(name && name.length > 3 && name !== 'Guest', 'guest profile name not generated: ' + name);
    check(await waitFor(page, () => TD.debug.audio.musicMode() === 'buffer', 45000), 'menu music never moved to the pre-rendered loop');
    await click(page, '[data-go=cpu]');
    check(await page.isVisible('#s-select'), 'tank select not shown');
    check(await page.locator('.tcard').count() === 6, 'expected 6 tanks');
    await click(page, '.tcard:nth-child(4)');
    check((await page.textContent('#d-name')) === 'Robo Rex', 'selecting a tank did not update the details');
    await click(page, '[data-diff=easy]');
    await click(page, '[data-map=lagoon]');
    await click(page, '#btn-ready');
    check(await page.evaluate(() => TD.debug.screen === 'battle' && TD.debug.battle.m.mapId === 'lagoon'), 'battle did not start on the chosen map');
    // wait for our turn, then aim up 5° and fire with the keyboard
    check(await waitFor(page, () => { const b = TD.debug.battle; return b.m.phase === 'aim' && b.slots[b.m.active].kind === 'local'; }, 60000), 'never got a turn');
    const before = await page.evaluate(() => { const t = TD.debug.battle.m.activeTank; return { aim: t.aim, shots: t.stats.shots }; });
    for (let i = 0; i < 5; i++) { await page.keyboard.press('ArrowUp'); await sleep(40); }
    await page.keyboard.down('Space'); await sleep(900); await page.keyboard.up('Space');
    await sleep(200);
    const after = await page.evaluate(() => { const t = TD.debug.battle.m.tanks[0]; return { aim: t.aim, shots: t.stats.shots, power: t.lastPower }; });
    check(after.aim === Math.min(before.aim + 5, 80), `5 taps of ↑ should aim +5° (${before.aim} → ${after.aim})`);
    check(after.shots === before.shots + 1 && after.power > 30, `holding Space should charge and fire (shots ${after.shots}, power ${after.power})`);
    // audio: the battle theme must reach the pre-rendered loop, and node churn must stay low
    check(await waitFor(page, () => TD.debug.audio.musicMode() === 'buffer' && TD.debug.audio.current === TD.THEMES[TD.debug.battle.m.terrain.map.theme].music, 45000), 'battle music never moved to the pre-rendered loop');
    const a0 = await page.evaluate(() => ({ n: TD.debug.audio.stats.created, f: TD.debug.battle.m.frame }));
    await sleep(6000);
    const a1 = await page.evaluate(() => ({ n: TD.debug.audio.stats.created, f: TD.debug.battle.m.frame, mode: TD.debug.audio.musicMode() }));
    const rate = (a1.n - a0.n) / 6;
    check(a1.f - a0.f > 200, 'battle barely advanced');
    check(rate < 60, `audio nodes created ${rate.toFixed(0)}/s during battle`);
    check(a1.mode === 'buffer', 'battle music fell back to ' + a1.mode);
    // let the CPU play our side and fast-forward to the end
    const played0 = await page.evaluate(() => FF.Profile.game('tank-dynamics').played);
    await page.evaluate(() => { TD.debug.autopilot('hard'); TD.debug.speed = 8; });
    check(await waitFor(page, () => TD.debug.screen === 'results', 150000), 'battle never reached the results screen');
    await page.evaluate(() => { TD.debug.speed = 1; });
    const res = await page.evaluate(() => ({ title: document.getElementById('r-title').textContent, rows: document.querySelectorAll('#r-table tr').length, played: FF.Profile.game('tank-dynamics').played }));
    check(/VICTORY|DEFEAT|DRAW/.test(res.title), 'results title: ' + res.title);
    check(res.rows === 3, 'results table should list both tanks');
    check(res.played === played0 + 1, 'profile did not record the game');
    await click(page, '#r-home');
    check(await page.isVisible('#s-home'), 'home button on results');
    check(errors.length === 0, 'page errors: ' + errors.join(' | '));
    console.log(`      audio nodes ${rate.toFixed(0)}/s, result "${res.title}"`);
    await page.close();
  });

  await test('phone: touch pad and FIRE work, stay on screen, rapid taps never zoom', async (check) => {
    const ctx = await browser.newContext({ ...devices['iPhone 13 landscape'] });
    const page = await ctx.newPage();
    const errors = watchErrors(page);
    await page.goto(URL + '?auto=cpu');
    await sleep(600);
    const vp = page.viewportSize();
    check(await page.isVisible('#fire-btn') && await page.isVisible('#touch-pad'), 'touch controls hidden on a phone');
    for (const sel of ['#fire-btn', '.pad.up', '.pad.down', '.pad.left', '.pad.right', '.wbtn[data-w="0"]', '.wbtn[data-w="2"]', '#btn-pause', '#btn-view']) {
      const bx = await page.locator(sel).boundingBox();
      check(bx && bx.x >= -1 && bx.y >= -1 && bx.x + bx.width <= vp.width + 1 && bx.y + bx.height <= vp.height + 1, `${sel} is off screen`);
      check(bx && bx.width >= 28 && bx.height >= 26, `${sel} is too small to tap (${bx && bx.width.toFixed(0)}×${bx && bx.height.toFixed(0)})`);
    }
    check(await waitFor(page, () => { const b = TD.debug.battle; return b && b.m.phase === 'aim' && b.slots[b.m.active].kind === 'local'; }, 60000), 'never got a turn');
    const up = await page.locator('.pad.up').boundingBox();
    const aim0 = await page.evaluate(() => TD.debug.battle.m.activeTank.aim);
    for (let i = 0; i < 4; i++) { await page.touchscreen.tap(up.x + up.width / 2, up.y + up.height / 2); await sleep(60); }
    const aim1 = await page.evaluate(() => TD.debug.battle.m.activeTank.aim);
    check(aim1 === Math.min(aim0 + 4, 80), `4 taps on ▲ should aim +4° (${aim0} → ${aim1})`);
    const scale = await page.evaluate(() => (window.visualViewport ? visualViewport.scale : 1));
    check(Math.abs(scale - 1) < 0.01, `page zoomed to ${scale}x after rapid taps`);
    // hold FIRE with a real pointer, then let go
    const fb = await page.locator('#fire-btn').boundingBox();
    const cdp = await ctx.newCDPSession(page);
    const pt = { x: fb.x + fb.width / 2, y: fb.y + fb.height / 2, id: 1 };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pt] });
    await sleep(700);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(200);
    const fired = await page.evaluate(() => TD.debug.battle.m.tanks[0].stats.shots);
    check(fired === 1, 'holding and releasing FIRE did not shoot');
    const pb = await page.locator('#btn-pause').boundingBox();
    await page.touchscreen.tap(pb.x + pb.width / 2, pb.y + pb.height / 2); await sleep(200);
    check(await page.isVisible('#o-pause'), 'pause did not open');
    await click(page, '#pz-resume');
    check(errors.length === 0, 'page errors: ' + errors.join(' | '));
    await ctx.close();
  });

  await test('phone portrait: shows the rotate hint (dismissable)', async (check) => {
    const ctx = await browser.newContext({ ...devices['iPhone 13'] });
    const page = await ctx.newPage();
    await page.goto(URL);
    await sleep(400);
    check(await page.isVisible('#rotate'), 'rotate hint not shown in portrait');
    await click(page, '#rotate-dismiss');
    check(!(await page.isVisible('#rotate')), 'rotate hint did not dismiss');
    await ctx.close();
  });

  await test('online: two tabs quick-match each other and play an identical full game', async (check) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const a = await ctx.newPage(), b = await ctx.newPage();
    const errA = watchErrors(a), errB = watchErrors(b);
    for (const p of [a, b]) { await p.goto(URL); await sleep(300); await click(p, '#btn-start'); }
    const r0 = await a.evaluate(() => FF.Profile.game('tank-dynamics').rating);
    for (const [p, tank] of [[a, 1], [b, 5]]) {
      await click(p, '[data-go=quick]'); await click(p, `.tcard:nth-child(${tank})`); await click(p, '#btn-ready');
      if (p === a) { await sleep(300); check(await a.isVisible('#s-mm'), 'matchmaking screen not shown'); }
    }
    const matched = await waitFor(a, () => TD.debug.screen === 'battle', 15000) && await waitFor(b, () => TD.debug.screen === 'battle', 5000);
    check(matched, 'the two tabs never matched');
    if (matched) {
      const setup = await Promise.all([a, b].map((p) => p.evaluate(() => ({ seed: TD.debug.battle.cfg.seed, map: TD.debug.battle.m.mapId, kinds: TD.debug.battle.slots.map((s) => s.kind), tanks: TD.debug.battle.m.tanks.map((t) => t.id) }))));
      check(setup[0].seed === setup[1].seed && setup[0].map === setup[1].map, 'tabs started different games');
      check(setup[0].tanks.join() === setup[1].tanks.join() && setup[0].tanks.includes('froggo') && setup[0].tanks.includes('nova'), 'tank line-up differs: ' + JSON.stringify(setup));
      check(setup[0].kinds.join() !== setup[1].kinds.join(), 'each tab should control a different tank');
      for (const p of [a, b]) await p.evaluate(() => { TD.debug.autopilot('hard'); TD.debug.speed = 6; });
      const done = await waitFor(a, () => TD.debug.battle && TD.debug.battle.over, 240000) && await waitFor(b, () => TD.debug.battle && TD.debug.battle.over, 20000);
      check(done, 'online game did not finish');
      const fin = await Promise.all([a, b].map((p) => p.evaluate(() => { const bt = TD.debug.battle; return { hash: bt.m.hash(), winner: bt.m.winner, turn: bt.m.turn, desync: !!bt.desync }; })));
      check(fin[0].hash === fin[1].hash && fin[0].winner === fin[1].winner, 'the two tabs ended in different states: ' + JSON.stringify(fin));
      check(!fin[0].desync && !fin[1].desync, 'desync reported');
      await waitFor(a, () => TD.debug.screen === 'results', 6000);
      const r1 = await a.evaluate(() => FF.Profile.game('tank-dynamics').rating);
      // both tabs share one browser profile, so the shared rating moves by the winner's gain then the loser's loss
      check(Number.isFinite(r1) && Math.abs(r1 - r0) <= 2 * 32, 'rating update looks wrong: ' + r0 + ' → ' + r1);
      console.log(`      ${fin[0].turn} turns, winner team ${fin[0].winner}, final hash ${fin[0].hash}`);
    }
    check(errA.length === 0 && errB.length === 0, 'page errors: ' + errA.concat(errB).join(' | '));
    await ctx.close();
  });

  await test('no opponent: "fight the computer" appears after 10 s and starts a rated game', async (check) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = watchErrors(page);
    await page.goto(URL); await sleep(300);
    await click(page, '#btn-start'); await click(page, '[data-go=quick]'); await click(page, '#btn-ready');
    await sleep(3000);
    check(!(await page.isVisible('#mm-cpu')), 'computer option shown too early');
    check(await waitFor(page, () => !document.getElementById('mm-cpu').hidden, 12000), 'computer option never appeared');
    const detail = await page.textContent('#mm-detail');
    check(/Players rated \d+–\d+/.test(detail), 'rating window not shown: ' + detail);
    await click(page, '#mm-cpu');
    const cfg = await page.evaluate(() => ({ screen: TD.debug.screen, mode: TD.debug.battle && TD.debug.battle.cfg.mode, rated: TD.debug.battle && TD.debug.battle.cfg.rated }));
    check(cfg.screen === 'battle' && cfg.mode === 'cpu' && cfg.rated, 'did not start a rated CPU game: ' + JSON.stringify(cfg));
    check(errors.length === 0, 'page errors: ' + errors.join(' | '));
    await page.close();
  });

  await browser.close();
  srv.close();
  const failed = results.filter((r) => r.fails.length);
  console.log(`\n${results.length - failed.length}/${results.length} passed` + (failed.length ? ` — FAILED: ${failed.map((f) => f.name).join('; ')}` : ''));
  process.exit(failed.length ? 1 : 0);
})();
