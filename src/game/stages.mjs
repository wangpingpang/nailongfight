import {addActor} from './combat.mjs'

const limit = (n, min, max) => Math.max(min,Math.min(n,max))

function positionsForWave(battle, number) {
  const {config, stage} = battle
  const {arenaWidth, arenaDepth} = config.rules
  const hero = battle.actors.find(a=>a.team === 1 && a.hp > 0)
  const waves = config.stages[stage.id].waves
  const locations = []
  for (const enemy of waves[number-1]) {
    // Prefer the designed entry. Mirror the formation when the player camps it.
    const candidates = [
      [enemy.x, enemy.y], [arenaWidth-enemy.x, enemy.y],
      [enemy.x, arenaDepth-enemy.y], [arenaWidth-enemy.x, arenaDepth-enemy.y]
    ]
    const place = candidates.find(([x,y]) =>
      Math.hypot(hero.x-x,hero.y-y) >= config.spawn.minDistance &&
      !locations.some(s => s.x === x && s.y === y))
    if (!place) return []
    locations.push({...enemy, x:place[0], y:place[1]})
  }
  return locations
}

function queueWave(battle, number, delay) {
  const s = battle.stage
  s.wave = number
  s.remainingFrames = delay
  s.active = false
  s.warnings = delay <= battle.config.spawn.warningFrames ? positionsForWave(battle,number) : []
}

/** Set up stage timing on a live PVE battle that already contains its player. */
export function startStage(battle, stageId) {
  const stage = battle.config.stages[stageId]
  if (battle.mode !== 'pve' || !stage || !battle.actors.some(a=>a.team===1 && a.hp>0))
    throw new Error('关卡或出战角色无效')
  battle.stage = {id:stageId, total:stage.waves.length}
  queueWave(battle,1,battle.config.spawn.warningFrames)
  return battle.stage
}

/** Run once after a combat tick. Waves share the same player and simulation clock. */
export function tickStage(battle) {
  const s = battle.stage
  if (!s || battle.result) return
  const player = battle.actors.find(a=>a.team===1 && a.hp>0)
  if (!player) {
    battle.result = {winner:2,reason:'ko'}
    return
  }
  if (s.active) {
    if (battle.actors.some(a=>a.team===2 && a.hp>0)) return
    if (s.wave === s.total) {
      battle.result = {winner:1,reason:'clear'}
      battle.entities.length = 0
    } else {
      queueWave(battle,s.wave+1,battle.config.spawn.waveDelay)
    }
    return
  }
  const {warningFrames,minDistance} = battle.config.spawn
  s.remainingFrames = Math.max(0,s.remainingFrames - 1)
  if (s.remainingFrames === warningFrames) s.warnings = positionsForWave(battle,s.wave)
  if (s.remainingFrames > 0) return
  if (!s.warnings.length || s.warnings.some(p=>Math.hypot(p.x-player.x,p.y-player.y) < minDistance)) {
    // Re-warn the alternative destination for a full window before spawning.
    queueWave(battle,s.wave,warningFrames)
    return
  }
  for (const [slot,enemy] of s.warnings.entries()) {
    addActor(battle,{...enemy,id:'wave-'+s.wave+'-'+slot, team:2, facing:Math.sign(player.x-enemy.x)||-1})
  }
  s.active = true
  s.warnings = []
}

function ultimateCovers(config, actor, target, direction) {
  const fighter = config.characters[actor.characterId]
  const skill = config.skills[fighter.ult]
  if (!skill || actor.energy < skill.cost) return false
  const dx = (target.x-actor.x)*direction
  const dy = Math.abs(target.y-actor.y)
  const effect = skill.effect
  if (effect.type === 'leap') {
    const endpoint = limit(actor.x+direction*effect.offset,0,config.rules.arenaWidth)
    return Math.hypot(target.x-endpoint,dy) <= effect.radius
  }
  return dx >= 0 && dx <= effect.length && dy <= effect.depth/2
}

function decide(battle,actor,target,memory) {
  const {config} = battle
  const {ai, characters, skills} = config
  const kind = characters[actor.characterId].ai
  const params = ai[kind]
  const dx = target.x-actor.x, dy = target.y-actor.y
  const dir = Math.sign(dx) || actor.facing
  const distance = Math.abs(dx)
  const attack = action => ({edge:{[action]:true,x:dir}})
  const walkTo = (x,y) => ({destination:{x,y}})
  const stride = characters[actor.characterId].speed/config.rules.tickRate
  const approach = range => walkTo(target.x-dir*Math.max(0,range-stride), target.y)
  const retreat = range => {
    const half = actor.hurtWidth/2
    const x = limit(target.x-dir*range,half,config.rules.arenaWidth-half)
    return walkTo(x,target.y)
  }
  const fighter = kind === 'shell' || kind === 'cloud'
  if (actor.state === 'HIT') {
    if (fighter && actor.lockFrames >= ai.escapeAfter && !actor.cooldowns.defend)
      return {edge:{defend:true,x:-dir}}
    return {}
  }
  if (actor.state === 'SKILL' && kind === 'cloud' && actor.actionId === characters[actor.characterId].s1)
    return {holdS1:true}
  if (!['IDLE','MOVE','BASIC'].includes(actor.state)) return {}
  if (fighter && ultimateCovers(config,actor,target,dir)) return attack('ult')
  // Meet halfway on the lane: two simultaneous observers otherwise swap lanes forever.
  if (Math.abs(dy) > ai.alignTolerance) return walkTo(actor.x,actor.y + dy/2)
  switch (kind) {
    case 'melee':
      return distance <= params.range ? attack('basic') : approach(params.range)
    case 'ranged':
      if (distance > params.keepMax) return approach(params.keepMax)
      if (distance < params.keepMin && Math.abs(retreat(params.keepMin).destination.x-actor.x) > ai.alignTolerance)
        return retreat(params.keepMin)
      return attack('basic')
    case 'shell': {
      const enemySkill = skills[target.actionId]
      if (!actor.cooldowns.s2 && distance <= params.parryRange && target.state === 'BASIC' &&
          target.facing === -dir && enemySkill && target.age < enemySkill.startup)
        return attack('s2')
      if (distance <= params.meleeRange) return attack('basic')
      if (distance <= params.approach && !actor.cooldowns.s1) return attack('s1')
      return approach(params.meleeRange)
    }
    case 'cloud': {
      if (memory.retreat && distance < params.keepMin && Math.abs(retreat(params.keepMin).destination.x-actor.x) > ai.alignTolerance)
        return retreat(params.keepMin)
      memory.retreat = false
      if (distance <= params.trapRange && !actor.cooldowns.s2) {
        memory.retreat = true
        return attack('s2')
      }
      if (distance >= params.chargeMin && distance <= params.chargeMax && !actor.cooldowns.s1)
        return {...attack('s1'),holdS1:true}
      const firstBasic = skills[characters[actor.characterId].basic[0]]
      if (distance <= firstBasic.effect.length) return attack('basic')
      if (distance > params.keepMax) return approach(params.keepMax)
      if (distance < params.keepMin) return retreat(params.keepMin)
      return {}
    }
    default:
      return {}
  }
}

/** Return an AI input source. Decisions only inspect the committed battle state.
 * Movement goals persist between observations, while action buttons are one-tick edges.
 */
export function makeAI() {
  const controllers = new WeakMap()
  return (battle,actor) => {
    if (battle.result || !actor || actor.hp <= 0) return {}
    let memory = controllers.get(actor)
    if (!memory) {
      memory = {next:0,plan:{},retreat:false}
      controllers.set(actor,memory)
    }
    if (battle.frame >= memory.next) {
      const targets = battle.actors.filter(a=>a.team !== actor.team && a.hp > 0)
      const target = targets.reduce((nearest,a) =>
        !nearest || Math.hypot(a.x-actor.x,a.y-actor.y) < Math.hypot(nearest.x-actor.x,nearest.y-actor.y)
          ? a : nearest, null)
      memory.plan = target ? decide(battle,actor,target,memory) : {}
      memory.next = battle.frame + battle.config.ai.interval
    }
    const plan = memory.plan
    const input = {...plan.edge}
    delete plan.edge
    if (plan.holdS1) input.holdS1 = true
    if (plan.destination) {
      const speed = battle.config.characters[actor.characterId].speed / battle.config.rules.tickRate
      const dx = plan.destination.x-actor.x, dy = plan.destination.y-actor.y
      const distance = Math.hypot(dx,dy)
      if (distance > speed/2) {
        input.x = dx/distance
        input.y = dy/distance
      }
    }
    return input
  }
}
