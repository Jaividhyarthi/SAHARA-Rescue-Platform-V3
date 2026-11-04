import {useCallback,useEffect,useRef,useState} from 'react';

type Props={missionId:string;token:string;enabled:boolean};
type Signal={type:string;data?:unknown;sender?:string};
type Incoming={description:RTCSessionDescriptionInit;video:boolean};

export default function CallPanel({missionId,token,enabled}:Props){
 const [status,setStatus]=useState('Connecting to call service…');
 const [online,setOnline]=useState(false);
 const [peers,setPeers]=useState(0);
 const [incoming,setIncoming]=useState<Incoming|null>(null);
 const [inCall,setInCall]=useState(false);
 const [video,setVideo]=useState(false);
 const ws=useRef<WebSocket|null>(null);
 const pc=useRef<RTCPeerConnection|null>(null);
 const local=useRef<MediaStream|null>(null);
 const pendingIce=useRef<RTCIceCandidateInit[]>([]);
 const incomingRef=useRef<Incoming|null>(null);
 const selfVideo=useRef<HTMLVideoElement|null>(null);
 const remoteVideo=useRef<HTMLVideoElement|null>(null);
 const iceServers=useRef<RTCIceServer[]>([
  {urls:'stun:stun.l.google.com:19302'},
  ...(import.meta.env.VITE_TURN_URL?[{urls:import.meta.env.VITE_TURN_URL,username:import.meta.env.VITE_TURN_USERNAME||'',credential:import.meta.env.VITE_TURN_CREDENTIAL||''}]:[])
 ]);
 const send=useCallback((type:string,data?:unknown):boolean=>{
  if(ws.current?.readyState!==WebSocket.OPEN){setStatus('Signaling disconnected — refresh the mission');return false;}
  ws.current.send(JSON.stringify({type,data}));return true;
 },[]);
 const stop=useCallback((notify=true)=>{
  if(notify&&ws.current?.readyState===WebSocket.OPEN)ws.current.send(JSON.stringify({type:'hangup'}));
  pc.current?.close();pc.current=null;
  local.current?.getTracks().forEach(t=>t.stop());local.current=null;
  if(selfVideo.current)selfVideo.current.srcObject=null;
  if(remoteVideo.current)remoteVideo.current.srcObject=null;
  pendingIce.current=[];incomingRef.current=null;setIncoming(null);setInCall(false);setStatus('Ready');
 },[]);
 const prepare=useCallback(async(withVideo:boolean)=>{
  if(!navigator.mediaDevices?.getUserMedia)throw Error('Microphone access requires localhost or HTTPS');
  const media=await navigator.mediaDevices.getUserMedia({audio:true,video:withVideo});
  local.current=media;if(selfVideo.current)selfVideo.current.srcObject=media;
  const peer=new RTCPeerConnection({iceServers:iceServers.current});pc.current=peer;
  media.getTracks().forEach(track=>peer.addTrack(track,media));
  peer.ontrack=e=>{if(remoteVideo.current)remoteVideo.current.srcObject=e.streams[0]};
  peer.onicecandidate=e=>{if(e.candidate)send('ice',e.candidate.toJSON())};
  peer.onconnectionstatechange=()=>{
   if(peer.connectionState==='connected'){setStatus('Connected');setInCall(true)}
   else if(['failed','disconnected'].includes(peer.connectionState)){setStatus('Connection '+peer.connectionState+' — check TURN/network')}
  };
  return peer;
 },[send]);
 const flushIce=useCallback(async()=>{
  const peer=pc.current;if(!peer?.remoteDescription)return;
  const queued=pendingIce.current.splice(0);
  for(const candidate of queued){try{await peer.addIceCandidate(candidate)}catch(err){console.warn('ICE candidate rejected',err)}}
 },[]);
 useEffect(()=>{
  if(!enabled){setOnline(false);setPeers(0);setStatus('Calling available after volunteer assignment');return;}
  let disposed=false;
  const protocol=window.location.protocol==='https:'?'wss:':'ws:';
  const host=window.location.host;
  const socket=new WebSocket(`${protocol}//${host}/ws/missions/${missionId}?token=${encodeURIComponent(token)}`);
  ws.current=socket;
  setOnline(false);setPeers(0);setStatus('Connecting to call service…');
  socket.onopen=()=>{if(!disposed){setOnline(true);setStatus('Connected to signaling');socket.send(JSON.stringify({type:'ping'}))}};
  socket.onerror=()=>{if(!disposed)setStatus('Cannot reach call signaling server')};
  socket.onclose=e=>{if(!disposed){setOnline(false);setPeers(0);setStatus(`Call signaling closed (${e.code}). Check backend and permissions.`)}};
  socket.onmessage=async e=>{if(disposed)return;
   try{
    const msg:Signal=JSON.parse(e.data);
    if(msg.type==='presence'){const count=Number((msg.data as {peers?:number})?.peers||0);setPeers(count);return}
    if(msg.type==='offer'){
     const data=msg.data as {description:RTCSessionDescriptionInit;video:boolean}|RTCSessionDescriptionInit;
     const offer=(data&&'description'in data)?data.description:data as RTCSessionDescriptionInit;
     const withVideo=!!(data&&'description'in data&&data.video);
     if(!offer?.sdp)return;
     if(pc.current){send('busy');return}
     const value={description:offer,video:withVideo};incomingRef.current=value;setIncoming(value);setVideo(withVideo);setStatus(`Incoming ${withVideo?'video':'audio'} call`);
    }else if(msg.type==='answer'&&pc.current){
     await pc.current.setRemoteDescription(msg.data as RTCSessionDescriptionInit);
     await flushIce();setStatus('Connecting media…');
    }else if(msg.type==='ice'){
     const candidate=msg.data as RTCIceCandidateInit;
     if(pc.current?.remoteDescription){await pc.current.addIceCandidate(candidate)}
     else pendingIce.current.push(candidate);
    }else if(msg.type==='hangup'||msg.type==='decline'){stop(false);setStatus(msg.type==='decline'?'Call declined':'Other participant ended the call')}
    else if(msg.type==='busy')setStatus('Other participant is busy');
   }catch(err){console.error('Call signaling error',err);setStatus('Signaling error: '+(err as Error).message)}
  };
  return()=>{disposed=true;socket.close();if(ws.current===socket)ws.current=null;pc.current?.close();pc.current=null;local.current?.getTracks().forEach(t=>t.stop());local.current=null};
 },[missionId,token,enabled,flushIce,send,stop]);
 async function call(withVideo:boolean){
  if(!online||peers<1){setStatus('Other participant not online in this mission — ask them to open the mission');return}
  try{setVideo(withVideo);setStatus('Requesting microphone/camera…');const peer=await prepare(withVideo);
   const offer=await peer.createOffer();await peer.setLocalDescription(offer);
   if(!send('offer',{description:offer,video:withVideo})){stop(false);return}
   setStatus('Calling… waiting for volunteer to answer');
  }catch(e){stop(false);setStatus((e as Error).message)}
 }
 async function answer(){
  const offer=incomingRef.current;if(!offer)return;
  try{setStatus('Requesting microphone/camera…');let useVideo=offer.video;let peer:RTCPeerConnection;
   try{peer=await prepare(useVideo)}catch(e){if(!useVideo)throw e;useVideo=false;peer=await prepare(false)}
   setVideo(useVideo);await peer.setRemoteDescription(offer.description);await flushIce();
   const answer=await peer.createAnswer();await peer.setLocalDescription(answer);
   if(!send('answer',answer)){stop(false);return}
   incomingRef.current=null;setIncoming(null);setInCall(true);setStatus('Connecting media…');
  }catch(e){stop(false);setStatus((e as Error).message)}
 }
 function decline(){send('decline');setIncoming(null);incomingRef.current=null;setStatus('Call declined')}
 return <div className="section" style={{marginTop:18}}>
  <h2>Private mission call</h2>
  <p className="muted tiny">Browser WebRTC calls. Both participants must open the same mission; TURN may be needed across networks. For emergencies use official services.</p>
  <p role="status" aria-live="polite"><strong>{online?'● Signaling connected':'○ Signaling offline'}</strong> · {peers} other participant(s) online</p>
  {incoming&&<div role="alert" style={{padding:14,background:'#dff7eb',borderRadius:10,marginBottom:12,color:'#114e43'}}>
   <strong>Incoming {incoming.video?'video':'audio'} call</strong><div style={{display:'flex',gap:8,marginTop:8}}><button className="primary" onClick={()=>void answer()}>Answer call</button><button className="outline" onClick={decline}>Decline</button></div>
  </div>}
  <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
   <button className="primary" disabled={!enabled||!online||peers<1||inCall||!!incoming||!!pc.current} onClick={()=>void call(false)}>Audio call</button>
   <button className="outline" disabled={!enabled||!online||peers<1||inCall||!!incoming||!!pc.current} onClick={()=>void call(true)}>Video call</button>
   <button className="outline" onClick={()=>stop()}>Hang up</button>
  </div>
  <p aria-live="polite">{status}{video&&inCall?' · Video enabled':''}</p>
  <div style={{display:'flex',gap:10}}>
   <video ref={selfVideo} muted autoPlay playsInline style={{width:'46%',maxHeight:160,background:'#122235',borderRadius:10}}/>
   <video ref={remoteVideo} autoPlay playsInline style={{width:'46%',maxHeight:160,background:'#122235',borderRadius:10}}/>
  </div>
 </div>
}
