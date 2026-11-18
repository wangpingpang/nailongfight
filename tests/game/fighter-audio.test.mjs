import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {applyFighterModule,validateConfig} from '../../src/game/config.mjs'
import {createBattle,stepBattle} from '../../src/game/combat.mjs'
import {clipPath,createCueRouter,createFighterSampler} from '../../src/game/fighter-audio.mjs'

const read = name => JSON.parse(readFileSync(new URL('../../src/game/data/' + name, import.meta.url)))
const config = validateConfig(applyFighterModule(read('game.json'),read('fighters-v04.json')))
function duel(p1, p2, distance = 1) {
  const b = createBattle(config,{id:'test',mode:'pvp',actors:[
    {id:'P',team:1,characterId:p1,x:3,y:3,facing:1},
    {id:'Q',team:2,characterId:p2,x:3+distance,y:3,facing:-1}
  ]})
  const router = createCueRouter()
  const tick = (P = {}, Q = {}) => {
    stepBattle(b,{P,Q})
    return router.cues(b).map(e=>e.actorId + '/' + e.bank + '/' + e.cue)
  }
  return {b,router,tick}
}

test('accepted heavy startup, contact on its real frame, defender timbre, whiff and evade',()=>{
  for (const [distance, expected] of [[1,true],[10,false]]) {
    const {tick,router,b} = duel('melancholy','courier',distance)
    assert.deepEqual(tick({s2:true}),['P/melancholy/windup'])
    for(let i=1;i<18;i++) assert.deepEqual(tick(),[])
    assert.deepEqual(tick(),expected ? ['P/melancholy/skill2','Q/kangaroo/hit'] : [])
    assert.deepEqual(router.cues(b),[])
    assert.deepEqual(tick({}, {defend:true}),['Q/kangaroo/evade'])
    assert.deepEqual(tick({}, {defend:true}),[])
  }
})

test('non-damaging abilities sound at activation, only if the windup survives',()=>{
  for(const [id,button,clip] of [['nailong','s2','skill2'],['courier','s1','skill1'],['melancholy','s1','skill1'],['sacred','s1','skill1']]) {
    const {b,tick} = duel(id,'laughing',10)
    const skill = config.skills[config.characters[id][button]]
    const logs = []
    for(let i=0;i<=skill.startup;i++) logs.push(tick(i===0 ? {[button]:true} : {}))
    assert.deepEqual(logs[0],skill.startup >= 18 ? ['P/'+config.fighterAudio.banks[id]+'/windup'] : [])
    assert.deepEqual(logs.slice(1,-1).flat(),[])
    assert.deepEqual(logs.at(-1),['P/'+config.fighterAudio.banks[id]+'/'+clip])
    assert.equal(b.actors[1].hp,b.actors[1].maxHp)
  }
  const interrupted=duel('nailong','laughing')
  const logs = [interrupted.tick({s2:true},{basic:true})]
  for(let i=0;i<32;i++) logs.push(interrupted.tick())
  assert.ok(logs.flat().includes('P/dragon/hit'))
  assert.ok(!logs.flat().includes('P/dragon/skill2'))
})

test('footstep spacing per moving fighter, no steps into a wall, legacy fighter keeps its generic audio',()=>{
  const {b,tick} = duel('sacred','doubao')
  const sounded = []
  tick()
  for(let i=0;i<75;i++) if(tick({x:-1}, {x:1}).length) sounded.push(b.frame)
  assert.deepEqual(sounded,[2,17,32])
  assert.equal(b.actors[0].x,b.actors[0].hurtWidth/2)
})

test('multi-target contact plays each victim but only one attacking cue per cast, and false contacts stay silent',()=>{
  const {b,router}=duel('nailong','laughing')
  b.actors.push({...b.actors[1],id:'R',characterId:'sacred'})
  const impact={type:'hit',sourceId:'P',targetId:'Q',actionId:'nailong.n3',damage:25,castId:3}
  b.frame++; b.events=[impact,{...impact,targetId:'R'}]
  assert.deepEqual(router.cues(b).map(e=>e.cue),['basic3','hit','hit'])
  b.frame++; b.events=[{...impact,targetId:'R'}]
  assert.deepEqual(router.cues(b).map(e=>e.cue),['hit'])
  b.frame++; b.events=[{...impact,castId:4,damage:0},{type:'parry',targetId:'Q',sourceId:'P'}]
  assert.deepEqual(router.cues(b),[{actorId:'Q',bank:'laughing',cue:'block'}])
})

test('live WebAudio wiring uses the selected decoded buffer and configured gains, shares loads, releases on reset',async()=>{
  const sounds=[], gains=[], fetches=[]
  const node=()=>({connect(target){this.destination=target},disconnect(){this.destination=null}})
  const ctx={currentTime:1,state:'running',decodeAudioData:async bytes=>({path:bytes}),
    createGain(){const n={...node(),gain:{value:0}};gains.push(n);return n},
    createBufferSource(){const n={...node(),start(t){this.when=t},stop(){this.stopped=true}};sounds.push(n);return n}}
  const output=node()
  const samples=createFighterSampler(ctx,output,async path=>{
    fetches.push(path)
    if(path.endsWith('/skill2.mp3')) throw Error('bad clip')
    return path
  })
  const {b}=duel('courier','laughing')
  const settings=config.fighterAudio
  await Promise.all([samples.prepare(settings,['courier','laughing']),samples.prepare(settings,['courier','doubao'])])
  assert.equal(fetches.length,24)
  assert.equal(sounds.length,0)
  b.frame++; b.events=[{type:'hit',sourceId:'P',targetId:'Q',actionId:'courier.n2',damage:10,castId:1}]
  assert.equal(samples.play(b),true)
  assert.deepEqual(sounds.map(s=>s.buffer.path),[clipPath('kangaroo','basic2'),clipPath('laughing','hit')])
  assert.deepEqual(gains.map(g=>g.gain.value),[settings.gains.basic2,settings.gains.hit])
  assert.ok(sounds.every(s=>s.destination.destination===output))
  b.result={winner:null};samples.victory(b)
  assert.equal(sounds.length,2)
  b.result={winner:2};samples.victory(b);samples.victory(b)
  assert.equal(sounds.length,3)
  assert.equal(sounds.at(-1).buffer.path,clipPath('laughing','victory'))
  samples.reset()
  assert.ok(sounds.every(s=>s.stopped && s.destination === null))
  assert.ok(gains.every(g=>g.destination === null))
})
