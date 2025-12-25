// server.js — FULL (Express + Socket.IO) — ONLINE 1v1 authoritative server
import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.join(__dirname, "public")));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

function randInt(min, max) { return (Math.random() * (max - min + 1) + min) | 0; }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function makeRoomId() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += chars[(Math.random() * chars.length) | 0];
  return s;
}

// ===== WORLD =====
const WORLD = {
  floorY: 0,
  left: -420,
  right: 420
};

// ===== CAMERA =====
const CAMERA = {
  minZoom: 1.0,  // gần
  maxZoom: 0.78, // xa
  minDist: 160,
  maxDist: 560
};

// ===== PHYS (model nhỏ, chạy hợp) =====
const PHYS = {
  moveSpeed: 175,
  moveSpeedWhileAtk: 120,
  jumpV: 395,
  gravity: 1550,

  dashTeleport: 120,
  dashSpeed: 980,
  dashTime: 0.09,
  dashDelay: 0.055,
  dashCd: 0.75,
};

// ===== DAMAGE =====
// Normal: min200 max350 ; crit 10%: min400 max450
function rollNormalDamage() {
  const crit = Math.random() < 0.10;
  const dmg = crit ? randInt(400, 450) : randInt(200, 350);
  return { dmg, crit };
}
// Skill: min1209 max2290 (crit 10% tăng 15%)
function rollSkillDamage() {
  const crit = Math.random() < 0.10;
  let dmg = randInt(1209, 2290);
  if (crit) dmg = (dmg * 1.15) | 0;
  return { dmg, crit };
}

const rooms = new Map();

function ensureRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      players: new Map(),
      phase: "lobby", // lobby -> countdown -> fight
      cdT: 0,
      camX: 0,
      zoom: CAMERA.minZoom,
      fxQueue: [],
    });
  }
  return rooms.get(roomId);
}

function makePlayer(side, sid) {
  const maxHp = randInt(20109, 36098);
  return {
    sid,
    side,          // "L" or "R"
    x: side === "L" ? -220 : 220,
    y: 0,
    vx: 0,
    vy: 0,
    face: side === "L" ? 1 : -1,

    grounded: true,
    jumpsLeft: 2,

    hp: maxHp,
    maxHp,
    en: 0,

    invul: 0,
    stun: 0,
    atkLock: 0,

    dashCd: 0,
    jumpCd: 0,
    s1Cd: 0,
    s2Cd: 0,
    ultCd: 0,
    subCd: 0,

    // input from that socket only
    inp: { mx: 0, atk: false, dash: false, jump: false, s1: false, s2: false, ult: false, sub: false },
    edge: { atk: false, dash: false, jump: false, s1: false, s2: false, ult: false, sub: false },

    combo: 0,

    _dashDelay: 0,
    _dashT: 0,
    _dashDir: 1,

    _emit: null,
    _emitUlt: null,
  };
}

const TICK_HZ = 30;
const DT = 1 / TICK_HZ;

function tickPlayer(p, opp, phase, fxOut) {
  const dec = (k) => (p[k] = Math.max(0, p[k] - DT));
  dec("invul"); dec("stun"); dec("atkLock");
  dec("dashCd"); dec("jumpCd"); dec("s1Cd"); dec("s2Cd"); dec("ultCd"); dec("subCd");

  const canAct = (phase === "fight") && (p.hp > 0) && (p.stun <= 0);

  // movement
  let mx = canAct ? clamp(p.inp.mx, -1, 1) : 0;
  const speed = p.atkLock > 0 ? PHYS.moveSpeedWhileAtk : PHYS.moveSpeed;
  p.vx = mx * speed;

  // dash (teleport-like but still dash anim)
  if (canAct && p.edge.dash && p.dashCd <= 0) {
    p.edge.dash = false;
    p.dashCd = PHYS.dashCd;
    p.invul = Math.max(p.invul, 0.16);
    p._dashDelay = PHYS.dashDelay;
    p._dashDir = (Math.abs(mx) > 0.15) ? Math.sign(mx) : p.face;
  } else {
    p.edge.dash = false;
  }

  if (p._dashDelay > 0) {
    p._dashDelay = Math.max(0, p._dashDelay - DT);
    if (p._dashDelay <= 0) {
      const dir = p._dashDir || p.face;
      p.x = clamp(p.x + dir * PHYS.dashTeleport, WORLD.left, WORLD.right);
      p.vx = dir * PHYS.dashSpeed;
      p._dashT = PHYS.dashTime;
      fxOut.push({ type: "dash", x: p.x, y: -36, side: p.side });
    }
  }

  if (p._dashT > 0) {
    p._dashT = Math.max(0, p._dashT - DT);
    if (p._dashT <= 0) p.vx *= 0.45;
  }

  // jump + double jump
  if (canAct && p.edge.jump && p.jumpCd <= 0 && p.jumpsLeft > 0) {
    p.edge.jump = false;
    p.jumpCd = 0.14;
    p.jumpsLeft -= 1;
    p.grounded = false;
    const mult = (p.jumpsLeft === 0) ? 0.88 : 1.0;
    p.vy = -PHYS.jumpV * mult;
    fxOut.push({ type: "jump", x: p.x, y: -18, side: p.side });
  } else {
    p.edge.jump = false;
  }

  // gravity
  if (!p.grounded) p.vy += PHYS.gravity * DT;
  else p.vy = 0;

  p.x += p.vx * DT;
  p.y += p.vy * DT;

  // floor
  if (p.y >= WORLD.floorY) {
    p.y = WORLD.floorY;
    p.vy = 0;
    p.grounded = true;
    p.jumpsLeft = 2;
  } else {
    p.grounded = false;
  }

  // world clamp
  p.x = clamp(p.x, WORLD.left, WORLD.right);

  if (!opp) return;

  // no magnet / no "hút nhau": only prevent overlap
  const minSep = 66;
  const dx = p.x - opp.x;
  if (Math.abs(dx) < minSep) {
    const push = (minSep - Math.abs(dx)) * 0.5;
    const sgn = Math.sign(dx || (p.side === "L" ? -1 : 1));
    p.x = clamp(p.x + sgn * push, WORLD.left, WORLD.right);
  }

  // face each other
  p.face = p.x <= opp.x ? 1 : -1;

  const tryHit = (range, width, stunTime, enGain, tag, dmgFn) => {
    if (opp.invul > 0 || opp.hp <= 0) return null;
    const facing = p.face;
    const hitCenterX = p.x + facing * range;
    const dist = Math.abs(opp.x - hitCenterX);
    const inFront = (opp.x - p.x) * facing > 0;

    if (inFront && dist <= width) {
      const { dmg, crit } = dmgFn();
      opp.hp = Math.max(0, opp.hp - dmg);
      opp.stun = Math.max(opp.stun, stunTime);
      opp.invul = Math.max(opp.invul, 0.06);
      p.en = clamp(p.en + enGain, 0, 100);
      return { dmg, crit, x: (opp.x + p.x) * 0.5, y: -58, tag, by: p.side };
    }
    return null;
  };

  // random normal attacks (variety)
  if (canAct && p.edge.atk && p.atkLock <= 0) {
    p.edge.atk = false;
    p.atkLock = 0.22;
    p.combo = (p.combo + 1) % 3;

    // 3 kiểu chém khác nhau
    const r = Math.random();
    let hit = null;
    if (r < 0.34) hit = tryHit(82, 72, 0.14, 7, "slashA", rollNormalDamage);
    else if (r < 0.67) hit = tryHit(96, 80, 0.16, 8, "slashB", rollNormalDamage);
    else hit = tryHit(112, 88, 0.18, 9, "slashC", rollNormalDamage);

    if (hit) fxOut.push({ type: "hit", ...hit });
    else fxOut.push({ type: "swing", x: p.x + p.face * 86, y: -52, tag: "miss", by: p.side });
  } else {
    p.edge.atk = false;
  }

  // skills
  if (canAct && p.edge.s1 && p.s1Cd <= 0) {
    p.edge.s1 = false;
    p.s1Cd = 3.2;
    p.atkLock = 0.32;
    const hit = tryHit(150, 125, 0.24, 14, "skill1", rollSkillDamage);
    fxOut.push({ type: "skillCast", x: p.x, y: -54, tag: "s1", by: p.side });
    if (hit) fxOut.push({ type: "hit", ...hit });
  } else p.edge.s1 = false;

  if (canAct && p.edge.s2 && p.s2Cd <= 0) {
    p.edge.s2 = false;
    p.s2Cd = 4.4;
    p.atkLock = 0.38;
    p.x = clamp(p.x + p.face * 58, WORLD.left, WORLD.right);
    const hit = tryHit(165, 140, 0.28, 16, "skill2", rollSkillDamage);
    fxOut.push({ type: "skillCast", x: p.x, y: -54, tag: "s2", by: p.side });
    if (hit) fxOut.push({ type: "hit", ...hit });
  } else p.edge.s2 = false;

  if (canAct && p.edge.sub && p.subCd <= 0) {
    p.edge.sub = false;
    p.subCd = 5.0;
    p.invul = Math.max(p.invul, 0.12);
    p.x = clamp(p.x - p.face * 76, WORLD.left, WORLD.right);
    const hit = tryHit(120, 110, 0.18, 10, "sub", rollSkillDamage);
    fxOut.push({ type: "skillCast", x: p.x, y: -54, tag: "sub", by: p.side });
    if (hit) fxOut.push({ type: "hit", ...hit });
  } else p.edge.sub = false;

  // ult cinematic-lite (server triggers overlay)
  if (canAct && p.edge.ult && p.ultCd <= 0 && p.en >= 70) {
    p.edge.ult = false;
    p.ultCd = 10.5;
    p.en = Math.max(0, p.en - 70);
    p.atkLock = 0.66;

    fxOut.push({ type: "ultStart", x: p.x, y: -56, by: p.side });
    const hit = tryHit(230, 190, 0.55, 0, "ult", rollSkillDamage);
    if (hit) fxOut.push({ type: "hit", ...hit });
  } else p.edge.ult = false;

  // passive energy gain
  if (phase === "fight") p.en = clamp(p.en + DT * 3.3, 0, 100);
}

function stepRoom(room) {
  let L = null, R = null;
  for (const p of room.players.values()) {
    if (p.side === "L") L = p; else R = p;
  }

  // phase transitions
  if (L && R) {
    if (room.phase === "lobby") { room.phase = "countdown"; room.cdT = 4.2; }
  } else {
    room.phase = "lobby";
    room.cdT = 0;
  }
  if (room.phase === "countdown") {
    room.cdT = Math.max(0, room.cdT - DT);
    if (room.cdT <= 0) room.phase = "fight";
  }

  const fx = [];
  if (L) tickPlayer(L, R, room.phase, fx);
  if (R) tickPlayer(R, L, room.phase, fx);

  // camera follow both players + zoom
  if (L && R) {
    room.camX = (L.x + R.x) * 0.5;
    const dist = Math.abs(L.x - R.x);
    const t = clamp((dist - CAMERA.minDist) / (CAMERA.maxDist - CAMERA.minDist), 0, 1);
    room.zoom = lerp(CAMERA.minZoom, CAMERA.maxZoom, t);

    // clamp camera to map center (avoid going too far)
    const camHalf = 360; // approximate visible half-width in world units
    room.camX = clamp(room.camX, WORLD.left + camHalf, WORLD.right - camHalf);
  } else if (L) { room.camX = L.x; room.zoom = CAMERA.minZoom; }
  else if (R) { room.camX = R.x; room.zoom = CAMERA.minZoom; }

  room.fxQueue = fx;
}

io.on("connection", (socket) => {
  // ping
  socket.on("ping2", () => socket.emit("pong2"));

  socket.on("room:create", (_, cb) => {
    const id = makeRoomId();
    ensureRoom(id);
    cb?.({ ok: true, roomId: id });
  });

  socket.on("room:join", ({ roomId }, cb) => {
    roomId = String(roomId || "").toUpperCase().slice(0, 12);
    if (!roomId) return cb?.({ ok: false, err: "NO_ROOM" });

    const room = ensureRoom(roomId);
    if (room.players.size >= 2) return cb?.({ ok: false, err: "FULL" });

    const side = room.players.size === 0 ? "L" : "R";
    const p = makePlayer(side, socket.id);
    room.players.set(socket.id, p);

    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.side = side;

    cb?.({ ok: true, roomId, side });
    io.to(roomId).emit("room:info", { count: room.players.size });
  });

  // ✅ FIX TRÙNG: server only updates player by socket.id
  socket.on("inp", ({ inp, edge }) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;
    const p = room.players.get(socket.id);
    if (!p) return;

    if (inp && typeof inp.mx === "number") p.inp.mx = clamp(inp.mx, -1, 1);

    const keys = ["atk", "dash", "jump", "s1", "s2", "ult", "sub"];
    for (const k of keys) p.inp[k] = !!inp?.[k];

    if (edge) {
      for (const k of keys) if (edge[k]) p.edge[k] = true;
    }
  });

  socket.on("disconnect", () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;

    room.players.delete(socket.id);
    if (room.players.size === 0) rooms.delete(roomId);
    else io.to(roomId).emit("room:info", { count: room.players.size });
  });
});

// main loop
setInterval(() => {
  for (const [roomId, room] of rooms) {
    stepRoom(room);

    let L = null, R = null;
    for (const p of room.players.values()) {
      if (p.side === "L") L = p; else R = p;
    }

    // countdown text
    let cdText = "";
    if (room.phase === "countdown") {
      const s = room.cdT;
      if (s > 3.1) cdText = "3";
      else if (s > 2.1) cdText = "2";
      else if (s > 1.1) cdText = "1";
      else cdText = "READY";
    }

    io.to(roomId).emit("snap", {
      t: Date.now(),
      phase: room.phase,
      cdText,

      camX: room.camX || 0,
      zoom: room.zoom || CAMERA.minZoom,

      world: { left: WORLD.left, right: WORLD.right, floorY: WORLD.floorY },

      Left: L && { x: L.x, y: L.y, face: L.face, hp: L.hp, maxHp: L.maxHp, en: L.en, invul: L.invul, stun: L.stun, atkLock: L.atkLock },
      Right: R && { x: R.x, y: R.y, face: R.face, hp: R.hp, maxHp: R.maxHp, en: R.en, invul: R.invul, stun: R.stun, atkLock: R.atkLock },

      fx: room.fxQueue || [],
    });
  }
}, 1000 / TICK_HZ);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Server listening on", PORT));
