import assert from 'node:assert/strict'
import test from 'node:test'
import {createImpactAudio} from '../../src/game/impact-audio.mjs'

function audioFixture() {
  const sources = [], gains = [], nodes = []
  function param() {
    return {
      value:0, ramps:[],
      setValueAtTime(v,t) { this.ramps.push(['start',v,t]) },
      linearRampToValueAtTime(v,t) { this.ramps.push(['linear',v,t]) },
      exponentialRampToValueAtTime(v,t) { this.ramps.push(['exp',v,t]) }
    }
  }
  function node() {
    const n = {connected:false, connect() { this.connected = true }, disconnect() { this.connected = false }}
    nodes.push(n)
    return n
  }
  function source(kind) {
    const s = {...node(),kind,frequency:param(),stops:[],
      start(time) { this.startTime = time }, stop(time) { this.stops.push(time) }}
    sources.push(s)
    return s
  }
  const context = {
    state:'running',currentTime:0,sampleRate:48000,destination:node(),
    createGain() { const n=node(); n.gain=param(); gains.push(n); return n },
    createBuffer(channels,length) { return {getChannelData:()=>new Float32Array(length)} },
    createOscillator:()=>source('tone'),
    createBufferSource:()=>source('noise'),
    createBiquadFilter() { const n=node(); n.frequency=param(); n.Q=param(); return n }
  }
  const battle = {frame:0,events:[],actors:[{id:'p1',characterId:'hero'}],config:{
    characters:{hero:{basic:['b1','b2','b3']}},
    skills:{b1:{kind:'basic',effect:{type:'melee'}},b2:{kind:'basic',effect:{type:'melee'}},
      b3:{kind:'basic',effect:{type:'melee'}},ult:{kind:'ult',effect:{type:'circle'}},
      field:{kind:'skill',effect:{type:'field'}}}
  }}
  const audio = createImpactAudio(()=>context)
  function emit(...events) {
    battle.frame++
    battle.events=events
    const index=sources.length
    audio.play(battle)
    return sources.slice(index)
  }
  return {audio,context,sources,gains,battle,emit}
}
const hit = impact => ({type:'hit',sourceId:'p1',actionId:'b1',damage:25,impact})
const action = actionId => ({type:'action',sourceId:'p1',actionId})

test('audio is lazy and unavailable or blocked devices leave gameplay available', () => {
  const {audio,emit,sources} = audioFixture()
  emit(hit('light'))
  assert.equal(sources.length,0)
  for(const get of [()=>null,()=>{throw Error('audio disabled')},()=>({})]) {
    const unavailable=createImpactAudio(get)
    assert.doesNotThrow(()=>{unavailable.activate();unavailable.play({events:[hit('heavy')]});unavailable.reset()})
  }
  assert.doesNotThrow(()=>audio.activate())
})

test('a missed swing has only a short filtered air sound; a placement or empty impact stays silent', () => {
  const {audio,emit} = audioFixture()
  audio.activate()
  const swing=emit(action('b1'))
  assert.deepEqual(swing.map(s=>s.kind),['noise'])
  assert.ok(swing[0].stops[0]-swing[0].startTime <= .08)
  assert.equal(emit(action('field')).length,0)
  assert.equal(emit({...hit('ultimate'),damage:0}).length,0)
  assert.equal(emit({type:'ko'}).length,0)
})

test('each contact grade has a distinct tone profile and priority selects one same-tick cue', () => {
  const {audio,emit,context,battle,sources} = audioFixture()
  audio.activate()
  const signatures=[]
  for(const grade of ['light','medium','heavy','ultimate','guard']) {
    context.currentTime+=.5
    const sounding=emit(hit(grade))
    const tones=sounding.filter(s=>s.kind==='tone')
    assert.ok(tones.length>0)
    signatures.push(tones.map(s=>s.frequency.ramps[0][1]).join(','))
    for(const s of sounding)s.onended()
  }
  assert.equal(new Set(signatures).size,5)
  context.currentTime+=.5
  const voice=emit(action('b1'),hit('light'),{type:'parry'},hit('ultimate'),hit('ultimate'))
  assert.equal(voice.length,3)
  assert.equal(voice[0].frequency.ramps[0][1],262)
  const n=sources.length
  audio.play(battle)
  assert.equal(sources.length,n)
})

test('mute and reset cancel all active and future layers immediately; new matches start clean', () => {
  const {audio,emit,context,sources,gains} = audioFixture()
  audio.activate()
  emit(hit('ultimate'))
  assert.ok(sources.some(s=>s.startTime>context.currentTime))
  audio.setVolume(0)
  assert.equal(gains[0].gain.value,0)
  assert.ok(sources.every(s=>!s.connected && s.stops.at(-1) === undefined))
  assert.equal(emit(hit('light')).length,0)
  audio.setVolume(.24)
  assert.equal(gains[0].gain.value,.24)
  assert.equal(emit(hit('light')).length,2)
  audio.reset()
  assert.ok(sources.every(s=>!s.connected))
  assert.equal(emit({type:'parry'}).length,3)
})

test('bursts across fixed-step catch-up frames limit lower tiers and active polyphony', () => {
  const {audio,emit,context,sources} = audioFixture()
  audio.activate()
  emit(action('b1'))
  assert.equal(emit(hit('light')).length,2)
  assert.equal(emit(hit('light')).length,0)
  assert.equal(emit(hit('ultimate')).length,3)
  assert.equal(emit({type:'parry'}).length,0)
  for(let n=0;n<30;n++) {
    context.currentTime+=.05
    emit(hit('heavy'))
  }
  assert.ok(sources.filter(s=>s.connected).length<=9)
  audio.reset()
  assert.ok(sources.every(s=>!s.connected))
})
