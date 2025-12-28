// src/render.js
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

function loadImage(src){
  return new Promise((res,rej)=>{
    const img=new Image();
    img.decoding="async";
    img.onload=()=>res(img);
    img.onerror=rej;
    img.src=src;
  });
}

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

  function worldToScreen(view, camX, camZoom, wx, wy) {
    const { ox, oy, vw, vh } = view;
    const base = (vw / 1280);
    const scale = base * camZoom;
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

    // stage
    ctx.fillStyle = "rgba(120,150,255,0.06)";
    ctx.fillRect(ox, oy + vh * 0.55, vw, vh * 0.45);

    // ground
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.fillRect(ox, oy + vh * 0.74, vw, vh * 0.02);

    // decorative platforms
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    ctx.fillRect(ox + vw*0.12, oy + vh*0.66, vw*0.20, vh*0.02);
    ctx.fillRect(ox + vw*0.70, oy + vh*0.62, vw*0.20, vh*0.02);
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
    ctx.fillRect(-18 * scale, -70 * scale, 36 * scale, 70 * scale);
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillRect(-12 * scale, -92 * scale, 24 * scale, 22 * scale);
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.fillRect(-7 * scale, -84 * scale, 14 * scale, 3 * scale);

    ctx.restore();
  }

  // ---- Skill spritesheets ----
  const FX = {
    ready:false,
    imgS1:null,
    imgS2:null,
    // Bạn chỉnh frameW/frameH theo đúng sprite bạn dùng
    s1:{ frameW:64, frameH:32, frames:4, fps:18, loop:true },     // ảnh 1 (đạn lửa)
    s2:{ frameW:64, frameH:32, frames:6, fps:22, loop:false },    // ảnh 2 (nổ chân)
    ult:{ frameW:64, frameH:64, frames:6, fps:18, loop:false }    // dùng lại glow (tự vẽ)
  };

  (async ()=>{
    try{
      FX.imgS1 = await loadImage("/assets/fx/skill1_fireball.png");
      FX.imgS2 = await loadImage("/assets/fx/skill2_blast.png");
      FX.ready = true;
    }catch(e){
      console.warn("FX sprite load failed:", e);
      FX.ready = false;
    }
  })();

  function drawFXSprites(view, camX, camZoom, fxSprites){
    const now = performance.now()/1000;
    for(const z of fxSprites){
      const p = worldToScreen(view, camX, camZoom, z.wx, z.wy);

      if(z.kind==="s1" && FX.ready && FX.imgS1){
        const clip=FX.s1;
        const fi = Math.floor((z.t*clip.fps)) % clip.frames;
        const sx = fi*clip.frameW, sy=0;

        // move bullet if has vx
        if(typeof z.vx==="number"){
          z.wx += z.vx * (1/60); // render smooth, server still authoritative
          if(z.face>0 && z.wx>z.endX) z.t=z.life;
          if(z.face<0 && z.wx<z.endX) z.t=z.life;
        }

        ctx.save();
        ctx.translate(p.sx, p.sy);
        ctx.scale(z.face<0?-1:1, 1);
        ctx.globalAlpha = 1 - (z.t/z.life)*0.4;
        ctx.imageSmoothingEnabled = false;
        const s = p.scale * 1.1 * (z.scale||1);
        ctx.drawImage(FX.imgS1, sx, sy, clip.frameW, clip.frameH, -clip.frameW*s*0.5, -clip.frameH*s*0.5, clip.frameW*s, clip.frameH*s);
        ctx.restore();
      }

      if(z.kind==="s2" && FX.ready && FX.imgS2){
        const clip=FX.s2;
        const fi = Math.min(clip.frames-1, Math.floor(z.t*clip.fps));
        const sx = fi*clip.frameW, sy=0;

        ctx.save();
        ctx.translate(p.sx, p.sy);
        ctx.globalAlpha = 1 - (z.t/z.life);
        ctx.imageSmoothingEnabled = false;
        const s = p.scale * 1.45 * (z.scale||1);
        ctx.drawImage(FX.imgS2, sx, sy, clip.frameW, clip.frameH, -clip.frameW*s*0.5, -clip.frameH*s*0.5, clip.frameW*s, clip.frameH*s);
        ctx.restore();
      }

      if(z.kind==="ult"){
        // “ngầu nhưng nhẹ”: vòng năng lượng + tia
        const t = z.t/z.life;
        ctx.save();
        ctx.translate(p.sx, p.sy);
        ctx.globalAlpha = 0.95*(1-t);
        const s = p.scale * 90 * (z.scale||1);
        ctx.strokeStyle = "rgba(255,220,140,0.95)";
        ctx.lineWidth = Math.max(2, 6*p.scale);
        ctx.beginPath();
        ctx.arc(0,0, s*(0.4+0.5*t), 0, Math.PI*2);
        ctx.stroke();

        ctx.strokeStyle = "rgba(255,255,255,0.45)";
        for(let i=0;i<6;i++){
          const a = (i/6)*Math.PI*2 + t*2.2;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a)*s*0.25, Math.sin(a)*s*0.25);
          ctx.lineTo(Math.cos(a)*s*(0.65+0.2*Math.sin(t*5)), Math.sin(a)*s*(0.65+0.2*Math.sin(t*5)));
          ctx.stroke();
        }
        ctx.restore();
      }
    }
  }

  function drawFX(view, camX, camZoom, fx) {
    const scale = (view.vw / 1280) * camZoom;

    // slashes
    for (const s of fx.slashes) {
      const p = worldToScreen(view, camX, camZoom, s.wx, s.wy);
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
      const p = worldToScreen(view, camX, camZoom, sp.wx, sp.wy);
      const t = sp.t / sp.life;
      ctx.globalAlpha = 1 - t;
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.fillRect(p.sx, p.sy, sp.s * scale, sp.s * scale);
    }

    // popups
    ctx.textAlign = "center";
    ctx.font = `${Math.max(12, 16 * scale)}px system-ui, -apple-system, Segoe UI, Roboto`;
    for (const d of fx.popups) {
      const p = worldToScreen(view, camX, camZoom, d.wx, d.wy);
      const t = d.t / d.life;
      ctx.globalAlpha = 1 - t;
      ctx.fillStyle = d.crit ? "rgba(255,220,120,1)" : "rgba(255,255,255,0.95)";
      ctx.fillText(d.text, p.sx, p.sy);
    }
    ctx.globalAlpha = 1;

    // NEW: sprites
    if(fx.sprites) drawFXSprites(view, camX, camZoom, fx.sprites);
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
    const camZoom = clamp(G.camZoom || 1, 0.68, 1.08);

    if (G.Left) {
      const p = worldToScreen(view, camX, camZoom, G.Left.x, G.Left.y);
      drawFallbackFighter(p.sx, p.sy, G.Left.face, false, camZoom, G.Left.invul);
    }
    if (G.Right) {
      const p = worldToScreen(view, camX, camZoom, G.Right.x, G.Right.y);
      drawFallbackFighter(p.sx, p.sy, G.Right.face, true, camZoom, G.Right.invul);
    }

    if(G.fx) drawFX(view, camX, camZoom, G.fx);

    drawVignette(view, G.vignette || 0);

    if (G.flash && G.flash > 0.01) {
      ctx.globalAlpha = Math.min(0.25, G.flash);
      ctx.fillStyle = "#fff";
      ctx.fillRect(ox, oy, vw, vh);
      ctx.globalAlpha = 1;
      G.flash *= 0.85;
    }

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
