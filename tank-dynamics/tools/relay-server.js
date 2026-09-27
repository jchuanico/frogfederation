#!/usr/bin/env node
/* Tank Dynamics relay — a tiny WebSocket message relay for internet matchmaking.
 *
 * GitHub Pages only serves static files, so on the live site players find each other through
 * BroadcastChannel (other tabs of the same browser). To play across the internet, run this on any
 * Node 18+ host (Render, Fly.io, a Raspberry Pi...) and open the game with
 *     https://<site>/tank-dynamics/?relay=wss://your-relay.example.com
 * or set TD.RELAY_URL in tank-dynamics/js/config.js.
 *
 * It knows nothing about the game: clients {op:'join'|'leave', room} and {op:'send', room, msg};
 * every `send` is forwarded as {room, msg} to the room's other members. No dependencies —
 * just the WebSocket handshake + framing from RFC 6455.
 *
 *   node tank-dynamics/tools/relay-server.js [port]      (default 8787, or $PORT)
 */
'use strict';
const http = require('http');
const crypto = require('crypto');

function createRelay({ port = 8787, log = console.log, maxRoomsPerClient = 8, maxMsgBytes = 64 * 1024 } = {}) {
  const rooms = new Map(); // room -> Set<client>
  const clients = new Set();

  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(`Tank Dynamics relay: ${clients.size} connected, ${rooms.size} rooms\n`);
  });

  server.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'];
    if (!key || (req.headers.upgrade || '').toLowerCase() !== 'websocket') { socket.destroy(); return; }
    const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
    socket.setNoDelay(true);
    const client = { socket, rooms: new Set(), buf: Buffer.alloc(0), frag: [] };
    clients.add(client);
    socket.on('data', (d) => { client.buf = Buffer.concat([client.buf, d]); parse(client); });
    const bye = () => drop(client);
    socket.on('close', bye); socket.on('error', bye); socket.on('end', bye);
  });

  function drop(c) {
    if (!clients.has(c)) return;
    clients.delete(c);
    for (const r of c.rooms) leave(c, r);
    try { c.socket.destroy(); } catch (e) { /* gone */ }
  }
  function leave(c, room) {
    const s = rooms.get(room); if (!s) return;
    s.delete(c); c.rooms.delete(room);
    if (!s.size) rooms.delete(room);
  }

  function frame(opcode, payload) {
    const len = payload.length;
    let head;
    if (len < 126) head = Buffer.from([0x80 | opcode, len]);
    else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | opcode; head[1] = 126; head.writeUInt16BE(len, 2); }
    else { head = Buffer.alloc(10); head[0] = 0x80 | opcode; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
    return Buffer.concat([head, payload]);
  }
  function sendText(c, str) { try { c.socket.write(frame(1, Buffer.from(str))); } catch (e) { drop(c); } }

  function parse(c) {
    for (;;) {
      const b = c.buf;
      if (b.length < 2) return;
      const fin = (b[0] & 0x80) !== 0, op = b[0] & 0x0f, masked = (b[1] & 0x80) !== 0;
      let len = b[1] & 0x7f, off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); off = 10; }
      if (len > maxMsgBytes) { drop(c); return; }
      const need = off + (masked ? 4 : 0) + len;
      if (b.length < need) return;
      let payload = b.subarray(off + (masked ? 4 : 0), need);
      if (masked) { const mask = b.subarray(off, off + 4); payload = Buffer.from(payload); for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3]; }
      c.buf = b.subarray(need);
      if (op === 8) { try { c.socket.write(frame(8, Buffer.alloc(0))); } catch (e) { /* closing */ } drop(c); return; }
      if (op === 9) { try { c.socket.write(frame(10, payload)); } catch (e) { /* closing */ } continue; }
      if (op === 10) continue;
      if (op === 1 || op === 0) {
        c.frag.push(payload);
        if (!fin) continue;
        const text = Buffer.concat(c.frag).toString('utf8'); c.frag = [];
        handle(c, text);
      }
    }
  }

  function handle(c, text) {
    let m; try { m = JSON.parse(text); } catch (e) { return; }
    if (!m || typeof m.room !== 'string' || m.room.length > 80) return;
    if (m.op === 'join') {
      if (c.rooms.size >= maxRoomsPerClient) return;
      if (!rooms.has(m.room)) rooms.set(m.room, new Set());
      rooms.get(m.room).add(c); c.rooms.add(m.room);
    } else if (m.op === 'leave') leave(c, m.room);
    else if (m.op === 'send') {
      const s = rooms.get(m.room); if (!s || !c.rooms.has(m.room)) return;
      const out = JSON.stringify({ room: m.room, msg: m.msg });
      for (const o of s) if (o !== c) sendText(o, out);
    }
  }

  return {
    server, rooms, clients,
    listen() { return new Promise((res) => server.listen(port, () => { log(`relay listening on :${server.address().port}`); res(server.address().port); })); },
    close() { for (const c of [...clients]) drop(c); return new Promise((res) => server.close(() => res())); },
  };
}

if (require.main === module) {
  const port = +(process.argv[2] || process.env.PORT || 8787);
  createRelay({ port }).listen();
}
module.exports = { createRelay };
