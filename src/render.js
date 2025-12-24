const lerp=(a,b,t)=>a+(b-a)*t;

export function setupRender(){
  const cv=document.getElementById("cv");
  const ctx=cv.getContext("2d");

  const VIEW={x:0,y:0,w:0,h:0,dpr:1};

  function resize(){
    VIEW.dpr = Math.max(1, Math.min(2, devicePixelRatio||1));
    cv.width = Math.floor(innerWidth*VIEW.dpr);
    cv.height= Math.floor(innerHeight*VIEW.dpr);

    const W=cv.width, H=cv.height;
    const target = 16/9;
    let vw=W, vh=Math.floor(W/target);
    if(vh>H){ vh=H; vw=Math.floor(H*target); }
    VIEW.w=vw; VIEW.h=vh;
    VIEW.x=Math.floor((W - vw)/2);
    VIEW.y=Math.floor((H - vh)/2);
  }
  addEventListener("resize", resize, {passive:true});
  resize();

  const floorRel=0.79;
  const floorY=()=>VIEW.h*floorRel;

  function beginView(G){
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,cv.width,cv.height);
    ctx.fillStyle="#000"; ctx.fillRect(0,0,cv.width,cv.height);

    ctx.save();
    ctx.translate(VIEW.x, VIEW.y);

    // cinematic zoom around center
    const z = G.zoom || 1;
    ctx.translate(VIEW.w/2, VIEW.h/2);
    ctx.scale(z, z);
    ctx.translate(-VIEW.w/2, -VIEW.h/2);
  }
  function endView(){ ctx.restore(); }

  function w2s(G, wx, wy){
    return { x: VIEW.w/2 + (wx - G.camX), y: floorY() + wy };
  }

  function roundRect(x,y,w,h,r){
    const rr=Math.min(r,w/2,h/2);
    ctx.beginPath();
    ctx.moveTo(x+rr,y);
    ctx.arcTo(x+w,y,x+w,y+h,rr);
    ctx.arcTo(x+w,y+h,x,y+h,rr);
    ctx.arcTo(x,y+h,x,y,rr);
    ctx.arcTo(x,y,x+w,y,rr);
    ctx.closePath();
  }

  function drawBackground(){
    const w=VIEW.w, h=VIEW.h;
    const g=ctx.createRadialGradient(w*0.5,0,10,w*0.5,0,w*0.9);
    g.addColorStop(0,"rgba(35,60,120,.35)");
    g.addColorStop(1,"rgba(5,7,12,1)");
    ctx.fillStyle=g; ctx.fillRect(0,0,w,h);

    ctx.globalAlpha=0.18;
    ctx.strokeStyle="rgba(255,255,255,.12)";
    ctx.lineWidth=2;
    ctx.beginPath(); ctx.moveTo(0,floorY()+1); ctx.lineTo(w,floorY()+1); ctx.stroke();
    ctx.globalAlpha=1;
  }

  function drawCinematicOverlay(G){
    const v=G.vignette||0;
    if(v>0.01){
      const g=ctx.createRadialGradient(VIEW.w/2, VIEW.h/2, VIEW.h*0.15, VIEW.w/2, VIEW.h/2, VIEW.h*0.72);
      g.addColorStop(0,"rgba(0,0,0,0)");
      g.addColorStop(1,`rgba(0,0,0,${0.65*v})`);
      ctx.fillStyle=g;
      ctx.fillRect(0,0,VIEW.w,VIEW.h);
    }
    if(v>0.08){
      const bar = Math.floor(lerp(0, VIEW.h*0.08, v));
      ctx.fillStyle="rgba(0,0,0,.85)";
      ctx.fillRect(0,0,VIEW.w,bar);
      ctx.fillRect(0,VIEW.h-bar,VIEW.w,bar);
    }
  }

  function drawFX(G, dt){
    const fx=G.fx;

    // slashes
    for(let i=fx.slashes.length-1;i>=0;i--){
      const s=fx.slashes[i]; s.t+=dt;
      const a=s.t/s.life;
      if(a>=1){ fx.slashes.splice(i,1); continue; }
      const pos=w2s(G, s.wx, s.wy);
      const alpha=(1-a)*0.95;
      const color = s.kind==="ult" ? "rgba(255,220,120,.92)" :
                    s.kind==="skill"? "rgba(180,240,255,.86)" : "rgba(200,245,255,.82)";
      ctx.save();
      ctx.globalAlpha=alpha;
      ctx.translate(pos.x,pos.y);
      ctx.scale(s.dir,1);
      ctx.rotate(s.rot + (s.kind==="ult"?1.35:1.0)*a);
      ctx.shadowColor = s.kind==="ult" ? "rgba(255,220,120,.42)" : "rgba(180,240,255,.30)";
      ctx.shadowBlur  = s.kind==="ult" ? 26 : 18;
      ctx.strokeStyle=color;
      ctx.lineWidth=s.w;
      ctx.lineCap="round";
      ctx.beginPath(); ctx.moveTo(-s.len*0.46,0); ctx.lineTo(s.len*0.56,0); ctx.stroke();
      ctx.shadowBlur=0;
      ctx.globalAlpha*=0.65;
      ctx.strokeStyle="rgba(255,255,255,.92)";
      ctx.lineWidth=Math.max(2,s.w*0.45);
      ctx.beginPath(); ctx.moveTo(-s.len*0.38,0); ctx.lineTo(s.len*0.48,0); ctx.stroke();
      ctx.restore();
    }

    // sparks
    for(let i=fx.sparks.length-1;i>=0;i--){
      const p=fx.sparks[i]; p.t+=dt;
      const a=p.t/p.life;
      if(a>=1){ fx.sparks.splice(i,1); continue; }
      p.wx+=p.vx*dt; p.wy+=p.vy*dt;
      p.vy+=920*dt; p.vx*=0.985;
      const pos=w2s(G, p.wx, p.wy);
      ctx.save();
      ctx.globalAlpha=(1-a)*0.85;
      ctx.fillStyle="rgba(255,255,255,.85)";
      ctx.fillRect(pos.x,pos.y,p.s,p.s);
      ctx.restore();
    }

    // popups
    for(let i=fx.popups.length-1;i>=0;i--){
      const d=fx.popups[i];
      d.t+=dt;
      d.wy += d.vy*dt;
      d.vy += 520*dt;
      const a=d.t/d.life;
      if(a>=1){ fx.popups.splice(i,1); continue; }
      const pos=w2s(G, d.wx, d.wy);
      const alpha=1-Math.pow(a,1.4);
      const scale=1+(1-a)*0.16;

      ctx.save();
      ctx.globalAlpha=alpha;
      ctx.translate(pos.x,pos.y);
      ctx.scale(scale,scale);
      ctx.font=(d.crit?"900 34px":"900 28px")+" system-ui,-apple-system,Segoe UI,Roboto,Arial";
      ctx.fillStyle="rgba(0,0,0,.35)";
      ctx.fillText(d.text,2,2);
      ctx.fillStyle=d.crit?"rgba(255,210,120,.95)":"rgba(255,255,255,.92)";
      ctx.fillText(d.text,0,0);
      ctx.restore();
    }

    // afterimages
    for(let i=fx.afterImgs.length-1;i>=0;i--){
      const aimg=fx.afterImgs[i]; aimg.t+=dt;
      const k=aimg.t/aimg.life;
      if(k>=1){ fx.afterImgs.splice(i,1); continue; }
      const pos=w2s(G, aimg.wx, aimg.wy);
      const alpha=(1-k)*aimg.a;

      ctx.save();
      ctx.globalAlpha=alpha;
      ctx.translate(pos.x, pos.y-108);
      ctx.scale(aimg.face, 1);
      ctx.filter="blur(0.4px)";
      ctx.fillStyle="rgba(200,245,255,.55)";
      roundRect(-34,-78,68,118,20); ctx.fill();
      ctx.filter="none";
      ctx.restore();
    }

    // smoke
    for(let i=fx.smokes.length-1;i>=0;i--){
      const p=fx.smokes[i]; p.t+=dt;
      const k=p.t/p.life;
      if(k>=1){ fx.smokes.splice(i,1); continue; }
      p.wx += p.vx*dt; p.wy += p.vy*dt;
      p.vy += 720*dt; p.vx *= 0.98;

      const pos=w2s(G, p.wx, p.wy);
      const r = p.r + p.grow*k;
      const alpha = (1-k)*0.20;

      ctx.save();
      ctx.globalAlpha=alpha;
      ctx.fillStyle="rgba(255,255,255,.85)";
      ctx.beginPath();
      ctx.arc(pos.x,pos.y,r,0,Math.PI*2);
      ctx.fill();
      ctx.restore();
    }
  }

  async function loadImage(url){
    return new Promise((resolve,reject)=>{
      const img=new Image();
      img.onload=()=>resolve(img);
      img.onerror=(e)=>reject(e);
      img.src=url;
    });
  }

  async function ensureSheetLoaded(f){
    if(f.sheetImg) return;
    try{
      f.sheetImg = await loadImage(f.char.sheet);
    }catch{
      f.sheetImg = null;
    }
  }

  function drawFighter(G, f, colorA, colorB){
    const s=w2s(G, f.x, f.y);
    const sx=s.x, sy=s.y;

    // shadow
    ctx.save();
    ctx.globalAlpha=0.35;
    ctx.beginPath(); ctx.ellipse(sx, sy+8, 58, 16, 0, 0, Math.PI*2);
    ctx.fillStyle="#000"; ctx.fill();
    ctx.restore();

    // blink when invul/stun
    let alpha=1;
    if(f.invul>0 || f.stun>0) alpha=(Math.sin(performance.now()/55)>0)?0.35:1;

    // if spritesheet available -> draw frame
    const frame = f.animator.frame();
    const grid = f.char.sheetGrid;

    ctx.save();
    ctx.globalAlpha=alpha;
    ctx.translate(sx, sy-108);
    ctx.scale(f.face, 1);

    if(f.sheetImg && grid){
      const fw=grid.fw, fh=grid.fh, cols=grid.cols;
      const fx = (frame % cols) * fw;
      const fy = Math.floor(frame / cols) * fh;

      // draw centered
      ctx.drawImage(f.sheetImg, fx, fy, fw, fh, -fw/2, -fh + 20, fw, fh);
    }else{
      // fallback vector
      const grad=ctx.createLinearGradient(-44,-80,44,20);
      grad.addColorStop(0,colorA); grad.addColorStop(1,colorB);
      ctx.fillStyle=grad;
      roundRect(-36,-78,72,118,20); ctx.fill();
      ctx.fillStyle="rgba(0,0,0,.18)";
      roundRect(-30,-78,60,42,18); ctx.fill();
      ctx.fillStyle="rgba(255,255,255,.85)";
      ctx.fillRect(-10,-56,7,3);
      ctx.fillRect(3,-56,7,3);
    }

    ctx.restore();
  }

  function drawFlash(G){
    if((G.flash||0)>0.01){
      ctx.save();
      ctx.globalAlpha=G.flash;
      ctx.fillStyle="#fff";
      ctx.fillRect(0,0,VIEW.w,VIEW.h);
      ctx.restore();
    }
  }

  function drawFrame(G, dt){
    beginView(G);

    // shake
    const ox=(G.shakeT>0)?(Math.random()-0.5)*G.shake:0;
    const oy=(G.shakeT>0)?(Math.random()-0.5)*G.shake:0;
    ctx.translate(ox,oy);

    drawBackground();

    if(G.Left && G.Right){
      drawFX(G, dt);
      // load sheets async (non-block)
      ensureSheetLoaded(G.Left);
      ensureSheetLoaded(G.Right);

      // draw fighters
      drawFighter(G, G.Right, "rgba(255,100,140,.92)", "rgba(255,200,120,.55)");
      drawFighter(G, G.Left,  "rgba(60,245,200,.92)", "rgba(80,170,255,.65)");
    }

    drawFlash(G);
    drawCinematicOverlay(G);
    endView();
  }

  return { VIEW, drawFrame };
}
