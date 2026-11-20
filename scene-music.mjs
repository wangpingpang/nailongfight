// The offline build has one element per track so selecting a scene only decodes that song.
async function readTrack(path) {
  const inline = globalThis.document?.getElementById('music-' + path.split('/').pop())
  if (inline) return Uint8Array.from(atob(inline.textContent), c => c.charCodeAt(0)).buffer
  const response = await fetch(new URL(path, document.baseURI))
  if (!response.ok) throw new Error('无法载入场景配乐')
  return response.arrayBuffer()
}

export const speechMix = {ratio:.55, attack:.006, release:.035}

export function createSceneMusic(getContext, readBytes = readTrack) {
  let round, source, gain, contactGain, speechGain, cache
  let speaking = false
  let startedAt = 0
  let volume = 0

  function halt() {
    if (!source) return
    round.offset += source.context.currentTime - startedAt
    if (round.offset >= source.loopEnd) {
      round.offset = source.loopStart + (round.offset - source.loopStart) % (source.loopEnd - source.loopStart)
    }
    source.stop()
    source.disconnect()
    gain.disconnect()
    contactGain.disconnect()
    speechGain.disconnect()
    source = gain = contactGain = speechGain = null
  }

  async function play() {
    const request = round
    const context = getContext()
    if (!request?.active || source || !context || !volume) return
    const track = request.track
    let entry
    try {
      if (cache?.path !== track.path || cache.context !== context) {
        cache = {path:track.path, context, buffer:readBytes(track.path).then(bytes => context.decodeAudioData(bytes))}
      }
      entry = cache
      const buffer = await entry.buffer
      if (round !== request || !round.active || source || !volume) return
      const start = track.loopStartSample / track.sampleRate
      const end = Math.min(track.loopEndSample / track.sampleRate, buffer.duration)
      if (end <= start) return
      gain = context.createGain()
      contactGain = context.createGain()
      speechGain = context.createGain()
      source = context.createBufferSource()
      gain.gain.value = volume
      contactGain.gain.value = 1
      speechGain.gain.value = speaking ? speechMix.ratio : 1
      source.buffer = buffer
      source.loop = true
      source.loopStart = start
      source.loopEnd = end
      source.connect(gain)
      gain.connect(contactGain)
      contactGain.connect(speechGain)
      speechGain.connect(context.destination)
      startedAt = context.currentTime
      source.start(0, round.offset)
    } catch {
      if (entry === cache) cache = null
      if (round === request && source) {
        try { source.disconnect(); gain.disconnect(); contactGain.disconnect(); speechGain.disconnect() }
        finally { source = gain = contactGain = speechGain = null }
      }
    }
  }

  function stop() {
    speaking = false
    halt()
    round = null
  }
  return {
    start(track) {
      stop()
      if (track) {
        round = {track, active:true, offset:0}
        void play()
      }
    },
    stop,
    pause() {
      if (!round) return
      round.active = false
      speaking = false
      halt()
    },
    resume() {
      if (!round) return
      round.active = true
      void play()
    },
    setVolume(value) {
      volume = Math.max(0, Math.min(1, value))
      if (gain) gain.gain.value = volume
      else if (volume) void play()
    },
    setSpeaking(active) {
      if (speaking === active) return
      speaking = active
      if (speechGain) speechGain.gain.setTargetAtTime(
        active ? speechMix.ratio : 1, source.context.currentTime, active ? speechMix.attack : speechMix.release)
    },
    duck(ratio = 0.5, holdSeconds = 0.06) {
      if (!source || !volume) return
      const now = source.context.currentTime
      contactGain.gain.cancelScheduledValues(now)
      contactGain.gain.setValueAtTime(ratio, now)
      contactGain.gain.setValueAtTime(ratio, now + holdSeconds)
      contactGain.gain.linearRampToValueAtTime(1, now + holdSeconds + .18)
    }
  }
}
