import http from "http";
import fs from "fs";
import path from "path";
import { WebSocketServer } from "ws";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 10000;

function serveFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".json": "application/json; charset=utf-8"
  };
  const type = map[ext] || "application/octet-stream";
  try {
    const data = fs.readFileSync(filePath);
    res.writeHead(200, { "Content-Type": type });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

const server = http.createServer((req, res) => {
  let urlPath = req.url.split("?")[0];
  if (urlPath === "/") urlPath = "/index.html";

  const safePath = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(__dirname, safePath);

  // block directory traversal
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  // static serve
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    return serveFile(res, filePath);
  }

  res.writeHead(404);
  res.end("Not found");
});

const wss = new WebSocketServer({ server });

/** rooms: code -> { hostWs, guestWs } */
const rooms = new Map();

function genCode() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // tránh O/0/I/1
  let s = "";
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function send(ws, obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function cleanup(ws) {
  for (const [code, room] of rooms) {
    if (room.host === ws) room.host = null;
    if (room.guest === ws) room.guest = null;

    if (!room.host && !room.guest) rooms.delete(code);
    else {
      const other = room.host || room.guest;
      send(other, { t: "peer-left" });
    }
  }
}

wss.on("connection", (ws) => {
  ws.on("message", (buf) => {
    let msg;
    try { msg = JSON.parse(buf.toString()); } catch { return; }

    // host creates room
    if (msg.t === "host") {
      let code = genCode();
      while (rooms.has(code)) code = genCode();
      rooms.set(code, { host: ws, guest: null });
      send(ws, { t: "room", code });
      return;
    }

    // join existing room
    if (msg.t === "join") {
      const code = String(msg.code || "").toUpperCase();
      const room = rooms.get(code);
      if (!room) return send(ws, { t: "err", err: "Room not found" });
      if (room.guest) return send(ws, { t: "err", err: "Room full" });

      room.guest = ws;
      send(ws, { t: "joined", code });
      send(room.host, { t: "peer-joined" });
      return;
    }

    // leave
    if (msg.t === "leave") {
      const code = String(msg.code || "").toUpperCase();
      const room = rooms.get(code);
      if (!room) return;
      if (room.host === ws) room.host = null;
      if (room.guest === ws) room.guest = null;
      const other = room.host || room.guest;
      if (other) send(other, { t: "peer-left" });
      if (!room.host && !room.guest) rooms.delete(code);
      return;
    }

    // relay offer/answer/ice
    if (msg.t === "offer" || msg.t === "answer" || msg.t === "ice") {
      const code = String(msg.code || "").toUpperCase();
      const room = rooms.get(code);
      if (!room) return;
      const target = (room.host === ws) ? room.guest : room.host;
      if (!target) return;
      send(target, msg);
      return;
    }
  });

  ws.on("close", () => cleanup(ws));
  ws.on("error", () => cleanup(ws));
});

server.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
