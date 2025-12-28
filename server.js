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

// ✅ default input để tránh undefined
function emptyInput() {
  return { mx: 0, atk: false, jump: false, dash: false, s1: false, s2: false, ult: false, sub: false };
}

// ✅ sanitize + clone input để không “dính object”
function safeInput(payload) {
  return {
    mx: Math.max(-1, Math.min(1, Number(payload?.mx ?? 0))),
    atk: !!payload?.atk,
    jump: !!payload?.jump,
    dash: !!payload?.dash,
    s1: !!payload?.s1,
    s2: !!payload?.s2,
    ult: !!payload?.ult,
    sub: !!payload?.sub,
  };
}

function createRoom() {
  let code = makeCode(5);
  while (rooms.has(code)) code = makeCode(5);

  const G = createGameState();
  // ✅ khởi tạo input tách riêng ngay từ đầu
  G.inputs = { host: emptyInput(), guest: emptyInput() };

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

  room.interval = setInterval(() => {
    const now = Date.now();
    const dt = Math.min(0.05, Math.max(0.001, (now - room.last) / 1000));
    room.last = now;

    // ✅ lấy input riêng cho từng người
    room.G.inputs ||= { host: emptyInput(), guest: emptyInput() };
    const inpL = room.G.inputs.host || emptyInput();
    const inpR = room.G.inputs.guest || emptyInput();

    // ✅ FIX quan trọng: gọi đúng signature
    stepGame(room.G, dt, inpL, inpR);

    io.to(code).emit("state", room.G);
  }, 1000 / 30);
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

// ========= SOCKET =========
io.on("connection", (socket) => {
  // ✅ ping support
  socket.on("pingx", (data) => socket.emit("pongx", data));

  socket.on("joinRoom", ({ code }) => {
    const room = rooms.get(code);
    if (!room) {
      socket.emit("joinFail", { reason: "Room not found" });
      return;
    }

    let role = "spectator";
    if (!room.hostSid) {
      room.hostSid = socket.id;
      role = "host";
    } else if (!room.guestSid) {
      room.guestSid = socket.id;
      role = "guest";
    } else {
      socket.emit("joinFail", { reason: "Room full" });
      return;
    }

    socket.join(code);
    socket.data.code = code;
    socket.data.role = role;

    // đảm bảo inputs có sẵn
    room.G.inputs ||= { host: emptyInput(), guest: emptyInput() };

    socket.emit("joined", { ok: true, role, code, G: room.G });

    // start loop when at least 1 player
    startRoomLoop(code, io);

    // countdown start when both players present
    if (room.hostSid && room.guestSid) {
      // ✅ đồng bộ phase countdown trong state luôn (để client nào cũng giống nhau)
      room.G.phase = "countdown";
      room.G.phaseT = 0;
      room.G.midText = "3";
      io.to(code).emit("countdown", { t: 3 });
    }
  });

  // inputs from clients
  socket.on("input", (payload) => {
    const code = socket.data.code;
    const role = socket.data.role;
    if (!code || !role) return;

    const room = rooms.get(code);
    if (!room) return;

    room.G.inputs ||= { host: emptyInput(), guest: emptyInput() };

    const inp = safeInput(payload);

    if (role === "host") room.G.inputs.host = inp;
    if (role === "guest") room.G.inputs.guest = inp;
  });

  socket.on("disconnect", () => {
    const code = socket.data.code;
    const role = socket.data.role;
    if (!code) return;

    const room = rooms.get(code);
    if (!room) return;

    // ✅ reset input để không kẹt nút
    room.G.inputs ||= { host: emptyInput(), guest: emptyInput() };
    if (role === "host") room.G.inputs.host = emptyInput();
    if (role === "guest") room.G.inputs.guest = emptyInput();

    if (role === "host") room.hostSid = null;
    if (role === "guest") room.guestSid = null;

    const still = room.hostSid || room.guestSid;
    if (!still) {
      stopRoomLoop(code);
      rooms.delete(code);
    } else {
      io.to(code).emit("info", { msg: "Opponent disconnected" });
      // đưa về lobby nếu thiếu người
      room.G.phase = "lobby";
      room.G.phaseT = 0;
      room.G.midText = "Waiting player…";
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Server listening on", PORT));
