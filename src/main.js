import { setupInput } from "./input.js";
import { setupNet } from "./net.js";
import { createGame } from "./game.js";
import { setupRender } from "./render.js";

const hud = document.getElementById("hud");
const info= document.getElementById("info");

const Lhp=document.getElementById("Lhp");
const Rhp=document.getElementById("Rhp");
const Len=document.getElementById("Len");
const Ren=document.getElementById("Ren");

function updateHUD(G, ping){
  if(!G.Left || !G.Right) return;
  Lhp.style.transform=`scaleX(${G.Left.hp/G.Left.hpMax})`;
  Rhp.style.transform=`scaleX(${G.Right.hp/G.Right.hpMax})`;
  Len.style.transform=`scaleX(${G.Left.en/G.Left.enMax})`;
  Ren.style.transform=`scaleX(${G.Right.en/G.Right.enMax})`;
  info.textContent = `FIGHT • ping: ${Math.round(ping)}ms • HP: ${G.Left.hp}/${G.Left.hpMax} vs ${G.Right.hp}/${G.Right.hpMax}`;
}

(function boot(){
  const input = setupInput();
  const net = setupNet();
  const { G, startMatch, step } = createGame();
  const render = setupRender();

  // hooks for net
  const hooks={
    maybeStart(){
      if(!net.NET.readyMe || !net.NET.readyPeer) return;
      if(net.NET.started) return;

      net.showGameUI();
      net.NET.started = true;

      if(net.role === "host"){
        const seed = (Math.random()*0xFFFFFFFF)>>>0;
        net.send({t:"start", seed});
        startMatch(seed);
      }
    },
    startMatch(seed){
      net.NET.started = true;
      net.NET.frame = 0;
      net.NET.myQ.clear();
      net.NET.peerQ.clear();
      startMatch(seed);
    }
  };
  net.setHooks(hooks);

  // IMPORTANT: host created DC is returned via button click; we need to wire it.
  document.getElementById("btnHost").addEventListener("click", async ()=>{
    const res = await (async()=>{ /* already handled in net.js onclick */ return null; })();
  });

  // intercept: net.js already sets onclick; but we still need to wire host dc
  // easiest: poll until dc exists after host click
  const hostBtn = document.getElementById("btnHost");
  const oldHost = hostBtn.onclick;
  hostBtn.onclick = async ()=>{
    const created = await oldHost();
    if(created?.dc) net.hostWire(created.dc);
    return created;
  };

  // join wiring: net.js uses _onDataChannel internally, already wired by setHooks.

  let last = performance.now();
  function loop(t){
    requestAnimationFrame(loop);
    const dtRaw = Math.min(0.033, Math.max(0.001, (t-last)/1000));
    last=t;

    // run sim if started + connected
    if(net.NET.started && net.NET.connected && net.dc && net.dc.readyState==="open" && G.Left && G.Right){
      const myIn = input.readLocalInput();
      const sendF = net.NET.frame + net.NET.inputDelay;
      net.NET.myQ.set(sendF, myIn);
      net.send({t:"in", f:sendF, i:myIn});

      if(t - net.NET._lastPing > 1000){
        net.NET._lastPing = t;
        net.send({t:"ping", ts:performance.now()});
      }

      const my = net.NET.myQ.get(net.NET.frame) || input.makeInput();
      const peer = net.NET.peerQ.get(net.NET.frame) || input.makeInput();

      const inLeft  = (net.role==="host") ? my   : peer;
      const inRight = (net.role==="host") ? peer : my;

      step(dtRaw * (G.timeScale||1), inLeft, inRight);

      if(net.NET.frame>80){
        net.NET.myQ.delete(net.NET.frame-80);
        net.NET.peerQ.delete(net.NET.frame-80);
      }
      net.NET.frame++;

      updateHUD(G, net.NET.ping);
      hud.style.display="flex";
      info.style.display="block";

      // auto rematch when someone dies (host triggers)
      if(G.Left.hp<=0 || G.Right.hp<=0){
        net.NET.started=false;
        setTimeout(()=>{
          if(net.NET.connected && net.dc && net.dc.readyState==="open" && net.role==="host"){
            const seed=(Math.random()*0xFFFFFFFF)>>>0;
            net.send({t:"start", seed});
            startMatch(seed);
            net.NET.started=true;
          }
        }, 1000);
      }
    }

    render.drawFrame(G, dtRaw);
  }
  requestAnimationFrame(loop);
})();
