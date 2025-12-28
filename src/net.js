// src/net.js
import { io } from "https://cdn.socket.io/4.7.5/socket.io.esm.min.js";

export function createNetClient({ code, onState, onJoined, onCountdown, onInfo, onJoinFail, onConnectError }) {
  const socket = io(window.location.origin, {
    transports: ["websocket", "polling"],
  });

  let role = "guest";
  let pingMs = 0;
  let connected = false;

  socket.on("connect", () => {
    connected = true;
    socket.emit("joinRoom", { code });
  });

  socket.on("connect_error", (err) => {
    onConnectError?.(String(err?.message || err));
  });

  // ping
  setInterval(() => {
    if (!connected) return;
    const t0 = performance.now();
    socket.emit("pingx", { t: t0 });
  }, 1000);

  socket.on("pongx", ({ t }) => {
    pingMs = Math.max(0, Math.round(performance.now() - t));
  });

  // join
  socket.on("joinFail", (data) => onJoinFail?.(data));

  socket.on("joined", ({ role: r, code: c, G }) => {
    role = r;
    onJoined?.({ role, code: c, G });
  });

  socket.on("countdown", (data) => onCountdown?.(data));
  socket.on("info", (data) => onInfo?.(data));
  socket.on("state", (G) => onState?.(G));

  function sendInput(inputObj) {
    if (!connected) return;
    socket.emit("input", inputObj);
  }

  function getRole() { return role; }
  function getPing() { return pingMs; }

  function close() {
    try { socket.disconnect(); } catch {}
  }

  return { sendInput, getRole, getPing, close };
}
