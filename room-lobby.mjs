function el(tag,cls,text) {
  const element=document.createElement(tag);
  if(cls)element.className=cls;
  if(text)element.textContent=text;
  return element;
}
function btn(label,cls,action) {
  const b=el('button',cls,label); b.type='button'; b.addEventListener('click',action);return b;
}
export function roomPanel(config,state,codeHint,call) {
  const box=el('section','panel room-panel');
  const status=el('p','room-status',state.message || '两台电脑分别打开游戏，各自使用本机玩家 1 的按键。');
  status.setAttribute('role','status');
  if(!state.role) {
    const create=btn('创建房间','primary',()=>call('onRoomCreate'));
    create.disabled=state.busy;
    const form=el('form','room-form'),label=el('label',null,'房间码');
    const field=el('input','room-code');field.type='text';field.autocapitalize='characters';field.maxLength=8;
    field.autocomplete='off';field.spellcheck=false;field.required=true;field.value=codeHint||'';
    field.pattern='[a-zA-Z0-9]{8}';field.placeholder='8 位房间码';field.id='duel-code';label.htmlFor=field.id;
    const join=el('button','minor','加入房间');join.type='submit';join.disabled=state.busy;
    form.addEventListener('submit',e=>{e.preventDefault();call('onRoomJoin',field.value);});
    form.append(label,field,join);box.append(status,create,form);return box;
  }
  const host=state.role==='host';
  const code=el('strong','room-number',state.code);
  const share=btn('复制邀请链接','minor',async()=>{
    try {await navigator.clipboard.writeText(state.inviteUrl);share.textContent='邀请链接已复制';}
    catch {url.hidden=false;url.focus();url.select();}
  });
  const url=el('input','room-url');url.readOnly=true;url.value=state.inviteUrl;url.hidden=true;url.setAttribute('aria-label','邀请链接');
  const header=el('div','actions');header.append(el('span','muted','房间码'),code,share);
  const versus=el('p','room-versus');
  const yours=config.characters[state.fighter],peer=config.characters[state.peerFighter];
  versus.textContent=(host?'你是 P1 · ':'你是 P2 · ')+yours.name+'　/　'+(peer?'对方 · '+peer.name:state.peerJoined?'对方正在选角':'等待对手');
  const list=el('div','roster room-roster');list.setAttribute('role','group');list.setAttribute('aria-label','选择联机斗士');
  for(const id of config.roster) {
    const c=config.characters[id],art=config.assets[c.asset], choice=btn('','fighter',()=>call('onRoomSelect',id));
    const image=el('img');image.alt='';image.src=art.portrait||art.path;
    const copy=el('span');copy.append(el('b',null,c.name),el('small',null,c.role));choice.append(image,copy);
    choice.setAttribute('aria-pressed',String(id===state.fighter));list.append(choice);
  }
  box.append(header,url,versus,el('h2',null,'选择斗士'),list);
  if(host) {
    const label=el('label','room-scene','对战场景'),select=el('select');
    select.setAttribute('aria-label','对战场景');
    for(const s of Object.values(config.scenes)) {
      const option=el('option',null,s.name);option.value=s.id;option.selected=state.scene===s.id;select.append(option);
    }
    select.addEventListener('change',()=>call('onRoomScene',select.value));label.append(select);box.append(label);
  } else if(config.scenes[state.scene])box.append(el('p','muted','对战场景 · '+config.scenes[state.scene].name));
  const action=host?btn('开始联机对战','primary',()=>call('onRoomStart')):btn(state.ready?'取消准备':'准备就绪','primary',()=>call('onRoomReady'));
  action.disabled=host && (!state.peerReady||!state.peerJoined);
  box.append(status,action);
  return box;
}
