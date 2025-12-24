// server.js
// WebRTC signaling server (1 code = join) + serve static index.html
// Run: node server.js
// Open: http://localhost:8080

import http from "http";
import fs from "fs";
import path from "path";
import { WebSocketServer } from "ws";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 8080;

const INDEX_PATH = path.join(__dirname, "index.html");
const indexHtml = fs.existsSync(INDEX_PATH)
  ? fs.readFileSync(INDEX_PATH, "utf8")
  : `<!doctype html><meta charset="utf-8"><title>Missing index.html</title><h1>Put index.html next to server.js</h1>`;

const server = http.createServer((req, res) => {
  // simple static: only index + health
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
    return;
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(indexHtml);
});

const wss = new WebSocketServer({ server });

// ---- Rooms memory (in-RAM) ----
/*
room = {
  host: ws,
  guest: ws|null,
  createdAt: number
}
*/
const rooms = new Map(); // code -> room

function makeCode() {
  // 6 chars, avoid confusing ones
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 6; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

function createRoom(ws) {
  let code;
  do { code = makeCode(); } while (rooms.has(code));
  rooms.set(code, { host: ws, guest: null, createdAt: Date.now() });
  ws._roomCode = code;
  ws._role = "host";
  return code;
}

function joinRoom(ws, code) {
  const room = rooms.get(code);
  if (!room) return { ok: false, err: "ROOM_NOT_FOUND" };
  if (!room.host || room.host.readyState !== 1) return { ok: false, err: "HOST_OFFLINE" };
  if (room.guest && room.guest.readyState === 1) return { ok: false, err: "ROOM_FULL" };

  room.guest = ws;
  ws._roomCode = code;
  ws._role = "guest";
  return { ok: true, room };
}

function otherPeer(room, ws) {
  return ws === room.host ? room.guest : room.host;
}

function safeSend(ws, obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}

// cleanup old empty rooms
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    const hostDead = !room.host || room.host.readyState !== 1;
    const guestDead = !room.guest || room.guest.readyState !== 1;

    // if both gone or too old with no guest, remove
    if ((hostDead && guestDead) || (guestDead && now - room.createdAt > 1000 * 60 * 30)) {
      rooms.delete(code);
    }
  }
}, 15000);

wss.on("connection", (ws) => {
  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    // Client -> Server protocol:
    // {t:"host"} -> {t:"room", code}
    // {t:"join", code} -> {t:"joined", code} + notify host {t:"peer-joined"}
    // {t:"offer", code, sdp}
    // {t:"answer", code, sdp}
    // {t:"ice", code, candidate}
    // {t:"leave", code}

    if (msg.t === "host") {
      const code = createRoom(ws);
      safeSend(ws, { t: "room", code });
      return;
    }

    if (msg.t === "join") {
      const code = String(msg.code || "").trim().toUpperCase();
      const r = joinRoom(ws, code);
      if (!r.ok) {
        safeSend(ws, { t: "err", err: r.err });
        return;
      }
      safeSend(ws, { t: "joined", code });
      safeSend(r.room.host, { t: "peer-joined", code });
      return;
    }

    if (msg.t === "leave") {
      const code = String(msg.code || "").trim().toUpperCase();
      const room = rooms.get(code);
      if (!room) return;
      // detach
      if (ws === room.host) room.host = null;
      if (ws === room.guest) room.guest = null;
      const peer = otherPeer(room, ws);
      safeSend(peer, { t: "peer-left" });
      if ((!room.host || room.host.readyState !== 1) && (!room.guest || room.guest.readyState !== 1)) {
        rooms.delete(code);
      }
      return;
    }

    // relay signals
    if (msg.t === "offer" || msg.t === "answer" || msg.t === "ice") {
      const code = String(msg.code || "").trim().toUpperCase();
      const room = rooms.get(code);
      if (!room) {
        safeSend(ws, { t: "err", err: "ROOM_NOT_FOUND" });
        return;
      }
      const peer = otherPeer(room, ws);
      // relay as-is
      safeSend(peer, msg);
      return;
    }
  });

  ws.on("close", () => {
    const code = ws._roomCode;
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;

    if (ws === room.host) room.host = null;
    if (ws === room.guest) room.guest = null;

    const peer = otherPeer(room, ws);
    safeSend(peer, { t: "peer-left" });

    const hostDead = !room.host || room.host.readyState !== 1;
    const guestDead = !room.guest || room.guest.readyState !== 1;
    if (hostDead && guestDead) rooms.delete(code);
  });

  safeSend(ws, { t: "hello" });
});

server.listen(PORT, () => {
  console.log(`Server running: http://localhost:${PORT}`);
});