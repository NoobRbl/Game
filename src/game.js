// src/game.js
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const rnd=(a,b)=>a+Math.random()*(b-a);
const rndi=(a,b)=>Math.floor(rnd(a,b+1));

export function createGameState(seed=0){
  const G = {
    t:0,
    WORLD:{ left:-540, right:540, floor:0 },
    camX:0, camZoom:1,
    phase:"lobby",
    phaseT:0,
    midText:"Waiting…",
    pingMs:0,

    fx:{
      slashes:[],
      sparks:[],
      popups:[],
      sprites:[]
    },

    Left: makeFighter(-160,0, 1, "YOU"),
    Right: makeFighter(160,0, -1, "FOE"),
    inputs:{ host:null, guest:null },
  };
  return G;
}

function makeFighter(x,y,face,name){
  const hpMax = rndi(20109,36098);
  return {
    name,
    x,y, vx:0, vy:0,
    face,
    grounded:true,
    jumpCount:0,

    hpMax, hp:hpMax,
    enMax:100, en:0,

    invul:0,
    stun:0,
    hitT:0,
    atkT:0, atkKind:1,

    cdAtk:0,
    cdDash:0,
    cdS1:0,
    cdS2:0,
    cdUlt:0,

    burnT:0,
    burnTick:0,
    burnDpsMin:100,
    burnDpsMax:300,

    dead:false,
  };
}

function addPopup(G,wx,wy,text,crit=false){
  G.fx.popups.push({wx,wy,text,crit,t:0,life:0.75});
}

function addSparks(G,wx,wy,count=6){
  for(let i=0;i<count;i++){
    G.fx.sparks.push({wx:wx+rnd(-10,10), wy:wy+rnd(-10,10), s:rnd(3,6), t:0, life:rnd(0.12,0.22)});
  }
}

function addSlash(G,wx,wy,kind="atk"){
  G.fx.slashes.push({wx,wy,rot:rnd(-0.4,0.4), len:rnd(80,120), w:rnd(10,16), kind, t:0, life:0.16});
}

function addSpriteFX(G, kind, wx, wy, face=1, scale=1, life=0.45){
  G.fx.sprites.push({kind, wx, wy, face, scale, t:0, life});
}

function applyHit(G, attacker, target, dmg, opts={}){
  if(target.dead) return;

  target.hp = Math.max(0, target.hp - dmg);
  addPopup(G, target.x, target.y-80, String(Math.round(dmg)), false);
  addSparks(G, target.x, target.y-60, 10);

  const st = opts.stun ?? 0.08;
  const kx = opts.kx ?? 120;
  const ky = opts.ky ?? 0;

  target.stun = Math.max(target.stun, st);
  target.hitT = Math.max(target.hitT, 0.12);

  const dir = Math.sign(attacker.face || 1);
  target.vx += dir * (kx);
  if(ky>0){
    target.vy = Math.max(target.vy, ky);
    target.grounded = false;
  }

  attacker.en = clamp(attacker.en + (opts.enGain ?? 10), 0, attacker.enMax);

  if(target.hp<=0){
    target.dead=true;
    target.stun=999;
    G.phase="ko";
    G.phaseT=0;
    G.midText="KO!";
  }
}

function startBurn(target, dur=2.0){
  target.burnT = Math.max(target.burnT, dur);
  target.burnTick = 0;
}

export function stepGame(G, dt, inpL, inpR){
  // ✅ inp null-safe
  inpL ||= { mx:0, atk:false, jump:false, dash:false, s1:false, s2:false, ult:false, sub:false };
  inpR ||= { mx:0, atk:false, jump:false, dash:false, s1:false, s2:false, ult:false, sub:false };

  G.t += dt;

  if(G.phase==="countdown"){
    G.phaseT += dt;
    const t=G.phaseT;
    if(t<1) G.midText="1";
    else if(t<2) G.midText="2";
    else if(t<3) G.midText="3";
    else if(t<3.6) G.midText="READY";
    else { G.phase="fight"; G.phaseT=0; G.midText="FIGHT"; }
  } else if(G.phase==="fight"){
    G.phaseT += dt;
    if(G.phaseT>1.0) G.midText=`FIGHT`;
  } else if(G.phase==="lobby"){
    G.midText="Waiting player…";
  } else if(G.phase==="ko"){
    G.phaseT += dt;
  }

  const P=[G.Left,G.Right];
  for(const p of P){
    if(p.invul>0) p.invul=Math.max(0,p.invul-dt);
    if(p.stun>0)  p.stun=Math.max(0,p.stun-dt);
    if(p.hitT>0)  p.hitT=Math.max(0,p.hitT-dt);
    if(p.atkT>0)  p.atkT=Math.max(0,p.atkT-dt);

    p.cdAtk=Math.max(0,p.cdAtk-dt);
    p.cdDash=Math.max(0,p.cdDash-dt);
    p.cdS1=Math.max(0,p.cdS1-dt);
    p.cdS2=Math.max(0,p.cdS2-dt);
    p.cdUlt=Math.max(0,p.cdUlt-dt);

    if(p.burnT>0 && !p.dead){
      p.burnT=Math.max(0,p.burnT-dt);
      p.burnTick += dt;
      while(p.burnTick>=0.10){
        p.burnTick -= 0.10;
        const d = rndi(p.burnDpsMin, p.burnDpsMax);
        p.hp = Math.max(0, p.hp - d);
        addPopup(G, p.x, p.y-95, String(d), false);
        if(p.hp<=0){ p.dead=true; p.stun=999; G.phase="ko"; G.midText="KO!"; break; }
      }
    }
  }

  tickFX(G, dt);

  updateFighter(G, G.Left, G.Right, dt, inpL);
  updateFighter(G, G.Right, G.Left, dt, inpR);

  updateCamera(G, dt);

  for(const p of P){
    p.x = clamp(p.x, G.WORLD.left, G.WORLD.right);
    if(p.y>=G.WORLD.floor){
      p.y=G.WORLD.floor;
      p.vy=0;
      if(!p.grounded){
        p.grounded=true;
        p.jumpCount=0;
      }
    }
  }
}

function tickFX(G,dt){
  for(const s of G.fx.slashes) s.t+=dt;
  for(const sp of G.fx.sparks) sp.t+=dt;
  for(const d of G.fx.popups) d.t+=dt;
  for(const z of G.fx.sprites) z.t+=dt;

  G.fx.slashes = G.fx.slashes.filter(x=>x.t<x.life);
  G.fx.sparks  = G.fx.sparks.filter(x=>x.t<x.life);
  G.fx.popups  = G.fx.popups.filter(x=>x.t<x.life);
  G.fx.sprites = G.fx.sprites.filter(x=>x.t<x.life);
}

function updateFighter(G, self, foe, dt, inp){
  if(self.dead) return;

  if(foe && !foe.dead){
    self.face = (foe.x>=self.x) ? 1 : -1;
  }

  const runSpeed = 260;
  const accel = 2400;
  const friction = 2200;
  const gravity = 1850;
  const jumpV = 620;
  const doubleJumpV = 560;

  const canAct = (self.stun<=0) && (G.phase==="fight");
  const attacking = self.atkT>0;
  const moveMul = attacking ? 0.55 : 1.0;

  const targetVx = clamp(inp.mx, -1, 1) * runSpeed * moveMul;
  const dv = targetVx - self.vx;
  const a = (Math.abs(targetVx)>0.01) ? accel : friction;
  self.vx += clamp(dv, -a*dt, a*dt);

  if(canAct && inp.dash && self.cdDash<=0){
    self.cdDash = 0.55;
    self.invul = Math.max(self.invul, 0.10);
    const dashDist = 185;
    const dir = self.face;
    self.x += dir * dashDist;
    self.vx = dir * 520;
    addSlash(G, self.x + dir*30, self.y-60, "dash");
    G.shake = Math.max(G.shake||0, 2.0);
    G.shakeT = Math.max(G.shakeT||0, 0.08);
  }

  if(canAct && inp.jump){
    if(self.grounded){
      self.grounded=false;
      self.vy = -jumpV;
      self.jumpCount=1;
    }else if(self.jumpCount<2){
      self.vy = -doubleJumpV;
      self.jumpCount++;
      addSparks(G, self.x, self.y-40, 6);
    }
  }

  if(!self.grounded){
    self.vy += gravity*dt;
    self.y += self.vy*dt;
  }

  self.x += self.vx*dt;

  if(canAct && inp.atk && self.cdAtk<=0){
    self.cdAtk = 0.28;
    self.atkT = 0.18;
    self.atkKind = (Math.random()<0.5)?1:2;

    addSlash(G, self.x + self.face*70, self.y-62, "atk");
    tryHitMelee(G, self, foe, { dmgMin:200, dmgMax:350, critChance:0.10, critMin:400, critMax:450,
      range:120, stun:0.09, kx:95, ky:40 });
  }

  if(canAct && inp.s1 && self.cdS1<=0){
    self.cdS1 = 1.35;
    self.atkT = 0.22;
    spawnFireball(G, self);
  }

  if(canAct && inp.s2 && self.cdS2<=0){
    self.cdS2 = 1.85;
    self.atkT = 0.28;
    spawnBlast(G, self, foe);
  }

  if(canAct && inp.ult && self.cdUlt<=0 && self.en>=100){
    self.en = 0;
    self.cdUlt = 7.5;
    startUlt(G, self, foe);
  }
}

function tryHitMelee(G, self, foe, cfg){
  if(!foe || foe.dead) return;
  const dx = foe.x - self.x;
  const adx = Math.abs(dx);
  if(adx>cfg.range) return;
  if(Math.sign(dx) !== Math.sign(self.face)) return;

  let dmg = rndi(cfg.dmgMin, cfg.dmgMax);
  const crit = Math.random()<cfg.critChance;
  if(crit) dmg = rndi(cfg.critMin, cfg.critMax);

  applyHit(G, self, foe, dmg, { stun:cfg.stun, kx:cfg.kx, ky:cfg.ky, enGain:12 });
}

function spawnFireball(G, self){
  const dir = self.face;
  const travel = 260;
  const startX = self.x + dir*70;
  const endX = startX + dir*travel;

  addSpriteFX(G, "s1", startX, self.y-70, dir, 1.0, 0.55);
  const z = G.fx.sprites[G.fx.sprites.length-1];
  z.startX = startX; z.endX = endX; z.hit = false;
  z.life = 0.75;

  const foe = (self===G.Left)?G.Right:G.Left;
  if(!foe || foe.dead) return;

  const minX = Math.min(startX,endX)-30;
  const maxX = Math.max(startX,endX)+30;
  if(foe.x>=minX && foe.x<=maxX && Math.abs((foe.y)-(self.y))<40){
    const dmg = rndi(2000,2500);
    applyHit(G, self, foe, dmg, { stun:0.16, kx:140, ky:120, enGain:22 });
    startBurn(foe, 2.0);
    addPopup(G, foe.x, foe.y-120, "BURN", false);
    z.hit = true;
    z.life = 0.28;
  }
}

function spawnBlast(G, self, foe){
  addSpriteFX(G, "s2", self.x, self.y-10, 1, 1.0, 0.60);

  const r = 150;
  if(!foe || foe.dead) return;
  const adx = Math.abs(foe.x - self.x);
  if(adx>r) return;

  const dmg = rndi(2000,3000);
  applyHit(G, self, foe, dmg, { stun:0.35, kx:120, ky:540, enGain:28 });
  G.shake = Math.max(G.shake||0, 4.2);
  G.shakeT = Math.max(G.shakeT||0, 0.12);
}

function startUlt(G, self, foe){
  G.flash = Math.max(G.flash||0, 0.35);
  G.vignette = Math.max(G.vignette||0, 1.0);
  G.shake = Math.max(G.shake||0, 6.0);
  G.shakeT = Math.max(G.shakeT||0, 0.18);

  addSpriteFX(G, "ult", self.x + self.face*60, self.y-70, self.face, 1.2, 0.85);

  if(!foe || foe.dead) return;
  const inRange = Math.abs(foe.x - self.x) < 220;

  if(inRange){
    for(let i=0;i<3;i++){
      const dmg = rndi(1500,2100);
      applyHit(G, self, foe, dmg, { stun:0.22, kx:160, ky:240, enGain:0 });
    }
    addPopup(G, foe.x, foe.y-140, "ULT", true);
  }else{
    addSlash(G, self.x + self.face*90, self.y-70, "ult");
  }
}

function updateCamera(G, dt){
  const a=G.Left, b=G.Right;
  const mid = (a.x + b.x)*0.5;
  const dist = Math.abs(a.x - b.x);

  const zTarget = clamp(1.0 - (dist/900)*0.35, 0.70, 1.05);

  const camMin = G.WORLD.left + 320;
  const camMax = G.WORLD.right - 320;
  const cx = clamp(mid, camMin, camMax);

  G.camX += (cx - G.camX) * (1 - Math.pow(0.001, dt));
  G.camZoom += (zTarget - G.camZoom) * (1 - Math.pow(0.001, dt));
}
