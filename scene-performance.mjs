import {courierLine, currentStory, stageScores} from './performance-score.mjs';
import {paintStageReaction} from './stage-theatre.mjs';
export function createPerformance() {
  return {casts:new Map(), approaches:new Set(), reaction:null, dialogue:null, lastMiss:null};
}

export function updatePerformance(battle, attacks) {
  const {performance:p, frame, actors, events, config} = battle;
  const scene = battle.sceneId ?? config.defaultScene;
  const trigger = stageScores[scene]?.trigger;
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
      p.reaction = {frame, x:source?.x};
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
        p.dialogue = doorDialogue(battle, actor);
        return;
      }
    }
  }
  p.approaches = approaches;
}

function doorDialogue(battle, actor) {
  return {frame:battle.frame, actorId:actor.id, text:'P'+actor.team+' '+battle.config.characters[actor.characterId].name+'：'+courierLine};
}

export function replayTrainingLine(battle) {
  if (!battle || battle.result || battle.mode !== 'training') return false;
  const actor = battle.actors.find(a => a.team === 1 && a.characterId === 'courier');
  if (!actor || !['IDLE','MOVE'].includes(actor.state)) return false;
  battle.performance.dialogue = doorDialogue(battle, actor);
  return true;
}

export function performanceCaption(battle) {
  const line = battle.performance.dialogue;
  const story = currentStory(battle);
  const subtitles = story?.beats.find(beat => beat.caption && story.age >= beat.at && story.age < beat.at + beat.hold);
  const courier = line && battle.frame - line.frame < 2 * battle.config.rules.tickRate ? line.text : '';
  const speaker = battle.actors.find(actor => actor.state === 'ULT' &&
    battle.config.characters[actor.characterId]?.ultimateLine);
  const profile = speaker && battle.config.characters[speaker.characterId];
  const fighter = courier || (profile ? profile.name+'：'+profile.ultimateLine : '');
  return [fighter, subtitles?.caption].filter(Boolean).join('　');
}

export function drawScenePerformance(ctx, view, battle, reduced = false) {
  if (!battle.performance) return;
  const scene = battle.sceneId ?? battle.config.defaultScene;
  const reaction = battle.performance.reaction;
  const age = reaction && !reaction.interrupted ? (battle.frame - reaction.frame)*60/battle.config.rules.tickRate : -1;
  paintStageReaction(scene, ctx, view, age, reaction?.x, reduced);
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
