// server.js
import http from "http";
import fs from "fs";
import path from "path";
import { WebSocketServer } from "ws";
import { fileURLToPath } from "url";

import { createGameState, stepGame } from "./src/game_server.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 10000;

const server = http.createServer((req,res)=>{
  // static serve /public
  let url = req.url.split("?")[0];
  if(url==="/") url="/index.html";
  const filePath = path.join(__dirname, "public", url);

  if(!filePath.startsWith(path.join(__dirname,"public"))){
    res.writeHead(403); res.end("Forbidden"); return;
  }
  fs.readFile(filePath,(err,data)=>{
    if(err){ res.writeHead(404); res.end("Not found"); return; }
    const ext = path.extname(filePath).toLowerCase();
    const map = {
      ".html":"text/html",
      ".js":"text/javascript",
      ".css":"text/css",
      ".png":"image/png",
      ".jpg":"image/jpeg",
      ".jpeg":"image/jpeg",
      ".webp":"image/webp"
    };
    res.writeHead(200, {"Content-Type": map[ext]||"application/octet-stream"});
    res.end(data);
  });
});

const wss = new WebSocketServer({ noServer:true });

server.on("upgrade",(req,socket,head)=>{
  if(req.url.startsWith("/ws")){
    wss.handleUpgrade(req,socket,head,(ws)=>wss.emit("connection",ws,req));
  } else socket.destroy();
});

const rooms = new Map(); // room -> { clients:Set, slotMap:Map(ws,slot), inputs:[inp0,inp1], G, lastTick, ping }

function makeEmptyInput(){
  return {mx:0, atk:false,jump:false,dash:false,s1:false,s2:false,ult:false,sub:false};
}

function getRoom(code){
  if(!rooms.has(code)){
    const G = createGameState();
    rooms.set(code,{
      clients:new Set(),
      slotMap:new Map(),
      inputs:[makeEmptyInput(), makeEmptyInput()],
      G,
      lastTick:Date.now(),
      started:false,
      lastBroadcast:0
    });
  }
  return rooms.get(code);
}

function broadcast(room, obj){
  const msg = JSON.stringify(obj);
  for(const c of room.clients){
    if(c.readyState===1) c.send(msg);
  }
}

wss.on("connection",(ws)=>{
  let room=null;
  let slot=-1;

  ws.on("message",(buf)=>{
    let msg;
    try{ msg = JSON.parse(buf.toString()); }catch{ return; }

    if(msg.t==="join"){
      const code = String(msg.room||"").toUpperCase().slice(0,10);
      room = getRoom(code);
      room.clients.add(ws);

      // assign slot 0 then 1
      const used = new Set(room.slotMap.values());
      slot = used.has(0) ? (used.has(1)? -1 : 1) : 0;
      if(slot===-1){
        ws.send(JSON.stringify({t:"status", text:"Room full"}));
        ws.close();
        return;
      }
      room.slotMap.set(ws,slot);

      ws.send(JSON.stringify({t:"welcome", room:code, slot}));
      broadcast(room, {t:"status", text:`Player ${slot+1} joined (${room.clients.size}/2)`});

      // when 2 players -> start countdown
      if(room.clients.size===2 && room.G.phase==="lobby"){
        room.G.phase="countdown";
        room.G.phaseT=0;
        room.G.midText="1";
      }
    }

    if(msg.t==="inp" && room && slot!==-1){
      room.inputs[slot] = msg.inp || makeEmptyInput();
    }
  });

  ws.on("close",()=>{
    if(!room) return;
    room.clients.delete(ws);
    room.slotMap.delete(ws);
    broadcast(room,{t:"status", text:"A player left"});
    // reset room to lobby
    room.G.phase="lobby";
    room.G.phaseT=0;
    room.G.midText="Waiting player…";
    room.inputs=[makeEmptyInput(),makeEmptyInput()];
  });
});

// tick loop 60fps server authoritative
setInterval(()=>{
  const now = Date.now();
  for(const [code, room] of rooms.entries()){
    const dt = Math.min(0.033, (now - room.lastTick)/1000);
    room.lastTick = now;

    // update ping approx (not strict)
    room.G.pingMs = room.G.pingMs || 0;

    stepGame(room.G, dt, room.inputs[0], room.inputs[1]);

    // broadcast 30fps to reduce lag
    room.lastBroadcast += dt;
    if(room.lastBroadcast >= (1/30)){
      room.lastBroadcast = 0;
      broadcast(room, {t:"state", state: room.G});
    }
  }
}, 1000/60);

server.listen(PORT, ()=>console.log("Server running on", PORT));
