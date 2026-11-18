import test from 'node:test'
import assert from 'node:assert/strict'
import {selectActionFrame} from '../../src/game/art.mjs'

// Legacy sheet support remains usable for independently authored future fighters.
const actions = [
  ['idle','A',0,[8,8,8,8,8,8],true],
  ['basic','A',2,[8,13,9,15,12,24],false],
  ['s2','B',1,[6,6,6,6,4,22],false],
  ['down','C',1,[4,4,4,4,4,16],false]
]
const animation = {actions:actions.map(([id,sheet,row,durations,loop]) =>
  ({id,sheet,row,durations,loop,columns:[0,1,2,3,4,5]}))}

test('three canceled attacks use their own two authored poses', () => {
  for (let segment=0; segment<3; segment++) {
    const actor = {state:'BASIC',age:1,duration:21,cast:{basicIndex:segment}}
    const first = selectActionFrame(animation,actor)
    assert.deepEqual(first,{sheet:'A',row:2,column:segment*2})
    actor.age = actor.duration
    assert.equal(selectActionFrame(animation,actor).column,segment*2+1)
  }
})

test('early braking switches from slide to its actual four-frame impact before recovery', () => {
  const actor = {state:'SKILL',age:16,duration:42,
    cast:{button:'s2',earlyStop:true,slideStoppedAt:16,skill:{active:4}}}
  assert.equal(selectActionFrame(animation,actor).column,2)
  actor.age=17
  assert.deepEqual(selectActionFrame(animation,actor),{sheet:'B',row:1,column:4})
  actor.age=20
  assert.equal(selectActionFrame(animation,actor).column,4)
  actor.age=21
  assert.equal(selectActionFrame(animation,actor).column,5)
})

test('idle repeats and knockdown reaches the last authored pose at its configured duration', () => {
  assert.deepEqual(selectActionFrame(animation,{state:'IDLE',age:49,duration:Infinity}),
    {sheet:'A',row:0,column:0})
  assert.deepEqual(selectActionFrame(animation,{state:'DOWN',age:36,duration:36}),
    {sheet:'C',row:1,column:5})
})

test('R1 actors show separate three-hit rows and strike on the actual simulation frame', async () => {
  const {readFile} = await import('node:fs/promises')
  const {applyFighterModule} = await import('../../src/game/config.mjs')
  const data = async name => JSON.parse(await readFile(new URL('../../src/game/data/' + name, import.meta.url)))
  const base = await data('game.json')
  const cfg = applyFighterModule(base, await data(base.fighterModule))
  for (const [id, clip] of Object.entries(cfg.animations)) {
    const fighter = cfg.characters[id]
    for (const [basicIndex, skillId] of fighter.basic.entries()) {
      const skill = cfg.skills[skillId]
      const actor = {state:'BASIC',age:1,cast:{basicIndex,skill}}
      assert.deepEqual(selectActionFrame(clip,actor),{sheet:'C',row:basicIndex,column:0})
      actor.age = skill.startup
      assert.equal(selectActionFrame(clip,actor).column,1)
      actor.age++
      assert.equal(selectActionFrame(clip,actor).column,2)
      actor.age += skill.active
      assert.equal(selectActionFrame(clip,actor).column,3)
    }
  }
  const actor = {state:'SKILL',age:17,cast:{button:'s2',slideStoppedAt:16}}
  assert.deepEqual(selectActionFrame(cfg.animations.courier,actor),{sheet:'D',row:1,column:2})
  actor.age += cfg.skills['courier.s2'].active
  assert.equal(selectActionFrame(cfg.animations.courier,actor).column,3)
})
