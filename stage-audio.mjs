import {clipPath, currentStory, doorCue, stageScores} from './performance-score.mjs';
import {readAudioBytes} from './fighter-audio.mjs';

// One background bus. Confirmed hits briefly duck all scenery, while dialogue
// remains readable in the subtitle strip independent of audio availability.
export function createStageAudio(context, master, read = readAudioBytes, onSpeech = () => {}) {
  const bus = context.createGain();
  bus.connect(master);
  const loaded = new Map(), loading = new Map(), voices = new Map();
  let generation = 0, previousRound, lastLine, lastFrame = -1, lastReaction;
  function load(cue) {
    if (loaded.has(cue)) return Promise.resolve(loaded.get(cue));
    if (!loading.has(cue)) loading.set(cue, Promise.resolve()
      .then(() => read(clipPath(cue))).then(bytes => context.decodeAudioData(bytes))
      .then(buffer => { loaded.set(cue,buffer); return buffer; })
      .catch(() => null).finally(() => loading.delete(cue)));
    return loading.get(cue);
  }
  function prepare(scene, fighters) {
    const score = stageScores[scene];
    const names = new Set([...(score?.intro ?? []), ...(score?.beats ?? [])].map(beat => beat.cue));
    if (fighters.includes('courier')) names.add(doorCue);
    return Promise.all([...names].map(load));
  }
  const wanted = new Map();
  let speaking = false;
  function updateSpeech() {
    const active = voices.has('voice') || voices.has('courier');
    if (active === speaking) return;
    speaking = active;
    onSpeech(active);
  }
  function stop(group, notify = true) {
    wanted.delete(group);
    const voice = voices.get(group);
    if (!voice) return;
    voices.delete(group);
    voice.source.onended = null;
    try {voice.source.stop();} catch { /* Already ended. */ }
    voice.nodes.forEach(n => n.disconnect());
    if (notify) updateSpeech();
  }
  function reset() {
    generation++;
    wanted.clear();
    for (const group of [...voices.keys()]) stop(group);
  }
  function start(cue, group, level, pan = 0, deadline = lastFrame + 12) {
    if (!loaded.has(cue)) {
      const token = {};
      wanted.set(group,token);
      void load(cue).then(buffer => {
        if (buffer && wanted.get(group) === token && lastFrame <= deadline) {
          start(cue,group,level,pan,deadline);
        }
      });
      return;
    }
    const buffer = loaded.get(cue);
    if (!buffer || context.state !== 'running') return;
    if (group === 'voice' && voices.has('courier')) return;
    if (group === 'courier') stop('voice', false);
    stop(group, false);
    const source = context.createBufferSource(), gain = context.createGain();
    const nodes = [source,gain];
    source.buffer = buffer;
    gain.gain.value = level;
    source.connect(gain);
    if (pan && context.createStereoPanner) {
      const stereo=context.createStereoPanner(); stereo.pan.value=pan;
      gain.connect(stereo); stereo.connect(bus); nodes.push(stereo);
    } else gain.connect(bus);
    source.onended = () => {
      if (voices.get(group)?.source !== source) return;
      voices.delete(group);
      nodes.forEach(n => n.disconnect());
      updateSpeech();
    };
    try {
      source.start();
      voices.set(group, {source,nodes});
    } catch {
      nodes.forEach(n => n.disconnect());
    }
    updateSpeech();
  }
  async function preview() {
    const request = ++generation;
    stop('courier');
    await load(doorCue);
    if (request === generation) start(doorCue,'courier',.68);
  }
  function play(battle) {
    if (!battle.performance) return;
    const {dialogue, reaction} = battle.performance;
    if (battle !== previousRound) { reset(); lastFrame=-1; lastLine=null; lastReaction=null; previousRound=battle; }
    if (lastFrame === battle.frame) return;
    lastFrame = battle.frame;
    if (battle.result) { reset(); return; }
    if (reaction !== lastReaction || reaction?.interrupted) {
      stop('voice'); stop('prop');
      lastReaction=reaction;
    }
    if (dialogue?.poseInterrupted) stop('courier');
    if (dialogue && lastLine !== dialogue) {
      lastLine=dialogue;
      if (!dialogue.poseInterrupted && battle.frame-dialogue.frame <= 1) {
        stop('voice'); start(doorCue,'courier',.68);
      }
    }
    const contact = battle.events.some(e => ['hit','parry','guard'].includes(e.type));
    if (contact) {
      const now=context.currentTime;
      bus.gain.cancelScheduledValues?.(now); bus.gain.setValueAtTime(.26,now);
      bus.gain.linearRampToValueAtTime(1,now+.18);
    }
    const story = currentStory(battle);
    if (!story) return;
    for (const beat of story.beats) if (beat.at === story.age) {
      const group = beat.caption ? 'voice' : 'prop';
      if (group === 'voice' && voices.has('courier')) continue;
      start(beat.cue,group,beat.gain,beat.pan);
    }
  }
  return {prepare,preview,reset,play};
}
