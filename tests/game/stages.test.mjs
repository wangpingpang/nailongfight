import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createBattle, stepBattle} from '../../src/game/combat.mjs'
import {makeAI, startStage, tickStage} from '../../src/game/stages.mjs'

const config = JSON.parse(await readFile(new URL('../../src/game/data/game.json', import.meta.url)))
const player = {id:'p1', team:1, characterId:'shell', x:3.2, y:3, facing:1}
function advance(battle,n) {
  for (let i=0;i<n && !battle.result;i++) { stepBattle(battle); tickStage(battle) }
}
function enemies(battle) {return battle.actors.filter(a=>a.team===2 && a.hp>0)}
function advanceUntil(battle,condition) {
  for (let i=0;i<=config.spawn.waveDelay+config.spawn.warningFrames;i++) {
    if (condition()) return
    advance(battle,1)
  }
  assert.fail('wave event did not occur within its configured timing')
}
test('three configured stages spawn all waves and preserve resources between them', () => {
  for(const [id,cfg] of Object.entries(config.stages)){
    const b=createBattle(config,{mode:'pve', actors:[player]})
    startStage(b,id)
    for (const [index,descriptions] of cfg.waves.entries()) {
      advanceUntil(b,()=>b.stage.warnings.length)
      const warnedAt=b.frame
      advanceUntil(b,()=>enemies(b).length)
      assert.ok(b.frame-warnedAt >= config.spawn.warningFrames)
      assert.deepEqual(enemies(b).map(e=>[e.characterId,e.hp]),descriptions.map(e=>[e.characterId,e.hp]))
      if (index>0) { assert.equal(b.actors[0].hp,600);assert.equal(b.actors[0].energy,20) }
      Object.assign(b.actors[0],{hp:600,energy:20})
      enemies(b).forEach(a=>Object.assign(a,{hp:0,state:'DEAD'}))
      advance(b,1)
    }
    assert.equal(b.result.winner,1)
  }
})
test('spawn warning is renewed at a safe point if the player occupies its location', () => {
  const b=createBattle(config,{mode:'pve',actors:[player]})
  startStage(b,'stage_01')
  advanceUntil(b,()=>b.stage.warnings.length)
  const old={...b.stage.warnings[0]}
  Object.assign(b.actors[0],{x:old.x,y:old.y})
  advance(b,config.spawn.warningFrames)
  assert.equal(enemies(b).length,0)
  assert.ok(b.stage.warnings.length)
  assert.ok(Math.hypot(b.stage.warnings[0].x-old.x,b.stage.warnings[0].y-old.y)>=config.spawn.minDistance)
  advance(b,config.spawn.warningFrames)
  assert.equal(enemies(b).length,1)
})
test('player death takes precedence over stage completion',()=>{
  const b=createBattle(config,{mode:'pve',actors:[player]})
  startStage(b,'stage_03')
  advanceUntil(b,()=>enemies(b).length)
  for(const a of b.actors) Object.assign(a,{hp:0,state:'DEAD'})
  advance(b,1)
  assert.equal(b.result.winner,2)
})
test('AI commands use observed state only; ordinary enemies do not defend or use special moves',()=>{
  const opponent={id:'r',team:2,characterId:'melee',x:4,y:3,facing:-1}
  const b=createBattle(config,{mode:'pve',actors:[player,opponent]})
  const ai=makeAI()
  const bot=b.actors[1]
  const position=[bot.x,bot.y,bot.hp]
  const cmd=ai(b,bot)
  assert.equal(cmd.basic,true)
  assert.deepEqual([bot.x,bot.y,bot.hp],position)
  b.frame+=config.ai.interval
  Object.assign(bot,{state:'HIT',lockFrames:90})
  assert.equal(Boolean(ai(b,bot).defend),false)
})

test('legal input controls clear every wave and boss without writing actor state', () => {
  for (const stageId of Object.keys(config.stages)) {
    const b=createBattle(config,{id:stageId, mode:'pve',actors:[player]})
    startStage(b,stageId)
    const controller=makeAI()
    for(let i=0;i<config.rules.duelLimit && !b.result;i++) {
      const intents=Object.fromEntries(b.actors.map(a=>[a.id,controller(b,a)]))
      stepBattle(b,intents)
      tickStage(b)
    }
    assert.deepEqual(b.result,{winner:1,reason:'clear'},stageId)
    assert.equal(b.stage.wave,b.stage.total)
  }
})

test('the same input API exercises victory, defeat and double KO in CPU duels', () => {
  const {playerX,playerY,opponentX,opponentY} = config.spawn
  const outcomes = new Set()
  for (const [a,b] of [['shell','cloud'],['cloud','shell'],['shell','shell']]) {
    const battle = createBattle(config,{mode:'vs_ai',actors:[
      {id:'p1',team:1,characterId:a,x:playerX,y:playerY},
      {id:'p2',team:2,characterId:b,x:opponentX,y:opponentY}
    ]})
    const control = makeAI()
    for (let frame=0; frame<config.rules.duelLimit && !battle.result; frame++) {
      stepBattle(battle,Object.fromEntries(battle.actors.map(actor=>[actor.id,control(battle,actor)])))
    }
    outcomes.add(battle.result.winner)
    assert.equal(battle.result.reason,'ko')
  }
  assert.deepEqual(outcomes,new Set([1,2,null]))
})
