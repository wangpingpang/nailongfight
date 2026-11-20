// Character module v0.4. All timings refer to the fixed simulation clock.
// Placement and skill startup are independent of sprite positions and animation.
const clamp = (n, lo, hi) => Math.max(lo, Math.min(n, hi))
const passiveOf = (b, a) => b.config.passives[b.config.characters[a.characterId].passive]
const circle = (x, y, radius) => ({kind: 'circle', x, y, radius})
const inside = (e, a) => Math.hypot(a.x - e.x, a.y - e.y) <= e.radius

/** Lock this cast's legal-start bonuses and spend its own route marker if usable. */
export function beginModuleCast(b, a) {
  const c = a.cast, e = c.skill.effect, p = passiveOf(b, a)
  if (p?.skill === c.skill.id && p.type === 'beat') {
    const beat = b.frame % p.period
    c.beat = beat <= p.window || beat >= p.period - p.window
    if (c.beat) c.bonusCoeff = p.bonusCoeff
  }
  if (p?.skill === c.skill.id && p.type === 'mirth' && a.mirthUntil > b.frame) {
    c.mirth = true
    c.bonusCoeff = p.bonusCoeff
    c.radius = p.boostRadius
    a.mirthUntil = 0
  }
  if (p?.type === 'fed' && p.skill === c.skill.id && a.fedUntil > b.frame) {
    c.fed = true
    c.bonusCoeff = p.bonusCoeff
    a.fedUntil = 0
  }
  const r = b.config.rules
  // The terminal point of a route is always reachable by the ground hurtbox.
  if (e.type === 'marker' || (e.type === 'leap' && e.landAtBody)) {
    c.targetX = clamp(c.targetX, a.hurtWidth / 2, r.arenaWidth - a.hurtWidth / 2)
  }
  if (e.type !== 'slide') return
  const marker = b.entities.find(item => item.kind === 'marker' && item.ownerId === a.id &&
    (item.x - a.x) * c.facing > 0 && Math.hypot(item.x-a.x, item.y-a.y) <= e.maxDistance + 1e-10)
  c.marked = Boolean(marker)
  c.slideStoppedAt = null
  if (marker) {
    c.targetX = marker.x
    c.targetY = marker.y
    b.entities = b.entities.filter(item => item !== marker)
  } else {
    c.targetX = clamp(a.x + c.facing * e.distance, a.hurtWidth / 2, r.arenaWidth - a.hurtWidth / 2)
  }
  a.duration += e.slideFrames
}

/** Install a persistent field / marker at its activation frame before resolving anyone's movement. */
export function placeModuleZones(b) {
  for (const a of b.actors) {
    const c = a.cast, s = c?.skill, e = s?.effect
    if (!e || (e.type !== 'field' && e.type !== 'marker') || c.spawned || a.age !== s.startup) continue
    c.spawned = true
    b.entities = b.entities.filter(item => item.ownerId !== a.id || item.kind !== e.type)
    b.entities.push({kind:e.type, cast:c, x:c.targetX, y:c.targetY, radius:e.radius,
      ownerId:a.id, team:a.team, born:b.frame, lifetime:e.life, slow:e.slow})
  }
}

/** Remove zones at the start of the first frame on which they are no longer usable. */
export function expireModuleZones(b) {
  b.entities = b.entities.filter(e =>
    (e.kind !== 'field' && e.kind !== 'marker') || b.frame - e.born < e.lifetime)
}

/** Read the strongest current ground slow, once per normal movement tick. */
export function walkingScale(b, a) {
  let scale = 1
  for (const e of b.entities) {
    if (e.kind === 'field' && e.team !== a.team && inside(e, a)) scale = Math.min(scale, e.slow)
  }
  const p = passiveOf(b, a)
  return p?.type === 'fed' && a.fedUntil > b.frame ? scale * p.speedMultiplier : scale
}

function slide(b, a, input, landingX) {
  const c = a.cast, s = c.skill, e = s.effect
  const moveAge = a.age - s.startup
  if (moveAge < 0) return {shape:circle(landingX, c.targetY, e.radius), phase:'warning'}
  if (moveAge < e.slideFrames && c.slideStoppedAt === null) {
    if (input.s2) {
      // Finish this movement tick, then begin the one existing four-frame attack.
      c.slideStoppedAt = a.age + 1
      c.earlyStop = true
      a.duration = c.slideStoppedAt + s.active + s.recovery
      b.events.push({type:'stop',sourceId:a.id,x:a.x,y:a.y})
    }
    return {shape:circle(c.earlyStop ? a.x : landingX, c.earlyStop ? a.y : c.targetY, e.radius), phase:'warning'}
  }
  const attackAge = a.age - (c.slideStoppedAt ?? s.startup + e.slideFrames)
  return {shape:circle(a.x,a.y,e.radius), phase:attackAge < s.active ? 'active' : 'recovery'}
}

/** Describe the module action's hit geometry at the resolved ground position. */
export function moduleAction(b, a, input, phase, landingX) {
  const c = a.cast, s = c.skill, e = s.effect
  switch (e.type) {
    case 'feed': {
      const p = passiveOf(b, a)
      if (a.age === s.startup && p?.type === 'fed' && p.grantSkill === s.id)
        a.fedUntil = b.frame + p.duration
      return {phase:'feeding'}
    }
    case 'backstep':
      return {phase:'movement'}
    case 'semicircle':
      return {shape:{kind:'semicircle', x:a.x,y:a.y,radius:e.radius,facing:c.facing},phase}
    case 'circle':
      return {shape:circle(c.targetX,c.targetY,c.radius ?? e.radius),phase}
    case 'field':
    case 'marker':
      if (phase === 'warning' && e.type === 'field') return {shape:circle(c.targetX,c.targetY,e.radius),phase}
      return {phase:'placement'}
    case 'slide':
      return slide(b,a,input,landingX)
    default:
      return null
  }
}

/** Resolve each target's own resonance against its position at the shared hit snapshot. */
export function moduleHitCoefficient(b, hit, target, p) {
  const c = hit.cast
  if (p?.type === 'resonance' && p.skill === c.skill.id && b.entities.some(e =>
    e.kind === 'field' && e.ownerId === hit.source.id && e.cast.skill.id === p.fieldSkill && inside(e,target)))
    return hit.coeff + p.bonusCoeff
  return hit.coeff + (c.bonusCoeff ?? 0)
}

/** Apply once-per-cast effects only after the first effective hit survives defense and protection. */
export function firstModuleHit(b, a, c) {
  const p = passiveOf(b,a)
  if (p?.type === 'mirth' && p.grantSkill === c.skill.id && a.hp > 0) a.mirthUntil = b.frame + p.duration
  const refund = p?.type === 'hitRefund' || (p?.type === 'arrival' && c.marked && !c.earlyStop)
  if (refund && p.skill === c.skill.id)
    a.cooldowns[p.reduceSlot] = Math.max(0, a.cooldowns[p.reduceSlot] - p.reduceFrames)
}
