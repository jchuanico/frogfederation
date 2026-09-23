# One Piece Frog Style

An unofficial, **non-commercial fan-made** 2-vs-2 tag fighting game in the spirit of
X-Men vs Street Fighter, starring the Straw Hat crew. It's hosted in the Frog Federation repo.

> ONE PIECE and all related characters, names and techniques belong to Eiichiro Oda /
> Shueisha and Toei Animation. This project is not affiliated with or endorsed by them,
> and nobody makes money from it. All art is drawn in code, and all music and sound
> effects are original synthesized tributes. No official assets are included.

Play it at `https://jchuanico.github.io/frogfederation/one-piece-frog-style/`, or serve
the repo root locally (for example `npx http-server .`) and open `/one-piece-frog-style/`.
Opening `index.html` straight from disk also works, because it uses plain scripts with no build step.

## Roster (starter crew)
| Character | Style | Specials (SP + direction) | Hyper |
|---|---|---|---|
| Luffy | Rubber limbs: stretched hitboxes *and* hurtboxes, bouncy knockdowns | Pistol · Gatling · Rocket · Whip | Gear Third: Gigant Pistol |
| Zoro | Three-sword style, heavy (85 kg) | 36 Pound Ho · Oni Giri · Tatsumaki · Toro Nagashi (parry) | Sanzen Sekai |
| Sanji | Kicks only (hands in pockets), double jump | Premier Hache · Mouton Shot · Sky Walk · Party Table | Hell Memories |
| Nami | Clima-Tact zoning, light (50 kg) | Thunderbolt · Cyclone · Thunder Lance · Mirage (teleport) | Zeus Breeze Tempo |

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

## Adding a character
Add an entry to `js/characters.js` (stats, palette, stance, moves with frame data and pose
keyframes). Then add a `STYLE` entry (body/clothes) and hair/face details in `js/draw.js`.
