// src/net.js
export function createNetClient(){
  let ws=null;
  let onState=()=>{};
  let onInfo=()=>{};
  let slot=-1;
  let room="";

  function connect(roomCode){
    room = roomCode;
    const proto = (location.protocol==="https:") ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${location.host}/ws`);

    ws.onopen=()=>{
      ws.send(JSON.stringify({t:"join", room}));
      onInfo({type:"status", text:"Connecting…"});
    };

    ws.onmessage=(ev)=>{
      const msg = JSON.parse(ev.data);
      if(msg.t==="welcome"){
        slot = msg.slot;
        onInfo({type:"welcome", slot, room:msg.room});
      }
      if(msg.t==="state"){
        onState(msg.state);
      }
      if(msg.t==="ping"){
        // ignore
      }
      if(msg.t==="status"){
        onInfo({type:"status", text:msg.text});
      }
    };

    ws.onclose=()=>{
      onInfo({type:"status", text:"Disconnected"});
    };
  }

  function sendInput(inp){
    if(!ws || ws.readyState!==1) return;
    ws.send(JSON.stringify({t:"inp", inp}));
  }

  return {
    connect,
    sendInput,
    setHandlers: (h)=>{ onState=h.onState||onState; onInfo=h.onInfo||onInfo; },
    get slot(){ return slot; },
    get room(){ return room; }
  };
}
