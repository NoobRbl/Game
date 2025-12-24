import { makeRng } from "./rng.js";
import { Animator } from "./anim.js";
import { getCharacter } from "./characters/registry.js";

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const lerp=(a,b,t)=>a+(b-a)*t;
const sign=v=>v<0?-1:1;

export function createGame(){
  const G={
    seed:0,
    rng:null,

    Left:null,
    Right:null,

    // cinematic
    zoom:1, zoomTarget:1,
    vignette:0, vignetteTarget:0,
    timeScale:1,

    // camera & fx
    camX:0,
    shake:0, shakeT:0,
    flash:0, flashT:0,

    fx:{
      popups:[], slashes:[], sparks:[], afterImgs:[], smokes:[]
    }
  };

  function startShake(d,p){ G.shakeT=Math.max(G.shakeT,d); G.shake=Math.max(G.shake,p); }
  function startFlash(i,d){ G.flashT=Math.max(G.flashT,d); G.flash=Math.max(G.flash,i); }

  function rollHP(char){ return G.rng.int(char.stats.hpMin, char.stats.hpMax); }
  function rollDamage(char){
    const crit = (G.rng.f() < char.stats.critChance);
    if(crit) return { dmg:G.rng.int(char.stats.critMin,char.stats.critMax), crit:true };
    return { dmg:G.rng.int(char.stats.dmgMin,char.stats.dmgMax), crit:false };
  }

  function Fighter(side, charId){
    const char = getCharacter(charId);
    const hp = rollHP(char);
    return {
      side, char,
      animator: new Animator(char.anim),
      sheetImg: null, // loaded in render
      x: side<0 ? -280 : 280,
      y: 0, vx:0, vy:0,
      face: side<0 ? 1 : -1,
      hp, hpMax: hp,
      en: 100, enMax: 100,

      state:"idle", t:0,
      lock:0, stun:0, invul:0,
      cdDash:0, cdS1:0, cdS2:0, cdUlt:0, cdSub:0,
      atkCd:0, combo:0, comboT:0,
      hitstop:0, didHit:false,
      ult:null,

      move: char.stats.move,
      dashSpd: char.stats.dash,
      jump: char.stats.jump
    };
  }

  function rectHit(att, def, range, w, h){
    const hx=att.x + att.face*range;
    const hy=att.y - 86;
    const dx=def.x;
    const dy=def.y - 86;
    return (dx > hx-w*0.5 && dx < hx+w*0.5 && dy > hy-h*0.5 && dy < hy+h*0.5);
  }

  function spawnPopup(wx,wy,text,crit){ G.fx.popups.push({wx,wy,vy:-320,t:0,life:0.85,text,crit}); }
  function spawnSlash(wx,wy,dir,kind){
    const n=(kind==="ult")?4:(kind==="skill"?3:2);
    for(let i=0;i<n;i++){
      G.fx.slashes.push({wx,wy,dir,kind,t:0,life:(kind==="ult")?0.24:0.17,rot:(-0.8+i*0.24)+(Math.random()-0.5)*0.2,len:((kind==="ult")?320:(kind==="skill")?260:220)*(0.85+Math.random()*0.25),w:((kind==="ult")?12:(kind==="skill")?9:7)*(0.85+Math.random()*0.25)});
    }
  }
  function spawnSparks(wx,wy,dir,power){
    const count = power==="ult"?28:power==="skill"?18:12;
    for(let i=0;i<count;i++){
      const a=Math.random()*Math.PI*2;
      const spd=(power==="ult"?1100:power==="skill"?860:650)*(0.5+Math.random()*0.6);
      G.fx.sparks.push({wx,wy,vx:Math.cos(a)*spd + dir*(power==="ult"?200:120),vy:Math.sin(a)*spd - (power==="ult"?320:220),t:0,life:power==="ult"?0.55:0.42,s:2+Math.random()*2});
    }
  }
  function spawnAfterImage(f,strength){ G.fx.afterImgs.push({wx:f.x,wy:f.y,face:f.face,t:0,life:0.18,a:clamp(strength,0.25,0.9)}); }
  function spawnSmoke(wx,wy,power){
    const n = power==="big"?18:10;
    for(let i=0;i<n;i++){
      const a=Math.random()*Math.PI*2;
      const spd=(power==="big"?820:520)*(0.4+Math.random()*0.8);
      G.fx.smokes.push({wx,wy,vx:Math.cos(a)*spd,vy:Math.sin(a)*spd-(power==="big"?360:240),t:0,life:power==="big"?0.55:0.38,r:12+Math.random()*18,grow:(power==="big"?64:44)*(0.7+Math.random()*0.6)});
    }
  }

  function applyHit(att, def, baseMul, power){
    if(def.invul>0) return false;
    const range = power==="atk"?175: power==="skill"?240:210;
    const w = power==="atk"?150: power==="skill"?220:190;
    const h = power==="atk"?120: power==="skill"?150:140;
    if(!rectHit(att,def,range,w,h)) return false;

    const roll=rollDamage(att.char);
    const dmg=Math.floor(roll.dmg*baseMul);

    def.hp=Math.max(0,def.hp-dmg);
    def.stun=Math.max(def.stun, power==="ult"?0.26:power==="skill"?0.20:0.16);
    def.invul=Math.max(def.invul, power==="ult"?0.16:power==="skill"?0.12:0.10);

    const dir=att.face;
    def.vx = dir*(power==="ult"?620:power==="skill"?520:420);
    def.vy = -(power==="ult"?620:power==="skill"?520:420);

    spawnPopup(def.x, def.y-120, String(dmg), roll.crit);
    spawnSlash(def.x, def.y-90, dir, power==="ult"?"ult":(power==="skill"?"skill":"atk"));
    spawnSparks(def.x, def.y-92, dir, power==="ult"?"ult":(power==="skill"?"skill":"atk"));

    startShake(0.06, power==="ult"?18:power==="skill"?14:12);
    startFlash(power==="ult"?0.45:0.22, power==="ult"?0.09:0.06);

    att.hitstop=Math.max(att.hitstop, power==="ult"?0.05:0.04);
    def.hitstop=Math.max(def.hitstop, power==="ult"?0.03:0.024);

    att.en = clamp(att.en + (roll.crit?10:7), 0, 100);
    return true;
  }

  function applyGround(f){ if(f.y>=0){ f.y=0; f.vy=0; } }

  function doJump(f){
    if(f.lock>0||f.stun>0) return;
    if(f.y===0){ f.vy=-f.jump; f.state="jump"; f.t=0; }
  }
  function doDash(f, dir){
    if(f.lock>0||f.stun>0) return;
    if(f.cdDash>0) return;
    f.cdDash=0.60; f.invul=Math.max(f.invul,0.12);
    f.lock=0.08; f.state="dash"; f.t=0;
    const d = Math.abs(dir)>0.2 ? sign(dir) : f.face;
    f.face=d;
    f.vx = d*f.dashSpd;
    f.vy *= 0.10;
    startShake(0.05,10);
  }
  function doAttack(f){
    if(f.lock>0||f.stun>0) return;
    if(f.atkCd>0) return;
    f.atkCd=0.14;
    if(f.comboT<=0) f.combo=0;
    f.comboT=0.85;
    f.combo=(f.combo+1)%3;
    f.lock=0.22 + f.combo*0.02;
    f.state="atk"; f.t=0; f.didHit=false;
  }
  function doSkill1(f){
    if(f.lock>0||f.stun>0||f.cdS1>0||f.en<20) return;
    f.en-=20; f.cdS1=1.2; f.lock=0.38; f.state="s1"; f.t=0; f.didHit=false;
    startFlash(0.18,0.05);
  }
  function doSkill2(f){
    if(f.lock>0||f.stun>0||f.cdS2>0||f.en<25) return;
    f.en-=25; f.cdS2=1.5; f.lock=0.46; f.state="s2"; f.t=0; f.didHit=false;
    startFlash(0.18,0.05);
  }
  function doSub(f){
    if(f.lock>0||f.stun>0||f.cdSub>0||f.en<15) return;
    f.en-=15; f.cdSub=0.9; f.lock=0.28; f.state="sub"; f.t=0; f.didHit=false;
  }
  function doUlt(f, def){
    if(f.lock>0||f.stun>0||f.cdUlt>0||f.en<100) return;
    f.en=0; f.cdUlt=3.0; f.lock=0.95; f.state="ult"; f.t=0;
    f.ult={tele:false, idx:0, hits:[0.20,0.33,0.47,0.62]};
    startFlash(0.45,0.10); startShake(0.07,18);
  }

  function updateFighter(f, def, dt, inp, edge){
    f.lock=Math.max(0,f.lock-dt);
    f.stun=Math.max(0,f.stun-dt);
    f.invul=Math.max(0,f.invul-dt);

    f.cdDash=Math.max(0,f.cdDash-dt);
    f.cdS1=Math.max(0,f.cdS1-dt);
    f.cdS2=Math.max(0,f.cdS2-dt);
    f.cdUlt=Math.max(0,f.cdUlt-dt);
    f.cdSub=Math.max(0,f.cdSub-dt);
    f.atkCd=Math.max(0,f.atkCd-dt);
    f.comboT=Math.max(0,f.comboT-dt);

    if(f.hitstop>0){ f.hitstop=Math.max(0,f.hitstop-dt); return; }

    const jumpOnce=edge("jump", inp.jump);
    const atkOnce =edge("atk",  inp.atk);
    const dashOnce=edge("dash", inp.dash);
    const s1Once  =edge("s1",   inp.s1);
    const s2Once  =edge("s2",   inp.s2);
    const ultOnce =edge("ult",  inp.ult);
    const subOnce =edge("sub",  inp.sub);

    if(Math.abs(inp.mx)>0.2 && f.stun<=0 && f.state!=="ult") f.face = inp.mx>0?1:-1;

    if(jumpOnce) doJump(f);
    if(dashOnce) doDash(f, inp.mx);
    if(atkOnce)  doAttack(f);
    if(s1Once)   doSkill1(f);
    if(s2Once)   doSkill2(f);
    if(subOnce)  doSub(f);
    if(ultOnce)  doUlt(f, def);

    let slow=1;
    if(f.state==="atk") slow=0.62;
    if(f.state==="s1"||f.state==="s2"||f.state==="sub") slow=0.45;
    if(f.state==="ult") slow=0.0;
    if(f.stun>0) slow=0.0;

    const accel=3300;
    const target = inp.mx*(f.move*slow);
    f.vx = lerp(f.vx, target, 1 - Math.exp(-accel*dt/Math.max(260,f.move)));
    if(Math.abs(inp.mx)<0.08) f.vx*=0.86;

    f.vy += 2600*dt;
    f.x += f.vx*dt; f.y += f.vy*dt;
    applyGround(f);

    if(f.hp<=0){ f.state="dead"; return; }
    if(f.stun>0) f.state="stun";
    else if(f.state==="ult") f.state="ult";
    else if(f.lock>0 && ["atk","dash","s1","s2","sub"].includes(f.state)) {}
    else if(f.y<0) f.state=(f.vy<0)?"jump":"fall";
    else if(Math.abs(inp.mx)>0.15) f.state="run";
    else f.state="idle";

    // ATK hit window
    if(f.state==="atk"){
      const w0=0.06+f.combo*0.01, w1=0.14+f.combo*0.015;
      if(!f.didHit && f.t>=w0 && f.t<=w1) if(applyHit(f,def,1.0,"atk")) f.didHit=true;
    }

    // S1 cross-slash
    if(f.state==="s1"){
      if(f.t < 0.22) spawnAfterImage(f, 0.55);
      if(!f.didHit && f.t>=0.10 && f.t<=0.16){
        if(applyHit(f,def,1.10,"skill")) f.didHit=true;
      }
      if(f.t>=0.18 && f.t<=0.24){
        applyHit(f,def,0.92,"skill");
        spawnSlash(def.x, def.y-92, f.face, "skill");
        spawnSparks(def.x, def.y-94, f.face, "skill");
      }
    }

    // S2 shadow step/backstab
    if(f.state==="s2"){
      if(f.t>=0.10 && f.t<0.12){
        const d=sign(def.x-f.x)||f.face; f.face=d;
        spawnSmoke(f.x, f.y-40, "small");
        f.x = def.x - d*240;
        f.invul=Math.max(f.invul,0.14);
        spawnSmoke(f.x, f.y-40, "big");
        startFlash(0.28,0.06);
        startShake(0.06,16);
        spawnSlash(def.x, def.y-98, d, "ult");
      }
      if(!f.didHit && f.t>=0.14 && f.t<=0.30){
        if(applyHit(f,def,1.25,"skill")) f.didHit=true;
      }
    }

    // SUB feint
    if(f.state==="sub"){
      if(f.t<0.12) spawnAfterImage(f, 0.45);
      if(f.t>=0.06 && f.t<0.08){
        f.x += f.face*90;
        spawnSmoke(f.x, f.y-40, "small");
      }
      if(!f.didHit && f.t>=0.08 && f.t<=0.16){
        if(applyHit(f,def,0.88,"skill")) f.didHit=true;
      }
    }

    // ULT cinematic multi slash
    if(f.state==="ult" && f.ult){
      if(f.t < 0.75) spawnAfterImage(f, 0.85);

      if(!f.ult.tele && f.t>=0.10){
        const d=sign(def.x-f.x)||f.face; f.face=d;
        spawnSmoke(def.x - d*220, def.y-40, "big");
        startFlash(0.55,0.08);
        startShake(0.08,22);
        f.x = def.x - d*210;
        f.invul=Math.max(f.invul,0.22);
        f.ult.tele=true;
        spawnSlash(def.x, def.y-110, d, "ult");
        spawnSparks(def.x, def.y-110, d, "ult");
      }

      while(f.ult.idx < f.ult.hits.length && f.t >= f.ult.hits[f.ult.idx]){
        const d=sign(def.x-f.x)||f.face; f.face=d;
        const jitter=(f.ult.idx%2===0)?36:-36;
        f.x = def.x - d*200 + jitter;

        spawnSlash(def.x, def.y-112, d, "ult");
        spawnSlash(def.x, def.y-96, d, "ult");
        spawnSparks(def.x, def.y-110, d, "ult");
        spawnSmoke(def.x, def.y-40, "small");

        applyHit(f,def,1.45,"ult");

        startFlash(0.38,0.05);
        startShake(0.06,20);

        f.ult.idx++;
      }
      if(f.t>=0.90 && f.lock<=0) f.ult=null;
    }

    // animation
    const clip = f.char.stateToAnim(f.state, f.combo);
    f.animator.set(clip);
    f.animator.update(dt);

    f.t += dt;
  }

  function separate(a,b,dt){
    const minDist=180;
    const dx=b.x-a.x;
    const d=Math.abs(dx);
    if(d < minDist){
      const push=(minDist-d)*4.0;
      const dir=dx>=0?1:-1;
      a.x -= dir*push*0.5*dt;
      b.x += dir*push*0.5*dt;
      a.vx*=0.93; b.vx*=0.93;
    }
  }

  // per-fighter edge tracker
  function makeEdgeTracker(prefix){
    const s=new Map();
    return (k,down)=>{
      const key=prefix+"_"+k;
      const prev=s.get(key)||false;
      if(down && !prev){ s.set(key,true); return true; }
      if(!down) s.set(key,false);
      return false;
    };
  }

  function startMatch(seed){
    G.seed = seed>>>0;
    G.rng = makeRng(G.seed);

    // chọn char cố định (sau này bạn cho chọn ở sảnh)
    G.Left = Fighter(-1, "assassin");
    G.Right= Fighter(+1, "assassin");

    G.edgeL = makeEdgeTracker("L");
    G.edgeR = makeEdgeTracker("R");

    G.camX=0;
    G.zoom=1; G.zoomTarget=1;
    G.vignette=0; G.vignetteTarget=0;
    G.timeScale=1;

    // clear FX
    for(const k of Object.keys(G.fx)) G.fx[k].length=0;
  }

  function step(dt, inLeft, inRight){
    if(!G.Left || !G.Right) return;

    // regen energy
    G.Left.en = clamp(G.Left.en + dt*10, 0, 100);
    G.Right.en= clamp(G.Right.en+ dt*10, 0, 100);

    G.camX = lerp(G.camX, (G.Left.x+G.Right.x)/2, 0.08);

    if(G.shakeT>0){ G.shakeT=Math.max(0,G.shakeT-dt); G.shake=lerp(G.shake,0,0.18); }
    else G.shake=lerp(G.shake,0,0.10);

    if(G.flashT>0){ G.flashT=Math.max(0,G.flashT-dt); G.flash=lerp(G.flash,0,0.22); }
    else G.flash=lerp(G.flash,0,0.18);

    updateFighter(G.Left, G.Right, dt, inLeft, G.edgeL);
    updateFighter(G.Right,G.Left, dt, inRight,G.edgeR);
    separate(G.Left,G.Right,dt);

    const anyUlt =
      (G.Left.state==="ult" && G.Left.t < 0.95) ||
      (G.Right.state==="ult" && G.Right.t < 0.95);

    G.zoomTarget = anyUlt ? 1.10 : 1.00;
    G.vignetteTarget = anyUlt ? 1.00 : 0.00;
    G.timeScale = anyUlt ? 0.82 : 1.00;

    G.zoom = lerp(G.zoom, G.zoomTarget, 0.12);
    G.vignette = lerp(G.vignette, G.vignetteTarget, 0.10);
  }

  return { G, startMatch, step, startShake, startFlash };
}
