// server.js (Node + Express + Socket.IO) — FULL
import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.join(__dirname, "public")));
app.get("/health", (_, res) => res.send("ok"));

// ===== helpers =====
function randInt(min, max) {
  return (Math.random() * (max - min + 1) + min) | 0;
}
function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}
function makeRoomId() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += chars[(Math.random() * chars.length) | 0];
  return s;
}

// ===== world/camera =====
const WORLD = {
  floorY: 0,
  left: -420,  // giới hạn map
  right: 420,
};

const CAMERA = {
  minZoom: 0.92, // gần
  maxZoom: 0.62, // xa (nhìn rộng)
  minDist: 140,
  maxDist: 560,
};

// ===== physics (model nhỏ => tốc độ/nhảy phù hợp) =====
const PHYS = {
  moveSpeed: 175,
  moveSpeedWhileAtk: 120,

  jumpV: 430,      // thấp hơn
  gravity: 1500,

  dashSpeed: 1050,   // nhanh
  dashTime: 0.08,    // ngắn
  dashTeleport: 110, // dịch chuyển tức thời (teleport-like)
  dashCd: 0.70,
  dashDelay: 0.06,   // delay để có “anim”
};

// ===== rooms =====
/**
 * roomId -> {
 *   players: Map<socketId, player>,
 *   camX, zoom
 * }
 */
const rooms = new Map();

function ensureRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      players: new Map(),
      camX: 0,
      zoom: CAMERA.minZoom,
    });
  }
  return rooms.get(roomId);
}

function makePlayer(side) {
  const maxHp = randInt(20109, 36098);
  return {
    side, // "L" or "R"
    x: side === "L" ? -220 : 220,
    y: 0,
    vx: 0,
    vy: 0,
    face: side === "L" ? 1 : -1,
    grounded: true,
    jumpsLeft: 2, // ✅ double jump

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
    _emitUlt: null,
  };
}

// ===== damage =====
function damageRoll() {
  // skill dmg theo yêu cầu: min 1209 max 2290
  const crit = Math.random() < 0.15; // 15%
  let dmg = randInt(1209, 2290);
  if (crit) dmg = clamp((dmg * 1.25) | 0, 1209, 2600);
  return { dmg, crit };
}

// ===== tick =====
const TICK_HZ = 30;
const DT = 1 / TICK_HZ;

function tickOne(p, opp) {
  const dec = (k) => (p[k] = Math.max(0, p[k] - DT));
  dec("invul"); dec("stun"); dec("atkLock");
  dec("dashCd"); dec("jumpCd"); dec("s1Cd"); dec("s2Cd"); dec("ultCd"); dec("subCd");

  if (!opp) return;

  const canAct = p.stun <= 0;

  // movement (vừa đánh vừa đi nhưng chậm hơn)
  let desired = clamp(p.inp.mx, -1, 1);
  if (!canAct) desired = 0;

  const speed = p.atkLock > 0 ? PHYS.moveSpeedWhileAtk : PHYS.moveSpeed;
  p.vx = desired * speed;

  // ===== dash (teleport-like + delay) =====
  if (canAct && p.edge.dash && p.dashCd <= 0) {
    p.dashCd = PHYS.dashCd;
    p.invul = Math.max(p.invul, 0.16);

    const dir = Math.abs(p.inp.mx) > 0.15 ? Math.sign(p.inp.mx) : p.face;
    p._dashDelay = PHYS.dashDelay;
    p._dashDir = dir;
  }
  p.edge.dash = false;

  // dash delay -> start dash burst + teleport
  if (p._dashDelay && p._dashDelay > 0) {
    p._dashDelay = Math.max(0, p._dashDelay - DT);
    if (p._dashDelay <= 0) {
      const dir = p._dashDir || p.face;

      p.x += dir * PHYS.dashTeleport; // teleport step
      p.vx = dir * PHYS.dashSpeed;    // burst
      p._dashT = PHYS.dashTime;

      p.x = clamp(p.x, WORLD.left, WORLD.right);
    }
  }

  // dash timer friction
  if (p._dashT && p._dashT > 0) {
    p._dashT = Math.max(0, p._dashT - DT);
    if (p._dashT <= 0) p.vx *= 0.45;
  }

  // ===== jump + double jump =====
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
    p.jumpsLeft = 2; // reset double jump
  }

  // bounds
  p.x = clamp(p.x, WORLD.left, WORLD.right);

  // stop "hút" nhau: giữ khoảng cách tối thiểu
  const minSep = 62;
  const dx = p.x - opp.x;
  if (Math.abs(dx) < minSep) {
    const push = (minSep - Math.abs(dx)) * 0.5;
    p.x += Math.sign(dx || (p.side === "L" ? -1 : 1)) * push;
    p.x = clamp(p.x, WORLD.left, WORLD.right);
  }

  // ===== hit helper =====
  const tryHit = (kind, range, width, stunTime, energyGain, fxTag) => {
    if (opp.invul > 0) return null;

    const facing = p.face;
    const hitCenterX = p.x + facing * range;
    const dist = Math.abs(opp.x - hitCenterX);
    const inFront = (opp.x - p.x) * facing > 0;

    if (inFront && dist <= width) {
      const { dmg, crit } = damageRoll();
      opp.hp = Math.max(0, opp.hp - dmg);
      opp.stun = Math.max(opp.stun, stunTime);
      opp.invul = Math.max(opp.invul, 0.05);
      p.en = clamp(p.en + energyGain, 0, 100);
      return { kind, dmg, crit, x: (opp.x + p.x) * 0.5, y: -55, tag: fxTag };
    }
    return null;
  };

  // ===== attack / skills =====
  if (canAct && p.edge.atk && p.atkLock <= 0) {
    p.edge.atk = false;
    p.atkLock = 0.22;

    // combo variety
    p.comboIdx = (p.comboIdx + 1) % 3;
    const v = p.comboIdx;

    let hit = null;
    if (v === 0) hit = tryHit("atk1", 72, 68, 0.14, 8, "slashA");
    if (v === 1) hit = tryHit("atk2", 84, 74, 0.16, 9, "slashB");
    if (v === 2) hit = tryHit("atk3", 96, 78, 0.18, 10, "slashC");

    if (hit) p._emitFx = hit;
  } else {
    p.edge.atk = false;
  }

  // S1
  if (canAct && p.edge.s1 && p.s1Cd <= 0) {
    p.edge.s1 = false;
    p.s1Cd = 3.2;
    p.atkLock = 0.35;
    const hit = tryHit("s1", 140, 110, 0.22, 14, "skill1");
    if (hit) p._emitFx = hit;
  } else p.edge.s1 = false;

  // S2 (slash forward)
  if (canAct && p.edge.s2 && p.s2Cd <= 0) {
    p.edge.s2 = false;
    p.s2Cd = 4.4;
    p.atkLock = 0.40;

    p.x = clamp(p.x + p.face * 52, WORLD.left, WORLD.right);
    const hit = tryHit("s2", 155, 120, 0.26, 16, "skill2");
    if (hit) p._emitFx = hit;
  } else p.edge.s2 = false;

  // SUB (backstep + small counter)
  if (canAct && p.edge.sub && p.subCd <= 0) {
    p.edge.sub = false;
    p.subCd = 5.0;

    p.invul = Math.max(p.invul, 0.12);
    p.x = clamp(p.x - p.face * 70, WORLD.left, WORLD.right);

    const hit = tryHit("sub", 110, 95, 0.16, 8, "sub");
    if (hit) p._emitFx = hit;
  } else p.edge.sub = false;

  // ULT (cinematic-lite)
  if (canAct && p.edge.ult && p.ultCd <= 0 && p.en >= 70) {
    p.edge.ult = false;
    p.ultCd = 10.5;
    p.en = Math.max(0, p.en - 70);
    p.atkLock = 0.65;

    const hit = tryHit("ult", 210, 170, 0.55, 0, "ult");
    if (hit) p._emitFx = hit;

    p._emitUlt = { x: p.x, y: -60 };
  } else p.edge.ult = false;

  // energy passive
  p.en = clamp(p.en + DT * 3.5, 0, 100);

  // KO (optional: giữ 0 hp)
  if (p.hp <= 0) {
    p.hp = 0;
    p.vx = 0;
  }
}

function stepRoom(room) {
  if (room.players.size === 0) return;

  let L = null, R = null;
  for (const p of room.players.values()) {
    if (p.side === "L") L = p;
    else R = p;
  }

  if (L && R) {
    // face each other
    L.face = L.x <= R.x ? 1 : -1;
    R.face = -L.face;

    tickOne(L, R);
    tickOne(R, L);

    // camera center
    const camX = (L.x + R.x) * 0.5;
    room.camX = camX;

    // zoom by distance
    const dist = Math.abs(L.x - R.x);
    const t = clamp((dist - CAMERA.minDist) / (CAMERA.maxDist - CAMERA.minDist), 0, 1);
    room.zoom = lerp(CAMERA.minZoom, CAMERA.maxZoom, t);
  } else {
    // 1 player only
    for (const p of room.players.values()) tickOne(p, null);
  }
}

// ===== socket =====
io.on("connection", (socket) => {
  // simple ping
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
    const p = makePlayer(side);

    room.players.set(socket.id, p);
    socket.join(roomId);
    socket.data.roomId = roomId;

    cb?.({ ok: true, roomId, side });

    io.to(roomId).emit("room:info", { count: room.players.size });
  });

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

    // one-shot edges
    if (edge) {
      for (const k of bools) {
        if (edge[k]) p.edge[k] = true;
      }
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

// ===== main tick loop =====
setInterval(() => {
  for (const [roomId, room] of rooms) {
    stepRoom(room);

    let L = null, R = null;
    for (const p of room.players.values()) {
      if (p.side === "L") L = p;
      else R = p;
    }

    // FX gather
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
          t: 0,
        });

        // sparks nhẹ (ít, không lag)
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
          t: 0,
        });

        p._emitFx = null;
      }

      if (p._emitUlt) {
        fx.ult = { wx: p._emitUlt.x, wy: p._emitUlt.y, life: 0.55, t: 0 };
        p._emitUlt = null;
      }
    }

    const snap = {
      t: Date.now(),
      camX: room.camX || 0,
      zoom: room.zoom || CAMERA.minZoom,
      count: room.players.size,
      Left: L && {
        x: L.x, y: L.y, face: L.face,
        hp: L.hp, maxHp: L.maxHp,
        en: L.en, invul: L.invul, stun: L.stun
      },
      Right: R && {
        x: R.x, y: R.y, face: R.face,
        hp: R.hp, maxHp: R.maxHp,
        en: R.en, invul: R.invul, stun: R.stun
      },
      fx,
    };

    io.to(roomId).emit("snap", snap);
  }
}, 1000 / TICK_HZ);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Server listening on", PORT));
