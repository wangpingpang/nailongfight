/** Return the next beat's distance in frames and whether this input frame is in the window. */
export function heartbeat(frame, passive) {
  const phase = frame % passive.period
  const until = (passive.period - phase) % passive.period
  return {until, onBeat: Math.min(phase, until) <= passive.window}
}

/** Find the actor's own active field or route marker in the committed world state. */
export function ownedEffect(battle, actor, kind) {
  return battle.entities.find(e => e.ownerId === actor.id && e.kind === kind && !e.spent)
}

/** Describe only the selected fighter's current passive. The UI never modifies its state. */
export function fighterStatus(battle, actor) {
  const config = battle.config
  const character = config.characters[actor.characterId]
  const passive = config.passives[character.passive]
  if (!passive || !config.roster?.includes(character.id)) return null
  const seconds = frames => Math.ceil(Math.max(0,frames) / config.rules.tickRate)
  const remaining = e => seconds(e.born + e.lifetime - battle.frame)
  let text, active = false
  switch (passive.type) {
    case 'beat': {
      const beat = heartbeat(battle.frame,passive)
      active = beat.onBeat || !!actor.cast?.beat
      text = actor.cast?.beat ? '本次回旋已踩拍' : beat.onBeat ? '拍点 · 现在可踩拍' :
        '距下一拍 ' + (beat.until / config.rules.tickRate).toFixed(1) + ' 秒'
      break
    }
    case 'mirth':
      active = !!actor.cast?.mirth || actor.mirthUntil > battle.frame
      text = actor.cast?.mirth ? '本次震波已强化' : active ?
        '笑意 '+seconds(actor.mirthUntil-battle.frame)+' 秒 · 震波可强化' : '跃进命中可获得笑意'
      break
    case 'resonance': {
      const field = ownedEffect(battle,actor,'field')
      active = !!field
      text = field ? '光环 '+remaining(field)+' 秒 · 环内命中强化' : '放置光环可触发共鸣'
      break
    }
    case 'arrival': {
      const route = ownedEffect(battle,actor,'marker')
      active = !!route || !!actor.cast?.marked
      text = actor.cast?.marked ? '沿标记滑行 · 原终点命中缩短冷却' : route ?
        '路线标记 '+remaining(route)+' 秒' : '放置标记可缩短路线冷却'
      break
    }
    case 'fed':
      active = !!actor.cast?.fed || actor.fedUntil > battle.frame
      text = actor.cast?.fed ? '本次冲撞已强化' : active ?
        '炽热 '+seconds(actor.fedUntil-battle.frame)+' 秒 · 移速提升' : '完成添炭可获得炽热'
      break
    case 'hitRefund': {
      const bubble = ownedEffect(battle,actor,'projectile')
      const zone = ownedEffect(battle,actor,'delayed')
      active = !!bubble || !!zone
      text = bubble && zone ? '气泡飞行中 · 延迟区已布置' : bubble ? '气泡飞行中' :
        zone ? '延迟区已布置' : '气泡命中可缩短布区冷却'
      break
    }
    default: return null
  }
  return {name:passive.name,text,active}
}
