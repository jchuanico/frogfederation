# Frog Federation — notes for Claude

Static GitHub Pages site (served from `main`). No build step: every page is plain HTML/CSS/JS.

- Site pages: one folder per page (`frog-court/`, `users/`, ...) sharing `style.css`.
- Games: `games/index.html` lists them; each game has its own folder
  (`one-piece-frog-style/`, `tank-dynamics/`). Shared game code lives in `shared/`
  (`ff-profile.js` player profile, `ff-audio.js` synth + music engine).
- **Making or changing a game? Read `docs/GAME_DEV_GUIDE.md` first**, or hand the idea to the
  `game-dev` agent (`.claude/agents/game-dev.md`), which follows that guide end to end.

Tests (run the ones for what you touched):
```
node one-piece-frog-style/tests/run.js      # engine
node one-piece-frog-style/tests/browser.js  # Playwright
node tank-dynamics/tests/run.js
node tank-dynamics/tests/browser.js
node tank-dynamics/tools/playtest.js --check
```
Local preview: `npx http-server -p 8123 -s -c-1 .` then open `http://localhost:8123/<folder>/`.
