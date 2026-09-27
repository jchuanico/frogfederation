# Tank Dynamics

A turn-based artillery battle game for the Frog Federation, in the spirit of GunBound.
Six cartoon tanks take turns lobbing shells across destructible landscapes. Angles, power,
gravity and wind decide every shot.

Play: https://jchuanico.github.io/frogfederation/tank-dynamics/

## Design note
- **Core loop:** on your turn, drive (uses fuel), set your angle, hold to charge power, release to
  fire. Shells follow real ballistics: gravity 9.81 m/s² plus air drag relative to the wind
  (`a = g + k·(wind − v)`). Explosions carve craters, and tanks fall (fall damage) or sink.
- **Turn order:** GunBound-style *delay*. Every shot and every metre driven adds delay, and the
  tank with the least delay goes next, so big shots cost you tempo.
- **Tanks:** Froggo (all-rounder), Blaze (heavy hitter), Frostbite (freezes enemies' turns),
  Robo Rex (drills and orbital laser), Nova (wind-proof comet, black hole) and Bubbles (builds goo
  walls, bubble barrage). Each has Shot 1, Shot 2 and an **SS** super that charges as you deal and
  take damage.
- **Maps:** Lily Pad Lagoon, Sunset Canyon, Frost Peaks, Neon Nights, Candy Clouds.
- **Modes:** Vs Computer (Easy/Normal/Hard, 1v1, 2v2, 3-way), Local Party (2–4 players on one
  device, free-for-all or teams), Quick Match (online, rated).
- **Win:** last team standing. From turn 26 it's Sudden Death: damage ×1.4 and the water rises.

## Controls
| | Keyboard | Touch |
|---|---|---|
| Move | ← → (A D) | ◀ ▶ |
| Angle | ↑ ↓ (W S) | ▲ ▼ |
| Fire | hold Space, release | hold FIRE, release |
| Shots | 1 2 3 | weapon cards |
| Map view / pass / pause | Z · Q · Esc | 🔍 ⏭ II |

## Accounts, rating and matchmaking
- Everyone plays as a **guest** (random id and fun name, editable) stored in the browser with
  `shared/ff-profile.js`. "Create account" is wired to a Frog Federation account provider that
  isn't live yet. When it is, guest progress merges into the account.
- **Rating:** Elo, start 1000, K = 32 online. "Fight the computer instead" games count at half K
  against the CPU's rating (Easy 800, Normal 1000, Hard 1250).
- **Matchmaking:** you're paired with the closest rating within ±100, a window that widens by 40
  per second of waiting. After 10 s you can fight the computer instead.
- **Online play:** the simulation is deterministic, so clients only exchange input changes
  (lockstep) and compare a state hash every turn.
  - On GitHub Pages, players find each other through `BroadcastChannel`, which only reaches other
    tabs of the same browser. Open two tabs to try it.
  - For real internet play, host `tools/relay-server.js` (Node 18+, no dependencies) and open the
    game with `?relay=wss://your-relay-host`.

## Code map
| File | What |
|---|---|
| `js/core.js` | constants, deterministic trig, seeded RNG, hashing, settings |
| `js/terrain.js` | destructible terrain bitmask + map recipes |
| `js/tanks.js` | roster and weapon data (tune here) |
| `js/game.js` | the battle simulation (turns, physics, weapons, damage) |
| `js/ai.js` | CPU players (search with real physics, then play via inputs) |
| `js/net.js` | Elo, transports, matchmaking, lockstep session |
| `js/audio.js` | songs + sound effects for `shared/ff-audio.js` |
| `js/render.js`, `js/skins.js`, `js/hud.js` | landscapes, terrain texture, effects, tanks, HUD |
| `js/main.js` | screens, input, main loop, match orchestration, `TD.debug` test hooks |
| `tools/playtest.js` | CPU round-robin balance report (`--check` for CI) |
| `tools/relay-server.js` | WebSocket relay for internet matchmaking |

## Tests
```
node tank-dynamics/tests/run.js            # engine: 42 tests (physics vs formulas, weapons, AI, netcode, relay...)
node tank-dynamics/tests/browser.js        # Playwright play-tests: menus, touch, audio, two-tab online game
node tank-dynamics/tools/playtest.js       # balance report (every tank vs every tank on every map)
```
CI runs all three (`.github/workflows/tank-dynamics-tests.yml`).

All art is drawn in code and all music and sound is synthesized. Everything is original.
