// src/main.js
import { setupInput } from "./input.js";
import { setupRender } from "./render.js";
import { createNetClient } from "./net.js";
import { createGameState } from "./game.js";

const $ = (id) => document.getElementById(id);

const lobby = $("lobby");
const roomInp = $("roomInp");
const btnHost = $("btnHost");
const btnJoin = $("btnJoin");
const btnCopy = $("btnCopy");
const lobStatus = $("lobStatus");

const p1Hp = $("p1Hp"), p2Hp = $("p2Hp");
const p1En = $("p1En"), p2En = $("p2En");
const p1HpTxt = $("p1HpTxt"), p2HpTxt = $("p2HpTxt");
const p1Name = $("p1Name"), p2Name = $("p2Name");
const midTxt = $("midTxt");

function normalizeRoom(v) {
  v = String(v || "").trim();
  const m = v.match(/ROOM=([A-Z0-9]{4,10})/i);
  if (m) v = m[1];
  v = v.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return v.slice(0, 10);
}

function parseHashRoom() {
  return normalizeRoom(location.hash || "");
}

// ✅ block double-tap zoom + pinch
let lastTap = 0;
addEventListener("touchend", (e) => {
  const now = Date.now();
  if (now - lastTap < 300) e.preventDefault();
  lastTap = now;
}, { passive: false });
addEventListener("gesturestart", (e) => e.preventDefault(), { passive: false });

const net = createNetClient();
const input = setupInput();
const render = setupRender();

// local state mirrored from server
let G = createGameState();

net.setHandlers({
  onInfo: (info) => {
    if (info?.type === "status") lobStatus.textContent = info.text;
    if (info?.type === "welcome") {
      lobStatus.textContent = `Joined room ${info.room} as ${info.slot === 0 ? "P1" : "P2"}`;
    }
  },
  onJoinFail: (e) => {
    lobStatus.textContent = `JoinFail ❌ ${e?.reason || "unknown"}`;
  },
  onJoined: (e) => {
    // ok
  },
  onState: (state) => {
    if (!state) return;
    G = state;
    // hide lobby when game started (you can change)
    if (G.phase !== "lobby") lobby.style.display = "none";
  },
});

function startJoin(room) {
  net.connect(room);
}

// ✅ HOST thật: gọi API tạo phòng
async function hostCreateRoom() {
  lobStatus.textContent = "Creating room…";
  const res = await fetch("/api/room", { method: "POST" });
  const j = await res.json();
  if (!j?.ok || !j?.code) throw new Error("Create room failed");
  return String(j.code).toUpperCase();
}

btnHost.onclick = async () => {
  try {
    const code = await hostCreateRoom();
    const link = `${location.origin}/#ROOM=${code}`;
    location.hash = `#ROOM=${code}`;
    roomInp.value = link;

    lobStatus.textContent = `HOST OK ✅ Link: ${link}`;
    startJoin(code);
  } catch (e) {
    lobStatus.textContent = `HOST ERROR ❌ ${e?.message || e}`;
  }
};

btnJoin.onclick = () => {
  const r = normalizeRoom(roomInp.value || parseHashRoom());
  if (!r) {
    lobStatus.textContent = "Nhập code hoặc dán link rồi bấm JOIN.";
    return;
  }
  location.hash = `#ROOM=${r}`;
  startJoin(r);
};

btnCopy.onclick = async () => {
  const text = String(roomInp.value || "").trim();
  if (!text) { lobStatus.textContent = "Chưa có link để copy"; return; }
  try {
    await navigator.clipboard.writeText(text);
    lobStatus.textContent = "Copied ✅";
  } catch {
    roomInp.focus();
    roomInp.select();
    document.execCommand("copy");
    lobStatus.textContent = "Copied (fallback) ✅";
  }
};

(function autoJoinIfHash() {
  const r = parseHashRoom();
  if (r) {
    roomInp.value = `${location.origin}/#ROOM=${r}`;
    startJoin(r);
  }
})();

function hud() {
  if (!G || !G.Left || !G.Right) return;

  p1Name.textContent = G.Left.name || "YOU";
  p2Name.textContent = G.Right.name || "FOE";

  p1HpTxt.textContent = `HP: ${Math.round(G.Left.hp)}/${Math.round(G.Left.hpMax)}`;
  p2HpTxt.textContent = `HP: ${Math.round(G.Right.hp)}/${Math.round(G.Right.hpMax)}`;

  p1Hp.style.width = `${(G.Left.hp / G.Left.hpMax) * 100}%`;
  p2Hp.style.width = `${(G.Right.hp / G.Right.hpMax) * 100}%`;

  p1En.style.width = `${(G.Left.en / G.Left.enMax) * 100}%`;
  p2En.style.width = `${(G.Right.en / G.Right.enMax) * 100}%`;

  midTxt.textContent = G.midText || `ping: ${Math.round(G.pingMs || 0)}ms`;
}

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;

  // send local input to server (server gán theo role host/guest)
  const inp = input.readLocalInput();
  net.sendInput(inp);

  render.drawFrame(G, dt);
  hud();

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
