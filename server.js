// server.js (FULL)
import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";

import { createGameState, stepGame } from "./src/game.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

// serve public
app.use(express.static(path.join(__dirname, "public")));

// FIX Cannot GET /
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ========= ROOM STORE =========
const rooms = new Map(); // code -> { hostSid, guestSid, G, last, interval }

function makeCode(len = 5) {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < len; i++) s += chars[(Math.random() * chars.length) | 0];
  return s;
}

function createRoom() {
  let code = makeCode(5);
  while (rooms.has(code)) code = makeCode(5);

  const G = createGameState();
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

function startRoomLoop(code, io) {
  const room = rooms.get(code);
  if (!room || room.interval) return;

  room.last = Date.now();
  room.interval = setInterval(() => {
    const now = Date.now();
    const dt = Math.min(0.05, Math.max(0.001, (now - room.last) / 1000));
    room.last = now;

    // ✅ IMPORTANT: stepGame cần input host/guest
    const inpH = room.G.inputs?.host || null;
    const inpG = room.G.inputs?.guest || null;
    stepGame(room.G, dt, inpH, inpG);

    io.to(code).emit("state", room.G);
  }, 1000 / 30); // 30fps server tick (nhẹ)
}

function stopRoomLoop(code) {
  const room = rooms.get(code);
  if (!room) return;
  if (room.interval) clearInterval(room.interval);
  room.interval = null;
}

// API create room
app.post("/api/room", (req, res) => {
  const code = createRoom();
  res.json({ ok: true, code });
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  transports: ["websocket", "polling"],
});

// helper: normalize code from client
function normalizeRoomCode(raw) {
  raw = String(raw || "").trim();
  const m = raw.match(/ROOM=([A-Z0-9]+)/i);
  if (m) raw = m[1];
  raw = raw.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return raw.slice(0, 5);
}

// ========= SOCKET =========
io.on("connection", (socket) => {
  // ✅ ping
  socket.on("pingx", ({ t }) => socket.emit("pongx", { t }));

  socket.on("joinRoom", ({ code }) => {
    const norm = normalizeRoomCode(code);

    const room = rooms.get(norm);
    if (!room) {
      socket.emit("joinFail", { reason: "Room not found", code: norm });
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
      socket.emit("joinFail", { reason: "Room full", code: norm });
      return;
    }

    socket.join(norm);
    socket.data.code = norm;
    socket.data.role = role;

    socket.emit("joined", { ok: true, role, code: norm, G: room.G });

    startRoomLoop(norm, io);

    // countdown when both present
    if (room.hostSid && room.guestSid) {
      room.G.phase = "countdown";
      room.G.phaseT = 0;
      io.to(norm).emit("countdown", { t: 3 });
    } else {
      room.G.phase = "lobby";
      room.G.phaseT = 0;
    }
  });

  // inputs from clients
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

    const still = room.hostSid || room.guestSid;
    if (!still) {
      stopRoomLoop(code);
      rooms.delete(code);
    } else {
      room.G.phase = "lobby";
      room.G.phaseT = 0;
      io.to(code).emit("info", { msg: "Opponent disconnected" });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Server listening on", PORT));
