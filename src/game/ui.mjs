const paths = {
  echo: 'M3 18V9l5-5h8l5 5v9M7 17v-6l3-3h4l3 3v6M10 17v-4l2-2 2 2v4M3 21h18',
  arrow: 'M4 12h15m-6-6 6 6-6 6', back: 'M20 12H5m6-6-6 6 6 6',
  settings: 'M4 6h16M4 12h16M4 18h16M8 3v6m8 0v6m-6 0v6',
  point: 'm12 2 8 5v10l-8 5-8-5V7zM8 12l4-3 4 3-4 3z',
  stages: 'M3 19h18M3 16l6-9 5 7 3-4 4 6M9 7V3h5l-2 2 2 2z',
  duo: 'M3 19v-3c0-3 3-4 5-4s5 1 5 4v3M5 7a3 3 0 1 0 6 0 3 3 0 1 0-6 0M15 4a3 3 0 1 1 0 6m0 3c3 0 6 1 6 4v2',
  target: 'M12 2v4m0 12v4M2 12h4m12 0h4M5 12a7 7 0 1 0 14 0 7 7 0 1 0-14 0M10 12a2 2 0 1 0 4 0 2 2 0 1 0-4 0',
  lock: 'M6 10h12v10H6zM8 10V7a4 4 0 0 1 8 0v3', pause: 'M8 4v16M16 4v16',
  tick: 'm4 12 5 5L20 6', close: 'm5 5 14 14m0-14L5 19',
};
const labels = {up:'上移',down:'下移',left:'左移',right:'右移',basic:'普攻',s1:'技能一',s2:'技能二',defend:'闪身 / 脱身',ult:'奥义'};
const keyNames = {ArrowUp:'↑',ArrowDown:'↓',ArrowLeft:'←',ArrowRight:'→',Space:'空格',Enter:'回车',Backspace:'退格',Escape:'Esc'};
function keyName(code) { return keyNames[code] || String(code || '—').replace(/^(Key|Digit)/,''); }
function node(tag, cls, ...content) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  for (const item of content.flat()) if (item !== null && item !== undefined) el.append(item);
  return el;
}
function icon(key) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns,'svg');
  for (const [k,v] of Object.entries({viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'1.65','stroke-linecap':'round','stroke-linejoin':'round',class:'i','aria-hidden':'true'})) svg.setAttribute(k,v);
  const path = document.createElementNS(ns,'path');
  path.setAttribute('d',paths[key]); svg.append(path);
  return svg;
}
function button(cls,label,action) {
  const btn = node('button',cls,...(Array.isArray(label) ? label : [label]));
  btn.type = 'button'; btn.addEventListener('click',action);
  return btn;
}
function lookupImage(character,config) {
  const asset = config.assets[character.asset];
  return asset?.portrait || asset?.path || './assets/' + encodeURIComponent(character.id) + '.svg';
}
function img(src,alt) {
  const picture = node('img'); picture.src = src; picture.alt = alt;
  picture.addEventListener('error',() => { picture.hidden = true; picture.parentElement?.append(node('span','muted','图像暂不可用')); }, {once:true});
  return picture;
}
function tag(text) { return node('span','tag',text); }
function muted(text) { return node('p','muted',text); }
function statLine(label,value) { return node('div',null,node('span','muted',label),node('strong',null,String(value))); }
function seconds(frames,hz) { return Math.ceil(Math.max(0,frames)/hz); }
function stamp(secs) { return Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2,'0'); }
function write(el, value) { const text=String(value); if (el.textContent!==text) el.textContent=text; }

/**
 * Builds the desktop arcade UI. Action callbacks implement simulation and persistence.
 * Battle HUD updates in place and the renderer owns all drawing on the exposed canvas.
 */
export function createUI(root, callbacks) {
  let config, profile, notice='', screen='home', overlay='', bindingsCapture=null, draft=null;
  let selected='shell', characterOrigin='home', stageId='stage_01', mode='vs_ai', picks=[], ready=[];
  let currentBattle=null, receipt=null, hud=null, busy=false, initialized=false, restoreFocus=null;
  const playable = () => Object.values(config.characters).filter(c=>c.playable);
  const defaultHero = () => profile.settings?.selectedCharacter || config.economy.initialCharacter;
  const settings = () => ({volume:.65, reduceEffects:false, bindings:config.input,...profile.settings});
  const call = (name,...args) => callbacks[name]?.(...args);
  const brandTitle=node('b');
  const brand = button('brand',[
    node('span','brand-mark',icon('echo')),node('span',null,brandTitle,node('small',null,'ECHO ARENA')),
  ],()=>go('home'));
  const nav = node('nav','nav'); nav.setAttribute('aria-label','主导航');
  const navItems={};
  for(const name of ['home','characters','stages']) {
    navItems[name]=button('nav-btn','',()=>name==='characters'?openCharacters('home'):go(name));
    nav.append(navItems[name]);
  }
  const pointValue=node('b',null,'0');
  const gear=button('tool',[icon('settings'),node('span',null,'设置')],()=>openSettings());
  gear.setAttribute('aria-label','设置');
  const tools=node('div','tools',node('span','points',icon('point'),pointValue,node('small',null,'练习点')),gear);
  const header=node('header','header',node('div','shell header-inner',brand,nav,tools));
  const note=node('div','notice');
  note.setAttribute('role','status'); note.hidden=true;
  const main=node('main'); main.tabIndex=-1;
  const footer=node('footer','footer',node('span',null,'本机存档 · 键盘操作'),node('span','version',''));
  const overlayHost=node('div','overlay-host');
  root.replaceChildren(header,node('div','shell',note,main,footer),overlayHost);
  function displayNotice(text) { notice=text || ''; note.textContent=notice; note.hidden=!notice; }
  function releaseOverlay() {
    overlayHost.replaceChildren(); overlay=''; bindingsCapture=null;
    header.inert=false; main.inert=false; footer.inert=false;
    if(restoreFocus?.isConnected) restoreFocus.focus({preventScroll:true});
    restoreFocus=null;
  }
  function modal(kind, title, ...items) {
    if(!overlay) restoreFocus=document.activeElement;
    overlay=kind; header.inert=true; main.inert=true; footer.inert=true;
    const panel=node('section','modal'+(kind==='settings'?' wide':''));
    panel.setAttribute('role','dialog'); panel.setAttribute('aria-modal','true');
    panel.setAttribute('aria-label',title); panel.tabIndex=-1;
    panel.append(node('h2',null,title),...items);
    overlayHost.replaceChildren(panel);
    panel.focus({preventScroll:true});
  }
  function reflect() {
    write(brandTitle,config.uiText.title);
    document.title=config.uiText.title;
    for(const [key,el] of Object.entries(navItems)) {
      write(el,config.uiText[key]);
      if(key===screen) el.setAttribute('aria-current','page'); else el.removeAttribute('aria-current');
    }
    const playing=screen==='battle';
    brand.disabled=playing; Object.values(navItems).forEach(btn=>{btn.disabled=playing;});
    main.className=playing?'arena-main':'';
    footer.hidden=playing;
    write(pointValue,profile.points);
    write(footer.lastElementChild,'BUILD / '+config.version);
    displayNotice(notice);
  }
  function go(page) {
    if(!initialized || (screen==='battle' && !currentBattle?.result && page!=='battle')) return;
    releaseOverlay(); screen=page; busy=false;
    if(page!=='battle') hud=null;
    paint();
    main.focus({preventScroll:true});
  }
  function home() { currentBattle=null; hud=null; screen='home'; busy=false; releaseOverlay(); if(initialized)paint(); }
  function title(eyebrow,heading,sub) {
    return node('div','titlebar',node('div',null,node('span','kicker',eyebrow),node('h1',null,heading),sub?node('p','page-sub',sub):null));
  }
  function back(action,to='返回大厅') { return button('return-btn',[icon('back'),to],action); }
  function modeCard(mark,name,description,action) {
    return button('mode-card',[node('span','mode-icon',icon(mark)),node('span','corner',icon('arrow')),node('b',null,name),node('small',null,description)],action);
  }
  function paintHome() {
    const copy=config.uiText;
    const hero=node('section','hero',
      Object.assign(img(config.assets.arena.path,'两名斗士在练习场对阵'),{className:'hero-img'}),
      node('div','hero-copy',node('span','kicker','SOLO ARENA'),node('h1',null,copy.vs_ai),
        node('p',null,copy.heroDescription),
        button('primary',[copy.heroAction,icon('arrow')],()=>openSelect('vs_ai'))));
    main.replaceChildren(hero,node('section','section',
      node('div','section-head',node('h2',null,copy.modeHeading),node('span',null,'TRAINING MODES')),
      node('div','modes',modeCard('stages',copy.pve,copy.pveDescription,()=>go('stages')),
        modeCard('duo',copy.pvp,copy.pvpDescription,()=>openSelect('pvp')),
        modeCard('target',copy.training,copy.trainingDescription,()=>openSelect('training')))));
  }
  function openCharacters(origin) {
    characterOrigin=origin; selected=defaultHero(); go('characters');
  }
  function fighterButton(character,active,action,sub) {
    const btn=button('fighter',[img(lookupImage(character,config),''),node('span',null,node('b',null,character.name),node('small',null,sub || character.role))],action);
    btn.setAttribute('aria-pressed',String(active));
    return btn;
  }
  function skillRow(type,skill) {
    return node('li',null,node('small',null,type),node('div',null,node('b',null,skill.name),node('br'),node('span',null,skill.description || '')));
  }
  function paintCharacters() {
    const c=config.characters[selected], level=profile.levels[c.id] || 0;
    const cost=config.economy.levelCosts[level-1], maximum=config.economy.levelCosts.length+1;
    const baseMult=level ? 1+(level-1)*config.economy.growthRate : 1;
    const list=node('ul','skill-list',
      node('li',null,node('small',null,'普攻'),node('b',null,c.basic.map(id=>config.skills[id].name).join(' → '))),
      skillRow('技能一',config.skills[c.s1]),skillRow('技能二',config.skills[c.s2]),skillRow('奥义',config.skills[c.ult]),skillRow('被动',config.passives[c.passive]));
    const upgrade=button('minor',level>=maximum?'已达等级上限':!level?'角色未解锁':(profile.points<cost?'练习点不足':'升级')+' · '+cost+' 点',async()=>{
      if(busy) return; busy=true; upgrade.disabled=true;
      try{await call('onUpgrade',c.id);}catch(e){displayNotice(e.message);}finally{busy=false;if(screen==='characters')paint();}
    });
    upgrade.disabled=!level || level>=maximum || profile.points<cost || busy;
    const pick=button('primary',['设为出战角色',icon('tick')],async()=>{
      if(busy)return; busy=true;pick.disabled=true;
      try{await call('onSelectCharacter',c.id); go(characterOrigin);}
      catch(e){displayNotice(e.message);busy=false;pick.disabled=false;}
    });
    pick.disabled=!level || busy;
    const sourceName=characterOrigin==='stages'?'返回关卡':characterOrigin==='result'?'返回结算':'返回大厅';
    main.replaceChildren(back(()=>go(characterOrigin),sourceName),title('FIGHTERS','角色档案'),
      node('div','roster',playable().map(ch=>fighterButton(ch,ch.id===c.id,()=>{selected=ch.id;paint();},profile.levels[ch.id]?'Lv. '+profile.levels[ch.id]+' · '+ch.role:'闯关未解锁'))),
      node('section','section split',node('div','portrait-area',Object.assign(img(lookupImage(c,config),c.name),{className:'portrait'})),
        node('article','panel',node('div','row-between',node('h2',null,c.name),tag(level?'Lv. '+level:'待解锁')),
          node('div','pills',tag(c.role),tag('生命 '+Math.round(c.hp*baseMult)),tag('攻击 '+Math.round(c.attack*baseMult))),
          muted(c.description),muted(c.playstyle),list,level?null:muted('首次通过「'+Object.values(config.stages).find(s=>s.unlockCharacter===c.id)?.name+'」解锁。'),
          node('div','actions',pick,upgrade))));
  }
  function paintStages() {
    const stages=Object.values(config.stages);
    if(!profile.unlockedStages.includes(stageId)) stageId=profile.unlockedStages[0];
    const s=config.stages[stageId], hero=config.characters[defaultHero()];
    const buttons=stages.map((stage,i)=>{
      const unlocked=profile.unlockedStages.includes(stage.id), cleared=profile.clearedStages.includes(stage.id);
      const card=button('stage-card',[node('span','stage-no','ST '+String(i+1).padStart(2,'0')),node('h2',null,stage.name),muted(stage.description),
        node('small',null,stage.waves.length+' 波 · '+(cleared?'已通关':unlocked?'可挑战':'通过上一关解锁')),
        node('span','reward',(cleared?'复刷 +'+stage.repeatReward:'首通 +'+stage.firstReward)+' 练习点'),
        !unlocked?icon('lock'):null],()=>{stageId=stage.id;paint();});
      card.setAttribute('aria-pressed',String(stage.id===s.id)); card.disabled=!unlocked;
      return card;
    });
    main.replaceChildren(back(()=>go('home')),title('STAGE SELECT',config.uiText.pve,'完成关卡获得练习点。首次突破可解锁后续训练。'),node('div','stage-grid',buttons),
      node('div','panel section',node('div','row-between',node('div',null,node('span','kicker','FIELD TEAM'),node('h2',null,s.name)),
        node('div','pills',tag(hero.name),tag('Lv. '+profile.levels[hero.id]))),
      node('div','actions',startButton('开始挑战',()=>({mode:'pve',characterId:hero.id,stageId:s.id})),button('minor','切换角色',()=>openCharacters('stages')))));
  }
  function openSelect(nextMode) {
    mode=nextMode; picks=[defaultHero(),nextMode==='pvp'?playable().at(-1).id:defaultHero()]; ready=[false,false]; go('select');
  }
  function keyHelp(slot) {
    const keys=settings().bindings[slot];
    return node('div','keyhelp',node('span',null,[keys.up,keys.left,keys.down,keys.right].map(k=>node('kbd',null,keyName(k))),'移动'),
      ...['basic','s1','s2','defend','ult'].map(k=>node('span',null,node('kbd',null,keyName(keys[k])),k==='defend'?'防御':labels[k])));
  }
  function startButton(label,options,disabled=false) {
    const btn=button('primary',[label,icon('arrow')],async ()=>{
      if(busy)return; busy=true; btn.disabled=true;
      try{await call('onStart',options());}catch(e){displayNotice(e.message);}finally{busy=false;if(btn.isConnected)btn.disabled=disabled;}
    });
    btn.disabled=disabled||busy;return btn;
  }
  function paintSelect() {
    const dual=mode==='pvp', count=dual?2:1;
    const panels=[];
    for(let i=0;i<count;i++) {
      const c=config.characters[picks[i]], slot=i?'p2':'p1';
      const choose=playable().map(ch=>fighterButton(ch,c.id===ch.id,()=>{picks[i]=ch.id;ready[i]=false;paint();}));
      const confirm=button(ready[i]?'quiet ready':'minor',ready[i]?[icon('tick'),'已就绪 · 取消']:'玩家 '+(i+1)+' 就绪',()=>{ready[i]=!ready[i];paint();});
      panels.push(node('section','panel',node('div','row-between',node('h2',null,dual?'玩家 '+(i+1):'选择斗士'),tag(dual?slot.toUpperCase():'玩家')),
        node('div','roster pick-grid',choose),node('div','pills',tag(c.role)),muted(c.playstyle),keyHelp(slot),dual?node('div','actions',confirm):null));
    }
    const info=dual?'双方各自选择斗士并就绪。竞技属性统一，支持镜像选角。':mode==='training'?'假人保持静止，可自由试招。':'电脑控制镜像斗士，双方使用相同的基础属性。';
    main.replaceChildren(back(()=>go('home')),title(dual?'LOCAL VERSUS':mode==='training'?'PRACTICE':'SOLO ARENA',config.uiText[mode],info),
      node('div',dual?'split':'',panels),node('div','actions',startButton(dual?'开始双人对战':mode==='training'?'进入训练':'开始人机对战',
        ()=>({mode,characterId:picks[0],opponentId:dual?picks[1]:picks[0]}),dual&&!ready.every(Boolean))));
  }
  function vital(right) {
    const name=node('b'),hp=node('small'),hpFill=node('i'),energyFill=node('i'),status=node('span'),energy=node('span');
    return {name,hp,hpFill,energyFill,status,energy,
      el:node('div','vitals'+(right?' right':''),node('div','hud-name',name,hp),node('div','track',hpFill),
        node('div','track energy',energyFill),node('div','hud-meta',status,energy))};
  }
  function actionStrip(actor,slot) {
    const data=Object.create(null),keys=settings().bindings[slot];
    const el=node('div','skill-strip',node('span','player-label',slot.toUpperCase()));
    for(const k of ['basic','s1','s2','defend','ult']) {
      const text=node('span'),hint=node('small'), key=node('kbd',null,keyName(keys[k]));
      const cell=node('span','hud-skill',key,text,hint);
      el.append(cell); data[k]={cell,text,hint,key};
    }
    return {slot,actorId:actor.id,el,data};
  }
  function createHud(battle) {
    screen='battle'; currentBattle=battle; releaseOverlay(); reflect();
    const left=vital(false),right=vital(true),clock=node('b'),clockLabel=node('small'),hint=node('div','battle-hint');
    const canvas=node('canvas'); canvas.width=1220; canvas.height=498;
    canvas.setAttribute('aria-label',config.uiText[battle.mode]+'战斗场地，使用键盘操作');
    const field=node('div','arena-wrap',canvas);
    const p1=battle.actors.find(a=>a.team===1),p2=battle.actors.find(a=>a.team===2);
    const strips=[actionStrip(p1,'p1')];
    if(battle.mode==='pvp'&&p2)strips.push(actionStrip(p2,'p2'));
    const stageName=battle.stage?config.stages[battle.stage.id].name:null;
    const bar=node('div','battle-bar',node('h1',null,stageName || config.uiText[battle.mode]),
      button('tool',[icon('pause'),'暂停'],()=>call('onPause')));
    main.replaceChildren(bar,node('section','battle-shell',node('div','hud-top',left.el,node('div','clock',clock,clockLabel),right.el),
      field,node('div','hud-bottom',strips.map(s=>s.el))),hint);
    hud={canvas,left,right,clock,clockLabel,hint,strips,battleId:battle.id,lastNotice:'',until:0};
  }
  function showVitals(v,a,role='') {
    if(!a) {write(v.name,'等待入场');write(v.hp,'');write(v.status,role);write(v.energy,'');v.hpFill.style.width=v.energyFill.style.width='0%';return;}
    const c=config.characters[a.characterId];
    write(v.name,c.name);write(v.hp,Math.ceil(a.hp)+' / '+a.maxHp);
    write(v.status,role);write(v.energy,'能量 '+Math.floor(a.energy));
    v.hpFill.style.width=Math.max(0,Math.min(100,100*a.hp/a.maxHp))+'%';
    v.energyFill.style.width=Math.max(0,Math.min(100,100*a.energy/config.rules.energyMax))+'%';
  }
  function updateStrip(strip,actor,b) {
    const c=config.characters[actor.characterId],keys=settings().bindings[strip.slot];
    for(const [k,item] of Object.entries(strip.data)) {
      const skill=config.skills[c[k]], cd=actor.cooldowns?.[k] || 0;
      let label=k==='basic'?'普攻':k==='defend'?(actor.state==='HIT'?'脱身':'闪身'):skill?.name || labels[k];
      const low=k==='ult'&&actor.energy<(skill?.cost ?? config.rules.energyMax);
      write(item.key,keyName(keys[k]));write(item.text,label);
      write(item.hint,cd>0?seconds(cd,b.config.rules.tickRate)+'s':low?'能量不足':'');
      item.cell.dataset.ready=String(!cd&&!low);
    }
  }
  function renderBattle(battle) {
    if(!initialized||!battle)return;
    if(screen!=='battle'||hud?.battleId!==battle.id)createHud(battle);
    currentBattle=battle;
    const left=battle.actors.find(a=>a.team===1);
    const enemies=battle.actors.filter(a=>a.team===2),right=enemies.find(a=>a.hp>0) || enemies.at(-1);
    const wave=battle.stage, hz=battle.config.rules.tickRate;
    showVitals(hud.left,left,'P1');
    showVitals(hud.right,right,battle.mode==='pvp'?'P2':battle.mode==='training'?'训练假人':wave?'本波 '+enemies.filter(a=>a.hp>0).length+' 名存活':'电脑');
    const timed=['pvp','vs_ai'].includes(battle.mode);
    write(hud.clock, timed ? stamp(seconds(battle.config.rules.duelLimit-battle.frame,hz)) : wave ? wave.wave+' / '+wave.total : '∞');
    write(hud.clockLabel,timed?'剩余时间':wave?'波次':'训练');
    for(const strip of hud.strips) {
      const actor=battle.actors.find(a=>a.id===strip.actorId);
      if(actor)updateStrip(strip,actor,battle);
    }
    let hint='';
    if(wave?.warnings?.length)hint='下一波即将入场，留意地面标记。';
    else if(wave?.remainingFrames>0)hint='下一波准备中';
    else if(wave?.id===config.economy.initialStage && wave.wave===1)hint='上下移动与对手对齐，面向对手后按普攻。';
    else if(battle.mode==='training')hint='训练假人保持静止。按 Esc 暂停并返回大厅。';
    if(left?.comboHits>=2)hint='受到 '+left.comboHits+' 连击';
    if(right?.comboHits>=2)hint='命中 '+right.comboHits+' 连击';
    write(hud.hint,hint);
  }
  function showPause() {
    if(screen!=='battle')return;
    modal('pause','对局已暂停',muted('继续后将倒计时，再恢复操作。'),
      node('div','actions',button('primary','继续对局',()=>call('onResume')),
        button('minor','操作设置',()=>openSettings()),button('quiet','退出到大厅',()=>call('onExit'))));
  }
  function showCountdown(n) {
    if(screen!=='battle')return;
    if(!(n>0)){releaseOverlay();return;}
    if(overlay==='countdown')write(overlayHost.querySelector('.count'),n);
    else modal('countdown','准备继续',node('div','count',String(n)));
  }
  function paintResult() {
    const b=currentBattle;
    if(!b){home();return;}
    const win=b.result.winner===1,tie=b.result.winner===null,stage=b.stage?config.stages[b.stage.id]:null;
    const titleText=tie?'平局':b.mode==='pvp'?'玩家 '+b.result.winner+' 获胜':win?(stage?'挑战完成':'对战胜利'):(stage?'挑战结束':'对战结束');
    const reason={timeout:'时间到',ko:'击倒',clear:'关卡完成',stage_clear:'关卡完成',defeat:'己方倒下',double_ko:'同时倒下'}[b.result.reason] || '';
    const lines=node('div','result-lines',statLine('模式',stage?stage.name:config.uiText[b.mode]),statLine('用时',stamp(Math.floor(b.frame/b.config.rules.tickRate))));
    if(reason)lines.append(statLine('结束条件',reason));
    if(b.mode!=='pvp' && !tie)lines.append(statLine('胜方',win?'玩家':b.mode==='vs_ai'?'电脑':'对手'));
    if(receipt?.notice) lines.append(node('p','notice',receipt.notice));
    else if(receipt){
      lines.append(statLine('练习点',(receipt.points>0?'+':'')+receipt.points));
      if(receipt.unlockedCharacter)lines.append(statLine('新伙伴',config.characters[receipt.unlockedCharacter].name));
      if(receipt.first && receipt.nextStage)lines.append(statLine('新关卡',config.stages[receipt.nextStage].name));
    }
    let next=null;
    if(stage && win && !receipt?.notice){
      const entries=Object.values(config.stages),index=entries.findIndex(x=>x.id===stage.id);
      if(entries[index+1]&&profile.unlockedStages.includes(entries[index+1].id))next=button('primary',['下一关',icon('arrow')],()=>call('onNext'));
    }
    const saveRetry=receipt?.notice?button('primary','重试保存',()=>call('onRetrySave')):null;
    main.replaceChildren(node('section','result-panel',node('span','kicker','MATCH RESULT'),node('h1',null,titleText),lines,
      node('div','actions',saveRetry,next,button(next||saveRetry?'minor':'primary','再来一局',()=>call('onRetry')),
        stage?button('minor','角色养成',()=>openCharacters('result')):null,
        stage?button('quiet','返回关卡',()=>go('stages')):null,button('quiet','返回大厅',()=>call('onExit')))));
  }
  function showResult(battle,newReceipt) {
    currentBattle=battle;receipt=newReceipt;screen='result';hud=null;busy=false;releaseOverlay();reflect();paintResult();
  }
  function closeSettings() { draft=null; bindingsCapture=null; if(screen==='battle')showPause();else releaseOverlay(); }
  const tabNames={p1:'玩家 1',p2:'玩家 2'};
  function openSettings() {
    if(!initialized || overlay==='countdown')return;
    if(screen==='battle' && overlay!=='pause' && overlay!=='settings')call('onPause');
    draft=structuredClone(settings());bindingsCapture=null;
    paintSettings('');
  }
  function paintSettings(error) {
    const volume=node('input'),effects=node('input');
    volume.type='range';volume.min='0';volume.max='100';volume.value=String(Math.round(draft.volume*100));
    const output=node('output',null,volume.value+'%');
    const volumeRow=node('label','setting-row','音量',volume,output);
    volume.addEventListener('input',()=>{draft.volume=Number(volume.value)/100;write(output,volume.value+'%');});
    effects.type='checkbox';effects.checked=!!draft.reduceEffects;
    effects.addEventListener('change',()=>{draft.reduceEffects=effects.checked;});
    const map=node('div','bindings',node('b',null,'动作'),node('b',null,tabNames.p1),node('b',null,tabNames.p2));
    for(const [key,label] of Object.entries(labels)) {
      map.append(node('span',null,label));
      for(const slot of ['p1','p2']){
        const waiting=bindingsCapture?.slot===slot && bindingsCapture?.key===key;
        const bind=button(waiting?'listening':'',waiting?'按下新键…':keyName(draft.bindings[slot][key]),()=>{
          bindingsCapture={slot,key}; paintSettings('');
        });
        bind.setAttribute('aria-label',tabNames[slot]+' '+label+' '+(waiting?'按下新键':keyName(draft.bindings[slot][key])));map.append(bind);
      }
    }
    const save=button('primary','保存设置',async()=>{
      save.disabled=true;
      try{await call('onSettings',draft);closeSettings();}
      catch(e){if(draft)paintSettings(e.message);}
    });
    modal('settings','操作设置',volumeRow,node('label','setting-row','减少画面动态效果',effects),
      node('h3',null,'键盘映射'),muted('点击键位后按新键。Esc 保留用于暂停。'),map,
      ...(error?[node('p','errorline',error)]:[]),node('div','actions',save,button('quiet','取消',closeSettings),
        button('quiet','恢复默认键位',()=>{draft.bindings=structuredClone(config.input);bindingsCapture=null;paintSettings('');})));
  }
  function showError(message) {
    const text=String(message || '载入失败，请重新打开页面。');
    if(initialized){displayNotice(text);return;}
    root.replaceChildren(node('main','boot',node('h1',null,'练习场暂时无法打开'),node('p','notice',text),
      button('minor','重新载入',()=>location.reload())));
  }
  window.addEventListener('keydown',event=>{
    if(!initialized)return;
    if(overlay==='settings' && bindingsCapture){
      event.preventDefault();event.stopImmediatePropagation();
      if(!event.repeat) {
        const {slot,key}=bindingsCapture;bindingsCapture=null;
        if(event.code==='Escape'){paintSettings('');return;}
        if(!event.code || event.metaKey || event.ctrlKey || event.altKey || ['Tab','CapsLock','ContextMenu','Unidentified'].includes(event.code)){
          paintSettings('请选择一个普通按键。');return;
        }
        const conflict=Object.entries(draft.bindings).some(([s,actions])=>Object.entries(actions).some(([k,code])=>code===event.code && (s!==slot||k!==key)));
        if(conflict){paintSettings('这个键已有动作使用，请选择其他键。');return;}
        draft.bindings[slot][key]=event.code;paintSettings('');
      }
    }else if(event.code==='Escape'){
      if(overlay==='settings'){event.preventDefault();event.stopImmediatePropagation();closeSettings();}
      else if(screen!=='battle'&&!event.repeat){event.preventDefault();event.stopImmediatePropagation();openSettings();}
    } else if(event.key==='Tab' && overlay) {
      const focusable=[...overlayHost.querySelectorAll('button:enabled,input:enabled,select:enabled')];
      if(!focusable.length){event.preventDefault();return;}
      const first=focusable[0],last=focusable.at(-1),focused=document.activeElement;
      if(event.shiftKey && (focused===first || focused?.matches('[role=dialog]'))){event.preventDefault();last.focus();}
      if(!event.shiftKey && focused===last){event.preventDefault();first.focus();}
    }
  },{capture:true});
  function paint() {
    if(!initialized)return;
    reflect();
    switch(screen) {
      case 'home':paintHome();break;case 'stages':paintStages();break;
      case 'characters':paintCharacters();break;case 'select':paintSelect();break;
      case 'result':paintResult();break;
    }
  }
  function setData(newConfig,newProfile,message='') {
    const first=!initialized;config=newConfig;profile=newProfile;notice=message || '';
    initialized=true;
    if(first){selected=defaultHero();stageId=config.economy.initialStage;}
    if(screen==='battle')reflect();else paint();
  }
  return {home,setData,renderBattle,showResult,showPause,showCountdown,showError,
    get canvas(){return hud?.canvas || null;},get screen(){return screen;},get isOverlayOpen(){return !!overlay;}};
}
