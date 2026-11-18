import {beginModuleCast, expireModuleZones, firstModuleHit, moduleAction,
  moduleHitCoefficient, placeModuleZones, walkingScale} from './module-combat.mjs'

// T02/T03, MVP specification §§3–7. Time advances exactly one logic frame per step.
// Free → attack/defense, attack → recovery or validated cancel, hit → stun/down,
// stun → escape/free, down → getup → free. KO supersedes every transition.
const priority = ['defend', 'ult', 's1', 's2', 'basic']
const free = a => a.state === 'IDLE' || a.state === 'MOVE'
const clamp = (v, min, max) => Math.max(min, Math.min(max, v))
const sign = v => v < 0 ? -1 : 1
const byId = (a, b) => String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0

function direction(x, y) {
  const magnitude = Math.hypot(x, y)
  return magnitude ? { x: x / magnitude, y: y / magnitude } : { x: 0, y: 0 }
}

function place(b, a, x, y) {
  const r = b.config.rules
  a.x = clamp(x, a.hurtWidth / 2, r.arenaWidth - a.hurtWidth / 2)
  a.y = clamp(y, a.hurtDepth / 2, r.arenaDepth - a.hurtDepth / 2)
}

function move(b, a, vector, distance) {
  place(b, a, a.x + vector.x * distance, a.y + vector.y * distance)
}

function enter(a, state, duration = Infinity) {
  a.state = state
  a.age = 0
  a.duration = duration
  a.actionId = null
  a.cast = null
}

function resetCombo(a) {
  a.comboHits = 0
  a.freeFrames = 0
  a.lockFrames = 0
}

/** Construct an independent simulation using an opening snapshot of the validated tables. */
export function createBattle(config, { id = globalThis.crypto.randomUUID(), mode, actors }) {
  const b = {
    id, mode, config: structuredClone(config), frame: 0, actors: [], entities: [],
    telegraphs: [], events: [], result: null, nextCast: 1,
  }
  for (const spec of actors) addActor(b, spec)
  return b
}

/** Spawn a fighter. Subsequent waves can add enemies without resetting the player. */
export function addActor(b, spec) {
  if (b.actors.some(a => a.id === spec.id)) throw new Error('重复的参战编号 ' + spec.id)
  const c = b.config.characters[spec.characterId]
  if (!c) throw new Error('未知角色 ' + spec.characterId)
  const level = b.mode === 'pve' ? (spec.level ?? 1) : 1
  const growth = 1 + (level - 1) * b.config.economy.growthRate
  const competitive = b.mode === 'pvp' || b.mode === 'vs_ai'
  const maxHp = Math.round((competitive ? c.hp : (spec.hp ?? c.hp)) * growth)
  const a = {
    id: spec.id, team: spec.team, characterId: c.id, level, hp: maxHp, maxHp,
    attack: Math.round((competitive ? c.attack : (spec.attack ?? c.attack)) * growth),
    hurtWidth: c.hurtWidth, hurtDepth: c.hurtDepth, facing: spec.facing ?? (spec.team === 1 ? 1 : -1),
    energy: b.config.rules.energyStart, cooldowns: { basic: 0, s1: 0, s2: 0, ult: 0, defend: 0 },
    comboHits: 0, lockFrames: 0, freeFrames: 0, mirthUntil: 0, fedUntil: 0, buffered: null, lastPush: { x: 1, y: 0 },
  }
  enter(a, 'IDLE')
  place(b, a, spec.x, spec.y)
  b.actors.push(a)
  return a
}

function expire(b, a) {
  if (a.age < a.duration) return
  if (a.state === 'DOWN') enter(a, 'GETUP', b.config.rules.getupFrames)
  else {
    if (a.state === 'HIT') {
      if (b.config.rules.resetComboOnStunExit) resetCombo(a)
      else a.lockFrames = 0
    }
    enter(a, 'IDLE')
  }
}

function evade(b, a, input) {
  const c = b.config.characters[a.characterId]
  if (!c.canDefend || a.cooldowns.defend > 0 || (!free(a) && a.state !== 'HIT')) return false
  const escape = a.state === 'HIT'
  const r = b.config.rules
  const vector = direction(input.x || 0, input.y || 0)
  a.defenseDirection = vector.x || vector.y ? vector : { x: -a.facing, y: 0 }
  a.cooldowns.defend = escape ? r.escapeCd : r.evadeCd
  if (escape) resetCombo(a)
  enter(a, escape ? 'ESCAPE' : 'EVADE', escape ? r.escapeFrames : r.evadeFrames)
  b.events.push({type:'evade', sourceId:a.id})
  return true
}

function castAction(b, a, button, input) {
  const cfg = b.config
  const c = cfg.characters[a.characterId]
  const previous = a.cast
  const cancel = a.state === 'BASIC' && previous.basicIndex < c.basic.length - 1 &&
    previous.firstHit !== null && b.frame >= previous.firstHit + cfg.rules.cancelAfterHitFrames &&
    ['basic', 's1', 's2'].includes(button)
  if (!free(a) && !cancel) return false
  const basicIndex = button === 'basic' && cancel ? previous.basicIndex + 1 : 0
  const skill = cfg.skills[button === 'basic' ? c.basic[basicIndex] : c[button]]
  if (!skill || a.energy < skill.cost || a.cooldowns[button] > 0) return false
  if (!cancel && input.x) a.facing = sign(input.x)
  a.cooldowns[button] = skill.cd
  a.energy -= skill.cost
  const e = skill.effect
  const duration = e.type === 'charge' ? Infinity : skill.startup + skill.active + skill.recovery
  enter(a, { basic: 'BASIC', skill: 'SKILL', ult: 'ULT' }[skill.kind], duration)
  a.actionId = skill.id
  a.cast = {
    id: b.nextCast++, skill, button, basicIndex, firstHit: null, credited: false, seen: new Set(),
    facing: a.facing, charge: 0, releaseAge: null, letGo: false, counter: false,
    originX: a.x, originY: a.y, targetX: clamp(a.x + a.facing * (e.offset ?? 0), 0, cfg.rules.arenaWidth),
    targetY: a.y,
  }
  beginModuleCast(b, a)
  b.events.push({ type: 'action', sourceId: a.id, actionId: skill.id })
  return true
}

function applyInput(b, a, input) {
  let pending = a.buffered
  if (pending && pending.expires < b.frame) pending = a.buffered = null
  for (const button of priority) {
    if (!input[button] && pending?.button !== button) continue
    const accepted = button === 'defend' ? evade(b, a, input) : castAction(b, a, button, input)
    if (accepted) {
      a.buffered = null
      return
    }
  }
  // Buffer one edge near recovery, or near the on-hit cancel window. Rejected
  // defense, missing resources and cooldown presses cannot turn into later casts.
  if (!a.cast) return
  const r = b.config.rules
  const nearRecovery = a.duration - a.age <= r.inputBuffer
  const nearCancel = a.state === 'BASIC' && a.cast.firstHit !== null &&
    a.cast.basicIndex < b.config.characters[a.characterId].basic.length - 1
  if (!nearCancel && !nearRecovery) return
  const c = b.config.characters[a.characterId]
  for (const button of priority.slice(1)) {
    const skillId = button === 'basic' ? c.basic[0] : c[button]
    if (input[button] && skillId && !a.cooldowns[button] && a.energy >= b.config.skills[skillId].cost) {
      a.buffered = { button, expires: b.frame + r.inputBuffer }
      return
    }
  }
}

function phase(age, startup, active) {
  if (age < startup) return 'warning'
  return age < startup + active ? 'active' : 'recovery'
}

function rect(x, y, facing, length, depth) {
  return { kind: 'rect', x: x + facing * length / 2, y, width: length, depth }
}

function circle(x, y, radius) {
  return { kind: 'circle', x, y, radius }
}

function display(b, a, shape, phaseName) {
  b.telegraphs.push({ ...shape, team: a.team, ownerId: a.id, phase: phaseName })
}

function overlaps(shape, a) {
  const dx = Math.abs(a.x - shape.x), dy = Math.abs(a.y - shape.y)
  if (shape.kind === 'rect')
    return dx <= (shape.width + a.hurtWidth) / 2 && dy <= (shape.depth + a.hurtDepth) / 2
  if (shape.kind === 'semicircle' && (a.x - shape.x) * shape.facing < -a.hurtWidth / 2) return false
  return Math.hypot(Math.max(0, dx - a.hurtWidth / 2), Math.max(0, dy - a.hurtDepth / 2)) <= shape.radius
}

function invincible(a, rules) {
  return ['DEAD', 'DOWN', 'GETUP', 'ESCAPE'].includes(a.state) ||
    (a.state === 'EVADE' && a.age < rules.evadeInvulnFrames)
}

function moveFighter(b, a, input) {
  const r = b.config.rules
  if (a.state === 'EVADE' || a.state === 'ESCAPE') {
    const d = a.state === 'EVADE' ? r.evadeDistance : r.escapeDistance
    if (a.age < r.defenseMoveFrames) move(b, a, a.defenseDirection, d / r.defenseMoveFrames)
    return
  }
  const cast = a.cast
  const e = cast?.skill.effect
  const charging = e?.type === 'charge' && a.age >= cast.skill.startup && cast.releaseAge === null
  if (!free(a) && a.state !== 'GETUP' && !charging) return
  const vector = direction(input.x || 0, input.y || 0)
  if (!charging && vector.x) a.facing = sign(vector.x)
  if (free(a)) {
    const state = vector.x || vector.y ? 'MOVE' : 'IDLE'
    if (a.state !== state) enter(a, state)
  }
  move(b, a, vector, b.config.characters[a.characterId].speed * (charging ? e.chargeMoveScale : walkingScale(b, a)) / r.tickRate)
}

function chargePhase(a, input) {
  const c = a.cast, s = c.skill, e = s.effect
  if (!input.holdS1) c.letGo = true
  if (a.age < s.startup) return 'warning'
  if (c.releaseAge === null) {
    if (!c.letGo && c.charge < e.chargeFrames) {
      c.charge++
      if (c.charge < e.chargeFrames) return 'warning'
      // This tick completes the final charge frame. Release preparation starts next tick.
      c.releaseAge = a.age + 1
    } else c.releaseAge = a.age
    a.duration = c.releaseAge + e.releaseFrames + s.active + s.recovery
  }
  return phase(a.age - c.releaseAge, e.releaseFrames, s.active)
}

function projectileParams(b, a) {
  const c = a.cast, e = c.skill.effect
  const t = e.type === 'charge' ? c.charge / e.chargeFrames : 0
  const passive = b.config.passives[b.config.characters[a.characterId].passive]
  const full = t >= 1 && passive?.type === 'fullChargeSpeed' && passive.skill === c.skill.id
  return {
    radius: (e.diameter + ((e.maxDiameter ?? e.diameter) - e.diameter) * t) / 2,
    coeff: c.skill.coeff + ((e.maxCoeff ?? c.skill.coeff) - c.skill.coeff) * t,
    speed: e.speed * (full ? passive.multiplier : 1),
  }
}

function updateAttack(b, a, input, attacks) {
  const c = a.cast
  if (!c) return
  const s = c.skill, e = s.effect
  let p = phase(a.age, s.startup, s.active)
  if (e.type === 'charge') p = chargePhase(a, input)
  if (c.counter) p = phase(a.age, e.counterStartup, e.counterActive)
  if (a.age === s.startup && ['field','marker','feed','backstep'].includes(e.type)) {
    b.events.push({type:'activate', sourceId:a.id, actionId:s.id})
  }
  const module = moduleAction(b, a, input, p, move)
  if (module) {
    if (module.shape && module.phase !== 'recovery') {
      display(b, a, module.shape, module.phase)
      if (module.phase === 'active') attacks.push({shape:module.shape, source:a,
        originX:module.shape.x, originY:module.shape.y, cast:c, coeff:s.coeff})
    }
    return
  }
  if (p === 'recovery') return
  if (e.type === 'parry' && !c.counter) {
    display(b, a, rect(a.x, a.y, c.facing, e.length, e.depth), p === 'active' ? 'guard' : 'warning')
    return
  }
  if (e.type === 'projectile' || e.type === 'charge') {
    const params = projectileParams(b, a)
    const x = a.x + c.facing * e.offset
    if (p === 'warning') {
      display(b, a, rect(x, a.y, c.facing, params.speed * e.lifetime / b.config.rules.tickRate, params.radius * 2), p)
    } else if (!c.spawned) {
      c.spawned = true
      b.entities.push({ kind: 'projectile', ownerId: a.id, team: a.team, cast: c, x, y: a.y,
        ...params, born: b.frame, lifetime: e.lifetime })
    }
    return
  }
  if (e.type === 'delayed') {
    const x = clamp(a.x + c.facing * e.offset, 0, b.config.rules.arenaWidth)
    if (p === 'warning') {
      if (!e.warnOnSpawnOnly) display(b, a, circle(x, a.y, e.radius), p)
    } else if (!c.spawned) {
      c.spawned = true
      b.entities = b.entities.filter(item => !(item.ownerId === a.id && item.cast.skill.id === s.id))
      b.entities.push({ kind: 'delayed', ownerId: a.id, team: a.team, cast: c, x, y: a.y,
        radius: e.radius, coeff: s.coeff, born: b.frame, delay: e.delay })
    }
    return
  }
  let shape
  if (e.type === 'leap') {
    if (p === 'warning' && a.age >= s.startup - e.moveFrames) {
      const t = (a.age - s.startup + e.moveFrames + 1) / e.moveFrames
      place(b, a, c.originX + (c.targetX - c.originX) * t, c.originY + (c.targetY - c.originY) * t)
    }
    shape = circle(c.targetX, c.targetY, e.radius)
  } else {
    if (e.type === 'dash' && p === 'active') move(b, a, { x: c.facing, y: 0 }, e.distance / s.active)
    const length = e.type === 'dash' && p === 'warning' ? e.length + e.distance : e.length
    shape = rect(a.x, a.y, c.facing, length, e.depth)
  }
  display(b, a, shape, p)
  if (p === 'active') attacks.push({ shape, source: a, originX: a.x, originY: a.y, cast: c, coeff: s.coeff })
}

function updateEntities(b, attacks) {
  for (const e of b.entities) {
    if (e.kind === 'field' || e.kind === 'marker') continue
    const source = b.actors.find(a => a.id === e.ownerId)
    if (!source || source.state === 'DEAD') { e.spent = true; continue }
    const age = b.frame - e.born
    let originX = e.x
    if (e.kind === 'projectile') {
      if (age >= e.lifetime) { e.spent = true; continue }
      // Spawn in front of the owner, then travel one speed-step on each later frame.
      if (age > 0) e.x += e.cast.facing * e.speed / b.config.rules.tickRate
      if (e.x < 0 || e.x > b.config.rules.arenaWidth) { e.spent = true; continue }
      // A bolt approaching an overlapping hurtbox still carries its incoming direction.
      originX = e.x - e.cast.facing * e.radius
    } else if (age < e.delay) {
      display(b, source, circle(e.x, e.y, e.radius), 'warning')
      continue
    } else e.spent = true
    const shape = circle(e.x, e.y, e.radius)
    display(b, source, shape, 'active')
    attacks.push({ shape, source, originX, originY: e.y, cast: e.cast, coeff: e.coeff, entity: e })
  }
}

// Use the same pre-knockback geometry as collision detection. For a rectangle,
// choose the point in the overlap nearest the incoming attack. For a circle,
// its nearest point on the hurtbox is guaranteed to be within its radius.
function contactSnapshot(attack, target) {
  const {shape, cast, entity} = attack
  const minX = target.x - target.hurtWidth / 2
  const maxX = target.x + target.hurtWidth / 2
  const minY = target.y - target.hurtDepth / 2
  const maxY = target.y + target.hurtDepth / 2
  let x, y
  if (shape.kind === 'rect') {
    x = clamp(attack.originX, Math.max(minX,shape.x-shape.width/2), Math.min(maxX,shape.x+shape.width/2))
    y = clamp(attack.originY, Math.max(minY,shape.y-shape.depth/2), Math.min(maxY,shape.y+shape.depth/2))
  } else {
    x = clamp(shape.x, minX, maxX)
    y = clamp(shape.y, minY, maxY)
  }
  const radial = shape.kind === 'circle' && entity?.kind !== 'projectile'
  const dir = radial ? Math.sign(target.x - shape.x) || cast.facing : cast.facing
  return {x, y, dir, targetX:target.x, targetY:target.y}
}

// A grade describes the attack as landed. Remaining HP and combo damage scaling
// cannot downgrade a finishing blow. Area bonuses are resolved separately per target.
function impactGrade(hit) {
  const {cast, coeff} = hit
  const skill = cast.skill
  if (skill.kind === 'ult') return 'ultimate'
  if (skill.kind === 'basic') return ['light','medium','heavy'][Math.min(cast.basicIndex,2)]
  if (cast.counter || skill.knockdown || coeff > skill.coeff) return 'heavy'
  return 'medium'
}

function confirmedImpact(hit, impact) {
  return {...hit.contact, impact, sourceId:hit.source.id, targetId:hit.target.id, skillId:hit.cast.skill.id, castId:hit.cast.id}
}

function impactsSnapshot(b, attacks) {
  const impacts = []
  for (const attack of attacks) {
    const { source, cast, entity, originX, originY } = attack
    let targets = b.actors.filter(a => a.team !== source.team && !cast.seen.has(a.id) &&
      !invincible(a, b.config.rules) && overlaps(attack.shape, a))
    if (entity?.kind === 'projectile') {
      targets.sort((a, other) => (a.x - other.x) * cast.facing || byId(a, other))
      targets = targets.slice(0, 1)
    }
    // Traits read the same snapshot as the hitbox. An incoming simultaneous hit
    // must not switch a low-life passive on halfway through this frame.
    const passive = b.config.passives[b.config.characters[source.characterId].passive]
    const boosted = passive?.type === 'lowHpKnockback' && passive.skill === cast.skill.id &&
      source.hp < source.maxHp * passive.threshold
    const knockback = cast.skill.knockback * (boosted ? passive.multiplier : 1)
    for (const a of targets) {
      const guard = a.cast
      const guardReady = guard?.skill.effect.type === 'parry' && !guard.counter &&
        phase(a.age, guard.skill.startup, guard.skill.active) === 'active'
      const dx = a.x - originX, dy = a.y - originY
      const push = (dx || dy) ? direction(dx, dy) : { x: cast.facing, y: 0 }
      const front = entity?.kind === 'projectile' ? cast.facing === -a.facing :
        (dx === 0 ? cast.facing === -a.facing : sign(-dx) === a.facing)
      impacts.push({
        ...attack, target: a, push, knockback,
        contact: contactSnapshot(attack, a),
        coeff: moduleHitCoefficient(b, attack, a, passive),
        guard: guardReady && front && cast.skill.kind === 'basic' ? guard : null,
      })
    }
  }
  return impacts.sort((one, two) => byId(one.target, two.target) || one.cast.id - two.cast.id)
}

function counter(a, c) {
  const e = c.skill.effect
  c.counter = true
  a.age = 0
  a.duration = e.counterStartup + e.counterActive + e.counterRecovery
}

function knockDown(b, a) {
  move(b, a, a.lastPush, b.config.rules.knockdownDistance)
  resetCombo(a)
  a.buffered = null
  enter(a, 'DOWN', b.config.rules.downFrames)
  b.events.push({ type: 'down', targetId: a.id, x: a.x, y: a.y })
}

// Eliminate binary addition noise in the fractional energy meter. In particular,
// accumulated hit gains must reach an exact integer display / ultimate threshold.
function gainEnergy(a, amount, maximum) {
  a.energy = Math.min(maximum, Number((a.energy + amount).toFixed(10)))
}

function settleImpact(b, hit) {
  const r = b.config.rules
  const { target: a, source, cast: c, entity, guard } = hit
  if (a.hp <= 0 || a.state === 'DOWN' || c.seen.has(a.id)) return
  if (entity?.kind === 'projectile') entity.spent = true
  c.seen.add(a.id)
  if (guard && !guard.counter && a.cast === guard) {
    counter(a, guard)
    b.events.push({type:'parry', ...confirmedImpact(hit, 'guard'), defenderId:a.id})
    return
  }
  const s = c.skill
  const scale = r.comboScale[Math.min(a.comboHits, r.comboScale.length - 1)]
  const damage = Math.min(a.hp, Math.round(source.attack * hit.coeff * scale))
  a.hp -= damage
  a.comboHits++
  a.freeFrames = 0
  a.lastPush = hit.push
  a.buffered = null
  if (c.firstHit === null) {
    c.firstHit = b.frame
    firstModuleHit(b, source, c)
  }
  if (s.kind !== 'ult') {
    gainEnergy(a, damage * r.hurtEnergyRate, r.energyMax)
    if (!c.credited) {
      gainEnergy(source, s.kind === 'basic' ? r.basicEnergy : r.skillEnergy, r.energyMax)
      c.credited = true
    }
  }
  b.events.push({type:'hit', ...confirmedImpact(hit, impactGrade(hit)), damage, actionId:s.id})
  if (a.hp === 0) {
    enter(a, 'DEAD')
    a.mirthUntil = 0
    a.fedUntil = 0
    b.events.push({ type: 'ko', targetId: a.id, x: a.x, y: a.y })
    return
  }
  if (s.knockdown || a.comboHits >= r.comboHitLimit || a.lockFrames >= r.comboLockLimit) {
    knockDown(b, a)
    return
  }
  move(b, a, hit.push, hit.knockback)
  enter(a, 'HIT', s.stun)
}

function decide(b) {
  if (b.mode === 'pve') {
    if (!b.actors.some(a => a.team === 1 && a.hp > 0)) b.result = { winner: 2, reason: 'ko' }
    return
  }
  const players = b.actors.filter(a => a.team === 1)
  const opponents = b.actors.filter(a => a.team === 2)
  const alive1 = players.some(a => a.hp > 0), alive2 = opponents.some(a => a.hp > 0)
  if (!alive1 || !alive2) {
    b.result = { winner: alive1 ? 1 : alive2 ? 2 : null, reason: 'ko' }
  } else if (b.mode !== 'training' && b.frame >= b.config.rules.duelLimit) {
    const ratio = group => group.reduce((v, a) => v + a.hp, 0) / group.reduce((v, a) => v + a.maxHp, 0)
    const delta = ratio(players) - ratio(opponents)
    b.result = { winner: delta === 0 ? null : delta > 0 ? 1 : 2, reason: 'timeout' }
  }
}

/** Apply both controllers' edge/held inputs to a single simultaneous 60 Hz logic frame. */
export function stepBattle(b, intents = {}) {
  if (b.result) return b
  b.frame++
  b.events = []
  b.telegraphs = []
  const attacks = []
  expireModuleZones(b)
  for (const a of b.actors) {
    if (a.state === 'DEAD') continue
    expire(b, a)
    if (a.mirthUntil <= b.frame) a.mirthUntil = 0
    if (a.fedUntil <= b.frame) a.fedUntil = 0
    for (const button of priority) a.cooldowns[button] = Math.max(0, a.cooldowns[button] - 1)
    applyInput(b, a, intents[a.id] ?? {})
  }
  placeModuleZones(b)
  for (const a of b.actors) {
    if (a.state === 'DEAD') continue
    const input = intents[a.id] ?? {}
    moveFighter(b, a, input)
    updateAttack(b, a, input, attacks)
  }
  updateEntities(b, attacks)
  const impacts = impactsSnapshot(b, attacks)
  for (const a of b.actors) {
    a.age++
    if (a.state === 'HIT') a.lockFrames++
    else if (a.comboHits && ++a.freeFrames >= b.config.rules.comboResetFree) resetCombo(a)
  }
  for (const impact of impacts) settleImpact(b, impact)
  for (const a of b.actors) {
    if (a.state === 'HIT' && a.lockFrames >= b.config.rules.comboLockLimit) knockDown(b, a)
  }
  b.entities = b.entities.filter(e => !e.spent && b.actors.some(a => a.id === e.ownerId && a.hp > 0))
  decide(b)
  if (b.result) b.entities = []
  return b
}
