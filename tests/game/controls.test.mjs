import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createClock, createInput } from '../../src/game/controls.mjs';
import { createBattle, stepBattle } from '../../src/game/combat.mjs';

const bindings = {
  p1: {left:'KeyA', right:'KeyD', up:'KeyW', down:'KeyS', basic:'KeyF', s1:'KeyG', s2:'KeyH', defend:'KeyR', ult:'KeyT'},
  p2: {left:'ArrowLeft', right:'ArrowRight', up:'ArrowUp', down:'ArrowDown', basic:'KeyJ', s1:'KeyK', s2:'KeyL', defend:'KeyO', ult:'KeyP'},
};

function key(target, type, code, options = {}) {
  const event = Object.assign(new Event(type, { cancelable: true }), {code, ...options});
  target.dispatchEvent(event);
  return event;
}

test('players can act on the same tick and each receives its own edges once', () => {
  const target = new EventTarget();
  const input = createInput(bindings, target);
  input.setActive(true);
  const press = code => key(target, 'keydown', code);
  for (const code of ['KeyW','KeyD','KeyF','ArrowLeft','KeyK']) {
    assert.equal(press(code).defaultPrevented, true);
  }
  assert.deepEqual(input.read('p2'), {
    x:-1, y:0, basic:false, s1:true, s2:false, defend:false, ult:false, holdS1:true
  });
  assert.deepEqual(input.read('p1'), {
    x:1, y:-1, basic:true, s1:false, s2:false, defend:false, ult:false, holdS1:false
  });
  key(target, 'keydown', 'KeyF', {repeat:true});
  assert.equal(input.read('p1').basic, false);
  assert.equal(input.read('p2').holdS1, true);
  key(target, 'keyup', 'KeyK');
  assert.equal(input.read('p2').holdS1, false);
  press('KeyA');
  assert.equal(input.read('p1').x, 0);
  key(target, 'keyup', 'KeyA');
  assert.equal(input.read('p1').x, 1);
  input.destroy();
});

test('inactive and destroyed listeners leave browser shortcuts alone, taps survive keyup', () => {
  const target = new EventTarget();
  target.document = Object.assign(new EventTarget(), { hidden:false });
  const input = createInput(bindings, target);
  assert.equal(key(target,'keydown','ArrowLeft').defaultPrevented, false);
  input.setActive(true);
  assert.equal(key(target,'keydown','KeyL',{ctrlKey:true}).defaultPrevented, false);
  assert.equal(key(target,'keydown','Escape').defaultPrevented, false);
  key(target,'keydown','KeyG');
  key(target,'keyup','KeyG');
  const tap = input.read('p1');
  assert.equal(tap.s1, true);
  assert.equal(tap.holdS1, false);
  key(target,'keydown','KeyD');
  key(target,'keydown','KeyP');
  target.dispatchEvent(new Event('blur'));
  assert.equal(input.read('p1').x, 0);
  assert.equal(input.read('p2').ult, false);
  key(target,'keydown','KeyD',{repeat:true});
  assert.equal(input.read('p1').x, 0);
  key(target,'keydown','KeyF');
  target.document.hidden = true;
  target.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(input.read('p1').basic, false);
  input.setActive(false);
  assert.equal(key(target,'keydown','ArrowUp').defaultPrevented, false);
  input.setActive(true);
  input.destroy();
  assert.equal(key(target,'keydown','ArrowUp').defaultPrevented, false);
});

test('rebinding checks both players atomically and drops old held input', () => {
  const target = new EventTarget();
  const input = createInput(bindings, target);
  input.setActive(true);
  const next = structuredClone(bindings);
  next.p1.basic = next.p2.basic;
  assert.throws(() => input.setBindings(next));
  key(target,'keydown','KeyF');
  assert.equal(input.read('p1').basic, true);
  key(target,'keydown','KeyW');
  next.p1.basic = 'KeyB';
  input.setBindings(next);
  next.p1.basic = 'KeyC';
  assert.equal(input.read('p1').y, 0);
  assert.equal(key(target,'keydown','KeyF').defaultPrevented, false);
  key(target,'keydown','KeyB');
  assert.equal(input.read('p1').basic, true);
  input.destroy();
});

test('30/60/120 Hz rendering each produces 7200 logic frames over two minutes', () => {
  for (const refresh of [30,60,120]) {
    let steps = 0;
    const clock = createClock(60, () => steps++);
    for (let index = 0; index <= 120 * refresh; index++) {
      clock.advance(251.3 + index * 1000 / refresh);
    }
    assert.equal(steps, 7200);
  }
});

test('diagonal fighter movement and cooldowns match across render rates', async () => {
  const configFile = new URL('../../src/game/data/game.json', import.meta.url);
  const config = JSON.parse(await readFile(configFile,'utf8'));
  const hz = config.rules.tickRate;
  for (const refresh of [30,60,120]) {
    const battle = createBattle(config, {id:'clock-test', mode:'pvp', actors:[
      {id:'p1',team:1,characterId:'shell',x:3,y:1},
      {id:'p2',team:2,characterId:'shell',x:12,y:5},
    ]});
    const actor = battle.actors[0];
    actor.cooldowns.s1 = hz;
    const clock = createClock(hz, () => stepBattle(battle, {p1:{x:1,y:1}}));
    for (let i = 0; i <= refresh / 2; i++) clock.advance(i * 1000 / refresh);
    assert.ok(Math.abs(Math.hypot(actor.x - 3, actor.y - 1) - config.characters.shell.speed / 2) < 1e-9);
    assert.equal(actor.cooldowns.s1, hz / 2);
  }
});

test('reset drops time spent paused, including when called during a slow render tick', () => {
  let steps = 0;
  const clock = createClock(60, () => {
    if (++steps === 3) clock.reset();
  });
  assert.equal(clock.advance(0), 0);
  assert.equal(clock.advance(100), 3);
  assert.equal(clock.advance(10_000), 0);
  assert.equal(clock.advance(10_050), 3);
  assert.equal(steps, 6);
});
