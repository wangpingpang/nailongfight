import {createFighterSampler} from './fighter-audio.mjs'

// Original synthesized cues. Frequencies are in Hz; envelopes and offsets are in seconds.
const tone = (wave, from, to, duration, peak, offset = 0) => ({wave,from,to,duration,peak,offset})
const grain = (from, to, duration, peak, rise = .002) => ({wave:'noise',from,to,duration,peak,rise,offset:0})

const cues = {
  swing: [grain(750, 2400, .065, .045, .018)],
  light: [tone('triangle', 330, 108, .062, .135), grain(2600, 1250, .032, .12)],
  medium: [tone('triangle', 225, 78, .086, .18), grain(2900, 760, .053, .15)],
  guard: [tone('sine', 1080, 950, .102, .095), tone('sine', 1625, 1510, .064, .048), grain(3300, 1900, .028, .095)],
  heavy: [tone('sine', 160, 48, .145, .26), tone('triangle', 380, 116, .065, .095), grain(3300, 600, .080, .19)],
  ultimate: [tone('triangle', 262, 68, .102, .18), tone('sine', 110, 42, .22, .25, .023), grain(3950, 470, .146, .21)]
}
const priority = {swing:0,light:1,medium:2,guard:3,heavy:4,ultimate:5}
const maxVoices = 3
const minContactInterval = .038

function cueFor(battle, event) {
  if (event.type === 'parry' || event.type === 'guard') return 'guard'
  if (event.type === 'hit' && event.impact === 'guard') return 'guard'
  const skill = battle.config.skills[event.actionId]
  if (event.type === 'action') {
    // Air alone belongs to a legal melee swing; actions never produce a contact cue.
    return skill?.kind === 'basic' && skill.effect?.type === 'melee' ? 'swing' : null
  }
  if (event.type !== 'hit' || !(event.damage > 0)) return null
  if (event.impact && Object.hasOwn(priority,event.impact) && event.impact !== 'swing') return event.impact
  if (skill?.kind === 'ult') return 'ultimate'
  if (skill?.kind === 'skill') return 'heavy'
  const attacker = battle.actors.find(actor => actor.id === event.sourceId)
  const chain = battle.config.characters[attacker?.characterId]?.basic
  return chain?.length > 1 && chain.at(-1) === event.actionId ? 'medium' : 'light'
}

function noiseBuffer(context) {
  const samples = context.createBuffer(1, Math.ceil(context.sampleRate * .24), context.sampleRate)
  const data = samples.getChannelData(0)
  // A repeatable audio-only sequence never consumes simulation randomness.
  let seed = 0x41a37ac
  for (let i=0; i<data.length; i++) {
    seed ^= seed << 13
    seed ^= seed >>> 17
    seed ^= seed << 5
    data[i] = (seed >>> 0) / 0x80000000 - 1
  }
  return samples
}

/**
 * Create a lazy synthesizer. Call activate() from a user gesture, play() once for
 * each committed battle tick, and reset() on pause, exit or a new match.
 * The context factory allows tests to inspect scheduling without an audio device.
 */
export function createImpactAudio(makeContext = () => {
  const Audio = globalThis.AudioContext || globalThis.webkitAudioContext
  return Audio ? new Audio() : null
}) {
  let context, master, noise, fighters
  let volume = .65, lastTime = -Infinity, lastPriority = -1, lastBattle, lastFrame
  const voices = new Set()

  function activate() {
    try {
      if (!context || context.state === 'closed') {
        const next = makeContext()
        if (!next) return
        const gain = next.createGain()
        gain.gain.value = volume
        gain.connect(next.destination)
        const buffer = noiseBuffer(next)
        context = next
        master = gain
        noise = buffer
        fighters = createFighterSampler(context, master)
      }
      if (context.state !== 'running') context.resume()?.catch(() => {})
    } catch { /* Audio availability never gates game startup. */ }
  }

  function silence(voice) {
    for (const part of voice.parts) {
      part.source.onended = null
      try { part.source.stop() } catch { /* Already ended. */ }
      for (const node of part.nodes) node.disconnect()
    }
    voice.parts.clear()
    voices.delete(voice)
  }

  function reset() {
    fighters?.reset()
    for (const voice of voices) silence(voice)
    lastTime = -Infinity
    lastPriority = -1
    lastBattle = undefined
    lastFrame = undefined
  }

  function setVolume(value) {
    if (!Number.isFinite(value)) return
    const next = Math.max(0,Math.min(1,value))
    if (next === volume) return
    volume = next
    if (master) master.gain.value = volume
    if (!volume) reset()
  }

  function startLayer(voice, layer, now, blend) {
    const start = now + layer.offset
    const end = start + layer.duration
    const isNoise = layer.wave === 'noise'
    const source = isNoise ? context.createBufferSource() : context.createOscillator()
    const envelope = context.createGain()
    const nodes = [source,envelope]
    let pitch
    if (isNoise) {
      source.buffer = noise
      const band = context.createBiquadFilter()
      band.type = 'bandpass'
      band.Q.value = .75
      pitch = band.frequency
      source.connect(band)
      band.connect(envelope)
      nodes.push(band)
    } else {
      source.type = layer.wave
      pitch = source.frequency
      source.connect(envelope)
    }
    pitch.setValueAtTime(layer.from,start)
    pitch.exponentialRampToValueAtTime(layer.to,end)
    envelope.gain.setValueAtTime(0,start)
    envelope.gain.linearRampToValueAtTime(layer.peak * blend,start+(layer.rise ?? .002))
    envelope.gain.exponentialRampToValueAtTime(.0001,end)
    envelope.connect(master)
    const part = {source,nodes}
    voice.parts.add(part)
    source.onended = () => {
      for (const node of nodes) node.disconnect()
      voice.parts.delete(part)
      if (!voice.parts.size) voices.delete(voice)
    }
    source.start(start)
    source.stop(end)
  }

  function play(battle, requestedVolume = volume) {
    setVolume(requestedVolume)
    if (!volume || context?.state !== 'running' || !battle || !battle.events) return
    if (lastBattle === battle && lastFrame === battle.frame) return
    lastBattle = battle
    lastFrame = battle.frame

    const personalContact = fighters?.play(battle)
    let cue = null
    for (const event of battle.events) {
      const kind = cueFor(battle,event)
      if (kind && (cue === null || priority[kind] > priority[cue])) cue = kind
    }
    if (!cue) return
    const now = context.currentTime
    if (now-lastTime < minContactInterval && priority[cue] <= lastPriority) return
    if (voices.size >= maxVoices) {
      let quietest
      for (const voice of voices) if (!quietest || voice.priority < quietest.priority) quietest = voice
      if (quietest.priority > priority[cue]) return
      silence(quietest)
    }
    const voice = {priority:priority[cue],parts:new Set()}
    voices.add(voice)
    try {
      for (const layer of cues[cue]) startLayer(voice,layer,now,personalContact ? .43 : 1)
      lastPriority = voice.priority
      lastTime = now
    } catch { silence(voice) }
  }

  function victory(battle) {
    if (volume && context?.state === 'running') fighters?.victory(battle)
  }

  return {activate,play,setVolume,reset,victory,prepare:(options, ids) => fighters?.prepare(options, ids)}
}
