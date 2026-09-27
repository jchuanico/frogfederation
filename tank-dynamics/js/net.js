/* Tank Dynamics — ratings, matchmaking and online play.
 *
 * Transport ("hub") — anything with join(room, onMessage) -> { send(msg), close() }, where a
 * message sent to a room reaches every *other* member of that room:
 *   LoopbackHub   in-memory, for tests (optional fake latency)
 *   BroadcastHub  BroadcastChannel: other tabs/windows of this browser (works on GitHub Pages today)
 *   WebSocketHub  a tiny relay server (tools/relay-server.js) for real internet play later
 * Messages that are meant for one player carry `to: <playerId>`; everyone else ignores them.
 *
 * Matchmaking: every seeker broadcasts {rating, since} once a second. The acceptable rating gap
 * starts at ±100 and widens by 40 per second waited, so you always find *someone* eventually.
 * When two seekers accept each other the one with the smaller id proposes (so there's never a
 * double booking), the other accepts, and both start the same seeded match.
 *
 * Online matches are lockstep: the sim is deterministic, so the only thing sent is the active
 * player's input bits (as changes, stamped with the sim frame). A client simply waits for the
 * remote player's input before simulating frames on their turn. Turn-start hashes catch desyncs.
 */
'use strict';
(function (TD) {
  /* ---------------- Elo rating ---------------- */
  const Elo = {
    START: 1000,
    K: 32,
    expected: (ra, rb) => 1 / (1 + Math.pow(10, (rb - ra) / 400)),
    /** New rating for A after a game vs B. score: 1 win, 0.5 draw, 0 loss. */
    update(ra, rb, score, k = Elo.K) { return Math.round(ra + k * (score - Elo.expected(ra, rb))); },
    title(r) {
      return r >= 1600 ? 'Legend' : r >= 1400 ? 'Champion' : r >= 1250 ? 'Ace' : r >= 1100 ? 'Captain' : r >= 950 ? 'Cadet' : 'Rookie';
    },
  };
  TD.Elo = Elo;

  /* ---------------- transports ---------------- */
  const clone = (m) => JSON.parse(JSON.stringify(m));

  class LoopbackHub {
    constructor(o = {}) { this.rooms = new Map(); this.latency = o.latency || 0; this.dropped = 0; this.sent = 0; }
    join(room, onMessage) {
      if (!this.rooms.has(room)) this.rooms.set(room, new Set());
      const members = this.rooms.get(room);
      const me = { onMessage, open: true };
      members.add(me);
      const hub = this;
      return {
        send(msg) {
          if (!me.open) return;
          hub.sent++;
          const data = clone(msg);
          for (const m of members) {
            if (m === me) continue;
            const deliver = () => { if (m.open) m.onMessage(clone(data)); };
            if (hub.latency) setTimeout(deliver, hub.latency); else Promise.resolve().then(deliver);
          }
        },
        close() { me.open = false; members.delete(me); },
      };
    }
  }

  class BroadcastHub {
    constructor(prefix = 'ff-td') { this.prefix = prefix; }
    static available() { return typeof BroadcastChannel !== 'undefined'; }
    join(room, onMessage) {
      const ch = new BroadcastChannel(this.prefix + ':' + room);
      ch.onmessage = (e) => onMessage(e.data);
      return { send: (msg) => { try { ch.postMessage(msg); } catch (e) { /* closed */ } }, close: () => ch.close() };
    }
  }

  class WebSocketHub {
    constructor(url) { this.url = url; this.ws = null; this.rooms = new Map(); this.queue = []; this.status = 'idle'; }
    connect() {
      if (this.ws) return;
      this.status = 'connecting';
      const ws = (this.ws = new WebSocket(this.url));
      ws.onopen = () => { this.status = 'open'; for (const r of this.rooms.keys()) ws.send(JSON.stringify({ op: 'join', room: r })); for (const q of this.queue.splice(0)) ws.send(q); };
      ws.onmessage = (e) => { let d; try { d = JSON.parse(e.data); } catch (err) { return; } const set = this.rooms.get(d.room); if (set) for (const cb of set) cb(d.msg); };
      ws.onclose = () => { this.status = 'closed'; this.ws = null; };
      ws.onerror = () => { this.status = 'error'; };
    }
    raw(obj) { const s = JSON.stringify(obj); if (this.ws && this.ws.readyState === 1) this.ws.send(s); else this.queue.push(s); }
    join(room, onMessage) {
      this.connect();
      if (!this.rooms.has(room)) { this.rooms.set(room, new Set()); this.raw({ op: 'join', room }); }
      this.rooms.get(room).add(onMessage);
      return {
        send: (msg) => this.raw({ op: 'send', room, msg }),
        close: () => { const s = this.rooms.get(room); if (s) { s.delete(onMessage); if (!s.size) { this.rooms.delete(room); this.raw({ op: 'leave', room }); } } },
      };
    }
  }

  /** The hub the game uses: a relay server if one is configured (?relay=wss://...), else tabs. */
  TD.defaultHub = function () {
    let relay = null;
    try { relay = new URLSearchParams(location.search).get('relay') || (TD.RELAY_URL || null); } catch (e) { relay = null; }
    if (relay && typeof WebSocket !== 'undefined') return new WebSocketHub(relay);
    if (BroadcastHub.available()) return new BroadcastHub();
    return new LoopbackHub();
  };

  /* ---------------- matchmaking ---------------- */
  const LOBBY = 'td-lobby';
  const ratingWindow = (waitedSec) => Math.min(700, 100 + 40 * Math.max(0, waitedSec));
  TD.ratingWindow = ratingWindow;

  class Matchmaker {
    /** me = { id, name, rating, tank }; o.now() -> ms (injectable for tests). */
    constructor(hub, me, o = {}) {
      this.hub = hub; this.me = me; this.now = o.now || (() => Date.now());
      this.seekers = new Map(); this.state = 'idle'; this.onMatch = null; this.onUpdate = null; this.pending = null;
      this.maps = o.maps || TD.MAPS.map((m) => m.id);
      this.rand = o.rand || Math.random;
    }
    start() {
      this.since = this.now(); this.state = 'seeking';
      this.link = this.hub.join(LOBBY, (m) => this.onMessage(m));
      this.announce();
      if (!this.manual) this.timer = setInterval(() => this.tick(), 1000);
    }
    stop() {
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      if (this.link) { this.link.send({ t: 'leave', id: this.me.id }); this.link.close(); }
      this.link = null;
      if (this.state === 'seeking') this.state = 'idle';
    }
    waited() { return (this.now() - this.since) / 1000; }
    window() { return ratingWindow(this.waited()); }
    announce() {
      if (this.link) this.link.send({ t: 'seek', id: this.me.id, name: this.me.name, rating: this.me.rating, tank: this.me.tank, since: this.since, v: TD.PROTOCOL });
    }
    tick() {
      if (this.state !== 'seeking') return;
      const now = this.now();
      for (const [id, s] of this.seekers) if (now - s.seen > 3500) this.seekers.delete(id);
      if (this.pending && now - this.pending.at > 3000) this.pending = null; // proposal went unanswered
      this.announce();
      this.consider();
      if (this.onUpdate) this.onUpdate(this);
    }
    compatible(s) {
      const gap = Math.abs(s.rating - this.me.rating);
      const theirs = ratingWindow((this.now() - s.since) / 1000);
      return s.v === TD.PROTOCOL && gap <= Math.min(this.window(), theirs);
    }
    consider() {
      if (this.pending || this.state !== 'seeking') return;
      // closest rating first, then whoever has waited longest
      const opts = [...this.seekers.values()].filter((s) => this.compatible(s) && this.me.id < s.id)
        .sort((a, b) => Math.abs(a.rating - this.me.rating) - Math.abs(b.rating - this.me.rating) || a.since - b.since);
      const s = opts[0];
      if (!s) return;
      const matchId = this.me.id.slice(-6) + '-' + s.id.slice(-6) + '-' + Math.floor(this.rand() * 1e6);
      this.pending = { to: s.id, matchId, at: this.now(), seed: Math.floor(this.rand() * 4294967295) >>> 0, map: this.maps[Math.floor(this.rand() * this.maps.length)] };
      this.link.send({ t: 'propose', to: s.id, from: this.me.id, matchId, seed: this.pending.seed, map: this.pending.map, name: this.me.name, rating: this.me.rating, tank: this.me.tank });
    }
    onMessage(m) {
      if (!m || (m.to && m.to !== this.me.id) || m.id === this.me.id || m.from === this.me.id) return;
      if (m.t === 'seek') { this.seekers.set(m.id, { id: m.id, name: m.name, rating: m.rating, tank: m.tank, since: m.since, v: m.v, seen: this.now() }); if (this.state === 'seeking') this.consider(); }
      else if (m.t === 'leave') this.seekers.delete(m.id);
      else if (m.t === 'propose' && this.state === 'seeking') {
        const s = this.seekers.get(m.from) || { rating: m.rating, since: this.now(), v: TD.PROTOCOL };
        if (!this.compatible(Object.assign({}, s, { rating: m.rating }))) { this.link.send({ t: 'decline', to: m.from, from: this.me.id, matchId: m.matchId }); return; }
        if (this.pending) { // we proposed to someone else meanwhile; smaller id's proposal wins
          if (m.from > this.me.id) { this.link.send({ t: 'decline', to: m.from, from: this.me.id, matchId: m.matchId }); return; }
          this.pending = null;
        }
        this.link.send({ t: 'accept', to: m.from, from: this.me.id, matchId: m.matchId, name: this.me.name, rating: this.me.rating, tank: this.me.tank });
        this.matched({ matchId: m.matchId, seed: m.seed, map: m.map, host: false, slot: 1, opponent: { id: m.from, name: m.name, rating: m.rating, tank: m.tank } });
      } else if (m.t === 'accept' && this.pending && m.matchId === this.pending.matchId) {
        const p = this.pending; this.pending = null;
        this.matched({ matchId: p.matchId, seed: p.seed, map: p.map, host: true, slot: 0, opponent: { id: m.from, name: m.name, rating: m.rating, tank: m.tank } });
      } else if (m.t === 'decline' && this.pending && m.matchId === this.pending.matchId) {
        this.pending = null; this.seekers.delete(m.from);
      }
    }
    matched(info) {
      this.state = 'matched';
      this.stop();
      this.state = 'matched';
      if (this.onMatch) this.onMatch(info);
    }
  }
  TD.Matchmaker = Matchmaker;

  /* ---------------- an online match's message link ---------------- */
  class Session {
    /** info from Matchmaker (matchId, slot); me = { id, name, tank }. */
    constructor(hub, info, me, o = {}) {
      this.hub = hub; this.info = info; this.me = me; this.now = o.now || (() => Date.now());
      this.remote = { changes: [], upto: -1, hello: null, lastHeard: this.now() };
      this.outChanges = []; this.lastSent = 0; this.sentUpto = -1; this.lastBits = 0;
      this.myHashes = new Map(); this.theirHashes = new Map();
      this.onDesync = null; this.onDisconnect = null; this.onReady = null; this.onChat = null; this.onBye = null;
      this.closed = false; this.desynced = false; this.gone = false;
      this.link = hub.join('td-match-' + info.matchId, (m) => this.onMessage(m));
      this.helloSent = 0;
      this.sendHello();
      if (!o.manual) this.timer = setInterval(() => this.tick(), 250);
    }
    sendHello() { this.link.send({ t: 'hello', from: this.me.id, name: this.me.name, tank: this.me.tank, rating: this.me.rating, slot: this.info.slot, v: TD.PROTOCOL }); this.helloSent = this.now(); }
    get ready() { return !!this.remote.hello; }
    onMessage(m) {
      if (!m || m.from === this.me.id || this.closed) return;
      this.remote.lastHeard = this.now();
      if (m.t === 'hello') {
        const first = !this.remote.hello;
        this.remote.hello = m;
        if (first) { this.sendHello(); if (this.onReady) this.onReady(m); }
      } else if (m.t === 'in') {
        for (const [f, b] of m.ch) if (!this.remote.changes.length || f > this.remote.changes[this.remote.changes.length - 1][0]) this.remote.changes.push([f, b]);
        this.remote.upto = Math.max(this.remote.upto, m.upto);
      } else if (m.t === 'hash') {
        this.theirHashes.set(m.turn, m.h); this.check(m.turn);
      } else if (m.t === 'chat') { if (this.onChat) this.onChat(m.text); }
      else if (m.t === 'bye') { this.gone = true; if (this.onBye) this.onBye(); }
    }
    /** Record the local player's input for sim frame f (only frames where the sim needs it). */
    pushInput(f, bits) {
      if (bits !== this.lastBits || !this.outChanges.length && this.sentUpto < 0) { this.outChanges.push([f, bits]); this.lastBits = bits; }
      this.sentUpto = f;
    }
    /** Remote input for sim frame f, or null if it hasn't arrived yet. */
    inputAt(f) {
      if (f > this.remote.upto) return null;
      const c = this.remote.changes;
      let lo = 0, hi = c.length - 1, ans = 0;
      while (lo <= hi) { const mid = (lo + hi) >> 1; if (c[mid][0] <= f) { ans = c[mid][1]; lo = mid + 1; } else hi = mid - 1; }
      return ans;
    }
    flush() {
      if (this.sentUpto > this.flushedUpto || this.outChanges.length) {
        this.link.send({ t: 'in', from: this.me.id, upto: this.sentUpto, ch: this.outChanges.splice(0) });
        this.flushedUpto = this.sentUpto;
      }
    }
    sendHash(turn, h) { this.myHashes.set(turn, h); this.link.send({ t: 'hash', from: this.me.id, turn, h }); this.check(turn); }
    check(turn) {
      if (this.myHashes.has(turn) && this.theirHashes.has(turn) && this.myHashes.get(turn) !== this.theirHashes.get(turn) && !this.desynced) {
        this.desynced = true; if (this.onDesync) this.onDesync(turn);
      }
    }
    tick() {
      if (this.closed) return;
      this.flush();
      if (!this.ready && this.now() - this.helloSent > 1000) this.sendHello();
      this.link.send({ t: 'ping', from: this.me.id });
      if (this.now() - this.remote.lastHeard > 10000 && !this.gone) { this.gone = true; if (this.onDisconnect) this.onDisconnect(); }
    }
    close(sayBye = true) {
      if (this.closed) return;
      if (sayBye) this.link.send({ t: 'bye', from: this.me.id });
      this.closed = true;
      if (this.timer) clearInterval(this.timer);
      this.link.close();
    }
  }
  Session.prototype.flushedUpto = -1;
  TD.Session = Session;

  /** Drive a Match for one render frame. slots[i] = { kind: 'local', bits: () => n } |
   *  { kind: 'remote', session } | { kind: 'cpu', brain }. Returns frames stepped. */
  TD.driveMatch = function (m, slots, session, maxSteps) {
    let n = 0;
    while (n < maxSteps && m.phase !== 'over') {
      const a = m.needsInput();
      let bits = 0;
      if (a >= 0) {
        const s = slots[a];
        if (s.kind === 'remote') { const b = s.session.inputAt(m.frame); if (b === null) break; bits = b; }
        else if (s.kind === 'cpu') bits = s.brain.bits(m);
        else bits = s.bits();
        if (session && s.kind !== 'remote') session.pushInput(m.frame, bits);
      }
      m.step(bits);
      n++;
      if (maxSteps > 1 && a >= 0 && slots[a].kind !== 'remote') break; // local input: one frame per render frame
    }
    if (session) session.flush();
    return n;
  };

  TD.Net = { LoopbackHub, BroadcastHub, WebSocketHub, Matchmaker, Session, LOBBY };
})(globalThis.TD);
