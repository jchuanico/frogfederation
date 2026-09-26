# One Piece Frog Style

An unofficial, **non-commercial fan-made** 2-vs-2 tag fighting game in the spirit of
X-Men vs Street Fighter, starring the Straw Hat crew. It's hosted in the Frog Federation repo.

> ONE PIECE and all related characters, names and techniques belong to Eiichiro Oda /
> Shueisha and Toei Animation. This project is not affiliated with or endorsed by them,
> and nobody makes money from it. All art is drawn in code, music and sound effects are
> original synthesized tributes, and voices are generated with an open TTS model.
> No official assets or voice recordings are included.

Play it at `https://jchuanico.github.io/frogfederation/one-piece-frog-style/`, or serve
the repo root locally (for example `npx http-server .`) and open `/one-piece-frog-style/`.
Opening `index.html` straight from disk also works, because it uses plain scripts with no build step.

## Roster
| Character | Style | Specials (SP + direction) | Hyper |
|---|---|---|---|
| Luffy | Rubber limbs: stretched hitboxes *and* hurtboxes, bouncy knockdowns | Pistol · Gatling · Rocket · Whip | Gear Third: Gigant Pistol (spikes the target into the deck; it bounces up for a juggle) |
| Zoro | Three-sword style, heavy (85 kg). Light = one-sword rising cut, heavy = two-sword overhead chop | 36 Pound Ho · Oni Giri · Tatsumaki · Toro Nagashi (parry) | Sanzen Sekai |
| Sanji | Kicks only (hands in pockets), double jump | Premier Hache · Mouton Shot · Sky Walk · Party Table | Hell Memories: one huge kick that throws fire outward; burns for 5 s |
| Nami | Clima-Tact zoning, light (50 kg) | Thunderbolt · Cyclone · Thunder Lance · Mirage (teleport) | Zeus Breeze Tempo |
| Usopp | Punches up close, Kabuto (staff slingshot) whacks and shots | Lead Star · Exploding Star · Sky Shot · Tabasco Star (low) | Firebird Star (heat-seeking) |
| Chopper | Tiny Brain Point; Rumble Ball forms | Heavy Point (grow, +5%) / Heavy Gong · Kokutei Roseo · Horn Point · Guard Point (armour) | Monster Point (giant, +25%, super armour). Two hits taken shrink him back |

## Voices
Call-outs, quotes, attack shouts, pain cries and the announcer are pre-recorded clips in
`voices/`. They were generated with the open-source **Kokoro-82M** neural TTS model (Apache-2.0),
using blended voice styles to give each character a distinct voice, then trimmed, driven and
loudness-matched. To change a line, edit it in `js/characters.js` (or the shouts in
`tools/make_voices.py`) and regenerate: `python tools/make_voices.py --model <dir>`. Setup steps
are in the script header.

## Controls
| | Keyboard P1 | Keyboard P2 | Gamepad |
|---|---|---|---|
| Move | WASD | Arrows | D-pad / stick |
| Light / Heavy / Special | J / K / L | Num1-3 or , . / | A / X / B |
| Hyper (or L+H) | O | Num6 or ' | Y |
| Tag / Assist | I / U | Num5 / Num4 | RB / LB |
| Pause | Enter / Esc | Num Enter | Start |

On phones and tablets, on-screen controls appear automatically: a floating stick on the
left and buttons on the right. Landscape works best. Press **H** to show hitboxes.

## How it works
- **Physics** runs on real units: metres, kilograms, and g = 9.81 m/s². Jumps use v = √(2gh),
  knockback is an impulse (Δv = J/m, so heavier fighters fly less), and bodies experience
  quadratic air drag, deck friction, and ground/wall bounces based on restitution
  (Luffy is rubber, so he bounces most).
- **Hitboxes** are capsules built from the live skeleton every frame, so a
  stretched arm is both the attack and a target. You can see them in Training or with **H**.
- **Tag team**: tag in, call an assist, recover red health while benched, and use Crew Combos
  (press Tag during a Hyper to chain your partner's Hyper).
- **Cut-ins**: specials and hypers zoom the camera into the fighter's face with a matching
  expression. Hypers also freeze time and show speed lines.
- **Audio** is synthesized with Web Audio (original music, anime-style SFX). Move names are spoken
  through the browser's speech engine, which you can switch off in Options.

## Regression tests
`node one-piece-frog-style/tests/run.js` runs the real engine headlessly, with no browser and no
dependencies. It checks move data and poses, capsule hitbox maths, every attack's reach and
whiff range, blocking rules, jump-ins, cross-ups and anti-airs, each character mechanic, and
full CPU matches for every character, drawn into a mock canvas. The matches also check for
crashes, NaN values, and the camera losing a fighter. Use `--quick` for a faster run.

`node one-piece-frog-style/tests/browser.js` runs the real page in headless Chromium (needs
`npm i --no-save playwright && npx playwright install chromium`). It checks that the music moves
to its pre-rendered loop, that audio nodes aren't piling up during a fight (the cause of the old
stutter), that voice clips play, that the page has no errors, and, on an emulated phone, that the
touch controls and corner pause button work and rapid taps never zoom the page.

GitHub Actions runs both suites on every push (`.github/workflows/game-tests.yml`).

## Adding a character
Add an entry to `js/characters.js` (stats, palette, stance, moves with frame data and pose
keyframes). Then add a `STYLE` entry (body/clothes) and hair/face details in `js/draw.js`.
