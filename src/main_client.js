// src/main_client.js
import { setupInput } from "./input.js";
import { setupRender } from "./render.js";
import { createNetClient } from "./net.js";

function clone(G) {
  return JSON.parse(JSON.stringify(G));
}

export async function startClient({ code }) {
  const hud = document.getElementById("hud");
  const { readLocalInput } = setupInput();
  const { drawFrame } = setupRender();

  let G = null;
  let countdownText = "";

  const net = createNetClient({
    code,

    onJoinFail: ({ reason }) => {
      alert("Join fail: " + (reason || "unknown"));
      location.hash = "";
      location.reload();
    },

    onJoined: ({ role, G: serverG }) => {
      G = clone(serverG);
      hud.textContent = `JOINED as ${role.toUpperCase()} • ROOM ${code}`;
      setTimeout(() => (hud.textContent = ""), 900);
    },

    onCountdown: ({ t }) => {
      // hiển thị 3-2-1 READY
      let x = t || 3;
      countdownText = `READY IN: ${x}`;
      const iv = setInterval(() => {
        x--;
        if (x <= 0) {
          countdownText = "READY!";
          setTimeout(() => (countdownText = ""), 600);
          clearInterval(iv);
        } else {
          countdownText = `READY IN: ${x}`;
        }
      }, 1000);
    },

    onInfo: ({ msg }) => {
      hud.textContent = msg || "";
      setTimeout(() => (hud.textContent = ""), 1200);
    },

    onState: (serverG) => {
      // server authoritative state
      G = clone(serverG);
    },
  });

  // game loop
  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
    last = now;

    if (G) {
      // 1) đọc input local (joystick + phím)
      const inp = readLocalInput();

      // 2) gửi input lên server
      net.sendInput(inp);

      // 3) vẽ frame theo state server
      drawFrame(G, dt);

      // 4) HUD ping + countdown
      const ping = net.getPing();
      const role = net.getRole();
      const top = `FIGHT • ping: ${ping}ms • ${role.toUpperCase()} • ROOM ${code}`;
      if (countdownText) {
        document.getElementById("hud").textContent = `${top} • ${countdownText}`;
      } else {
        // không spam hud quá nhiều: giữ title thay vì text overlay nếu bạn muốn
        // ở đây mình để HUD nhẹ
        document.getElementById("hud").textContent = top;
      }
    }

    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}
