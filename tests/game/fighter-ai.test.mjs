import assert from 'node:assert/strict'
import test from 'node:test'
import {readFile} from 'node:fs/promises'
import {loadConfig} from '../../src/game/config.mjs'
import {createBattle,stepBattle} from '../../src/game/combat.mjs'
import {makeAI} from '../../src/game/stages.mjs'
import {fighterStatus,heartbeat} from '../../src/game/fighter-status.mjs'

const config = await loadConfig(async url => ({ok:true,json:async () => JSON.parse(await readFile(url,'utf8'))}),null)
const battleOf = (id,dx=2,mode='vs_ai') => createBattle(config,{id:'ai-'+id,mode,actors:[
  {id:'p1',team:1,characterId:id,x:8,y:3,facing:1},
  {id:'p2',team:2,characterId:id,x:8+dx,y:3,facing:-1}
]})

test('every roster AI takes ordinary inputs to reach and damage a stationary opponent',()=>{
  for(const id of config.roster) {
    const b=battleOf(id,5),bot=b.actors[0],target=b.actors[1],control=makeAI()
    for(let frame=0;frame<config.rules.tickRate*18 && target.hp===target.maxHp;frame++)
      stepBattle(b,{p1:control(b,bot)})
    assert.ok(target.hp<target.maxHp,id+' must engage through the public controller')
    assert.ok(fighterStatus(b,bot)?.name, id+' must have a readable passive')
  }
})

test('the six controllers choose their signature actions from current visible conditions',()=>{
  function decide(id,dx,setup) {
    const battle=battleOf(id,dx), actor=battle.actors[0]
    setup?.(battle,actor,battle.actors[1])
    return makeAI()(battle,actor)
  }
  assert.equal(decide('melancholy',1).s2,true,'heartbeat')
  assert.equal(decide('melancholy',1,(b,a,t)=>Object.assign(t,{state:'BASIC',actionId:'melancholy.n1',age:1})).s1,true,'backstep')
  assert.equal(decide('laughing',1.8).s2,true,'leap')
  assert.equal(decide('laughing',1.5,(b,a)=>{a.mirthUntil=45}).s1,true,'empowered pulse')
  assert.equal(decide('sacred',2).s1,true,'place slow field')
  assert.equal(decide('sacred',2,(b,a)=>{a.cooldowns.s1=15}).s2,true,'cast targeted light')
  assert.equal(decide('courier',2.4).s1,true,'set route')
  assert.equal(decide('courier',1,(b,a)=>{a.cooldowns.s1=15}).s2,true,'slide')
  assert.equal(decide('nailong',4).s2,true,'feed at distance')
  assert.equal(decide('nailong',2,(b,a)=>{a.fedUntil=50}).s1,true,'use fed dash')
  assert.equal(decide('doubao',4).s1,true,'ranged bubble')
  assert.equal(decide('doubao',2).s2,true,'place delayed area')
})

test('the HUD reads only the selected owner’s beat, temporary buffs and grounded effects',()=>{
  const b=battleOf('melancholy'),actor=b.actors[0]
  const beat=b.config.passives[b.config.characters[actor.characterId].passive]
  for(const [frame,expected] of [[0,true],[4,true],[5,false],[55,false],[56,true],[60,true]]) {
    assert.equal(heartbeat(frame,beat).onBeat,expected)
    b.frame=frame
    assert.equal(fighterStatus(b,actor).active,expected)
  }
  const f=battleOf('sacred')
  f.entities.push({id:1,ownerId:'p2',kind:'field',born:0,lifetime:120})
  assert.equal(fighterStatus(f,f.actors[0]).active,false)
  assert.equal(fighterStatus(f,f.actors[1]).active,true)
  for(const [id,key] of [['laughing','mirthUntil'],['nailong','fedUntil']]){
    const duel=battleOf(id),unit=duel.actors[0]
    unit[key]=30
    assert.equal(fighterStatus(duel,unit).active,true)
    duel.frame=30
    assert.equal(fighterStatus(duel,unit).active,false)
  }
})
