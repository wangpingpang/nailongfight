import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { addActor, createBattle, stepBattle } from '../../src/game/combat.mjs'
import { applyFighterModule } from '../../src/game/config.mjs'

const load = file => JSON.parse(readFileSync(new URL('../../src/game/data/' + file, import.meta.url)))
const host = load('game.json')
const module = applyFighterModule(host, load('fighters-v04.json'))
const actor = (id, team, characterId, x) => ({id, team, characterId, x, y:3, facing:team === 1 ? 1 : -1})
function duel(characterId, targetId, x = 5, cfg = module) {
  return createBattle(cfg, {id:'impacts',mode:'training',actors:[
    actor('p1',1,characterId,4), actor('p2',2,targetId,x),
  ]})
}
function advance(b, count, first = {}) {
  const impacts = []
  for (let i=0; i<count; i++) {
    stepBattle(b, i === 0 ? first : {})
    impacts.push(...b.events.filter(event=>event.impact))
  }
  return impacts
}

test('a three-segment confirmed attack emits three ascending grades with pre-knockback contact and skill identity', () => {
  const b=duel('courier','melancholy')
  const [a,t]=b.actors
  t.y=3.45
  const output=[]
  for (let i=0;i<3;i++) {
    const skill=b.config.skills['courier.n'+(i+1)]
    const prev={x:t.x,y:t.y}
    const [hit]=advance(b,skill.startup+1,{p1:{basic:true}})
    assert.ok(hit)
    assert.equal(hit.type,'hit')
    assert.equal(hit.skillId,skill.id)
    assert.equal(hit.actionId,skill.id)
    assert.equal(hit.sourceId,a.id)
    assert.equal(hit.targetId,t.id)
    assert.equal(hit.dir,1)
    assert.equal(hit.x,prev.x-t.hurtWidth/2)
    assert.equal(hit.y,prev.y-t.hurtDepth/2)
    output.push(hit.impact)
    if (i<2) advance(b,b.config.rules.cancelAfterHitFrames-1)
  }
  assert.deepEqual(output,['light','medium','heavy'])
})

test('mirroring a directional strike also mirrors its contact and direction', () => {
  const b=duel('courier','melancholy')
  const [a,t]=b.actors
  a.x=7; a.facing=-1; t.x=6
  const [hit]=advance(b,9,{p1:{basic:true}})
  assert.equal(hit.dir,-1)
  assert.equal(hit.x,6.5)
  assert.equal(hit.y,3)
})

test('regular and empowered attacks use the resolved coefficient before combo scaling or overkill', () => {
  for(const [start,expectedDamage,grade] of [[9,120,'medium'],[0,145,'heavy']]) {
    const b=duel('melancholy','courier')
    b.frame=start
    const [hit]=advance(b,19,{p1:{s2:true}})
    assert.equal(hit.impact,grade)
    assert.equal(hit.damage,expectedDamage)
  }
  const b=duel('laughing','courier')
  b.actors[1].hp=1
  b.actors[1].comboHits=4
  b.actors[0].energy=100
  const [hit]=advance(b,43,{p1:{ult:true}})
  assert.equal(hit.damage,1)
  assert.equal(hit.impact,'ultimate')
})

test('a delayed blast uses its own center to push left and right and retains the original skill after recovery', () => {
  const b=duel('doubao','courier',5.25)
  addActor(b,actor('extra',2,'courier',6.75))
  const hits=advance(b,50,{p1:{s2:true}})
  assert.equal(hits.length,2)
  assert.equal(b.actors[0].cast,null)
  const left=hits.find(e=>e.targetId==='p2'), right=hits.find(e=>e.targetId==='extra')
  for (const h of hits) {
    assert.equal(h.impact,'medium')
    assert.equal(h.skillId,'doubao.s2')
    assert.equal(h.sourceId,'p1')
    assert.equal(h.y,3)
  }
  assert.deepEqual([left.dir,left.x,right.dir,right.x],[-1,5.75,1,6.25])
})

test('a parried attack emits guard feedback at contact; only the subsequent counter creates a damage impact', () => {
  const b=duel('shell','shell',5,host)
  const [parry]=advance(b,8,{p1:{basic:true},p2:{s2:true}})
  assert.equal(parry.type,'parry')
  assert.equal(parry.impact,'guard')
  assert.equal(parry.sourceId,'p1')
  assert.equal(parry.targetId,'p2')
  assert.equal(parry.defenderId,'p2')
  assert.equal(parry.skillId,'shell.n1')
  assert.equal(parry.dir,1)
  assert.equal(parry.x,4.5)
  assert.equal(b.actors[1].hp,1000)
  const [reply]=advance(b,7)
  assert.equal(reply.type,'hit')
  assert.equal(reply.impact,'heavy')
  assert.equal(reply.sourceId,'p2')
  assert.equal(reply.targetId,'p1')
  assert.equal(reply.skillId,'shell.s2')
})

test('whiffs, evades and pure marker/field placement generate no impact', () => {
  const miss=duel('courier','doubao',13)
  assert.deepEqual(advance(miss,60,{p1:{basic:true}}),[])
  const evade=duel('courier','doubao',5)
  assert.deepEqual(advance(evade,22,{p1:{basic:true},p2:{defend:true,x:1}}),[])
  for (const id of ['courier','sacred']) {
    const b=duel(id,'doubao',5.5)
    assert.deepEqual(advance(b,80,{p1:{s1:true}}),[])
  }
})

test('projectile keeps its firing direction after the owner turns, and captures the target center before knockback', () => {
  const b=duel('doubao','courier',9)
  advance(b,13,{p1:{s1:true}})
  advance(b,19)
  stepBattle(b,{p1:{x:-1}})
  assert.equal(b.actors[0].facing,-1)
  const before={x:b.actors[1].x,y:b.actors[1].y}
  const [hit]=advance(b,40)
  assert.equal(hit.dir,1)
  assert.equal(hit.skillId,'doubao.s1')
  assert.equal(hit.impact,'medium')
  assert.equal(hit.targetX,before.x)
  assert.equal(hit.targetY,before.y)
  assert.ok(b.actors[1].x>hit.targetX)
})

test('same-frame attacks anchor at a common snapshot even when earlier impacts have already pushed the target', () => {
  const b=duel('courier','melancholy')
  addActor(b,actor('partner',1,'courier',4))
  const hits=advance(b,9,{p1:{basic:true},partner:{basic:true}})
  assert.equal(hits.length,2)
  assert.ok(hits.every(hit=>hit.targetX===5 && hit.targetY===3 && hit.x===4.5))
  assert.ok(b.actors[1].x>5)
})

test('an area that covers its own buff zone grants heavy impact only to the target in the zone', () => {
  const b=duel('sacred','courier',5.6)
  addActor(b,actor('outside',2,'courier',6.75))
  advance(b,40,{p1:{s1:true}})
  const hits=advance(b,43,{p1:{s2:true}})
  assert.equal(hits.length,2)
  assert.equal(hits.find(e=>e.targetId==='p2').impact,'heavy')
  assert.equal(hits.find(e=>e.targetId==='outside').impact,'medium')
})
