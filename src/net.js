export function setupNet() {
  const status = document.getElementById("status");
  const menu = document.getElementById("menu");
  const hud = document.getElementById("hud");
  const info = document.getElementById("info");
  const controls = document.getElementById("controls");
  const hint = document.getElementById("hint");

  const roomOut = document.getElementById("roomOut");
  const roomIn = document.getElementById("roomIn");
  const hostNote = document.getElementById("hostNote");

  const setStatus = (text, ok = true) => {
    status.textContent = text;
    status.className = "pill " + (ok ? "ok" : "bad");
  };

  const WS_URL = (location.protocol === "https:" ? "wss://" : "ws://") + location.host;
  let ws = null;
  let roomCode = "";
  let side = "L";
  let seed = 0;

  const NET = {
    connected: false,
    ping: 0,
    _lastPing: 0,
    onStart: null,
    onState: null
  };

  const wsSend = (obj) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); };

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); }
    catch {
      const t = document.createElement("textarea");
      t.value = text;
      document.body.appendChild(t);
      t.select();
      document.execCommand("copy");
      t.remove();
    }
  }

  function closeAll() {
    try { ws && ws.close(); } catch { }
    ws = null;
    NET.connected = false;
    roomCode = "";
    menu.style.display = "flex";
    hud.style.display = "none";
    info.style.display = "none";
    controls.style.display = "none";
    hint.style.display = "none";
    setStatus("Offline", true);
  }

  function showGameUI() {
    menu.style.display = "none";
    hud.style.display = "flex";
    info.style.display = "block";
    hint.style.display = ("ontouchstart" in window) ? "block" : "none";
    controls.style.display = ("ontouchstart" in window) ? "block" : "none";
  }

  async function connectWS() {
    return new Promise((resolve, reject) => {
      ws = new WebSocket(WS_URL);
      ws.onopen = () => {
        NET.connected = true;
        setStatus("Connected", true);
        resolve();
      };
      ws.onerror = (e) => reject(e);
      ws.onclose = () => {
        setStatus("Disconnected", false);
        closeAll();
      };
      ws.onmessage = (ev) => {
        let msg = null;
        try { msg = JSON.parse(ev.data); } catch { return; }

        if (msg.t === "room") {
          roomCode = msg.code;
          roomOut.value = roomCode;
          hostNote.innerHTML = `Gửi code <b>${roomCode}</b> cho bạn bè.`;
          setStatus("Room: " + roomCode, true);
          return;
        }
        if (msg.t === "joined") {
          roomCode = msg.code;
          setStatus("Joined: " + roomCode, true);
          return;
        }
        if (msg.t === "side") {
          side = msg.side;
          return;
        }
        if (msg.t === "start") {
          seed = msg.seed >>> 0;
          showGameUI();
          NET.onStart && NET.onStart({ seed, side, roomCode });
          return;
        }
        if (msg.t === "state") {
          NET.onState && NET.onState(msg);
          return;
        }
        if (msg.t === "pong") {
          NET.ping = performance.now() - msg.ts;
          return;
        }
        if (msg.t === "peer-left") {
          alert("Peer left");
          closeAll();
          return;
        }
        if (msg.t === "err") {
          setStatus("Error: " + msg.err, false);
          alert("Lỗi: " + msg.err);
          return;
        }
      };
    });
  }

  // buttons
  const btnHost = document.getElementById("btnHost");
  const btnJoin = document.getElementById("btnJoin");

  btnHost.onclick = async () => {
    closeAll();
    setStatus("Connecting…", true);
    await connectWS();
    wsSend({ t: "host" });
  };

  btnJoin.onclick = async () => {
    const code = roomIn.value.trim().toUpperCase();
    if (code.length !== 6) { alert("Room code phải đủ 6 ký tự."); return; }
    closeAll();
    setStatus("Connecting…", true);
    await connectWS();
    wsSend({ t: "join", code });
  };

  document.getElementById("btnCopy").onclick = () => copyText(roomOut.value || "");
  document.getElementById("btnLeaveH").onclick = () => { if (roomCode) wsSend({ t: "leave", code: roomCode }); closeAll(); };
  document.getElementById("btnLeaveJ").onclick = () => { if (roomCode) wsSend({ t: "leave", code: roomCode }); closeAll(); };

  return {
    NET,
    get side() { return side; },
    get roomCode() { return roomCode; },
    sendInput(i) { if (roomCode) wsSend({ t: "in", code: roomCode, i }); },
    ping() { if (ws && ws.readyState === 1) wsSend({ t: "ping", ts: performance.now() }); },
    setHandlers({ onStart, onState }) { NET.onStart = onStart; NET.onState = onState; }
  };
}
