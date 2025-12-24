import http from "http";
import fs from "fs";
import path from "path";
import { WebSocketServer } from "ws";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 10000;

// ---------- static ----------
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
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) return serveFile(res, filePath);
  res.writeHead(404);
  res.end("Not found");
});

// ---------- game sim ----------
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const sgn = (v) => (v < 0 ? -1 : 1);

function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
function makeRng(seed) {
  const r = mulberry32(seed);
  return { f: () => r(), int: (a, b) => Math.floor(a + r() * (b - a + 1)) };
}

const SKILL_DMG_MIN = 1209;
const SKILL_DMG_MAX = 2290;

const TICK_HZ = 60;
const STATE_HZ = 20;

// fighter data
function Fighter(side, rng) {
  const hpMax = rng.int(20109, 36098);
  return {
    side,
    x: side < 0 ? -320 : 320,
    y: 0,
    vx: 0,
    vy: 0,
    face: side < 0 ? 1 : -1,

    hpMax,
    hp: hpMax,
    enMax: 100,
    en: 100,

    state: "idle",
    lock: 0,
    stun: 0,
    invul: 0,

    cdDash: 0,
    cdS1: 0,
    cdS2: 0,
    cdUlt: 0,
    cdSub: 0,
    cdAtk: 0,

    atkVar: 0,
    skillVar: 0,
    atkT: 0,
    actT: 0,
    didHit: false
  };
}

function separate(a, b, dt) {
  const minDist = 190;
  const dx = b.x - a.x;
  const d = Math.abs(dx);
  if (d < minDist) {
    const push = (minDist - d) * 4.2;
    const dir = dx >= 0 ? 1 : -1;
    a.x -= dir * push * 0.5 * dt;
    b.x += dir * push * 0.5 * dt;
    a.vx *= 0.92;
    b.vx *= 0.92;
  }
}

function rectHit(att, def, range, w, h) {
  const hx = att.x + att.face * range;
  const hy = -86;
  const dx = def.x;
  const dy = -86;
  return dx > hx - w * 0.5 && dx < hx + w * 0.5 && dy > hy - h * 0.5 && dy < hy + h * 0.5;
}

function rollCrit(rng) {
  return rng.f() < 0.15;
}

function rollSkillDamage(rng) {
  let dmg = rng.int(SKILL_DMG_MIN, SKILL_DMG_MAX);
  const crit = rollCrit(rng);
  if (crit) dmg = Math.min(SKILL_DMG_MAX, Math.floor(dmg * 1.12));
  return { dmg, crit };
}

function rollAtkDamage(rng) {
  let dmg = rng.int(271, 418);
  const crit = rng.f() < 0.12;
  if (crit) dmg = Math.min(520, Math.floor(dmg * 1.25));
  return { dmg, crit };
}

function applyHit(att, def, dmg, crit, power, events) {
  if (def.invul > 0) return false;

  const range = power === "atk" ? 200 : power === "ult" ? 290 : 260;
  const w = power === "atk" ? 160 : power === "ult" ? 240 : 220;
  const h = power === "atk" ? 120 : power === "ult" ? 170 : 150;

  if (!rectHit(att, def, range, w, h)) return false;

  def.hp = Math.max(0, def.hp - dmg);
  def.stun = Math.max(def.stun, power === "ult" ? 0.18 : power === "skill" ? 0.14 : 0.10);
  def.invul = Math.max(def.invul, power === "ult" ? 0.10 : power === "skill" ? 0.08 : 0.06);

  const kb = power === "ult" ? 520 : power === "skill" ? 420 : 320;
  def.vx = att.face * kb;
  def.vy = -(power === "ult" ? 520 : power === "skill" ? 420 : 320);

  events.push({ t: "hit", x: def.x, y: def.y, dmg, crit, power });

  att.en = clamp(att.en + (power === "atk" ? 6 : power === "skill" ? 10 : 14), 0, 100);
  return true;
}

function startAttack(f, rng) {
  if (f.lock > 0 || f.stun > 0 || f.cdAtk > 0) return false;
  f.state = "atk";
  f.lock = 0.18;
  f.cdAtk = 0.12;
  f.atkT = 0;
  f.didHit = false;
  f.atkVar = rng.int(0, 3);
  return true;
}

function startDash(f, dir) {
  if (f.lock > 0 || f.stun > 0 || f.cdDash > 0) return false;
  f.state = "dash";
  f.lock = 0.06;
  f.cdDash = 0.55;
  const d = Math.abs(dir) > 0.2 ? sgn(dir) : f.face;
  f.face = d;
  f.vx = d * 2200; // dash nhanh
  f.vy *= 0.10;
  f.invul = Math.max(f.invul, 0.10);
  return true;
}

function startJump(f) {
  if (f.lock > 0 || f.stun > 0) return false;
  if (f.y === 0) {
    f.vy = -1100;
    f.state = "jump";
    return true;
  }
  return false;
}

function startSkill(f, which, rng) {
  if (f.lock > 0 || f.stun > 0) return false;

  if (which === "s1") {
    if (f.cdS1 > 0 || f.en < 20) return false;
    f.en -= 20; f.cdS1 = 1.1; f.lock = 0.28; f.state = "s1";
  } else if (which === "s2") {
    if (f.cdS2 > 0 || f.en < 25) return false;
    f.en -= 25; f.cdS2 = 1.35; f.lock = 0.34; f.state = "s2";
  } else if (which === "sub") {
    if (f.cdSub > 0 || f.en < 15) return false;
    f.en -= 15; f.cdSub = 0.9; f.lock = 0.22; f.state = "sub";
  } else if (which === "ult") {
    if (f.cdUlt > 0 || f.en < 100) return false;
    f.en = 0; f.cdUlt = 3.2; f.lock = 0.55; f.state = "ult";
  }

  f.actT = 0;
  f.didHit = false;
  f.skillVar = rng.int(0, 2);
  return true;
}

function stepRoom(room, dt) {
  const { rng, L, R, inL, inR } = room;
  const events = [];

  function updateF(f, other, inp) {
    f.lock = Math.max(0, f.lock - dt);
    f.stun = Math.max(0, f.stun - dt);
    f.invul = Math.max(0, f.invul - dt);

    f.cdDash = Math.max(0, f.cdDash - dt);
    f.cdS1 = Math.max(0, f.cdS1 - dt);
    f.cdS2 = Math.max(0, f.cdS2 - dt);
    f.cdUlt = Math.max(0, f.cdUlt - dt);
    f.cdSub = Math.max(0, f.cdSub - dt);
    f.cdAtk = Math.max(0, f.cdAtk - dt);

    // regen energy nhẹ
    f.en = clamp(f.en + dt * 9, 0, 100);

    if (Math.abs(inp.mx) > 0.2 && f.stun <= 0) f.face = inp.mx > 0 ? 1 : -1;

    // one-shot actions from client
    if (inp.jump) startJump(f);
    if (inp.dash) startDash(f, inp.mx);
    if (inp.atk) startAttack(f, rng);
    if (inp.s1) startSkill(f, "s1", rng);
    if (inp.s2) startSkill(f, "s2", rng);
    if (inp.sub) startSkill(f, "sub", rng);
    if (inp.ult) startSkill(f, "ult", rng);

    // move while attacking but slower + khựng
    let slow = 1;
    if (f.state === "atk") slow = 0.62;
    if (f.state === "s1" || f.state === "s2" || f.state === "sub") slow = 0.45;
    if (f.state === "ult") slow = 0.12;
    if (f.stun > 0) slow = 0.0;

    const move = 720;
    const accel = 3600;
    const target = inp.mx * (move * slow);
    f.vx = lerp(f.vx, target, 1 - Math.exp(-accel * dt / move));
    if (Math.abs(inp.mx) < 0.08) f.vx *= 0.86;

    // physics
    f.vy += 2600 * dt;
    f.x += f.vx * dt;
    f.y += f.vy * dt;

    if (f.y >= 0) { f.y = 0; f.vy = 0; }

    if (f.hp <= 0) { f.state = "dead"; return; }
    if (f.stun > 0) { f.state = "stun"; }

    // attack hit window
    if (f.state === "atk") {
      f.atkT += dt;
      const roll = rollAtkDamage(rng);
      const table = [
        { t0: 0.05, t1: 0.10, mul: 1.00, power: "atk" },
        { t0: 0.07, t1: 0.12, mul: 1.06, power: "atk" },
        { t0: 0.04, t1: 0.09, mul: 0.94, power: "atk" },
        { t0: 0.09, t1: 0.14, mul: 1.12, power: "atk" }
      ];
      const v = table[f.atkVar] || table[0];
      if (!f.didHit && f.atkT >= v.t0 && f.atkT <= v.t1) {
        const dmg = Math.floor(roll.dmg * v.mul);
        if (applyHit(f, other, dmg, roll.crit, v.power, events)) f.didHit = true;
      }
      if (f.lock <= 0) f.state = "idle";
    }

    // skills
    if (f.state === "s1" || f.state === "s2" || f.state === "sub" || f.state === "ult") {
      f.actT += dt;

      if (!f.didHit) {
        if (f.state === "ult") {
          if (f.actT >= 0.12 && f.actT <= 0.16) {
            const r1 = rollSkillDamage(rng);
            applyHit(f, other, r1.dmg, r1.crit, "ult", events);
          }
          if (f.actT >= 0.22 && f.actT <= 0.26) {
            const r2 = rollSkillDamage(rng);
            applyHit(f, other, r2.dmg, r2.crit, "ult", events);
            f.didHit = true;
          }
          if (f.lock <= 0) f.state = "idle";
        } else {
          if (f.actT >= 0.08 && f.actT <= 0.14) {
            const roll = rollSkillDamage(rng);
            const mul = (f.state === "s2") ? 1.10 : (f.state === "sub" ? 0.90 : 1.00);
            const dmg = Math.floor(roll.dmg * mul);
            if (applyHit(f, other, dmg, roll.crit, "skill", events)) f.didHit = true;
          }
          if (f.lock <= 0) f.state = "idle";
        }
      }
    }

    if (f.state === "dash") {
      if (f.lock <= 0) f.state = "idle";
    }

    if (f.y < 0 && f.state === "idle") f.state = "jump";
    if (f.y === 0 && f.state === "jump" && f.vy >= 0) f.state = "idle";
  }

  updateF(L, R, inL);
  updateF(R, L, inR);

  separate(L, R, dt);

  // clear one-shot actions (movement stays)
  room.inL.atk = room.inL.jump = room.inL.dash = room.inL.s1 = room.inL.s2 = room.inL.ult = room.inL.sub = false;
  room.inR.atk = room.inR.jump = room.inR.dash = room.inR.s1 = room.inR.s2 = room.inR.ult = room.inR.sub = false;

  room.tick++;
  room._events = events;
}

// ---------- rooms/ws ----------
const wss = new WebSocketServer({ server });
const rooms = new Map();

function genCode() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
function send(ws, obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}
function broadcast(room, obj) {
  if (room.host) send(room.host, obj);
  if (room.guest) send(room.guest, obj);
}

function createRoom(code) {
  const seed = (Math.random() * 0xFFFFFFFF) >>> 0;
  const rng = makeRng(seed);
  return {
    code,
    seed,
    rng,
    host: null,
    guest: null,
    tick: 0,
    inL: { mx: 0, atk: false, jump: false, dash: false, s1: false, s2: false, ult: false, sub: false },
    inR: { mx: 0, atk: false, jump: false, dash: false, s1: false, s2: false, ult: false, sub: false },
    L: Fighter(-1, rng),
    R: Fighter(+1, rng),
    _events: [],
    _stateAcc: 0
  };
}

// sim loop
setInterval(() => {
  const dt = 1 / TICK_HZ;
  for (const room of rooms.values()) {
    if (!room.host || !room.guest) continue;

    stepRoom(room, dt);

    room._stateAcc += dt;
    if (room._stateAcc >= 1 / STATE_HZ) {
      room._stateAcc = 0;
      broadcast(room, {
        t: "state",
        tick: room.tick,
        s: { L: room.L, R: room.R },
        events: room._events
      });
      room._events = [];
    }

    // auto rematch
    if (room.L.hp <= 0 || room.R.hp <= 0) {
      const newSeed = (Math.random() * 0xFFFFFFFF) >>> 0;
      room.seed = newSeed;
      room.rng = makeRng(newSeed);
      room.L = Fighter(-1, room.rng);
      room.R = Fighter(+1, room.rng);
      room.tick = 0;
      broadcast(room, { t: "start", seed: newSeed });
    }
  }
}, Math.floor(1000 / TICK_HZ));

wss.on("connection", (ws) => {
  ws.on("message", (buf) => {
    let msg;
    try { msg = JSON.parse(buf.toString()); } catch { return; }

    if (msg.t === "host") {
      let code = genCode();
      while (rooms.has(code)) code = genCode();
      const room = createRoom(code);
      room.host = ws;
      rooms.set(code, room);
      send(ws, { t: "room", code });
      send(ws, { t: "side", side: "L" });
      return;
    }

    if (msg.t === "join") {
      const code = String(msg.code || "").toUpperCase();
      const room = rooms.get(code);
      if (!room) return send(ws, { t: "err", err: "Room not found" });
      if (room.guest) return send(ws, { t: "err", err: "Room full" });
      room.guest = ws;
      send(ws, { t: "joined", code });
      send(ws, { t: "side", side: "R" });
      broadcast(room, { t: "start", seed: room.seed });
      return;
    }

    if (msg.t === "leave") {
      const code = String(msg.code || "").toUpperCase();
      const room = rooms.get(code);
      if (!room) return;
      if (room.host === ws) room.host = null;
      if (room.guest === ws) room.guest = null;
      if (!room.host && !room.guest) rooms.delete(code);
      else broadcast(room, { t: "peer-left" });
      return;
    }

    if (msg.t === "in") {
      const code = String(msg.code || "").toUpperCase();
      const room = rooms.get(code);
      if (!room) return;

      const i = msg.i || {};
      const inp = {
        mx: clamp(Number(i.mx || 0), -1, 1),
        atk: !!i.atk, jump: !!i.jump, dash: !!i.dash,
        s1: !!i.s1, s2: !!i.s2, ult: !!i.ult, sub: !!i.sub
      };

      if (room.host === ws) {
        room.inL.mx = inp.mx;
        if (inp.atk) room.inL.atk = true;
        if (inp.jump) room.inL.jump = true;
        if (inp.dash) room.inL.dash = true;
        if (inp.s1) room.inL.s1 = true;
        if (inp.s2) room.inL.s2 = true;
        if (inp.ult) room.inL.ult = true;
        if (inp.sub) room.inL.sub = true;
      } else if (room.guest === ws) {
        room.inR.mx = inp.mx;
        if (inp.atk) room.inR.atk = true;
        if (inp.jump) room.inR.jump = true;
        if (inp.dash) room.inR.dash = true;
        if (inp.s1) room.inR.s1 = true;
        if (inp.s2) room.inR.s2 = true;
        if (inp.ult) room.inR.ult = true;
        if (inp.sub) room.inR.sub = true;
      }
      return;
    }

    if (msg.t === "ping") {
      send(ws, { t: "pong", ts: msg.ts });
      return;
    }
  });

  ws.on("close", () => {
    for (const [code, room] of rooms) {
      if (room.host === ws) room.host = null;
      if (room.guest === ws) room.guest = null;
      if (!room.host && !room.guest) rooms.delete(code);
      else broadcast(room, { t: "peer-left" });
    }
  });
});

server.listen(PORT, () => console.log("Server running on port", PORT));
