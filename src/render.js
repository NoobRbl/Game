// src/render.js
export function setupRender() {
  const canvas = document.getElementById("cv");
  const ctx = canvas.getContext("2d", { alpha: false });

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = Math.floor(w * devicePixelRatio);
    canvas.height = Math.floor(h * devicePixelRatio);
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  }
  addEventListener("resize", resize, { passive: true });
  resize();

  function computeView() {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const target = 16 / 9;
    let vw = W, vh = H, ox = 0, oy = 0;

    if (W / H > target) {
      vh = H;
      vw = H * target;
      ox = (W - vw) * 0.5;
    } else {
      vw = W;
      vh = W / target;
      oy = (H - vh) * 0.5;
    }
    return { W, H, vw, vh, ox, oy };
  }

  function drawVignette(view, amount) {
    if (amount <= 0) return;
    const { ox, oy, vw, vh } = view;
    const grd = ctx.createRadialGradient(
      ox + vw / 2, oy + vh / 2, vh * 0.2,
      ox + vw / 2, oy + vh / 2, vh * 0.7
    );
    grd.addColorStop(0, `rgba(0,0,0,0)`);
    grd.addColorStop(1, `rgba(0,0,0,${0.55 * amount})`);
    ctx.fillStyle = grd;
    ctx.fillRect(ox, oy, vw, vh);
  }

  function worldToScreen(view, camX, camZoom, wx, wy) {
    const { ox, oy, vw, vh } = view;
    const base = (vw / 1280);
    const scale = base * (camZoom || 1);
    const sx = ox + vw / 2 + (wx - camX) * scale;
    const sy = oy + vh * 0.72 + wy * scale;
    return { sx, sy, scale };
  }

  function drawBackground(view) {
    const { ox, oy, vw, vh } = view;
    const g = ctx.createLinearGradient(0, oy, 0, oy + vh);
    g.addColorStop(0, "#0b1020");
    g.addColorStop(1, "#05070f");
    ctx.fillStyle = g;
    ctx.fillRect(ox, oy, vw, vh);

    ctx.fillStyle = "rgba(120,150,255,0.06)";
    ctx.fillRect(ox, oy + vh * 0.55, vw, vh * 0.45);

    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.fillRect(ox, oy + vh * 0.74, vw, vh * 0.02);

    // simple platforms decor
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fillRect(ox + vw*0.08, oy + vh*0.64, vw*0.22, vh*0.015);
    ctx.fillRect(ox + vw*0.70, oy + vh*0.61, vw*0.18, vh*0.015);
  }

  function drawFallbackFighter(sx, sy, face, isEnemy, scale, invul) {
    ctx.save();
    ctx.translate(sx, sy);

    if (invul > 0) ctx.globalAlpha = 0.55 + 0.25 * Math.sin(performance.now() * 0.03);

    ctx.scale(face < 0 ? -1 : 1, 1);

    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.ellipse(0, 6 * scale, 28 * scale, 10 * scale, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = isEnemy ? "#ff6a6a" : "#6ad5ff";
    ctx.fillRect(-24 * scale, -92 * scale, 48 * scale, 92 * scale);

    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillRect(-14 * scale, -118 * scale, 28 * scale, 26 * scale);

    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.fillRect(-8 * scale, -108 * scale, 16 * scale, 3 * scale);

    ctx.restore();
  }

  function drawFX(view, camX, camZoom, fx) {
    const scaleBase = (view.vw / 1280) * (camZoom || 1);

    for (const s of fx.slashes) {
      const p = worldToScreen(view, camX, camZoom, s.wx, s.wy);
      const t = s.t / s.life;
      ctx.save();
      ctx.translate(p.sx, p.sy);
      ctx.rotate(s.rot);
      ctx.globalAlpha = 1 - t;
      ctx.fillStyle = (s.kind === "ult") ? "rgba(255,220,140,0.95)" : "rgba(190,255,255,0.9)";
      ctx.fillRect(-s.len * scaleBase * 0.5, -s.w * scaleBase * 0.5, s.len * scaleBase, s.w * scaleBase);
      ctx.restore();
    }

    for (const sp of fx.sparks) {
      const p = worldToScreen(view, camX, camZoom, sp.wx, sp.wy);
      const t = sp.t / sp.life;
      ctx.globalAlpha = 1 - t;
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.fillRect(p.sx, p.sy, sp.s * scaleBase, sp.s * scaleBase);
    }

    ctx.textAlign = "center";
    ctx.font = `${Math.max(12, 16 * scaleBase)}px system-ui, -apple-system, Segoe UI, Roboto`;
    for (const d of fx.popups) {
      const p = worldToScreen(view, camX, camZoom, d.wx, d.wy);
      const t = d.t / d.life;
      ctx.globalAlpha = 1 - t;
      ctx.fillStyle = d.crit ? "rgba(255,220,120,1)" : "rgba(255,255,255,0.95)";
      ctx.fillText(d.text, p.sx, p.sy);
    }
    ctx.globalAlpha = 1;
  }

  function drawFrame(G, dt) {
    const view = computeView();
    const { W, H, ox, oy, vw, vh } = view;

    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);

    const shake = G.shake || 0;
    const shx = shake ? (Math.random() - 0.5) * shake : 0;
    const shy = shake ? (Math.random() - 0.5) * shake : 0;

    ctx.save();
    ctx.translate(shx, shy);

    drawBackground(view);

    const camX = G.camX || 0;
    const camZoom = G.camZoom || 1;

    if (G.Left) {
      const p = worldToScreen(view, camX, camZoom, G.Left.x, G.Left.y);
      drawFallbackFighter(p.sx, p.sy, G.Left.face, false, 1.0, G.Left.invul);
    }
    if (G.Right) {
      const p = worldToScreen(view, camX, camZoom, G.Right.x, G.Right.y);
      drawFallbackFighter(p.sx, p.sy, G.Right.face, true, 1.0, G.Right.invul);
    }

    drawFX(view, camX, camZoom, G.fx);

    drawVignette(view, G.vignette || 0);

    if (G.flash && G.flash > 0.01) {
      ctx.globalAlpha = Math.min(0.25, G.flash);
      ctx.fillStyle = "#fff";
      ctx.fillRect(ox, oy, vw, vh);
      ctx.globalAlpha = 1;
      G.flash *= 0.85;
    }

    // mid text
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.font = `700 ${Math.max(14, vw*0.022)}px system-ui`;
    ctx.textAlign = "center";
    ctx.fillText(G.midText || "", ox + vw/2, oy + vh*0.16);

    ctx.restore();

    if (G.shakeT > 0) {
      G.shakeT = Math.max(0, G.shakeT - dt);
      G.shake *= 0.88;
    } else {
      G.shake *= 0.90;
    }
  }

  return { drawFrame };
}
