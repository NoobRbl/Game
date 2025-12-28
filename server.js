// server.js (FULL)
import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";

import { createGameState, stepGame } from "./src/game_server.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

// ✅ serve public
app.use(express.static(path.join(__dirname, "public")));

// ✅ fix Cannot GET /
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ========= ROOM STORE =========
const rooms = new Map(); // code -> { hostSid, guestSid, G, last, interval }

function makeCode(len = 6) {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < len; i++) s += chars[(Math.random() * chars.length) | 0];
  return s;
}

function normalizeCode(v) {
  v = String(v || "").trim();
  // accept full link or hash
  const m = v.match(/ROOM=([A-Z0-9]{4,10})/i);
  if (m) v = m[1];
  v = v.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return v.slice(0, 10);
}

function createRoom() {
  let code = makeCode(6);
  while (rooms.has(code)) code = makeCode(6);

  const G = createGameState();
  // trạng thái input server lưu ở đây
  G.inputs = { host: null, guest: null };

  rooms.set(code, {
    hostSid: null,
    guestSid: null,
    G,
    last: Date.now(),
    interval: null,
  });
  return code;
}

function startRoomLoop(code) {
  const room = rooms.get(code);
  if (!room || room.interval) return;

  room.interval = setInterval(() => {
    const now = Date.now();
    const dt = Math.min(0.05, Math.max(0.001, (now - room.last) / 1000));
    room.last = now;

    // ✅ LẤY INPUT THEO SLOT
    const inpHost = room.G.inputs?.host || null;
    const inpGuest = room.G.inputs?.guest || null;

    // ✅ tick game có input
    stepGame(room.G, dt, inpHost, inpGuest);

    io.to(code).emit("state", room.G);
  }, 1000 / 30);
}

function stopRoomLoop(code) {
  const room = rooms.get(code);
  if (!room) return;
  if (room.interval) clearInterval(room.interval);
  room.interval = null;
}

// ✅ API create room (HOST thật)
app.post("/api/room", (req, res) => {
  const code = createRoom();
  res.json({ ok: true, code });
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  transports: ["websocket", "polling"],
});

io.on("connection", (socket) => {
  // ✅ ping for HUD
  socket.on("pingx", ({ t }) => socket.emit("pongx", { t }));

  socket.on("joinRoom", ({ code }) => {
    code = normalizeCode(code);

    const room = rooms.get(code);
    if (!room) {
      socket.emit("joinFail", { reason: "Room not found", code });
      return;
    }

    // assign role
    let role = "spectator";
    if (!room.hostSid) {
      room.hostSid = socket.id;
      role = "host";
    } else if (!room.guestSid) {
      room.guestSid = socket.id;
      role = "guest";
    } else {
      socket.emit("joinFail", { reason: "Room full", code });
      return;
    }

    socket.join(code);
    socket.data.code = code;
    socket.data.role = role;

    socket.emit("joined", { ok: true, role, code });

    // start tick
    startRoomLoop(code);

    // ✅ khi đủ 2 người thì set phase countdown
    if (room.hostSid && room.guestSid) {
      room.G.phase = "countdown";
      room.G.phaseT = 0;
      room.G.midText = "1";
      io.to(code).emit("countdown", { t: 3 });
      io.to(code).emit("info", { type: "status", text: "Both players ready ✅" });
    } else {
      io.to(code).emit("info", { type: "status", text: "Waiting opponent…" });
    }
  });

  // input from client
  socket.on("input", (payload) => {
    const code = socket.data.code;
    const role = socket.data.role;
    if (!code || !role) return;

    const room = rooms.get(code);
    if (!room) return;

    room.G.inputs ||= { host: null, guest: null };
    if (role === "host") room.G.inputs.host = payload;
    if (role === "guest") room.G.inputs.guest = payload;
  });

  socket.on("disconnect", () => {
    const code = socket.data.code;
    const role = socket.data.role;
    if (!code) return;

    const room = rooms.get(code);
    if (!room) return;

    if (role === "host") room.hostSid = null;
    if (role === "guest") room.guestSid = null;

    // reset inputs of leaver
    if (role === "host") room.G.inputs.host = null;
    if (role === "guest") room.G.inputs.guest = null;

    const still = room.hostSid || room.guestSid;
    if (!still) {
      stopRoomLoop(code);
      rooms.delete(code);
    } else {
      io.to(code).emit("info", { type: "status", text: "Opponent disconnected" });
      // back to lobby
      room.G.phase = "lobby";
      room.G.phaseT = 0;
      room.G.midText = "Waiting…";
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Server listening on", PORT));
