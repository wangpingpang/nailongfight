const reactions = {
  'lantern-stage': ['miss', ''],
  'melon-market': ['down', '……我拿别的担保。'],
  'bamboo-hall': ['hit', '主审：请证人指认茶盏。　书记：请茶盏指认证人。'],
  'rain-tram': ['double-miss', '都停一下！……五、六、七，走！']
};

export const backgrounds = {
  melancholy: '它早就想下班了。可它一停步，找钥匙的人就看不见了。',
  laughing: '它给全街拍过证件照。最端正的一张，拍的是空凳子。',
  sacred: '只要有东西掉下来，它就郑重迎接。今天轮到它自己。',
  courier: '街坊请它当门神。所有人都进去了，还说这门神真有礼貌。'
};

export function createPerformance() {
  return {casts:new Map(), approaches:new Set(), reaction:null, dialogue:null, lastMiss:null};
}

export function updatePerformance(battle, attacks) {
  const {performance:p, frame, actors, events, config} = battle;
  const scene = battle.sceneId ?? config.defaultScene;
  const [trigger, text] = reactions[scene] ?? [];
  const misses = [];
  for (const {cast,source} of attacks) p.casts.set(cast,source);
  for (const [cast,source] of p.casts) {
    if ((source.cast === cast && source.age < source.duration) ||
        battle.entities.some(entity => entity.cast === cast)) continue;
    p.casts.delete(cast);
    if (!cast.seen.size && cast.skill.kind !== 'basic') misses.push(source);
  }
  const landed = events.some(event => ['hit','parry'].includes(event.type));
  if (landed) {
    p.lastMiss = null;
    if (scene === 'rain-tram' && p.reaction) p.reaction.interrupted = true;
  }
  if (!p.reaction) {
    let source = trigger === 'miss' ? misses[0] : null;
    if (trigger === 'double-miss' && !landed) {
      for (const miss of misses) {
        if (p.lastMiss && p.lastMiss.team !== miss.team &&
            frame - p.lastMiss.frame <= 2 * config.rules.tickRate) source = miss;
        p.lastMiss = {team:miss.team,frame};
      }
    }
    if (source || events.some(event => event.type === trigger ||
        trigger === 'down' && event.type === 'ko')) {
      p.reaction = {frame, text, x:source?.x};
    }
  }

  if (p.dialogue) {
    const speaker = actors.find(actor => actor.id === p.dialogue.actorId);
    if (!speaker || !['IDLE','MOVE'].includes(speaker.state)) p.dialogue.poseInterrupted = true;
    return;
  }
  if (battle.mode === 'training') return;
  const approaches = new Set();
  for (const actor of [...actors].sort((a,b) => a.team-b.team)) {
    if (actor.characterId !== 'courier' || actor.hp <= 0) continue;
    for (const enemy of actors) {
      if (enemy.team === actor.team || enemy.hp <= 0) continue;
      const dx = (enemy.x - actor.x) * actor.facing;
      if (dx <= 0 || dx > actor.hurtWidth * 1.1 ||
          Math.abs(enemy.y - actor.y) > actor.hurtDepth) continue;
      const key = JSON.stringify([actor.id,enemy.id]);
      approaches.add(key);
      if (!p.approaches.has(key) && ['IDLE','MOVE'].includes(actor.state)) {
        p.dialogue = {frame, actorId:actor.id, text:'P' + actor.team + ' 美团袋鼠：你的胆子真是肥嘟嘟的'};
        return;
      }
    }
  }
  p.approaches = approaches;
}

export function performanceCaption(battle) {
  const {dialogue,reaction} = battle.performance;
  const duration = 2 * battle.config.rules.tickRate;
  return [dialogue,reaction]
    .filter(item => item && !item.interrupted && battle.frame - item.frame < duration)
    .map(item => item.text).filter(Boolean).join('　');
}

export function drawScenePerformance(ctx, view, battle) {
  if (!battle.performance) return;
  const scene = battle.sceneId ?? battle.config.defaultScene;
  const reaction = battle.performance.reaction;
  const age = reaction ? battle.frame - reaction.frame : Infinity;
  const active = age < 105 && !reaction.interrupted;
  const {width:w,height:h} = view;
  ctx.save();
  ctx.translate(w/2,h*.39);
  ctx.scale(w/720,h/300);
  ctx.lineCap = 'round';
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#493e39';
  ctx.fillStyle = '#d7ba79';
  if (scene === 'lantern-stage') {
    const x = active ? (view.x(reaction.x)-w/2)*720/w : 0;
    for (const offset of [-115,115]) {
      ctx.fillStyle = '#ffdc8055';
      ctx.beginPath();
      ctx.moveTo(offset,-117);
      const focus = active ? x : offset * .56;
      ctx.lineTo(focus-50,48);
      ctx.lineTo(focus+50,48);
      ctx.fill();
      for (const shift of [-32,32]) {
        const person = offset + shift;
        ctx.strokeStyle = '#402d52';
        ctx.beginPath();
        ctx.arc(person,-4,6,0,Math.PI*2);
        ctx.moveTo(person,2);
        ctx.lineTo(person,24);
        ctx.lineTo(person-6,39);
        ctx.moveTo(person,24);
        ctx.lineTo(person+6,39);
        ctx.moveTo(person,10);
        ctx.lineTo(person+(active ? Math.sign(x-person)*20 : -3),active ? 3 : 19);
        ctx.stroke();
      }
    }
  } else if (scene === 'melon-market') {
    ctx.fillRect(102,29,48,6);
    ctx.fillRect(123,2,7,27);
    ctx.fillRect(105,-3,44,5);
    const drop = !reaction ? 0 : Math.min(23,age*1.3);
    ctx.fillStyle = '#40434c';
    ctx.fillRect(121 + (reaction ? Math.max(0,Math.min(23,age-48)) : 0),2+drop,11,6);
  } else if (scene === 'bamboo-hall') {
    ctx.fillRect(-15,24,30,5);
    ctx.fillStyle = '#d4e8da';
    ctx.fillRect(-9,9,18,15);
    ctx.translate(0,9);
    ctx.rotate(active && age > 28 ? .6 : 0);
    ctx.fillRect(-12,-3,24,4);
  } else if (scene === 'rain-tram') {
    for (const x of [-68,68]) {
      ctx.fillStyle = '#9ddaf077';
      ctx.beginPath();
      ctx.ellipse(x,40,28,5,0,0,Math.PI*2);
      ctx.fill();
      ctx.save();
      ctx.translate(x,active ? 4*Math.sin(age/4) : -8);
      ctx.fillStyle = '#e1a86b';
      ctx.beginPath();
      ctx.moveTo(0,-32);
      ctx.lineTo(-7,17);
      ctx.lineTo(7,17);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(0,17);
      ctx.lineTo(0,29);
      ctx.stroke();
      ctx.restore();
    }
  }
  ctx.restore();
}

export function fighterPerformance(battle, actor, reduced) {
  const neutral = {angle:0,sx:1,sy:1,lift:0,forward:0};
  if (reduced) return neutral;
  const {state, age, cast, characterId} = actor;
  const recovery = cast && age > cast.skill.startup + cast.skill.active &&
    cast.seen.size === 0 && cast.skill.effect.type !== 'projectile';
  if (recovery) {
    const arc = Math.sin(Math.PI * Math.min(1,
      (age - cast.skill.startup - cast.skill.active) / Math.max(1,cast.skill.recovery)));
    if (characterId === 'melancholy') return {...neutral, angle:.13*arc, forward:-.035*arc};
    if (characterId === 'laughing') return {...neutral, sy:1-.09*arc, angle:.05*Math.sin(age)*arc};
    if (characterId === 'sacred') return {...neutral, angle:.19*arc, sy:1-.06*arc};
    if (characterId === 'courier') return {...neutral, angle:-.10*arc, forward:.034*arc};
  }
  if (!['IDLE','MOVE'].includes(state)) return neutral;
  const step = Math.sin(battle.frame * .28);
  if (characterId === 'melancholy') return {...neutral, angle:.07*step, forward:.022*step};
  if (characterId === 'laughing') return {...neutral, sy:1-.05*step, lift:.018*Math.max(0,step)};
  const line = battle.performance?.dialogue;
  if (line?.actorId === actor.id && battle.frame - line.frame < 75 && !line.poseInterrupted) {
    return {...neutral, angle:.13*Math.max(0,Math.sin((battle.frame-line.frame)/24))};
  }
  return neutral;
}
