// server.js — FULL (Express + Socket.IO) 1v1 authoritative + countdown + fixed ownership
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

// ✅ Serve static from repo root OR /public if you have it.
// If your index.html is at root -> keep "__dirname"
app.use(express.static(__dirname));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));

function randInt(min, max) { return (Math.random() * (max - min + 1) + min) | 0; }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function makeRoomId() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += chars[(Math.random() * chars.length) | 0];
  return s;
}

// ===== WORLD LIMITS =====
const WORLD = {
  floorY: 0,
  left: -360,
  right: 360
};

// camera zoom clamp
const CAMERA = {
  minZoom: 0.98,
  maxZoom: 0.78,
  minDist: 160,
  maxDist: 520
};

// ===== PHYS tuned for small model =====
const PHYS = {
  moveSpeed: 160,
  moveSpeedWhileAtk: 110,

  jumpV: 410,
  gravity: 1500,

  dashSpeed: 980,
  dashTime: 0.085,
  dashTeleport: 105,
  dashCd: 0.75,
  dashDelay: 0.06
};

// ===== DAMAGE =====
// Normal attack: min200 max350, crit10% min400 max450
function rollNormalDamage() {
  const crit = Math.random() < 0.10;
  const dmg = crit ? randInt(400, 450) : randInt(200, 350);
  return { dmg, crit };
}

// Skills: giữ mạnh hơn chút, bạn không yêu cầu cụ thể nên mình set nhẹ vừa phải
function rollSkillDamage() {
  const crit = Math.random() < 0.10;
  let dmg = randInt(1209, 2290);
  if (crit) dmg = (dmg * 1.15) | 0;
  return { dmg, crit };
}

const rooms = new Map();
/**
room = {
  players: Map<sid, player>
  camX, zoom,
  phase: "lobby" | "countdown" | "fight",
  cdT: number, // countdown timer
}
*/

function ensureRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      players: new Map(),
      camX: 0,
      zoom: CAMERA.minZoom,
      phase: "lobby",
      cdT: 0
    });
  }
  return rooms.get(roomId);
}

function makePlayer(side, sid) {
  const maxHp = randInt(20109, 36098);
  return {
    sid,
    side, // "L"/"R"
    x: side === "L" ? -200 : 200,
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

    inp: { mx: 0, atk: false, dash: false, jump: false, s1: false, s2: false, ult: false, sub: false },
    edge: { atk: false, dash: false, jump: false, s1: false, s2: false, ult: false, sub: false },

    comboIdx: 0,
    _dashT: 0,
    _dashDelay: 0,
    _dashDir: 1,

    _emitFx: null,
    _emitUlt: null
  };
}

const TICK_HZ = 30;
const DT = 1 / TICK_HZ;

function tickOne(p, opp, roomPhase) {
  const dec = (k) => (p[k] = Math.max(0, p[k] - DT));
  dec("invul"); dec("stun"); dec("atkLock");
  dec("dashCd"); dec("jumpCd"); dec("s1Cd"); dec("s2Cd"); dec("ultCd"); dec("subCd");

  // ✅ lock in countdown
  const canAct = (roomPhase === "fight") && (p.stun <= 0) && (p.hp > 0);

  // movement
  let desired = clamp(p.inp.mx, -1, 1);
  if (!canAct) desired = 0;

  const speed = p.atkLock > 0 ? PHYS.moveSpeedWhileAtk : PHYS.moveSpeed;
  p.vx = desired * speed;

  // dash
  if (canAct && p.edge.dash && p.dashCd <= 0) {
    p.dashCd = PHYS.dashCd;
    p.invul = Math.max(p.invul, 0.16);
    const dir = Math.abs(p.inp.mx) > 0.15 ? Math.sign(p.inp.mx) : p.face;
    p._dashDelay = PHYS.dashDelay;
    p._dashDir = dir;
  }
  p.edge.dash = false;

  if (p._dashDelay > 0) {
    p._dashDelay = Math.max(0, p._dashDelay - DT);
    if (p._dashDelay <= 0) {
      const dir = p._dashDir || p.face;
      p.x += dir * PHYS.dashTeleport;
      p.vx = dir * PHYS.dashSpeed;
      p._dashT = PHYS.dashTime;
      p.x = clamp(p.x, WORLD.left, WORLD.right);
    }
  }
  if (p._dashT > 0) {
    p._dashT = Math.max(0, p._dashT - DT);
    if (p._dashT <= 0) p.vx *= 0.45;
  }

  // jump (double)
  if (canAct && p.edge.jump && p.jumpCd <= 0 && p.jumpsLeft > 0) {
    p.jumpCd = 0.14;
    p.jumpsLeft -= 1;
    p.grounded = false;
    const mult = (p.jumpsLeft === 0) ? 0.88 : 1.0;
    p.vy = -PHYS.jumpV * mult;
  }
  p.edge.jump = false;

  // gravity
  if (!p.grounded) p.vy += PHYS.gravity * DT;
  else p.vy = 0;

  // integrate
  p.x += p.vx * DT;
  p.y += p.vy * DT;

  // floor
  if (p.y >= WORLD.floorY) {
    p.y = WORLD.floorY;
    p.grounded = true;
    p.vy = 0;
    p.jumpsLeft = 2;
  }

  // bounds
  p.x = clamp(p.x, WORLD.left, WORLD.right);

  if (!opp) return;

  // no "hút" nhau: minimum separation
  const minSep = 62;
  const dx = p.x - opp.x;
  if (Math.abs(dx) < minSep) {
    const push = (minSep - Math.abs(dx)) * 0.5;
    p.x += Math.sign(dx || (p.side === "L" ? -1 : 1)) * push;
    p.x = clamp(p.x, WORLD.left, WORLD.right);
  }

  // face each other (only when both exist)
  p.face = p.x <= opp.x ? 1 : -1;

  const tryHit = (kind, range, width, stunTime, energyGain, fxTag, dmgRollFn) => {
    if (opp.invul > 0 || opp.hp <= 0) return null;

    const facing = p.face;
    const hitCenterX = p.x + facing * range;
    const dist = Math.abs(opp.x - hitCenterX);
    const inFront = (opp.x - p.x) * facing > 0;

    if (inFront && dist <= width) {
      const { dmg, crit } = dmgRollFn();
      opp.hp = Math.max(0, opp.hp - dmg);
      opp.stun = Math.max(opp.stun, stunTime);
      opp.invul = Math.max(opp.invul, 0.05);
      p.en = clamp(p.en + energyGain, 0, 100);
      return { kind, dmg, crit, x: (opp.x + p.x) * 0.5, y: -55, tag: fxTag };
    }
    return null;
  };

  // attack / skills
  if (canAct && p.edge.atk && p.atkLock <= 0) {
    p.edge.atk = false;
    p.atkLock = 0.22;
    p.comboIdx = (p.comboIdx + 1) % 3;

    let hit = null;
    if (p.comboIdx === 0) hit = tryHit("atk1", 72, 68, 0.14, 7, "slashA", rollNormalDamage);
    if (p.comboIdx === 1) hit = tryHit("atk2", 84, 74, 0.16, 8, "slashB", rollNormalDamage);
    if (p.comboIdx === 2) hit = tryHit("atk3", 96, 78, 0.18, 9, "slashC", rollNormalDamage);
    if (hit) p._emitFx = hit;
  } else p.edge.atk = false;

  if (canAct && p.edge.s1 && p.s1Cd <= 0) {
    p.edge.s1 = false;
    p.s1Cd = 3.2;
    p.atkLock = 0.35;
    const hit = tryHit("s1", 140, 110, 0.22, 14, "skill1", rollSkillDamage);
    if (hit) p._emitFx = hit;
  } else p.edge.s1 = false;

  if (canAct && p.edge.s2 && p.s2Cd <= 0) {
    p.edge.s2 = false;
    p.s2Cd = 4.4;
    p.atkLock = 0.40;
    p.x = clamp(p.x + p.face * 52, WORLD.left, WORLD.right);
    const hit = tryHit("s2", 155, 120, 0.26, 16, "skill2", rollSkillDamage);
    if (hit) p._emitFx = hit;
  } else p.edge.s2 = false;

  if (canAct && p.edge.sub && p.subCd <= 0) {
    p.edge.sub = false;
    p.subCd = 5.0;
    p.invul = Math.max(p.invul, 0.12);
    p.x = clamp(p.x - p.face * 70, WORLD.left, WORLD.right);
    const hit = tryHit("sub", 110, 95, 0.16, 8, "sub", rollSkillDamage);
    if (hit) p._emitFx = hit;
  } else p.edge.sub = false;

  if (canAct && p.edge.ult && p.ultCd <= 0 && p.en >= 70) {
    p.edge.ult = false;
    p.ultCd = 10.5;
    p.en = Math.max(0, p.en - 70);
    p.atkLock = 0.65;
    const hit = tryHit("ult", 210, 170, 0.55, 0, "ult", rollSkillDamage);
    if (hit) p._emitFx = hit;
    p._emitUlt = { x: p.x, y: -60 };
  } else p.edge.ult = false;

  // energy passive
  if (roomPhase === "fight") p.en = clamp(p.en + DT * 3.5, 0, 100);
}

function stepRoom(room) {
  let L = null, R = null;
  for (const p of room.players.values()) {
    if (p.side === "L") L = p;
    else R = p;
  }

  // phase logic
  if (L && R) {
    if (room.phase === "lobby") {
      room.phase = "countdown";
      room.cdT = 4.2; // 3..2..1..READY
    }
  } else {
    room.phase = "lobby";
    room.cdT = 0;
  }

  if (room.phase === "countdown") {
    room.cdT = Math.max(0, room.cdT - DT);
    if (room.cdT <= 0) room.phase = "fight";
  }

  // tick players
  if (L) tickOne(L, R, room.phase);
  if (R) tickOne(R, L, room.phase);

  // camera center + zoom (clamped) — only if 2 players
  if (L && R) {
    const camX = (L.x + R.x) * 0.5;
    room.camX = camX;

    const dist = Math.abs(L.x - R.x);
    const t = clamp((dist - CAMERA.minDist) / (CAMERA.maxDist - CAMERA.minDist), 0, 1);
    // ✅ keep zoom within band, avoid too far
    room.zoom = lerp(CAMERA.minZoom, CAMERA.maxZoom, t);
  } else if (L) {
    room.camX = L.x;
    room.zoom = CAMERA.minZoom;
  } else if (R) {
    room.camX = R.x;
    room.zoom = CAMERA.minZoom;
  }
}

// ===== socket =====
io.on("connection", (socket) => {
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

  // ✅ HARD FIX: Input only affects YOUR player (by socket.id).
  socket.on("inp", ({ seq, inp, edge }) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;

    const room = rooms.get(roomId);
    if (!room) return;

    const p = room.players.get(socket.id);
    if (!p) return;

    // save analog + held keys
    if (inp && typeof inp.mx === "number") p.inp.mx = clamp(inp.mx, -1, 1);

    const bools = ["atk", "dash", "jump", "s1", "s2", "ult", "sub"];
    for (const k of bools) p.inp[k] = !!inp?.[k];

    // edges
    if (edge) {
      for (const k of bools) if (edge[k]) p.edge[k] = true;
    }

    p._seq = (seq | 0);
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

// ===== main loop =====
setInterval(() => {
  for (const [roomId, room] of rooms) {
    stepRoom(room);

    let L = null, R = null;
    for (const p of room.players.values()) {
      if (p.side === "L") L = p;
      else R = p;
    }

    // FX collect
    const fx = { slashes: [], popups: [], sparks: [], ult: null };

    for (const p of room.players.values()) {
      if (p._emitFx) {
        fx.slashes.push({
          wx: p._emitFx.x,
          wy: p._emitFx.y,
          kind: p._emitFx.tag,
          rot: (Math.random() * 0.6 - 0.3),
          len: p._emitFx.tag === "ult" ? 240 : 160,
          w: p._emitFx.tag === "ult" ? 22 : 14,
          life: p._emitFx.tag === "ult" ? 0.30 : 0.18,
          t: 0
        });
        for (let i = 0; i < 6; i++) {
          fx.sparks.push({
            wx: p._emitFx.x + (Math.random() - 0.5) * 22,
            wy: p._emitFx.y + (Math.random() - 0.5) * 18,
            s: 6 + Math.random() * 6,
            life: 0.18 + Math.random() * 0.10,
            t: 0
          });
        }
        fx.popups.push({
          wx: p._emitFx.x,
          wy: p._emitFx.y - 30,
          text: String(p._emitFx.dmg),
          crit: !!p._emitFx.crit,
          life: 0.55,
          t: 0
        });
        p._emitFx = null;
      }
      if (p._emitUlt) {
        fx.ult = { wx: p._emitUlt.x, wy: p._emitUlt.y, life: 0.55, t: 0 };
        p._emitUlt = null;
      }
    }

    // countdown display
    let cdText = "";
    if (room.phase === "countdown") {
      const s = room.cdT;
      if (s > 3.1) cdText = "3";
      else if (s > 2.1) cdText = "2";
      else if (s > 1.1) cdText = "1";
      else cdText = "READY";
    }

    const snap = {
      t: Date.now(),
      phase: room.phase,
      cdText,
      camX: room.camX || 0,
      zoom: room.zoom || CAMERA.minZoom,
      Left: L && { x: L.x, y: L.y, face: L.face, hp: L.hp, maxHp: L.maxHp, en: L.en, invul: L.invul },
      Right: R && { x: R.x, y: R.y, face: R.face, hp: R.hp, maxHp: R.maxHp, en: R.en, invul: R.invul },
      fx
    };

    io.to(roomId).emit("snap", snap);
  }
}, 1000 / TICK_HZ);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Server listening on", PORT));
