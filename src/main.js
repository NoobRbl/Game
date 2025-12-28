// src/main.js
import { setupInput } from "./input.js";
import { setupRender } from "./render.js";
import { createNetClient } from "./net.js";
import { createGameState } from "./game.js";

const $ = (id)=>document.getElementById(id);

const lobby = $("lobby");
const roomInp = $("roomInp");
const btnHost = $("btnHost");
const btnJoin = $("btnJoin");
const lobStatus = $("lobStatus");

const p1Hp = $("p1Hp"), p2Hp = $("p2Hp");
const p1En = $("p1En"), p2En = $("p2En");
const p1HpTxt = $("p1HpTxt"), p2HpTxt = $("p2HpTxt");
const p1Name = $("p1Name"), p2Name = $("p2Name");
const midTxt = $("midTxt");

function genRoom(){
  const chars="ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s="";
  for(let i=0;i<6;i++) s += chars[(Math.random()*chars.length)|0];
  return s;
}

function parseHashRoom(){
  const m = (location.hash||"").match(/ROOM=([A-Z0-9]+)/i);
  return m ? m[1].toUpperCase() : "";
}

const net = createNetClient();
const input = setupInput();
const render = setupRender();

// local state mirrored from server
let G = createGameState();
let lastStateAt = performance.now();
let lastPing = 0;

net.setHandlers({
  onInfo:(info)=>{
    if(info.type==="status") lobStatus.textContent = info.text;
    if(info.type==="welcome"){
      lobStatus.textContent = `Joined room ${info.room} as slot ${info.slot===0?"P1":"P2"}`;
      // hide lobby when both ready will happen from server state
    }
  },
  onState:(state)=>{
    G = state;
    lastStateAt = performance.now();
    // lobby hide when phase != lobby
    if(G.phase!=="lobby") lobby.style.display="none";
  }
});

function startJoin(room){
  net.connect(room);
}

btnHost.onclick=()=>{
  const r = genRoom();
  location.hash = `#ROOM=${r}`;
  roomInp.value = r;
  startJoin(r);

  // show link to copy (simple)
  const link = location.href;
  lobStatus.textContent = `HOST OK • Link: ${link}`;
};

btnJoin.onclick=()=>{
  const r = (roomInp.value||parseHashRoom()||"").trim().toUpperCase();
  if(!r){ lobStatus.textContent="Nhập ROOM hoặc bấm Host."; return; }
  location.hash = `#ROOM=${r}`;
  startJoin(r);
};

(function autoJoinIfHash(){
  const r = parseHashRoom();
  if(r){
    roomInp.value=r;
    startJoin(r);
  }
})();

function hud(){
  if(!G || !G.Left || !G.Right) return;

  p1Name.textContent = G.Left.name || "YOU";
  p2Name.textContent = G.Right.name || "FOE";

  p1HpTxt.textContent = `HP: ${Math.round(G.Left.hp)}/${Math.round(G.Left.hpMax)}`;
  p2HpTxt.textContent = `HP: ${Math.round(G.Right.hp)}/${Math.round(G.Right.hpMax)}`;

  p1Hp.style.width = `${(G.Left.hp / G.Left.hpMax)*100}%`;
  p2Hp.style.width = `${(G.Right.hp / G.Right.hpMax)*100}%`;

  p1En.style.width = `${(G.Left.en / G.Left.enMax)*100}%`;
  p2En.style.width = `${(G.Right.en / G.Right.enMax)*100}%`;

  midTxt.textContent = G.midText || "—";
}

let last = performance.now();
function loop(now){
  const dt = Math.min(0.033, (now-last)/1000);
  last = now;

  // send local input to server (only your slot matters server-side)
  const inp = input.readLocalInput();
  net.sendInput(inp);

  render.drawFrame(G, dt);
  hud();

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
