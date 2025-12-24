export function setupNet(){
  const status=document.getElementById("status");
  const menu=document.getElementById("menu");
  const hud=document.getElementById("hud");
  const info=document.getElementById("info");
  const controls=document.getElementById("controls");
  const hint=document.getElementById("hint");

  const roomOut=document.getElementById("roomOut");
  const roomIn=document.getElementById("roomIn");
  const hostNote=document.getElementById("hostNote");

  const setStatus=(text,ok=true)=>{
    status.textContent=text;
    status.className="pill "+(ok?"ok":"bad");
  };

  const WS_URL=(location.protocol==="https:"?"wss://":"ws://")+location.host;

  let ws=null, pc=null, dc=null;
  let roomCode="", myRole="none";

  const NET={
    connected:false,
    readyMe:false,
    readyPeer:false,
    started:false,
    frame:0,
    inputDelay:3,
    myQ:new Map(),
    peerQ:new Map(),
    ping:0,
    _lastPing:0
  };

  const now=()=>performance.now();

  const wsSend=(obj)=>{ if(ws && ws.readyState===1) ws.send(JSON.stringify(obj)); };
  const dcSend=(obj)=>{ if(dc && dc.readyState==="open") dc.send(JSON.stringify(obj)); };

  async function copyText(text){
    try{ await navigator.clipboard.writeText(text); }
    catch{
      const t=document.createElement("textarea");
      t.value=text; document.body.appendChild(t);
      t.select(); document.execCommand("copy"); t.remove();
    }
  }

  function closeAll(){
    try{ dc && dc.close(); }catch{}
    try{ pc && pc.close(); }catch{}
    try{ ws && ws.close(); }catch{}
    ws=null; pc=null; dc=null;

    NET.connected=false; NET.readyMe=false; NET.readyPeer=false; NET.started=false;
    NET.frame=0; NET.myQ.clear(); NET.peerQ.clear();

    roomCode=""; myRole="none";
    menu.style.display="flex";
    hud.style.display="none";
    info.style.display="none";
    controls.style.display="none";
    hint.style.display="none";

    setStatus("Offline", true);
  }

  async function connectWS(){
    return new Promise((resolve,reject)=>{
      ws=new WebSocket(WS_URL);
      ws.onopen=()=>resolve();
      ws.onerror=(e)=>reject(e);
      ws.onmessage=async (ev)=>{
        let msg=null; try{ msg=JSON.parse(ev.data);}catch{return;}

        if(msg.t==="room"){
          roomCode=msg.code;
          roomOut.value=roomCode;
          hostNote.innerHTML=`Gửi code <b>${roomCode}</b> cho bạn bè.`;
          setStatus("Room: "+roomCode,true);
          return;
        }
        if(msg.t==="joined"){ roomCode=msg.code; setStatus("Joined: "+roomCode,true); return; }
        if(msg.t==="peer-joined" && myRole==="host"){
          setStatus("Peer joined… creating offer",true);
          const offer=await pc.createOffer({offerToReceiveAudio:false,offerToReceiveVideo:false});
          await pc.setLocalDescription(offer);
          wsSend({t:"offer", code:roomCode, sdp:pc.localDescription});
          return;
        }
        if(msg.t==="offer" && myRole==="guest"){
          await pc.setRemoteDescription(msg.sdp);
          const ans=await pc.createAnswer();
          await pc.setLocalDescription(ans);
          wsSend({t:"answer", code:roomCode, sdp:pc.localDescription});
          setStatus("Answer sent…",true);
          return;
        }
        if(msg.t==="answer" && myRole==="host"){
          await pc.setRemoteDescription(msg.sdp);
          setStatus("Answer received…",true);
          return;
        }
        if(msg.t==="ice"){ try{ await pc.addIceCandidate(msg.candidate);}catch{} return; }
        if(msg.t==="peer-left"){ setStatus("Peer left",false); closeAll(); return; }
        if(msg.t==="err"){ setStatus("Error: "+msg.err,false); alert("Lỗi: "+msg.err); }
      };
    });
  }

  async function createPC(){
    const _pc=new RTCPeerConnection({
      iceServers:[{urls:"stun:stun.l.google.com:19302"},{urls:"stun:stun1.l.google.com:19302"}]
    });
    _pc.onicecandidate=(ev)=>{
      if(ev.candidate && roomCode) wsSend({t:"ice", code:roomCode, candidate:ev.candidate});
    };
    _pc.oniceconnectionstatechange=()=>{
      const s=_pc.iceConnectionState;
      if(s==="connected"||s==="completed") setStatus("Connected",true);
      else if(s==="failed"||s==="disconnected") setStatus("Disconnected",false);
      else setStatus("ICE: "+s,true);
    };
    return _pc;
  }

  function wireDC(_dc, hooks){
    dc=_dc;
    dc.onopen=()=>{
      NET.connected=true;
      setStatus("Connected (DC open)",true);

      NET.readyMe=true;
      dcSend({t:"ready"});
      hooks.maybeStart();
    };
    dc.onmessage=(ev)=>{
      let msg=null; try{ msg=JSON.parse(ev.data);}catch{return;}
      if(msg.t==="ready"){ NET.readyPeer=true; hooks.maybeStart(); return; }
      if(msg.t==="start"){ hooks.startMatch(msg.seed>>>0); return; }
      if(msg.t==="in"){ NET.peerQ.set(msg.f, msg.i); return; }
      if(msg.t==="ping"){ dcSend({t:"pong", ts:msg.ts}); return; }
      if(msg.t==="pong"){ NET.ping = now()-msg.ts; return; }
    };
    dc.onclose=()=>{ setStatus("Channel closed",false); closeAll(); };
  }

  function tryLockLandscape(){
    try{ screen.orientation?.lock?.("landscape").catch(()=>{}); }catch{}
  }

  // buttons
  document.getElementById("btnHost").onclick=async ()=>{
    tryLockLandscape();
    closeAll();
    setStatus("Connecting server…",true);
    await connectWS();
    myRole="host";
    pc=await createPC();
    const _dc=pc.createDataChannel("game",{ordered:true});
    // hooks will be set later in main.js
    setStatus("Creating room…",true);
    wsSend({t:"host"});
    return { role:"host", dc:_dc };
  };

  document.getElementById("btnJoin").onclick=async ()=>{
    tryLockLandscape();
    const code=roomIn.value.trim().toUpperCase();
    if(code.length!==6){ alert("Room code phải đủ 6 ký tự."); return null; }
    closeAll();
    setStatus("Connecting server…",true);
    await connectWS();
    myRole="guest";
    pc=await createPC();
    pc.ondatachannel=(ev)=>{
      // will be wired in main.js by exposing onDataChannel callback
      netApi._onDataChannel?.(ev.channel);
    };
    wsSend({t:"join", code});
    setStatus("Joining…",true);
    return { role:"guest" };
  };

  document.getElementById("btnCopy").onclick=()=>copyText(roomOut.value||"");
  document.getElementById("btnLeaveH").onclick=()=>{ if(ws && roomCode) wsSend({t:"leave", code:roomCode}); closeAll(); };
  document.getElementById("btnLeaveJ").onclick=()=>{ if(ws && roomCode) wsSend({t:"leave", code:roomCode}); closeAll(); };

  // API exposed to main.js
  const netApi={
    NET,
    get role(){ return myRole; },
    get dc(){ return dc; },
    send: dcSend,
    closeAll,
    showGameUI(){
      menu.style.display="none";
      hud.style.display="flex";
      info.style.display="block";
      hint.style.display=("ontouchstart" in window)?"block":"none";
      controls.style.display=("ontouchstart" in window)?"block":"none";
    },
    setHooks(hooks){
      // host button creates dc but wire later
      netApi._wire = (createdDc)=>wireDC(createdDc, hooks);
      netApi._onDataChannel = (channel)=>wireDC(channel, hooks);
    },
    hostWire(createdDc){ netApi._wire?.(createdDc); },
    joinWire(channel){ netApi._onDataChannel?.(channel); }
  };

  return netApi;
}
