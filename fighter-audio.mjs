// Role-specific sound is driven by simulation events. Audio nodes never affect battle state.
export function clipPath(bank, cue) {
  return './assets/audio/' + bank + '/' + cue + '.mp3'
}

function actionCue(character, id) {
  if (!character || !id) return null
  const index = character.basic.indexOf(id)
  if (index >= 0) return 'basic' + (index + 1)
  return id === character.s1 ? 'skill1' : id === character.s2 ? 'skill2' : id === character.ult ? 'ult' : null
}

export function createCueRouter() {
  let round, lastFrame
  const feet = new Map()
  const confirmed = new Set()
  function reset() {
    round = undefined
    lastFrame = undefined
    feet.clear()
    confirmed.clear()
  }
  function cues(battle) {
    if (round !== battle) { reset(); round = battle }
    if (lastFrame === battle.frame) return []
    lastFrame = battle.frame
    const {characters, skills, fighterAudio} = battle.config
    const actors = new Map(battle.actors.map(a => [a.id, a]))
    const selected = new Map()
    function add(actor, cue) {
      const bank = fighterAudio?.banks[actor?.characterId]
      if (bank && cue) selected.set(actor.id + '/' + cue, {actorId:actor.id, bank, cue})
    }
    for (const event of battle.events) {
      const actor = actors.get(event.sourceId)
      const target = actors.get(event.defenderId ?? event.targetId)
      const slot = actionCue(characters[actor?.characterId], event.actionId)
      if (event.type === 'evade') add(actor, 'evade')
      else if (event.type === 'action') {
        const skill = skills[event.actionId]
        if (skill?.kind === 'ult' || (skill?.kind === 'skill' && skill.startup >= fighterAudio.heavyStartup))
          add(actor, 'windup')
      } else if (event.type === 'activate') add(actor, slot)
      else if (event.type === 'parry' || event.type === 'guard' || (event.type === 'hit' && event.impact === 'guard')) {
        add(target, 'block')
      } else if (event.type === 'hit' && event.damage > 0) {
        if (event.castId == null || !confirmed.has(event.castId)) {
          add(actor, slot)
          if (event.castId != null) confirmed.add(event.castId)
        }
        add(target, 'hit')
      }
    }
    for (const actor of battle.actors) {
      if (!fighterAudio.banks[actor.characterId]) continue
      const previous = feet.get(actor.id)
      const walking = actor.state === 'MOVE' && previous && (actor.x !== previous.x || actor.y !== previous.y)
      let next = previous?.next ?? 0
      if (walking && battle.frame >= next && !battle.result) {
        add(actor, 'move')
        next = battle.frame + fighterAudio.stepFrames
      }
      feet.set(actor.id,{x:actor.x,y:actor.y,next})
    }
    return [...selected.values()]
  }
  return {cues,reset}
}

export async function readAudioBytes(path) {
  const inline = globalThis.document?.getElementById('inline-fighter-audio')
  if (inline) {
    inline.audioClips ??= JSON.parse(inline.textContent)
    const contents = inline.audioClips[path]
    if (!contents) throw Error('Missing embedded clip')
    return Uint8Array.from(atob(contents), char => char.charCodeAt(0)).buffer
  }
  const result = await fetch(new URL(path, globalThis.document.baseURI), {signal:globalThis.AbortSignal?.timeout?.(2500)})
  if (!result.ok) throw Error('Missing audio clip')
  return result.arrayBuffer()
}

export function createFighterSampler(context, output, readBytes = readAudioBytes) {
  const pending = new Map()
  const buffers = new Map()
  const voices = new Set()
  const router = createCueRouter()
  let settings, celebrated
  function stop(voice) {
    voice.source.onended = null
    try { voice.source.stop() } catch { /* Already finished. */ }
    voice.source.disconnect()
    voice.gain.disconnect()
    voices.delete(voice)
  }
  function reset() {
    for (const voice of voices) stop(voice)
    router.reset()
    celebrated = undefined
  }
  async function prepare(options, fighterIds) {
    settings = options
    if (!settings || !context.decodeAudioData) return
    const loads = []
    for (const bank of new Set(fighterIds.map(id => settings.banks[id]).filter(Boolean))) {
      for (const cue of Object.keys(settings.gains)) {
        const path = clipPath(bank, cue)
        if (buffers.has(path)) continue
        if (!pending.has(path)) {
          const loading = Promise.resolve().then(() => readBytes(path)).then(bytes => context.decodeAudioData(bytes))
            .then(buffer => buffers.set(path,buffer)).catch(() => {}).finally(() => pending.delete(path))
          pending.set(path,loading)
        }
        loads.push(pending.get(path))
      }
    }
    if (!loads.length) return
    // A stalled decoder may finish in the background. Only later gameplay events can use its result.
    let timeout
    try {
      await Promise.race([Promise.all(loads), new Promise(resolve => { timeout = setTimeout(resolve, 1500) })])
    } finally { clearTimeout(timeout) }
  }
  function sound(entry, delay = 0) {
    const {bank,cue,actorId} = entry
    const buffer = buffers.get(clipPath(bank,cue))
    if (!buffer || context.state !== 'running') return false
    const level = settings.gains[cue]
    // A new take of one actor's cue replaces its tail, also on fixed-step catch-up frames.
    for (const voice of voices) if (voice.actorId === actorId && voice.cue === cue) stop(voice)
    if (voices.size >= 8) {
      let quietest = null
      for (const voice of voices) if (!quietest || voice.level < quietest.level) quietest = voice
      if (quietest.level > level) return false
      stop(quietest)
    }
    const source = context.createBufferSource(), gain = context.createGain()
    const voice = {source,gain,cue,actorId,level}
    try {
      source.buffer = buffer
      gain.gain.value = level
      source.connect(gain)
      gain.connect(output)
      source.onended = () => { source.disconnect(); gain.disconnect(); voices.delete(voice) }
      voices.add(voice)
      source.start(context.currentTime + delay)
      return true
    } catch { stop(voice); return false }
  }
  function play(battle) {
    if (!settings) return false
    let personalContact = false
    for (const cue of router.cues(battle)) {
      if (sound(cue) && ['basic1','basic2','basic3','skill1','skill2','ult','hit','block'].includes(cue.cue))
        personalContact = true
    }
    return personalContact
  }
  function victory(battle) {
    if (!settings || !battle?.result?.winner || celebrated === battle) return
    celebrated = battle
    const winner = battle.actors.find(a => a.hp > 0 && a.team === battle.result.winner && settings.banks[a.characterId])
    if (winner) sound({bank:settings.banks[winner.characterId],actorId:winner.id,cue:'victory'}, .12)
  }
  return {prepare,play,victory,reset}
}
