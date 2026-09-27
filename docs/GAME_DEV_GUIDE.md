# Frog Federation — Game Development Guide

This is the playbook for adding games to the Frog Federation site. It was written while building
**Tank Dynamics** (and draws on the lessons from **One Piece Frog Style**), so the next game can go
from a one-paragraph idea to a tested, playable page with very little back-and-forth.

If you're Claude Code: the `game-dev` agent (`.claude/agents/game-dev.md`) follows this guide.
Give it a game idea and it builds the whole thing.

---

## 1. What every Frog Federation game is

| Rule | Why |
|---|---|
| A **static page** in its own folder (`/<game-slug>/index.html`), plain `<script>` tags, no build step, no npm packages at runtime | The site is GitHub Pages. Anything that needs a build or a server breaks the "push and it's live" workflow. |
| Works with **keyboard, mouse and touch** (phones in landscape) | Most players are kids on phones or school Chromebooks. |
| **Original or credited** art, music and characters. Fan games say "unofficial, non-commercial" and credit the owner | We never ship copyrighted recordings or images. Everything is drawn with canvas and synthesized with Web Audio. |
| Has a **card on `games/index.html`** and a line in the root `README.md` | That's how people find it. |
| Has **automated tests** (engine + browser) and a **GitHub Actions workflow** | Games are built by AI with little prompting; tests are what keep them from silently breaking. |
| Uses the **shared modules** in `/shared` for profiles and audio | One profile across all games; one audio engine that's already been debugged. |

## 2. Folder layout (copy this)

```
<game-slug>/
  index.html          page shell: canvas + DOM screens/overlays + <script> list
  game.css            menus and touch controls
  README.md           how to play, how it works, how to test
  js/
    core.js           namespace, constants, settings (localStorage with try/catch), deterministic math
    <sim files>.js    the game simulation — NO DOM, NO canvas, NO audio, NO Math.random
    ai.js             computer opponents that play through the same inputs as humans
    net.js            (multiplayer games) transports, matchmaking, lockstep sessions
    audio.js          songs + sfx data for FF.Audio
    render.js         world drawing (camera, backgrounds, effects)
    <art>.js          character/skin drawing
    hud.js            heads-up display
    main.js           boot, screens, input, main loop, glue, TD.debug test hooks
  tests/
    load.js           loads the sim files into a Node vm sandbox
    run.js            engine regression suite (node only, no deps)
    browser.js        Playwright play-tests of the real page
  tools/              playtest/balance scripts, servers, generators
```

Script order in `index.html`: `../shared/ff-profile.js`, `../shared/ff-audio.js`, then core → sim →
ai → net → audio → render → art → hud → main.

## 3. Page contract (screen, input, mobile)

* **Logical resolution 1280×720**, letterboxed. The canvas is sized in device pixels
  (`devicePixelRatio`, capped at 2) and drawn with a transform. The DOM UI layer (`#ui`) is a
  1280×720 box scaled with a CSS transform by the same factor, so DOM buttons line up with canvas
  art on every screen. (See `tank-dynamics/js/main.js` → `resize()`.)
* **iOS Safari zoom guard** — copy the block from `tank-dynamics/js/main.js` (gesturestart /
  touchmove with 2 fingers / double-tap `touchend` / `visualViewport` re-apply). Without it, quick
  taps zoom the page and the controls slide off screen (a real bug we shipped once).
* In-game buttons act on **`pointerdown`**, not `click` (instant, and the double-tap guard can
  swallow a second quick click). Use `setPointerCapture` for hold buttons.
* **Quick taps must never be lost**: latch any key/button that went down and up between two sim
  frames so the sim sees it for one frame (`tapped` in main.js).
* Show a **rotate-your-phone** hint in portrait, dismissable.
* Keep touch targets ≥ 56 logical px (≈ 28 CSS px on the smallest phone).
* Minimum menus: Title → Home (profile card) → mode/setup → game → results, plus How to Play,
  Settings (music, sfx, accessibility toggles), Pause.

## 4. Simulation rules (the part that makes testing and multiplayer easy)

1. **Fixed 60 Hz step.** `main.js` accumulates real time and calls `step()`; rendering interpolates
   nothing and never changes game state.
2. **Deterministic.** Only `+ - * /`, `Math.sqrt/floor/abs/min/max`, and the seeded RNG
   (`TD.rng`, mulberry32). `Math.sin/cos/atan2/exp/pow` may differ between browsers in the last
   bit, so the sim uses the polynomial `dsin/dcos/datan2` in `core.js`. Cosmetic code (particles,
   camera) may use `Math.random` freely.
3. **Input is a small bit field per player per frame.** The sim never reads the keyboard. Humans,
   the AI, replays, tests and remote players all produce the same bits. That's what lets the CPU
   "play like a human", tests drive real input paths, and online play send only inputs.
4. **Events out, not callbacks.** The sim pushes `{type: ...}` events; `main.js` turns them into
   particles, sounds and HUD banners, then clears them. The sim never depends on them.
5. **`hash()`** summarises the whole state (FNV-1a over numbers) for desync checks and replay tests.
6. **Real units.** Metres, seconds, `g = 9.81 m/s²`. Write down the physics in a comment at the top
   of the sim file and test it against the textbook formula.

## 5. Multiplayer pattern (turn-based or lockstep)

* **Transports** share one tiny interface — `join(room, onMessage) → { send, close }`:
  `LoopbackHub` (tests), `BroadcastHub` (other tabs of the same browser — works on GitHub Pages
  today), `WebSocketHub` (+ `tools/relay-server.js`, a dependency-free relay you can host anywhere
  and enable with `?relay=wss://…`).
* **Matchmaking**: seekers broadcast `{rating, since}` every second; the acceptable rating gap is
  `100 + 40·seconds waited` (max 700); the smaller id proposes, the other accepts; both start the
  same seeded match. After 10 s offer **"Fight the computer instead"** (rated at half K).
* **Elo** ratings (K = 32, start 1000) live in the player's profile record for that game.
* **Lockstep**: stream the local player's input *changes* stamped with the sim frame; the other
  client waits for input before simulating the remote player's frames. Compare `hash()` at every
  turn start; on mismatch, end as "no contest".
* Opponent leaves / times out (10 s silence) → the other player wins.

## 6. Shared modules

### `shared/ff-profile.js` — `FF.Profile`
Guest profile (random id + fun name) stored in `localStorage` (memory fallback). Per-game records:
```js
const rec = FF.Profile.game('my-game', { rating: 1000 });       // created with defaults
FF.Profile.updateGame('my-game', (g) => { g.wins++; g.rating = 1016; });
FF.Profile.rename('Frog King');
FF.Profile.signIn('federation')   // wired, rejects "coming soon" until accounts exist
```
When real Frog Federation accounts arrive, implement `providers.federation.signIn()` to resolve
`{id, name, token}`; the guest's game records merge into the account automatically. Games don't
change.

### `shared/ff-audio.js` — `FF.Audio.create({ songs, sfx, loops, volumes, prerender })`
* Songs are text (`'D5:4 F5:4 A5:8'`, chords `'Dm:16 Bb:16'`, drum grids) — see the header comment.
  Instruments: brass, horn, lead, strings, violins, choir, pad, pluck, bell, bass, guitar; drums:
  k, s, h, c, tom, taiko, timp, anvil.
* Songs are **pre-rendered** with `OfflineAudioContext` and looped as buffers (list the most
  important song first in `prerender`). Give heavy songs a `live: [track indices]` light
  arrangement that plays until the render is ready.
  *Lesson from One Piece Frog Style: scheduling notes from a JS timer stutters after ~50 s of
  gameplay on phones and creates hundreds of audio nodes per second.*
* `sfx(name)` one-shots are functions of the synth API (`a.tone({...})`, `a.noise({...})`).
* `loop(name)` returns `{ set({f, g, filter}), stop() }` for continuous sounds (whistles, engines).
* `stats.created` counts live nodes so browser tests can assert audio stays cheap.
* Call `audio.init()` from a user gesture.

## 7. Testing (what "done" means)

**Engine suite** (`tests/run.js`, plain Node, no deps) — typical sections:
* math helpers vs `Math.*`; RNG reproducibility
* physics vs analytic formulas (projectile range/apex; drag + wind closed form)
* hitboxes: just-inside hits, just-outside misses
* every mechanic/weapon/move has a focused test (fire it, check the events and state)
* data sanity for rosters/levels
* AI: hard is accurate, easy is worse
* full CPU-vs-CPU games on every map/level finish, no NaN, sensible length
* determinism: same seed + inputs → same hash every turn; different seed → different
* matchmaking, Elo, lockstep over a laggy loopback, tamper → desync detected, relay over real sockets
* shared modules (profile persistence, account hook) and audio data (songs compile, every sound
  the game calls exists)

**Browser suite** (`tests/browser.js`, Playwright + Chromium; starts its own static server):
* menus end-to-end, a human turn via real keyboard events, a full game to the results screen
  (`TD.debug.autopilot()` + `TD.debug.speed` fast-forward)
* music reaches the pre-rendered buffer; audio node churn stays low
* phone emulation: controls visible, on screen, big enough; taps work; rapid taps don't zoom
* two tabs in one browser context quick-match and finish an identical game
* matchmaking fallback appears after 10 s

**Balance play-test** (`tools/playtest.js --check`): round-robin CPU matches; fails if any
character wins < 30% or > 70%.

Always **mutation-check** a new test once: break the code it guards and see it fail.

CI: one workflow per game in `.github/workflows/`, jobs `engine`, `browser`, and (if the game has
characters) `balance`. Node 22 (built-in WebSocket client).

Run locally:
```
node <game>/tests/run.js
node <game>/tests/browser.js          # needs: npm i --no-save playwright && npx playwright install chromium
node <game>/tools/playtest.js --check
npx http-server -p 8123 -s -c-1 .     # then open http://localhost:8123/<game>/
```

## 8. Art & sound direction that works for kids

* Chunky toy-like shapes, rounded rectangles, thick dark outlines on text, bright saturated
  palettes with a darker shade + a highlight per colour.
* Characters have **big expressive eyes** that blink, follow what they're aiming at, squint when
  concentrating, panic when danger approaches, grin after success, and go dizzy when knocked out.
* Every action has a sound, a particle burst and (for big moments) screen shake and a comic word
  ("KA-BOOM!", "DIRECT HIT!"). Keep a settings toggle for screen shake.
* Landscapes: sky gradient → sun/moon glow → 2 parallax silhouette layers → clouds drifting with
  the wind → play field → water/foreground → ambient particles (fireflies, snow, dust...).
* Music: an energetic battle theme (taiko + staccato strings + brass melody + choir pad), a bright
  menu theme, a calm lobby loop, short victory/defeat stings. All original.

## 9. Workflow for a new game (checklist)

1. Write a one-screen **design note** at the top of the new `README.md`: pitch, core loop,
   controls (keyboard + touch), modes, characters/levels, win condition, what's out of scope.
2. `core.js` + sim + `tests/load.js` + `tests/run.js` first. Get a CPU-vs-CPU game running in Node
   before drawing anything.
3. AI through the input bits. Balance tool. Tune until the play-test passes.
4. Multiplayer (if any) using `net.js` from Tank Dynamics as the template.
5. Page shell, screens, input, render, art, HUD, audio.
6. Browser suite; screenshot every screen at 1280×720 and on an iPhone landscape viewport and
   look at them. Fix what looks off.
7. Games card, root README line, game README, CI workflow.
8. Run all suites, commit, push to the working branch. Ask before merging to `main`.

## 10. Lessons learned (keep adding)

* **Camera**: frame the action box, not a single character; zoom in on the active player so the
  art reads on phones; zoom out to follow projectiles; offer an overview toggle.
* **Audio**: pre-render music; disconnect nodes on `ended`; count nodes in tests.
* **iOS**: `user-scalable=no` is ignored; block gestures and re-apply the viewport.
* **Quick taps** vanish unless latched for one frame.
* **Playwright** `click` waits for "stable" elements — use `{ force: true }` on pulsing buttons.
* Offline audio renders also create nodes — only count the live context in churn tests.
* A test that passes on the first run hasn't proven anything until it has failed on purpose.
* Hitboxes should match the art. Draw the character around its physics shape, then test the
  boundaries (just inside / just outside).

## 11. How Tank Dynamics was built (worked example)

The original request: *"a multiplayer tank game like GunBound. Different skill/skin tanks take
turns shooting at each other from beautiful landscapes. Geometry, trigonometry and earth physics.
Polish the skins to appeal to today's kids. Unique sound effects and an epic soundtrack.
Matchmaking with a rating and an option to fight the computer instead of waiting. Anonymous play
now, accounts later. Robust regression and play testing. Document it."*

How that became a game:
1. **Sim first** — terrain bitmask (0.25 m cells, carve/fill), ballistics with drag relative to
   wind, GunBound delay-based turns, SS gauge, fall damage, water, sudden death. Deterministic
   trig. CPU-vs-CPU in Node on all maps before any graphics.
2. **Roster as data** (`tanks.js`): six characters × three weapons, each weapon a `kind` handled
   in one place (`explode`/`substep`). Tuned with the play-test tool until win rates sat at 38–58%.
3. **AI** searches angle × power with the real physics (coarse grid, then refine), picks by
   expected damage, adds a difficulty wobble, then *plays the plan through input bits*.
4. **Net**: loopback test first (two sims, one hub, fake latency) → BroadcastChannel for tabs →
   relay server with a real-socket test.
5. **Presentation**: letterboxed canvas + scaled DOM layer; themed parallax landscapes; bilinear
   smoothed terrain texture with strata and scorch marks; cartoon tanks with mood-driven faces;
   HUD with angle dial, power bar + last-shot marker, wind gauge, turn order, minimap.
6. **Audio**: shared engine extracted from One Piece Frog Style, new orchestral instruments, five
   songs, ~40 synthesized sfx, loops for shell whistle / treads / charge.
7. **Tests**: 42 engine tests, 5 browser play-tests, balance round-robin, CI workflow.

## 12. Prompt template for the next game

> Make a new Frog Federation game called **<name>**. It's like **<reference game>**:
> <2–4 sentences on the core loop>. Players: <solo vs CPU / local / online>. Characters or levels:
> <list or "surprise me">. Style: <mood/palette>. Keep it kid-friendly.

That's enough — the agent fills in everything else from this guide.
