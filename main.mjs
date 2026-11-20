import {loadConfig, validateBindings, resolveScene} from './config.mjs';
import {createInput, createClock} from './controls.mjs';
import {createBattle, stepBattle} from './combat.mjs';
import {makeAI, startStage, tickStage} from './stages.mjs';
import {createProgressStore} from './progress.mjs';
import {createUI} from './ui.mjs';
import {drawArena, recordBattleFeedback, warmMatchArt} from './art.mjs';
import {createImpactAudio} from './impact-audio.mjs';
import {replayTrainingLine} from './scene-performance.mjs';
import {impactHoldFrames} from './impact-timing.mjs';

const root = document.getElementById('app');
let config, store, profile, input, clock, battle, choice;
let phase = 'menu';
let generation = 0;
let controllers = new Map();
let resumeAt = 0;
const audio = createImpactAudio();
let holdRemaining = 0;
let pauseAfterLoading = false;
let settings = {};
const ui = createUI(root, {
  onStart: startMatch,
  onDoorPreview: () => audio.previewDoor(),
  onStopPreview: () => audio.stopPerformance(),
  onTrainingReplay: () => phase === 'playing' && replayTrainingLine(battle),
  onUpgrade: async id => applyProfile(await store.upgrade(id, profile.levels[id])),
  onSettings: async next => {
    validateBindings(next.bindings ?? config.input);
    applyProfile(await store.updateSettings(next));
  },
  onSelectCharacter: async id => {
    if (config.roster.includes(id) && profile.levels[id]) applyProfile(await store.updateSettings({selectedCharacter:id}));
  },
  onPause: pause,
  onResume: resume,
  onExit: exitMatch,
  onRetry: () => startMatch(choice),
  onRetrySave: () => phase === 'result' && settle(),
  onNext: () => {
    const next = config.stages[choice.stageId]?.unlockStage;
    if (next) return startMatch({...choice, stageId:next});
  }
});

function applyProfile(outcome) {
  profile = outcome.profile;
  settings = {...profile.settings};
  audio.setVolume(settings.volume ?? 0.65);
  audio.music.setVolume((settings.volume ?? 0.65) * (settings.musicVolume ?? config.sceneMusic?.defaultVolume ?? 0));
  try {
    validateBindings(settings.bindings ?? config.input);
  } catch {
    settings.bindings = config.input;
  }
  input?.setBindings(settings.bindings ?? config.input);
  ui.setData(config, profile, outcome.notice || '');
  return outcome;
}

function matchId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  const words = new Uint32Array(4);
  crypto.getRandomValues(words);
  return Array.from(words, w => w.toString(16).padStart(8, '0')).join('');
}

async function startMatch(request) {
  if (!request || phase === 'loading' || phase === 'settling') return;
  const serial = ++generation;
  const previousPhase = phase;
  phase = 'loading';
  pauseAfterLoading = document.hidden || document.hasFocus?.() === false;
  input?.setActive(false);
  audio.music.stop();
  audio.reset();
  audio.activate();
  try {
    const latest = await loadConfig();
    if (serial !== generation) return;
    const {mode, characterId, stageId} = request;
    const scene = resolveScene(latest, request.sceneId);
    if (!['vs_ai','pve','pvp','training'].includes(mode)) throw new Error('对战模式不可用');
    if (!latest.roster.includes(characterId)) throw new Error('请选择可出战角色');
    config = latest;
    store = createProgressStore(config);
    const saved = applyProfile(store.read());
    if (mode === 'pve' && (saved.blocked || !profile.levels[characterId] || !profile.unlockedStages.includes(stageId) || !config.stages[stageId])) {
      throw new Error(saved.notice || '该角色或关卡尚未解锁');
    }
    const actor = {
      id:'p1', team:1, characterId, x:config.spawn.playerX, y:config.spawn.playerY, facing:1,
      level:mode === 'pve' ? profile.levels[characterId] : 1
    };
    const actors = [actor];
    if (mode !== 'pve') {
      const opponentId = request.opponentId || characterId;
      if (!config.roster.includes(opponentId)) throw new Error('请选择有效对手');
      actors.push({id:'p2',team:2,characterId:opponentId,x:config.spawn.opponentX, y:config.spawn.opponentY,facing:-1,level:1});
    }
    const matchFighters = actors.map(a => a.characterId);
    if (mode === 'pve') matchFighters.push(...config.stages[stageId].waves.flat().map(enemy => enemy.characterId));
    warmMatchArt(config, scene, matchFighters);
    void audio.preparePerformance?.(scene.id, matchFighters);
    await audio.prepare(config.fighterAudio, matchFighters);
    if (serial !== generation) return;
    battle = createBattle(config, {id:matchId(), mode, actors});
    holdRemaining = 0;
    Object.defineProperty(battle, 'sceneId', {value:scene.id, enumerable:true});
    choice = {...request, sceneId:scene.id};
    controllers = new Map();
    if (mode === 'pve') startStage(battle, stageId);
    clock = createClock(config.rules.tickRate, tick);
    phase = 'playing';
    input.setActive(true);
    ui.renderBattle(battle);
    drawArena(ui.canvas, battle, settings);
    audio.music.start(config.sceneMusic?.tracks[scene.id]);
    if (pauseAfterLoading || document.hidden || document.hasFocus?.() === false) pause();
  } catch (err) {
    if (serial !== generation) return;
    phase = previousPhase;
    if (previousPhase === 'playing') {
      if (pauseAfterLoading || document.hidden || document.hasFocus?.() === false) pause();
      else input?.setActive(true);
    }
    ui.showError(err.message || '载入战斗失败');
  }
}

function tick() {
  if (phase !== 'playing') return;
  // Keep input edges queued until the first live frame. Timers, AI and damage
  // advance together; only presentation ages while the two fighters hold their poses.
  if (holdRemaining > 0) {
    holdRemaining--;
    recordBattleFeedback(battle, true);
    if (battle.result && holdRemaining === 0) void settle();
    return;
  }
  const intents = {p1:input.read('p1')};
  if (battle.mode === 'pvp') intents.p2 = input.read('p2');
  else if (battle.mode !== 'training') {
    for (const actor of battle.actors) {
      if (actor.team === 1 || actor.hp <= 0) continue;
      if (!controllers.has(actor.id)) controllers.set(actor.id, makeAI());
      intents[actor.id] = controllers.get(actor.id)(battle, actor);
    }
  }
  stepBattle(battle, intents);
  recordBattleFeedback(battle);
  if (battle.mode === 'pve') tickStage(battle);
  audio.play(battle, settings.volume ?? 0.65);
  if (battle.events.some(e => e.type === 'hit' && e.damage > 0 && ['heavy','ultimate'].includes(e.impact))) audio.music.duck();
  holdRemaining = impactHoldFrames(battle.events, battle.config.rules.impactHoldFrames);
  if (battle.result && holdRemaining === 0) void settle();
}

async function settle() {
  const announce = phase !== 'result';
  phase = 'settling';
  audio.music.stop();
  clock.reset();
  input.setActive(false);
  const serial = generation;
  const finished = battle;
  ui.renderBattle(finished);
  drawArena(ui.canvas, finished, settings);
  let receipt = {points:0, first:false};
  try {
    if (finished.mode === 'pve') {
      const settled = await store.settle({id:finished.id,mode:finished.mode,winner:finished.result.winner,stageId:choice.stageId});
      if (serial !== generation) return;
      applyProfile(settled);
      receipt = settled.receipt ?? {...receipt,notice:settled.notice};
    }
  } catch (err) {
    receipt = {...receipt,notice:err.message || '结算存档写入失败'};
  }
  if (serial !== generation) return;
  if (announce && !document.hidden && document.hasFocus?.() !== false) audio.victory(finished);
  phase = 'result';
  ui.showResult(finished, receipt);
}

function pause() {
  audio.music.pause();
  audio.reset();
  if (phase === 'loading') {
    // Keep this intent even if focus returns before the pending load completes.
    pauseAfterLoading = true;
    return;
  }
  if (phase !== 'playing' && phase !== 'countdown') return;
  if (battle?.result) {
    void settle();
    return;
  }
  phase = 'paused';
  input.setActive(false);
  clock.reset();
  ui.showPause();
}

function resume() {
  if (phase !== 'paused' || document.hidden || document.hasFocus?.() === false) return;
  audio.activate();
  phase = 'countdown';
  resumeAt = performance.now() + config.rules.resumeSeconds * 1000;
  ui.showCountdown(Math.ceil(config.rules.resumeSeconds));
}

function exitMatch() {
  generation++;
  phase = 'menu';
  audio.music.stop();
  input?.setActive(false);
  clock?.reset();
  audio.reset();
  holdRemaining = 0;
  pauseAfterLoading = false;
  battle = null;
  controllers.clear();
  ui.home();
}

function redraw(now) {
  if (phase === 'countdown') {
    const left = Math.ceil((resumeAt - now) / 1000);
    if (left > 0) ui.showCountdown(left);
    else {
      ui.showCountdown(0);
      phase = 'playing';
      audio.music.resume();
      input.setActive(true);
      clock.reset();
    }
  }
  if (phase === 'playing') {
    const ticks = clock.advance(now);
    if (phase === 'playing' && ticks > 0) {
      // Read the canvas dimensions before writing this tick's HUD changes.
      drawArena(ui.canvas, battle, settings);
      ui.renderBattle(battle);
    }
  }
  requestAnimationFrame(redraw);
}

window.addEventListener('blur', pause);
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
window.addEventListener('keydown', e => {
  if (e.code === 'Escape' && !e.repeat && ['playing','countdown','loading'].includes(phase)) {
    e.preventDefault();
    pause();
  }
});
window.addEventListener('storage', () => {
  if (store && !['playing','paused','countdown','settling'].includes(phase)) applyProfile(store.read());
});

try {
  config = await loadConfig();
  store = createProgressStore(config);
  input = createInput(config.input);
  applyProfile(store.read());
  ui.home();
  requestAnimationFrame(redraw);
} catch (err) {
  ui.showError('无法启动练习场。' + (err.message || '请检查游戏配置后重新打开'));
}
