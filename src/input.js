export function setupInput(){
  const keys = new Set();
  addEventListener("keydown",(e)=>keys.add(e.key.toLowerCase()),{passive:true});
  addEventListener("keyup",(e)=>keys.delete(e.key.toLowerCase()),{passive:true});

  const touch={atk:false,dash:false,jump:false,s1:false,s2:false,ult:false,sub:false};

  const bindBtn=(id,name)=>{
    const el=document.getElementById(id);
    el.addEventListener("pointerdown",(e)=>{e.preventDefault(); touch[name]=true;},{passive:false});
    const up=(e)=>{e.preventDefault(); touch[name]=false;};
    el.addEventListener("pointerup",up,{passive:false});
    el.addEventListener("pointercancel",up,{passive:false});
    el.addEventListener("pointerleave",up,{passive:false});
  };
  bindBtn("bAtk","atk"); bindBtn("bDash","dash"); bindBtn("bJump","jump");
  bindBtn("bS1","s1"); bindBtn("bS2","s2"); bindBtn("bUlt","ult"); bindBtn("bSub","sub");

  const joyL=document.getElementById("joyL");
  const stickL=document.getElementById("stickL");
  const joyVec={x:0,y:0};

  (function setupJoy(){
    let active=false,pid=null,center={x:0,y:0};
    const radius=46;
    function setStick(x,y){ stickL.style.transform=`translate(${x}px,${y}px)`; }
    function start(e){
      active=true; pid=e.pointerId;
      const r=joyL.getBoundingClientRect();
      center.x=r.left+r.width/2; center.y=r.top+r.height/2;
      move(e);
    }
    function move(e){
      if(!active||e.pointerId!==pid) return;
      const dx=e.clientX-center.x, dy=e.clientY-center.y;
      const len=Math.hypot(dx,dy)||1;
      const k=Math.min(1,len/radius);
      joyVec.x=(dx/len)*k; joyVec.y=(dy/len)*k;
      setStick(joyVec.x*radius, joyVec.y*radius);
      e.preventDefault();
    }
    function end(e){
      if(!active||e.pointerId!==pid) return;
      active=false; pid=null;
      joyVec.x=0; joyVec.y=0;
      setStick(0,0);
    }
    joyL.addEventListener("pointerdown",(e)=>{joyL.setPointerCapture(e.pointerId); start(e); e.preventDefault();},{passive:false});
    joyL.addEventListener("pointermove",move,{passive:false});
    joyL.addEventListener("pointerup",end,{passive:true});
    joyL.addEventListener("pointercancel",end,{passive:true});
  })();

  const makeInput=()=>({mx:0, atk:false, jump:false, dash:false, s1:false, s2:false, ult:false, sub:false});
  const edgeState=new Map();
  const once=(k,down)=>{
    const prev=edgeState.get(k)||false;
    if(down && !prev){ edgeState.set(k,true); return true; }
    if(!down) edgeState.set(k,false);
    return false;
  };

  function readLocalInput(){
    const inp=makeInput();
    let x=0;
    if(keys.has("a")) x-=1;
    if(keys.has("d")) x+=1;
    x += joyVec.x*1.05;
    inp.mx = Math.max(-1, Math.min(1, x));

    inp.atk  = keys.has("j") || touch.atk;
    inp.jump = keys.has("k") || touch.jump;
    inp.dash = keys.has("l") || touch.dash;
    inp.s1   = keys.has("u") || touch.s1;
    inp.s2   = keys.has("i") || touch.s2;
    inp.ult  = keys.has("o") || touch.ult;
    inp.sub  = keys.has("p") || touch.sub;

    return inp;
  }

  return { readLocalInput, once, makeInput };
}
