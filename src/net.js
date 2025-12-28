// src/net.js
import { io } from "https://cdn.socket.io/4.7.5/socket.io.esm.min.js";

const norm = (v) => {
  v = String(v || "").trim();
  const m = v.match(/ROOM=([A-Z0-9]{4,10})/i);
  if (m) v = m[1];
  v = v.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return v.slice(0, 10);
};

export function createNetClient() {
  let socket = null;
  let handlers = {};
  let pingMs = 0;
  let pingTimer = null;

  function setHandlers(h) {
    handlers = h || {};
  }

  function connect(roomCode) {
    const code = norm(roomCode);
    if (!code) {
      handlers.onInfo?.({ type: "status", text: "Invalid room code" });
      return;
    }

    // close old
    try {
      if (pingTimer) clearInterval(pingTimer);
      if (socket) socket.disconnect();
    } catch {}

    socket = io(window.location.origin, {
      transports: ["websocket", "polling"],
    });

    socket.on("connect_error", (err) => {
      handlers.onInfo?.({ type: "status", text: "Socket error: " + (err?.message || err) });
    });

    socket.on("connect", () => {
      handlers.onInfo?.({ type: "status", text: "Connecting… joining " + code });
      socket.emit("joinRoom", { code });
    });

    // ping
    pingTimer = setInterval(() => {
      const t0 = performance.now();
      socket.emit("pingx", { t: t0 });
    }, 1000);

    socket.on("pongx", ({ t }) => {
      pingMs = Math.max(0, Math.round(performance.now() - t));
    });

    socket.on("joinFail", (data) => {
      handlers.onJoinFail?.(data);
      handlers.onInfo?.({ type: "status", text: "JoinFail: " + (data?.reason || "unknown") });
    });

    socket.on("joined", (data) => {
      handlers.onJoined?.(data);
      handlers.onInfo?.({ type: "welcome", room: data.code, slot: data.role === "host" ? 0 : 1 });
    });

    socket.on("countdown", (data) => {
      handlers.onInfo?.({ type: "status", text: "Countdown…" });
    });

    socket.on("info", (info) => {
      handlers.onInfo?.(info);
    });

    socket.on("state", (G) => {
      // embed ping into state if you want
      if (G) G.pingMs = pingMs;
      handlers.onState?.(G);
    });
  }

  function sendInput(inp) {
    if (!socket || !socket.connected) return;
    socket.emit("input", inp);
  }

  function getPing() {
    return pingMs;
  }

  return { setHandlers, connect, sendInput, getPing };
}
