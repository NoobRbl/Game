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

  // 16:9 letterbox
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

  function worldToScreen(view, camX, wx, wy) {
    const { ox, oy, vw, vh } = view;
    const scale = (vw / 1280); // world base width
    const sx = ox + vw / 2 + (wx - camX) * scale;
    const sy = oy + vh * 0.72 + wy * scale; // floor line
    return { sx, sy, scale };
  }

  function drawBackground(view) {
    const { ox, oy, vw, vh } = view;
    // nền nhẹ
    const g = ctx.createLinearGradient(0, oy, 0, oy + vh);
    g.addColorStop(0, "#0b1020");
    g.addColorStop(1, "#05070f");
    ctx.fillStyle = g;
    ctx.fillRect(ox, oy, vw, vh);

    // “stage” gradient
    ctx.fillStyle = "rgba(120,150,255,0.06)";
    ctx.fillRect(ox, oy + vh * 0.55, vw, vh * 0.45);

    // ground shadow
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.fillRect(ox, oy + vh * 0.74, vw, vh * 0.02);
  }

  function drawFallbackFighter(sx, sy, face, isEnemy, scale, invul) {
    ctx.save();
    ctx.translate(sx, sy);

    // invul flicker nhẹ
    if (invul > 0) ctx.globalAlpha = 0.55 + 0.25 * Math.sin(performance.now() * 0.03);

    // flip
    ctx.scale(face < 0 ? -1 : 1, 1);

    // shadow
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.ellipse(0, 6 * scale, 28 * scale, 10 * scale, 0, 0, Math.PI * 2);
    ctx.fill();

    // body
    ctx.fillStyle = isEnemy ? "#ff6a6a" : "#6ad5ff";
    ctx.fillRect(-24 * scale, -92 * scale, 48 * scale, 92 * scale);

    // head
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillRect(-14 * scale, -118 * scale, 28 * scale, 26 * scale);

    // eye line
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.fillRect(-8 * scale, -108 * scale, 16 * scale, 3 * scale);

    ctx.restore();
  }

  function drawFX(view, camX, fx) {
    const { ox, oy, vw, vh } = view;
    const scale = (vw / 1280);

    // slashes
    for (const s of fx.slashes) {
      const p = worldToScreen(view, camX, s.wx, s.wy);
      const t = s.t / s.life;
      ctx.save();
      ctx.translate(p.sx, p.sy);
      ctx.rotate(s.rot);
      ctx.globalAlpha = 1 - t;
      ctx.fillStyle = (s.kind === "ult") ? "rgba(255,220,140,0.95)" : "rgba(190,255,255,0.9)";
      ctx.fillRect(-s.len * scale * 0.5, -s.w * scale * 0.5, s.len * scale, s.w * scale);
      ctx.restore();
    }

    // sparks
    for (const sp of fx.sparks) {
      const p = worldToScreen(view, camX, sp.wx, sp.wy);
      const t = sp.t / sp.life;
      ctx.globalAlpha = 1 - t;
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.fillRect(p.sx, p.sy, sp.s * scale, sp.s * scale);
    }

    // popups (số damage kiểu simple)
    ctx.textAlign = "center";
    ctx.font = `${Math.max(12, 16 * scale)}px system-ui, -apple-system, Segoe UI, Roboto`;
    for (const d of fx.popups) {
      const p = worldToScreen(view, camX, d.wx, d.wy);
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

    // clear full screen (black bars)
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);

    // shake
    const shake = G.shake || 0;
    const shx = shake ? (Math.random() - 0.5) * shake : 0;
    const shy = shake ? (Math.random() - 0.5) * shake : 0;

    ctx.save();
    ctx.translate(shx, shy);

    drawBackground(view);

    const camX = G.camX || 0;

    // draw fighters (fallback always)
    if (G.Left) {
      const p = worldToScreen(view, camX, G.Left.x, G.Left.y);
      drawFallbackFighter(p.sx, p.sy, G.Left.face, false, 1.0, G.Left.invul);
    }
    if (G.Right) {
      const p = worldToScreen(view, camX, G.Right.x, G.Right.y);
      drawFallbackFighter(p.sx, p.sy, G.Right.face, true, 1.0, G.Right.invul);
    }

    // FX
    drawFX(view, camX, G.fx);

    // vignette + flash
    drawVignette(view, G.vignette || 0);

    if (G.flash && G.flash > 0.01) {
      ctx.globalAlpha = Math.min(0.25, G.flash);
      ctx.fillStyle = "#fff";
      ctx.fillRect(ox, oy, vw, vh);
      ctx.globalAlpha = 1;
      G.flash *= 0.85;
    }

    ctx.restore();

    // decay shake
    if (G.shakeT > 0) {
      G.shakeT = Math.max(0, G.shakeT - dt);
      G.shake *= 0.88;
    } else {
      G.shake *= 0.90;
    }
  }

  return { drawFrame };
}
