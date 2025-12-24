import { setupInput } from "./input.js";
import { setupNet } from "./net.js";
import { setupRender } from "./render.js";

const hud = document.getElementById("hud");
const info = document.getElementById("info");
const Lhp = document.getElementById("Lhp");
const Rhp = document.getElementById("Rhp");
const Len = document.getElementById("Len");
const Ren = document.getElementById("Ren");

function updateHUD(state, ping) {
  if (!state?.L || !state?.R) return;
  Lhp.style.transform = `scaleX(${state.L.hp / state.L.hpMax})`;
  Rhp.style.transform = `scaleX(${state.R.hp / state.R.hpMax})`;
  Len.style.transform = `scaleX(${state.L.en / state.L.enMax})`;
  Ren.style.transform = `scaleX(${state.R.en / state.R.enMax})`;
  info.textContent = `FIGHT • ping: ${Math.round(ping)}ms • HP: ${state.L.hp}/${state.L.hpMax} vs ${state.R.hp}/${state.R.hpMax}`;
}

(function boot() {
  const input = setupInput();
  const net = setupNet();
  const render = setupRender();

  // current authoritative state from server
  const G = {
    seed: 0,
    camX: 0,
    zoom: 1,
    vignette: 0,
    shake: 0,
    shakeT: 0,
    flash: 0,
    flashT: 0,
    timeScale: 1,
    fx: { popups: [], slashes: [], sparks: [], afterImgs: [], smokes: [] },
    Left: null,
    Right: null
  };

  // lightweight FX from server events (simple, no lag)
  function spawnPopup(wx, wy, text, crit) {
    G.fx.popups.push({ wx, wy: wy - 120, vy: -260, t: 0, life: 0.70, text, crit });
  }
  function spawnSlash(wx, wy, power) {
    const count = power === "ult" ? 2 : 1; // giảm mạnh số lượng => bớt lag
    for (let i = 0; i < count; i++) {
      G.fx.slashes.push({
        wx, wy: wy - 90,
        dir: 1,
        kind: power,
        t: 0,
        life: power === "ult" ? 0.18 : 0.14,
        rot: (-0.6 + i * 0.25) + (Math.random() - 0.5) * 0.2,
        len: power === "ult" ? 280 : 220,
        w: power === "ult" ? 10 : 7
      });
    }
  }
  function spawnSparks(wx, wy, power) {
    const count = power === "ult" ? 10 : 6; // giảm
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const spd = (power === "ult" ? 820 : 620) * (0.5 + Math.random() * 0.6);
      G.fx.sparks.push({
        wx,
        wy: wy - 96,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd - 220,
        t: 0,
        life: 0.36,
        s: 2 + Math.random() * 2
      });
    }
  }

  net.setHandlers({
    onStart({ seed }) {
      G.seed = seed;
      G.fx.popups.length = 0;
      G.fx.slashes.length = 0;
      G.fx.sparks.length = 0;
    },
    onState(msg) {
      // server sends L/R already; just map into render structure
      const s = msg.s;
      G.Left = s.L;
      G.Right = s.R;

      // simple cam
      G.camX = (G.Left.x + G.Right.x) * 0.5;

      // light cinematic: only when ult state
      const anyUlt = (G.Left.state === "ult" || G.Right.state === "ult");
      G.zoom = anyUlt ? 1.07 : 1.00;
      G.vignette = anyUlt ? 0.7 : 0.0;
      G.timeScale = 1;

      // apply events
      for (const e of (msg.events || [])) {
        if (e.t === "hit") {
          spawnPopup(e.x, e.y, String(e.dmg), e.crit);
          spawnSlash(e.x, e.y, e.power);
          spawnSparks(e.x, e.y, e.power);

          // tiny shake only
          G.shakeT = Math.max(G.shakeT, 0.05);
          G.shake = Math.max(G.shake, e.power === "ult" ? 14 : 10);
          G.flashT = Math.max(G.flashT, 0.05);
          G.flash = Math.max(G.flash, e.power === "ult" ? 0.18 : 0.10);
        }
      }

      updateHUD(s, net.NET.ping);
      hud.style.display = "flex";
      info.style.display = "block";
    }
  });

  let last = performance.now();
  let sendAcc = 0;

  function loop(t) {
    requestAnimationFrame(loop);
    const dt = Math.min(0.033, Math.max(0.001, (t - last) / 1000));
    last = t;

    // send inputs at 30hz (nhẹ hơn nhiều)
    sendAcc += dt;
    if (sendAcc >= 1 / 30) {
      sendAcc = 0;
      const my = input.readLocalInput();

      // IMPORTANT: actions should be “press” not “hold”
      // We convert to one-shot using edge detector from input
      const i = {
        mx: my.mx,
        atk: input.once("atk", my.atk),
        jump: input.once("jump", my.jump),
        dash: input.once("dash", my.dash),
        s1: input.once("s1", my.s1),
        s2: input.once("s2", my.s2),
        ult: input.once("ult", my.ult),
        sub: input.once("sub", my.sub)
      };
      net.sendInput(i);
      net.ping();
    }

    // update local FX timers (client-only)
    const fx = G.fx;

    for (let i = fx.slashes.length - 1; i >= 0; i--) {
      fx.slashes[i].t += dt;
      if (fx.slashes[i].t >= fx.slashes[i].life) fx.slashes.splice(i, 1);
    }
    for (let i = fx.sparks.length - 1; i >= 0; i--) {
      const p = fx.sparks[i];
      p.t += dt;
      p.wx += p.vx * dt;
      p.wy += p.vy * dt;
      p.vy += 920 * dt;
      p.vx *= 0.985;
      if (p.t >= p.life) fx.sparks.splice(i, 1);
    }
    for (let i = fx.popups.length - 1; i >= 0; i--) {
      const d = fx.popups[i];
      d.t += dt;
      d.wy += d.vy * dt;
      d.vy += 520 * dt;
      if (d.t >= d.life) fx.popups.splice(i, 1);
    }

    // shake/flash decay
    if (G.shakeT > 0) { G.shakeT = Math.max(0, G.shakeT - dt); G.shake *= 0.88; }
    else G.shake *= 0.90;

    if (G.flashT > 0) { G.flashT = Math.max(0, G.flashT - dt); G.flash *= 0.80; }
    else G.flash *= 0.85;

    render.drawFrame(G, dt);
  }
  requestAnimationFrame(loop);
})();
