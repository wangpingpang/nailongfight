import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createBattle, addActor, stepBattle } from '../../src/game/combat.mjs'

const config = JSON.parse(readFileSync(new URL('../../src/game/data/game.json', import.meta.url)))
const fighter = (id, team, x, characterId = 'shell') => ({ id, team, characterId, x, y: 3, facing: team === 1 ? 1 : -1 })
function duel(first = 'shell', second = 'shell', mode = 'training', overrides = {}) {
  return createBattle(config, { id: 'test', mode, actors: [
    { ...fighter('a', 1, 4, first), ...overrides }, fighter('b', 2, 5, second)
  ] })
}
function advance(battle, frames, inputs = {}) {
  for (let i = 0; i < frames; i++) stepBattle(battle, inputs)
}

test('startup, cast deduplication, multi-target credit and recovery', () => {
  const b = duel()
  addActor(b, fighter('c', 2, 5))
  stepBattle(b, { a: { basic: true } })
  advance(b, 6)
  assert.equal(b.actors[1].hp, 1000)
  advance(b, 3)
  for (const target of b.actors.slice(1)) assert.equal(target.hp, 965)
  assert.equal(b.actors[0].energy, 3)
})

test('skill cost, cooldown, snapshot and PVE growth', () => {
  const b = duel('shell', 'shell', 'pve', { level: 5 })
  const a = b.actors[0]
  a.energy = 99
  stepBattle(b, { a: { ult: true } })
  assert.equal(a.state, 'IDLE')
  a.energy = 100
  stepBattle(b, { a: { ult: true } })
  assert.equal(a.state, 'ULT')
  assert.equal(a.energy, 0)
  const another = duel('shell', 'shell', 'pve', { level: 5 })
  assert.equal(another.actors[0].attack, 116)
  stepBattle(another, { a: { s1: true } })
  advance(another, 10)
  assert.equal(another.actors[1].hp, 849)
  assert.equal(another.actors[0].cooldowns.s1, 470)
  assert.equal(duel('shell', 'shell', 'pvp', { level: 5 }).actors[0].maxHp, 1000)
})

test('evade is invulnerable only in its configured window and shares escape cooldown', () => {
  const b = duel()
  b.actors[0].x = 0.5
  b.actors[1].x = 1.45
  stepBattle(b, { a: { defend: true }, b: { basic: true } })
  advance(b, 10)
  assert.equal(b.actors[0].hp, 1000)
  assert.equal(b.actors[0].x, 0.5)
  advance(b, 10)
  stepBattle(b, { b: { basic: true } })
  advance(b, 7)
  assert.equal(b.actors[0].state, 'HIT')
  stepBattle(b, { a: { defend: true } })
  assert.equal(b.actors[0].state, 'HIT')
})

test('parry intercepts each cast only once without granting energy for the block', () => {
  const b = duel()
  stepBattle(b, { a: { s2: true }, b: { basic: true } })
  advance(b, 9)
  assert.equal(b.actors[0].hp, 1000)
  assert.equal(b.actors[0].energy, 0)
  assert.equal(b.actors[1].energy, 0)
  advance(b, 6)
  assert.equal(b.actors[1].hp, 850)
  assert.equal(b.actors[0].energy, 8)
})

test('same-frame double knockout survives resolution order, PvE uses player-death precedence', () => {
  for (const mode of ['pvp', 'pve']) {
    const b = duel('shell', 'shell', mode)
    b.actors.forEach(a => { a.hp = 1 })
    stepBattle(b, { a: { basic: true }, b: { basic: true } })
    advance(b, 7)
    assert.equal(b.result.winner, mode === 'pve' ? 2 : null)
    assert.ok(b.actors.every(a => a.state === 'DEAD'))
    const frame = b.frame
    advance(b, 4)
    assert.equal(b.frame, frame)
  }
})

test('confirmed basic cancels advance the chain, while whiffs restart from segment one', () => {
  const b = duel()
  stepBattle(b, { a: { basic: true } })
  advance(b, 7)
  stepBattle(b, { a: { basic: true } }) // buffered before the third frame after hit
  advance(b, 2)
  assert.equal(b.actors[0].actionId, 'shell.n2')
  advance(b, 8)
  advance(b, 2)
  stepBattle(b, { a: { basic: true } })
  assert.equal(b.actors[0].actionId, 'shell.n3')
  const empty = duel()
  empty.actors[1].x = 12
  stepBattle(empty, { a: { basic: true } })
  advance(empty, 19)
  stepBattle(empty, { a: { basic: true } })
  assert.equal(empty.actors[0].actionId, 'shell.n1')
})

test('every defender shares one protection count across attackers; seventh same-frame hit drops', () => {
  const b = duel()
  // Six subsequent first-segment hits cover one victim. Attackers do not hit their allies.
  for (let i = 0; i < 6; i++) addActor(b, fighter('helper' + i, 1, 4))
  const inputs = Object.fromEntries(b.actors.filter(a => a.team === 1).map(a => [a.id, { basic: true }]))
  stepBattle(b, inputs)
  advance(b, 7)
  const target = b.actors[1]
  assert.equal(target.state, 'DOWN')
  assert.equal(target.hp, 1000 - 3 * 35 - 3 * 25)
  assert.equal(target.comboHits, 0)
  assert.equal(b.events.filter(e => e.type === 'hit').length, 6)
  const hp = target.hp
  advance(b, 36)
  stepBattle(b, { b: { basic: true, defend: true, y: 1 } })
  assert.equal(target.state, 'GETUP')
  assert.ok(target.y > 3)
  assert.equal(target.hp, hp)
})

test('long continuous hard stun triggers protection without another attack', () => {
  const edited = structuredClone(config)
  edited.skills['shell.n1'].stun = 180
  const b = createBattle(edited, { mode: 'training', id: 'long', actors: [fighter('a', 1, 4), fighter('b', 2, 5)] })
  stepBattle(b, { a: { basic: true } })
  advance(b, 7 + 149)
  assert.equal(b.actors[1].state, 'HIT')
  stepBattle(b)
  assert.equal(b.actors[1].state, 'DOWN')
})

test('charge scales damage, projectile diameter and full-charge passive speed; interruption keeps CD', () => {
  const release = hold => {
    const b = duel('cloud')
    b.actors[1].x = 12
    stepBattle(b, { a: { s1: true, holdS1: hold } })
    for (let frame = 0; frame < 100 && !b.entities.length; frame++) stepBattle(b, { a: { holdS1: hold } })
    assert.equal(b.entities.length, 1)
    return b.entities[0]
  }
  const quick = release(false), full = release(true)
  assert.equal(quick.coeff, .9)
  assert.equal(quick.radius, .25)
  assert.equal(full.coeff, 1.6)
  assert.equal(full.radius, .5)
  assert.ok(Math.abs(full.speed - 6.9) < 1e-12)
  const b = duel('cloud')
  stepBattle(b, { a: { s1: true, holdS1: true }, b: { basic: true } })
  advance(b, 8, { a: { holdS1: true } })
  assert.equal(b.actors[0].state, 'HIT')
  assert.ok(b.actors[0].cooldowns.s1 > 0)
  advance(b, 80)
  assert.equal(b.actors[1].hp, 1000)
})

test('a spawned delayed area survives interruption and ignites on schedule', () => {
  const b = duel('cloud')
  b.actors[1].x = 5.2
  stepBattle(b, { a: { s2: true } })
  advance(b, 11)
  stepBattle(b, { b: { basic: true } })
  assert.equal(b.entities[0].kind, 'delayed')
  advance(b, 7)
  assert.equal(b.actors[0].state, 'HIT')
  advance(b, 34)
  assert.equal(b.actors[1].hp, 1000)
  stepBattle(b)
  assert.equal(b.actors[1].hp, 880)
})

test('parry does not intercept skills or attacks from behind', () => {
  const b = duel()
  stepBattle(b, { a: { s2: true }, b: { s1: true } })
  advance(b, 10)
  assert.equal(b.actors[0].hp, 870)
  const back = duel()
  back.actors[0].facing = -1
  stepBattle(back, { a: { s2: true }, b: { basic: true } })
  advance(back, 7)
  assert.equal(back.actors[0].hp, 965)
})

test('front parry consumes an incoming basic projectile; no hit cooldown is awarded', () => {
  const b = duel('shell', 'ranged')
  b.actors[1].x = 6.5
  stepBattle(b, { b: { basic: true } })
  const startup = config.skills[config.characters.ranged.basic[0]].startup
  advance(b, startup)
  assert.ok(b.entities.length)
  stepBattle(b, { a: { s2: true } })
  for (let i = 0; i < 30 && b.entities.length; i++) stepBattle(b)
  assert.equal(b.entities.length, 0)
  assert.equal(b.actors[0].hp, 1000)
  assert.equal(b.actors[0].energy, 0)
  assert.ok(b.events.some(e => e.type === 'parry'))
})

test('STUN escape clears combo, pushes backwards, clamps and cannot attack immediately', () => {
  const b = duel()
  b.actors[0].x = .6
  b.actors[1].x = 1.4
  stepBattle(b, { b: { basic: true } })
  advance(b, 7)
  stepBattle(b, { a: { defend: true, basic: true } })
  const a = b.actors[0]
  assert.equal(a.state, 'ESCAPE')
  assert.equal(a.cooldowns.defend, 1080)
  assert.equal(a.comboHits, 0)
  advance(b, 12, { a: { basic: true } })
  assert.equal(a.x, .5)
  assert.equal(a.state, 'ESCAPE')
})

test('timeout settles last-frame hits before comparing health', () => {
  const b = duel('shell', 'shell', 'vs_ai')
  b.frame = config.rules.duelLimit - (config.skills['shell.n1'].startup + 1)
  stepBattle(b, { a: { basic: true } })
  advance(b, 7)
  assert.deepEqual(b.result, { winner: 1, reason: 'timeout' })
  const tie = duel('shell', 'shell', 'pvp')
  tie.frame = config.rules.duelLimit - 1
  stepBattle(tie)
  assert.deepEqual(tie.result, { winner: null, reason: 'timeout' })
})

test('opening snapshot isolates live cooldowns and new fights pick up changed values', () => {
  const cfg = structuredClone(config)
  const args = { mode: 'pvp', id: 'cfg', actors: [fighter('a', 1, 3), fighter('b', 2, 11)] }
  const old = createBattle(cfg, args)
  cfg.skills['shell.s1'].cd = 600
  const next = createBattle(cfg, args)
  stepBattle(old, { a: { s1: true } })
  stepBattle(next, { a: { s1: true } })
  assert.equal(old.actors[0].cooldowns.s1, 480)
  assert.equal(next.actors[0].cooldowns.s1, 600)
})

test('fourth hit scales an attack-100 charge to 91 damage; ultimate hits generate no energy', () => {
  const b = duel()
  b.actors[1].comboHits = 3
  stepBattle(b, { a: { s1: true } })
  advance(b, 10)
  assert.equal(b.actors[1].hp, 909)
  const ult = duel()
  ult.actors[0].energy = config.rules.energyMax
  stepBattle(ult, { a: { ult: true } })
  advance(ult, config.skills['shell.ult'].startup)
  assert.equal(ult.actors[0].energy, 0)
  assert.equal(ult.actors[1].energy, 0)
  assert.equal(ult.actors[1].state, 'DOWN')
})

test('full movement speed is independent of diagonal direction; pure vertical travel preserves facing', () => {
  const b = duel()
  const a = b.actors[0], x = a.x, y = a.y
  stepBattle(b, { a: { x: -1, y: 1 } })
  assert.ok(Math.abs(Math.hypot(a.x - x, a.y - y) - config.characters.shell.speed / config.rules.tickRate) < 1e-10)
  stepBattle(b, { a: { y: -1 } })
  assert.equal(a.facing, -1)
})

test('unprotected twelfth defense movement frame takes a real hit; energy counts actual damage', () => {
  const b = duel()
  b.actors[0].x = .5
  b.actors[1].x = 1.2
  stepBattle(b, { a: { defend: true } })
  advance(b, 3)
  stepBattle(b, { b: { basic: true } })
  advance(b, 7)
  assert.equal(b.actors[0].hp, 965)
  const capped = duel()
  capped.actors[1].hp = 10
  stepBattle(capped, { a: { basic: true } })
  advance(capped, 7)
  assert.equal(capped.actors[1].energy, .4)
})

test('skill cooldown prevents repeat casts through recovery without restarting the cooldown', () => {
  const b = duel()
  b.actors[1].x = 13
  stepBattle(b, { a: { s1: true } })
  advance(b, config.skills['shell.s1'].cd - 1, { a: { s1: true } })
  assert.equal(b.nextCast, 2)
  assert.equal(b.actors[0].cooldowns.s1, 1)
  stepBattle(b, { a: { s1: true } })
  assert.equal(b.nextCast, 3)
})

test('spent energy stays spent when an ultimate is interrupted before its first active frame', () => {
  const b = duel()
  b.actors[0].energy = 100
  stepBattle(b, { a: { ult: true }, b: { basic: true } })
  advance(b, 7)
  const a = b.actors[0]
  assert.equal(a.state, 'HIT')
  assert.equal(a.energy, 1.4)
  advance(b, config.skills['shell.ult'].startup)
  assert.equal(b.actors[1].hp, 1000)
})

test('leap keeps its original landing when the target walks away', () => {
  const b = duel('cloud')
  const a = b.actors[0]
  a.energy = config.rules.energyMax
  const x = a.x, y = a.y
  stepBattle(b, { a: { ult: true } })
  const ultimate = config.skills['cloud.ult']
  for (let i = 0; i < ultimate.startup; i++) stepBattle(b, { b: { y: 1 } })
  assert.equal(a.x, x + ultimate.effect.offset)
  assert.equal(a.y, y)
  assert.equal(b.actors[1].hp, 1000)
})

test('non-player-controlled machinery cannot defend or spend a nonexistent ultimate', () => {
  const b = duel('melee')
  const a = b.actors[0]
  a.energy = config.rules.energyMax
  stepBattle(b, { a: { defend: true, s1: true, ult: true } })
  assert.equal(a.state, 'IDLE')
  assert.equal(a.energy, config.rules.energyMax)
})

test('shell low-health passive increases only the third segment push', () => {
  function measure(hp) {
    const b = duel()
    b.actors[0].hp = hp
    const a = b.actors[0], target = b.actors[1]
    for (let segment = 0; segment < 3; segment++) {
      const before = target.x
      stepBattle(b, { a: { basic: true } })
      advance(b, config.skills[config.characters.shell.basic[segment]].startup)
      if (segment === 2) return target.x - before
      advance(b, config.rules.cancelAfterHitFrames - 1)
      assert.equal(a.state, 'BASIC')
    }
  }
  assert.ok(Math.abs(measure(400) - .7) < 1e-10)
  assert.ok(Math.abs(measure(399) - .84) < 1e-10)
})

test('fractional hit gains reach the exact ultimate threshold', () => {
  const b = duel()
  const defender = b.actors[0]
  const skill = b.config.skills['shell.n1']
  skill.coeff = .02
  skill.knockback = 0
  defender.energy = 98
  for (let count = 0; count < 25; count++) {
    stepBattle(b, { b: { basic: true } })
    advance(b, 80) // Stun and natural combo reset have both expired.
  }
  assert.equal(defender.energy, 100)
  stepBattle(b, { a: { ult: true } })
  assert.equal(defender.state, 'ULT')
})
