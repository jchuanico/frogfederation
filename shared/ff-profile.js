/* Frog Federation — shared player profile (used by every game in /games).
 *
 * Today every player is an anonymous *guest*: a random id + fun name stored in this browser.
 * Each game keeps its own record under profile.games[gameId] (rating, wins, losses...).
 *
 * Accounts are wired but not live yet: `FF.Profile.providers.federation` is the hook for a
 * future Frog Federation sign-in. When it exists, `signIn('federation')` will merge the guest
 * record into the account so nobody loses their progress. Games never touch storage directly —
 * they call FF.Profile.game(id) / FF.Profile.updateGame(id, fn) — so swapping the backend later
 * doesn't change any game code.
 */
(function (root) {
  'use strict';
  const KEY = 'ff.profile.v1';
  let memory = null; // fallback when localStorage is blocked (private mode, sandboxed previews)
  const listeners = [];

  function read() {
    try { const v = root.localStorage && root.localStorage.getItem(KEY); return v ? JSON.parse(v) : memory; } catch (e) { return memory; }
  }
  function write(p) {
    memory = p;
    try { root.localStorage && root.localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) { /* memory only */ }
    for (const cb of listeners) try { cb(p); } catch (e) { /* listener errors never break games */ }
  }
  function randomId() {
    const b = new Uint8Array(8);
    if (root.crypto && root.crypto.getRandomValues) root.crypto.getRandomValues(b); else for (let i = 0; i < 8; i++) b[i] = (Math.random() * 256) | 0;
    return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  }
  const ADJ = ['Brave', 'Swift', 'Mighty', 'Lucky', 'Jolly', 'Sneaky', 'Cosmic', 'Turbo', 'Sparkly', 'Bouncy', 'Epic', 'Zippy'];
  const NOUN = ['Frog', 'Toad', 'Tadpole', 'Newt', 'Croaker', 'Lilypad', 'Bullfrog', 'Hopper'];
  function funName() {
    const n = (x) => x[(Math.random() * x.length) | 0];
    return n(ADJ) + n(NOUN) + ((Math.random() * 90 + 10) | 0);
  }
  function newGuest() {
    return { v: 1, id: 'guest-' + randomId(), name: funName(), provider: 'guest', guest: true, createdAt: Date.now(), games: {} };
  }

  const Profile = {
    /** Current profile (creates a guest the first time). */
    get() {
      let p = read();
      if (!p || !p.id) { p = newGuest(); write(p); }
      return p;
    },
    rename(name) {
      const clean = String(name || '').replace(/[^\w .-]/g, '').trim().slice(0, 18);
      if (!clean) return this.get();
      const p = this.get(); p.name = clean; write(p); return p;
    },
    /** A game's record, created with `defaults` if missing. */
    game(gameId, defaults) {
      const p = this.get();
      if (!p.games[gameId]) { p.games[gameId] = Object.assign({ played: 0, wins: 0, losses: 0 }, defaults || {}); write(p); }
      return p.games[gameId];
    },
    /** Mutate a game's record: FF.Profile.updateGame('tank-dynamics', (g) => { g.wins++; }) */
    updateGame(gameId, fn, defaults) {
      const p = this.get();
      const g = p.games[gameId] || (p.games[gameId] = Object.assign({ played: 0, wins: 0, losses: 0 }, defaults || {}));
      fn(g); write(p); return g;
    },
    onChange(cb) { listeners.push(cb); },

    /** Sign-in providers. Only "guest" works today; "federation" is the future account system. */
    providers: {
      guest: { id: 'guest', label: 'Play as guest', available: true },
      federation: {
        id: 'federation', label: 'Frog Federation account', available: false,
        // Future: open the Frog Federation sign-in, get {id, name, token}, then resolve.
        signIn() { return Promise.reject(new Error('Frog Federation accounts are coming soon — you can play as a guest for now.')); },
      },
    },
    /** Upgrade the guest to an account; the guest's game records are merged in. */
    signIn(providerId) {
      const prov = this.providers[providerId];
      if (!prov || !prov.signIn) return Promise.reject(new Error('Unknown sign-in provider'));
      return prov.signIn().then((acct) => {
        const guest = this.get();
        const p = { v: 1, id: acct.id, name: acct.name || guest.name, provider: providerId, guest: false, token: acct.token, createdAt: Date.now(), games: Object.assign({}, guest.games, acct.games || {}) };
        write(p); return p;
      });
    },
    signOut() { const p = newGuest(); write(p); return p; },
    _reset() { memory = null; try { root.localStorage && root.localStorage.removeItem(KEY); } catch (e) { /* ignore */ } },
  };

  root.FF = root.FF || {};
  root.FF.Profile = Profile;
})(typeof window !== 'undefined' ? window : globalThis);
