import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateConfig} from '../../src/game/config.mjs';
import {createBattle, stepBattle} from '../../src/game/combat.mjs';
import {makeAI, startStage, tickStage} from '../../src/game/stages.mjs';
import {createProgressStore} from '../../src/game/progress.mjs';

const cfg = validateConfig(JSON.parse(await readFile(new URL('../../src/game/data/game.json', import.meta.url))));
function playStage(id, profile) {
  const player = {id:'p1', team:1, characterId:'shell', level:profile.levels.shell, x:cfg.spawn.playerX, y:cfg.spawn.playerY};
  const battle = createBattle(cfg, {id, mode:'pve', actors:[player]});
  startStage(battle, id);
  const hero = battle.actors[0];
  const ai = makeAI();
  for (let elapsed = 0; elapsed < cfg.rules.tickRate * 180 && !battle.result; elapsed++) {
    const foes = battle.actors.filter(a => a.team === 2 && a.hp > 0);
    const inputs = {};
    if (foes.length) {
      const distance = a => Math.hypot(a.x - hero.x, a.y - hero.y);
      const target = foes.reduce((near,a) => distance(a) < distance(near) ? a : near);
      const dx = target.x - hero.x, dy = target.y - hero.y;
      // This simulated player sends the same intents as the keyboard adapter.
      const aligned = Math.abs(dy) < 0.21;
      inputs.p1 = {
        x:aligned && Math.abs(dx) > 0.15 ? Math.sign(dx) : 0,
        y:aligned ? 0 : Math.sign(dy),
        basic:aligned && Math.abs(dx) <= 1.35,
        s1:aligned && Math.abs(dx) > 0.6 && Math.abs(dx) < 2.5 && !hero.cooldowns.s1,
        ult:aligned && Math.abs(dx) < 2.6 && hero.energy >= cfg.rules.energyMax,
        defend:hero.state === 'HIT' && hero.lockFrames > 12
      };
      for (const foe of foes) inputs[foe.id] = ai(battle,foe);
    }
    stepBattle(battle,inputs);
    tickStage(battle);
  }
  assert.equal(battle.result?.winner,1, id + ' must be winnable via ordinary inputs');
  return battle;
}

test('a fresh campaign clears all three stages using public inputs, saves and replays', async () => {
  const entries = new Map();
  const storage = {getItem:k => entries.get(k) ?? null, setItem:(k,v) => entries.set(k,v)};
  const store = createProgressStore(cfg,storage);
  let profile = store.read().profile;
  let replay;
  for (const id of ['stage_01','stage_02','stage_03']) {
    assert.ok(profile.unlockedStages.includes(id));
    const b = playStage(id,profile);
    const result = {id:b.id,mode:b.mode,winner:b.result.winner,stageId:id};
    const outcome = await store.settle(result);
    profile = outcome.profile;
    assert.equal(outcome.receipt.first,true);
    assert.equal(outcome.receipt.points,cfg.stages[id].firstReward);
    assert.equal((await store.settle(result)).profile.points,profile.points);
    if (id === 'stage_01') {
      assert.equal(profile.levels.cloud,1);
      profile = (await store.upgrade('shell',profile.levels.shell)).profile;
      assert.equal(profile.levels.shell,2);
      assert.equal(profile.points,0);
      replay = {...result,id:'fresh-repeat'};
    }
  }
  assert.deepEqual(createProgressStore(cfg,storage).read().profile,profile);
  const repeat = await store.settle(replay);
  assert.equal(repeat.receipt.points,cfg.stages.stage_01.repeatReward);
  assert.equal(repeat.receipt.first,false);
});
