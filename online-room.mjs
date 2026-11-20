const edgeKeys = ['basic','s1','s2','defend','ult'];
const idle = () => ({x:0,y:0,holdS1:false});
const lobbyPoll = 650;
const playPoll = 90;
export const roomCode = text => String(text || '').trim().toUpperCase();
export const validRoomCode = code => /^[A-Z0-9]{8}$/.test(code);

function delay(ms) { return new Promise(resolve => setTimeout(resolve,ms)); }
function validPeerInput(raw) {
  const axis = n => n === 1 || n === -1 ? n : 0;
  return {x:axis(raw?.x),y:axis(raw?.y),holdS1:raw?.holdS1 === true};
}
function castForWire(cast) {
  if (!cast) return null;
  const {skill,seen,...values} = cast;
  return {...values,skill:skill.id,seen:Array.from(seen || [])};
}
function actorForWire(actor) {
  return {...actor,cast:castForWire(actor.cast)};
}
function snapshotOf(b, trail, ack) {
  return {frame:b.frame,actors:b.actors.map(actorForWire),
    entities:b.entities.map(e=>({...e,cast:castForWire(e.cast)})),telegraphs:b.telegraphs,
    reaction:b.performance?.reaction ?? null,dialogue:b.performance?.dialogue ?? null,
    result:b.result,trail,ack};
}
function restoreCast(cast,config) {
  if (!cast) return null;
  const skill=config.skills[cast.skill];
  if (!skill || !Array.isArray(cast.seen)) throw Error('联机技能数据无效');
  return {...cast,skill,seen:new Set(cast.seen)};
}
export function applyRoomFrame(b,snap,feedback) {
  if(!Number.isInteger(snap?.frame) || snap.frame < b.frame || !Array.isArray(snap.actors) || snap.actors.length !== 2) return;
  const actors=snap.actors.map((wire,i)=>{
    if(wire.id!==b.actors[i].id || wire.characterId!==b.actors[i].characterId ||
      !Number.isFinite(wire.x) || !Number.isFinite(wire.y) || !Number.isFinite(wire.hp)) throw Error('联机角色状态无效');
    return {...wire,duration:wire.duration??Infinity,cast:restoreCast(wire.cast,b.config)};
  });
  b.actors=actors;
  b.entities=snap.entities.map(e=>({...e,cast:restoreCast(e.cast,b.config)}));
  b.telegraphs=snap.telegraphs;
  b.performance.reaction=snap.reaction;
  b.performance.dialogue=snap.dialogue;
  const previous=b.frame;
  for(const entry of (snap.trail ?? [])) {
    if(entry.frame>previous && entry.frame<=snap.frame) {
      b.frame=entry.frame; b.events=entry.events; feedback();
    }
  }
  b.frame=snap.frame; b.events=[]; b.result=snap.result;
}
export function createOnlineRoom({origin,config,view,begin,receive,end,connection=()=>{}}) {
  let session=null, generation=0, uiKey='', pending=false, message='';
  let selected=null, scene=null;
  const game=()=>config();
  function describe() {
    const s=session;
    const peer=s?.peer;
    const invite=new URL(location.href);
    invite.search=''; invite.hash='';
    if(s) invite.searchParams.set('room',s.code);
    const state={role:s?.role||null,code:s?.code||'',inviteUrl:s?invite.href:'',
      fighter:selected||game().roster[0],scene:(s?.role==='guest' && game().scenes[peer?.scene]?peer.scene:scene)||game().defaultScene,peerFighter:peer?.fighter||null,
      peerReady:!!peer?.ready,peerJoined:!!s?.joined,ready:!!s?.ready,busy:pending,message};
    const key=JSON.stringify(state);
    if(key!==uiKey) {uiKey=key;view(state);}
    return state;
  }
  async function request(path,body,token,timeout=6500) {
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
    try {
      const headers={'Content-Type':'application/json'};
      if(token) headers.Authorization='Bearer '+token;
      const response=await fetch(new URL('/api/rooms'+path,origin),{method:'POST',headers,
        body:JSON.stringify(body),signal:controller.signal,credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer'});
      let data; try {data=await response.json();} catch {throw Error('房间服务暂时无法连接');}
      if(!response.ok) throw Object.assign(Error(data.error || '房间请求未成功'),{status:response.status});
      return data;
    } finally {clearTimeout(timer);}
  }
  const leaveSeat=s=>request('/'+s.code+'/leave',{},s.token,2000).catch(()=>{});
  async function closeFinishedSeat(s) {
    // Give the other browser time to receive KO even if the host immediately
    // returns to the menu. Closing the relay deliberately clears its contents.
    const until=Date.now()+4000;
    do {
      try {
        const reply=await request('/'+s.code+'/sync',{seq:++s.seq,data:payload(s)},s.token,1600);
        if(reply.closed || reply.peerData?.finished===s.match.id)break;
      } catch { return; }
      await delay(180);
    } while(Date.now()<until);
    void leaveSeat(s);
  }
  function discard() {
    generation++;
    const old=session; session=null;pending=false;message='';uiKey='';
    if(old?.role==='host' && old.track?.result && !old.finalAck)void closeFinishedSeat(old);
    else if(old)void leaveSeat(old);
  }
  function stop(s,reason) {
    if(s!==session) return;
    discard();end(reason);
  }
  function select(id) {
    if(!game().roster.includes(id)||session?.match) return;
    selected=id;if(session)session.ready=false;
    describe();
  }
  function selectScene(id) {
    if(!game().scenes[id]||session?.role!=='host'||session.match)return;
    scene=id;describe();
  }
  function ready() {
    if(session?.role!=='guest'||session.match)return;
    session.ready=!session.ready;describe();
  }
  async function connect(code) {
    if(pending||session)return;
    code=roomCode(code);
    if(code && !validRoomCode(code)){message='请输入 8 位房间码';describe();return;}
    const serial=++generation, id=crypto.randomUUID();
    pending=true; message=code?'正在加入房间…':'正在创建房间…';describe();
    try {
      let data;
      for(let attempt=0;attempt<2;attempt++) {
        try {data=await request(code?'/'+code+'/join':'',{session:id});break;}
        catch(e) {if(attempt||e.status||serial!==generation)throw e;}
      }
      if(!validRoomCode(data.room)||!['guest','host'].includes(data.role)||!data.token)throw Error('房间服务响应无效');
      const s={code:data.room,role:data.role,token:data.token,seq:0,peerSeq:0,lastGood:Date.now(),peer:null,joined:false,
        ready:false,match:null,loaded:false,finished:'',finalAck:false,guestInput:idle(),remoteInput:idle(),edges:[],remoteEdges:[],
        edgeSeq:0,receivedEdge:0,ack:0,trail:[],track:null};
      if(serial!==generation){void leaveSeat(s);return;}
      if(!selected)selected=game().roster[0]; if(!scene)scene=game().defaultScene;
      session=s;pending=false;message='';describe();void poll(s);
    } catch(err) {
      if(serial===generation){pending=false;message=err.status?err.message:'连接房间服务失败，请重试';describe();}
    }
  }
  function validMatch(match) {
    const cfg=game();
    return match && typeof match.id==='string' && match.id.length<=64 &&
      cfg.roster.includes(match.p1) && cfg.roster.includes(match.p2) && Object.hasOwn(cfg.scenes,match.scene);
  }
  async function launch(s,m) {
    if(!validMatch(m)||s.match) return;
    s.match={id:m.id,p1:m.p1,p2:m.p2,scene:m.scene};
    try {
      const ok=await begin({mode:'pvp',characterId:m.p1,opponentId:m.p2,sceneId:m.scene,onlineRole:s.role,networkMatch:m.id});
      if(s!==session)return;
      if(!ok) {stop(s,'载入联机战斗失败');return;}
      s.loaded=true;
      if(s.role==='guest' && s.peer?.snapshot)receive(s.peer.snapshot);
    } catch {stop(s,'载入联机战斗失败');}
  }
  function start() {
    const s=session; if(!s||s.role!=='host'||s.match||!s.peer?.ready||!s.joined)return;
    void launch(s,{id:crypto.randomUUID(),p1:selected,p2:s.peer.fighter,scene});
  }
  function payload(s) {
    const data={v:1,fighter:s.match?(s.role==='guest'?s.match.p2:s.match.p1):selected,scene:s.match?.scene||scene,ready:s.ready,match:s.match,loaded:s.loaded,finished:s.finished};
    if(!s.match)return data;
    if(s.role==='host' && s.track) data.snapshot=snapshotOf(s.track,s.trail,s.ack);
    if(s.role==='guest')Object.assign(data,{input:s.guestInput,edges:s.edges});
    return data;
  }
  function consume(s,peer) {
    if(!peer || peer.v!==1 || !game().roster.includes(peer.fighter)) return;
    s.peer=peer;
    if(s.role==='guest' && peer.match && !s.match)void launch(s,peer.match);
    if(!s.match||s.match.id!==peer.match?.id)return;
    if(s.role==='host') {
      if(peer.finished===s.match.id)s.finalAck=true;
      s.remoteInput=validPeerInput(peer.input);
      for(const edge of (Array.isArray(peer.edges)?peer.edges:[]).slice(-48)) {
        if(!Number.isSafeInteger(edge.id)||edge.id<=s.receivedEdge) continue;
        s.receivedEdge=edge.id;
        s.remoteEdges.push({id:edge.id,...Object.fromEntries(edgeKeys.map(k=>[k,edge[k]===true]))});
      }
    } else if(peer.snapshot) {
      const ack=peer.snapshot.ack??0; s.edges=s.edges.filter(e=>e.id>ack);
      if(s.loaded){receive(peer.snapshot);if(peer.snapshot.result)s.finished=s.match.id;}
    }
  }
  async function poll(s) {
    while(s===session) {
      const began=Date.now();
      try {
        const r=await request('/'+s.code+'/sync',{seq:++s.seq,data:payload(s)},s.token);
        if(s!==session) return;
        s.lastGood=Date.now();s.joined=!!r.peerJoined;s.peerActivity=Date.now()-Math.max(0,r.serverTime-r.peerSeen);
        if(r.peerSeq>s.peerSeq){s.peerSeq=r.peerSeq;consume(s,r.peerData);}
        if(r.closed){stop(s,'对方已离开房间');return;}
        if(r.peerSeen>0 && r.serverTime-r.peerSeen>18000){stop(s,'对方连接已中断');return;}
        if(!s.joined && s.role==='host') message='等待另一位玩家加入';
        else message=s.match?'':s.role==='host'?(s.peer?.ready?'对方已准备，可以开战':'等待对方选角并准备'):'选好角色后点击准备';
        if(!s.match)describe();
        else connection(!s.loaded||!s.peer?.loaded?'正在等待双方进入擂台…':r.peerSeen>0 && r.serverTime-r.peerSeen>2000?'对方连接不稳定，等待同步…':'');
      } catch(e) {
        if(s!==session)return;
        if(e.status===401||e.status===404||e.status===410||Date.now()-s.lastGood>18000) {stop(s,'房间已断开，请重新加入');return;}
        message='连接不稳定，正在重连…'; if(!s.match)describe();else connection(message);
      }
      await delay(Math.max(12,(s.match?playPoll:lobbyPoll)-(Date.now()-began)));
    }
  }
  function localIntent(input) {
    const s=session;if(!s)return;
    s.guestInput=validPeerInput(input);
    if(edgeKeys.some(k=>input[k]===true)) {
      s.edges.push({id:++s.edgeSeq,...Object.fromEntries(edgeKeys.map(k=>[k,input[k]===true]))});
      if(s.edges.length>48)s.edges.shift();
    }
  }
  function peerIntent() {
    const s=session;if(!s||Date.now()-s.lastGood>1400||Date.now()-(s.peerActivity||0)>1400) return idle();
    const edge=s.remoteEdges.shift();
    if(edge)s.ack=edge.id;
    return {...s.remoteInput,...edge};
  }
  function track(battle) {
    const s=session;if(s?.role!=='host')return;
    s.track=battle;
    if(battle.events.length)s.trail.push({frame:battle.frame,events:battle.events.slice()});
    while(s.trail.length>40 || s.trail[0]?.frame<battle.frame-120)s.trail.shift();
  }
  function beforeUnload() {
    const s=session;if(!s)return;
    const final=s.role==='host' && s.track?.result && !s.finalAck;
    const path='/api/rooms/'+s.code+(final?'/sync':'/leave');
    const body=final?JSON.stringify({seq:++s.seq,data:payload(s)}):'{}';
    void fetch(new URL(path,origin),{method:'POST',headers:{Authorization:'Bearer '+s.token,'Content-Type':'application/json'},body,keepalive:true,credentials:'omit'}).catch(()=>{});
  }
  return {connect,discard,select,selectScene,ready,start,localIntent,peerIntent,track,beforeUnload,
    get role(){return session?.role;},get loaded(){return !!session?.loaded && !!session?.peer?.loaded && session.match?.id===session.peer?.match?.id;},
    get state(){return describe();},resetView(){uiKey='';message='';return describe();}};
}
