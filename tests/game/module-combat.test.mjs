import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {applyFighterModule} from '../../src/game/config.mjs'
import {createBattle,addActor,stepBattle} from '../../src/game/combat.mjs'

function read(name) {
  return JSON.parse(readFileSync(new URL('../../src/game/data/' + name, import.meta.url)))
}
const config = applyFighterModule(read('game.json'), read('fighters-v04.json'))
const spec = (id,team,characterId,x) => ({id,team,characterId,x,y:3,facing:team === 1 ? 1 : -1})
const duel = (id, x = 5) => createBattle(config,{id:'module',mode:'training',actors:[
  spec('p',1,id,4),spec('e',2,'melancholy',x),
]})
const tick = (b, p = {}, e = {}) => stepBattle(b,{p,e})
function wait(b,n) { for(let i=0;i<n;i++) tick(b) }
function cast(b, slot, age) { tick(b,{[slot]:true}); wait(b,age-1) }
const near = (actual,expected) => assert.ok(Math.abs(actual-expected) < 1e-9, actual + ' != ' + expected)

test('beat locks at legal startup at both ends of the four-frame window', () => {
  for(const [frame,damage] of [[4,145],[5,120],[55,120],[56,145],[60,145]]) {
    const b=duel('melancholy')
    b.frame=frame-1
    cast(b,'s2',19)
    assert.equal(b.actors[1].hp,1000-damage)
    assert.equal(b.actors[0].energy,8)
    wait(b,3)
    assert.equal(b.actors[1].hp,1000-damage)
  }
  const b=duel('melancholy')
  b.actors[0].cooldowns.s2=10
  tick(b,{s2:true})
  wait(b,12)
  assert.equal(b.actors[0].state,'IDLE')
  cast(b,'s2',19)
  assert.equal(b.actors[1].hp,880)
})

test('forward semicircle ignores players wholly behind the fighter, backstep has no armor or damage', () => {
  const b=duel('melancholy',3)
  cast(b,'s2',22)
  assert.equal(b.actors[1].hp,1000)
  const back=duel('melancholy',12)
  cast(back,'s1',18)
  near(back.actors[0].x,3.1)
  assert.equal(back.actors[0].cooldowns.s1,403)
  assert.equal(back.actors[0].energy,0)
  const interrupted=duel('melancholy',4.3)
  tick(interrupted,{s1:true},{basic:true})
  wait(interrupted,8)
  assert.equal(interrupted.actors[0].state,'HIT')
  assert.ok(interrupted.actors[0].x > 3.1)
})

test('jump lands on frame 25, gains one stack across multiple targets, then spends the stack on startup', () => {
  const b=duel('laughing',5.8)
  addActor(b,spec('e2',2,'courier',5.85))
  const [a,target] = b.actors
  cast(b,'s2',8)
  near(a.x,4)
  wait(b,16)
  near(a.x,5.8)
  assert.equal(target.hp,1000)
  tick(b)
  assert.equal(target.hp,870)
  assert.equal(a.mirthUntil,b.frame+240)
  assert.equal(a.energy,8)
  wait(b,25)
  target.x=7.75
  tick(b,{s1:true})
  assert.equal(a.mirthUntil,0)
  assert.equal(a.cast.mirth,true)
  wait(b,14)
  assert.equal(target.hp,730)
})

test('jump is interruptible, mirth expires, and interrupting an enhanced shockwave never refunds it', () => {
  const jump=duel('laughing',4.3)
  tick(jump,{s2:true},{basic:true})
  wait(jump,8)
  assert.equal(jump.actors[0].state,'HIT')
  assert.ok(jump.actors[0].cooldowns.s2>0)
  assert.equal(jump.actors[0].mirthUntil,0)
  const b=duel('laughing',5.8)
  cast(b,'s2',25)
  wait(b,240)
  cast(b,'s1',15)
  assert.equal(b.actors[1].hp,760)
  const spend=duel('laughing')
  spend.actors[0].mirthUntil=100
  tick(spend,{s1:true},{basic:true})
  wait(spend,8)
  assert.equal(spend.actors[0].state,'HIT')
  assert.equal(spend.actors[0].mirthUntil,0)
  assert.equal(spend.actors[1].hp,1000)
})

test('field is persistent, does no damage, and slows ordinary enemy walking only inside its radius', () => {
  const b=duel('sacred',5.5)
  cast(b,'s1',19)
  const [a,e]=b.actors
  assert.equal(b.entities[0].kind,'field')
  assert.equal(e.hp,1000)
  assert.equal(a.energy,0)
  tick(b,{}, {x:1})
  near(e.x-5.5,4/60*.75)
  e.x=9
  tick(b,{}, {x:1})
  near(e.x-9,4/60)
  e.x=5.5
  tick(b,{}, {x:1,defend:true})
  near(e.x-5.5,1.2/12)
  wait(b,116)
  assert.ok(b.entities.length)
  tick(b)
  assert.equal(b.entities.length,0)
})

test('resonance checks the owner’s active field per target at impact, not at startup or against the hurtbox', () => {
  const b=duel('sacred',5.5)
  const outside=addActor(b,spec('outside',2,'melancholy',6.75))
  cast(b,'s1',40)
  tick(b,{s2:true})
  // Switch center positions after startup. Both hurtboxes overlap the actual attack.
  b.actors[1].x=6.75
  outside.x=5.5
  wait(b,42)
  assert.equal(b.actors[1].hp,850)
  assert.equal(outside.hp,820)
  assert.equal(b.actors[0].energy,8)
  const expired=duel('sacred',5.5)
  cast(expired,'s1',120)
  cast(expired,'s2',43)
  assert.equal(expired.actors[1].hp,850)
})

test('field and route can be interrupted before placement and survive a normal hit after placement', () => {
  for (const [id,frames,type] of [['sacred',19,'field'],['courier',13,'marker']]) {
    const before=duel(id,4.8)
    tick(before,{s1:true},{basic:true})
    wait(before,frames+3)
    assert.equal(before.entities.length,0)
    assert.ok(before.actors[0].cooldowns.s1>0)
    const after=duel(id,4.8)
    cast(after,'s1',frames)
    tick(after,{}, {basic:true})
    wait(after,8)
    assert.equal(after.actors[0].state,'HIT')
    assert.equal(after.entities[0].kind,type)
    after.actors[0].hp=1
    wait(after,30)
    tick(after,{}, {basic:true})
    wait(after,8)
    assert.equal(after.entities.length,0)
  }
})

test('courier consumes a forward marker on entry, travels exactly twelve frames, hits once and refunds only S1 once', () => {
  const b=duel('courier',6.4)
  addActor(b,spec('e2',2,'courier',6.5))
  cast(b,'s1',30)
  const a=b.actors[0], cd=a.cooldowns.s1
  cast(b,'s2',12)
  assert.equal(b.entities.length,0)
  assert.equal(a.cast.marked,true)
  near(a.x,4)
  wait(b,12)
  near(a.x,6.4)
  assert.equal(b.actors[1].hp,1000)
  tick(b)
  assert.equal(b.actors[1].hp,870)
  assert.equal(a.cooldowns.s1,cd-25-60)
  assert.equal(a.cooldowns.s2,600-24)
  assert.equal(a.energy,8)
  wait(b,3)
  assert.equal(b.actors[1].hp,870)
})

test('courier internal stop completes one movement frame, runs four attack frames and full recovery without refund', () => {
  const b=duel('courier',4.7)
  cast(b,'s1',30)
  const a=b.actors[0], cd=a.cooldowns.s1
  cast(b,'s2',12)
  tick(b,{s2:true,ult:true})
  near(a.x,4.2)
  assert.equal(a.cast.slideStoppedAt,13)
  assert.equal(a.duration,39)
  assert.equal(b.actors[1].hp,1000)
  tick(b)
  assert.equal(b.actors[1].hp,870)
  assert.equal(a.cooldowns.s1,cd-14)
  assert.equal(a.cooldowns.s2,600-13)
  wait(b,25)
  assert.equal(a.state,'SKILL')
  tick(b)
  assert.equal(a.state,'IDLE')
})

test('a wrong-direction or expired marker cannot activate the refund, while a consumed route remains fixed', () => {
  const back=duel('courier',12)
  cast(back,'s1',30)
  tick(back,{s2:true,x:-1})
  assert.equal(back.entities[0].kind,'marker')
  wait(back,23)
  near(back.actors[0].x,2.5)
  const late=duel('courier',6.4)
  cast(late,'s1',250)
  tick(late,{s2:true})
  assert.equal(late.actors[0].cast.marked,true)
  wait(late,24)
  near(late.actors[0].x,6.4)
  assert.equal(late.actors[1].hp,870)
  const expired=duel('courier',12)
  cast(expired,'s1',253)
  assert.equal(expired.entities.length,0)
  cast(expired,'s2',24)
  near(expired.actors[0].x,5.5)
})

test('landing and charged finishers can be interrupted, and no spent marker or ultimate energy is returned', () => {
  const b=duel('courier',4.9)
  cast(b,'s1',30)
  cast(b,'s2',6)
  tick(b,{}, {basic:true})
  wait(b,8)
  assert.equal(b.actors[0].state,'HIT')
  assert.equal(b.entities.length,0)
  assert.ok(b.actors[0].x<6.4)
  assert.ok(b.actors[0].cooldowns.s2>0)
  for (const id of config.roster) {
    const ult=duel(id,4.8)
    ult.actors[0].energy=100
    tick(ult,{ult:true},{basic:true})
    wait(ult,10)
    assert.equal(ult.actors[0].state,'HIT')
    assert.equal(ult.actors[0].energy,1)
    assert.equal(ult.actors[1].hp,1000)
  }
})

test('feed grants on frame 31, applies to ordinary walking and is spent at legal dash startup', () => {
  const b=duel('nailong',12), [a,e]=b.actors
  cast(b,'s2',30)
  assert.equal(a.fedUntil,0)
  tick(b)
  assert.equal(a.fedUntil,b.frame+480)
  assert.equal(a.energy,0)
  wait(b,17)
  const before=a.x
  tick(b,{x:1})
  near(a.x-before,4.4/60)
  e.x=a.x+1.1
  tick(b,{s1:true})
  assert.equal(a.fedUntil,0)
  assert.ok(a.cast.fed)
  wait(b,10)
  assert.equal(e.hp,840)
  assert.equal(a.energy,8)
})

test('early interruption cancels feeding, late interruption preserves it, and interrupted dash cannot get it back', () => {
  const early=duel('nailong',4.8)
  tick(early,{s2:true},{basic:true})
  wait(early,40)
  assert.equal(early.actors[0].fedUntil,0)
  const late=duel('nailong',4.8), [a]=late.actors
  cast(late,'s2',31)
  const deadline=a.fedUntil
  tick(late,{}, {basic:true})
  wait(late,8)
  assert.equal(a.state,'HIT')
  assert.equal(a.fedUntil,deadline)
  wait(late,22)
  tick(late,{s1:true},{basic:true})
  wait(late,8)
  assert.equal(a.state,'HIT')
  assert.equal(a.fedUntil,0)
  assert.ok(a.cooldowns.s1>0)
})

test('expired fullness cannot speed up motion or enhance dash; defensive movement has its normal distance', () => {
  const b=duel('nailong',12), [a]=b.actors
  cast(b,'s2',48)
  const x=a.x
  tick(b,{defend:true,x:1})
  wait(b,11)
  near(a.x-x,1.2)
  wait(b,a.fedUntil-b.frame)
  const end=a.x
  tick(b,{x:1})
  near(a.x-end,4/60)
  b.actors[1].x=a.x+1
  cast(b,'s1',11)
  assert.equal(b.actors[1].hp,870)
})

test('a bubble refunds S2 once only for a valid hit and does not collide with an invulnerable target', () => {
  const b=duel('doubao',4.6), [a,e]=b.actors
  addActor(b,spec('other',2,'courier',4.75))
  a.cooldowns.s2=300
  cast(b,'s1',13)
  assert.equal(e.hp,890)
  assert.equal(b.actors[2].hp,1000)
  assert.equal(a.cooldowns.s2,300-13-60)
  assert.equal(b.entities.length,0)
  wait(b,4)
  assert.equal(a.cooldowns.s2,300-17-60)
  const miss=duel('doubao',4.75)
  miss.actors[0].cooldowns.s2=200
  cast(miss,'s1',10)
  tick(miss,{}, {defend:true,x:-1})
  wait(miss,3)
  assert.equal(miss.actors[1].hp,1000)
  assert.equal(miss.actors[0].cooldowns.s2,186)
  assert.equal(miss.actors[0].energy,0)
  const floor=duel('doubao',4.75)
  floor.actors[0].cooldowns.s2=16
  cast(floor,'s1',13)
  assert.equal(floor.actors[0].cooldowns.s2,0)
})

test('delayed instruction keeps its locked position after its owner is interrupted, with a single burst after 36 frames', () => {
  const b=duel('doubao',5.2)
  cast(b,'s2',12)
  assert.equal(b.telegraphs.length,0)
  tick(b)
  assert.ok(b.telegraphs.some(shape=>shape.phase==='warning' && shape.kind==='circle'))
  const [a,e]=b.actors, zone=b.entities[0]
  near(zone.x,6)
  tick(b,{}, {basic:true})
  wait(b,8)
  assert.equal(a.state,'HIT')
  assert.equal(b.entities[0],zone)
  wait(b,26)
  assert.equal(e.hp,1000)
  tick(b)
  assert.equal(e.hp,870)
  assert.equal(b.entities.length,0)
  assert.equal(a.energy,9)
})

test('the six finishers use their own damage, timing and locked geometry, hit once and grant no energy', () => {
  for (const [id,damage] of Object.entries({melancholy:245,laughing:260,sacred:270,courier:250,nailong:240,doubao:250})) {
    const skill=config.skills[config.characters[id].ult], effect=skill.effect
    const b=duel(id,4+(effect.offset ?? 1)), [a,target]=b.actors
    a.energy=100
    cast(b,'ult',skill.startup)
    assert.equal(target.hp,1000,id)
    assert.equal(a.energy,0,id)
    assert.ok(b.telegraphs.some(s=>s.phase==='warning'),id)
    wait(b,skill.active)
    assert.equal(target.hp,1000-damage,id)
    assert.equal(target.energy,0,id)
    assert.equal(target.state,'DOWN',id)
    assert.equal(a.energy,0,id)
  }
})

test('v0.4 clears the old chain at the first controllable frame after stun', () => {
  const b=duel('courier')
  cast(b,'basic',9)
  const target=b.actors[1]
  assert.equal(target.comboHits,1)
  wait(b,18)
  assert.equal(target.state,'HIT')
  tick(b,{}, {x:1})
  assert.equal(target.state,'MOVE')
  assert.equal(target.comboHits,0)
  assert.equal(target.lockFrames,0)
})
