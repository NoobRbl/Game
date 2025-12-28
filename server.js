import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

// ===== SERVE PUBLIC =====
app.use(express.static(path.join(__dirname, "public")));
app.get("/", (_, res) =>
  res.sendFile(path.join(__dirname, "public", "index.html"))
);

// ===== ROOM STORE =====
const rooms = new Map(); // code -> { host, guest }

function makeCode(len = 5) {
  const c = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < len; i++) s += c[(Math.random() * c.length) | 0];
  return s;
}

// ===== API CREATE ROOM =====
app.post("/api/room", (req, res) => {
  let code = makeCode();
  while (rooms.has(code)) code = makeCode();
  rooms.set(code, { host: null, guest: null });
  console.log("Created room:", code);
  res.json({ ok: true, code });
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  transports: ["websocket", "polling"]
});

// ===== SOCKET =====
io.on("connection", (socket) => {
  console.log("Socket connected", socket.id);

  socket.on("joinRoom", ({ code }) => {
    const room = rooms.get(code);
    if (!room) {
      socket.emit("joinFail", { reason: "Room not found" });
      return;
    }

    let role = "spectator";
    if (!room.host) {
      room.host = socket.id;
      role = "host";
    } else if (!room.guest) {
      room.guest = socket.id;
      role = "guest";
    } else {
      socket.emit("joinFail", { reason: "Room full" });
      return;
    }

    socket.join(code);
    socket.data.code = code;
    socket.data.role = role;

    socket.emit("joined", { ok: true, role, code });
    console.log(`Socket ${socket.id} joined ${code} as ${role}`);
  });

  socket.on("disconnect", () => {
    const code = socket.data.code;
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;

    if (room.host === socket.id) room.host = null;
    if (room.guest === socket.id) room.guest = null;

    if (!room.host && !room.guest) {
      rooms.delete(code);
      console.log("Deleted room", code);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Server listening on", PORT));
