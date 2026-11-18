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

test('number row and keypad share one charge edge and hold until the last physical release in either order', () => {
  for (const saved of ['Digit2','Numpad2']) {
    for (const first of ['Digit2','Numpad2']) {
      for (const firstReleased of ['Digit2','Numpad2']) {
        const second = first === 'Digit2' ? 'Numpad2' : 'Digit2';
        const lastReleased = firstReleased === 'Digit2' ? 'Numpad2' : 'Digit2';
        const custom = structuredClone(bindings);
        custom.p1.s1 = saved;
        const target = new EventTarget();
        const input = createInput(custom, target);
        input.setActive(true);
        assert.equal(key(target,'keydown',first).defaultPrevented,true);
        const start = input.read('p1');
        assert.equal(start.s1,true);
        assert.equal(start.holdS1,true);
        assert.equal(key(target,'keydown',second).defaultPrevented,true);
        key(target,'keydown',first,{repeat:true});
        key(target,'keydown',second); // duplicate down notification
        assert.equal(input.read('p1').s1,false);
        key(target,'keyup',firstReleased);
        key(target,'keyup',firstReleased); // duplicate release cannot release the other physical key
        assert.equal(input.read('p1').holdS1,true);
        key(target,'keyup',lastReleased);
        assert.equal(input.read('p1').holdS1,false);
        key(target,'keydown',lastReleased);
        assert.equal(input.read('p1').s1,true);
        input.destroy();
      }
    }
  }
});

test('NumLock navigation legends retain keypad bindings while dedicated arrows still move independently', () => {
  const custom = structuredClone(bindings);
  custom.p1.s1 = 'Numpad2';
  custom.p2.basic = 'Digit6';
  const target = new EventTarget();
  const input = createInput(custom,target);
  input.setActive(true);
  key(target,'keydown','Numpad2',{key:'ArrowDown',location:3});
  key(target,'keydown','Numpad6',{key:'ArrowRight',location:3});
  key(target,'keydown','ArrowDown',{key:'ArrowDown',location:0});
  const one = input.read('p1');
  const two = input.read('p2');
  assert.equal(one.s1,true);
  assert.equal(two.basic,true);
  assert.equal(two.x,0);
  assert.equal(two.y,1);
  key(target,'keyup','Numpad2',{key:'2',location:3});
  assert.equal(input.read('p1').holdS1,false);
  assert.equal(input.read('p2').y,1);
  input.destroy();
});

test('reserved empty number keys leave browser input alone, and shortcut presses cannot double-fire an alias', () => {
  const custom = structuredClone(bindings);
  custom.p1.s1 = 'Digit1';
  const target = new EventTarget();
  const input = createInput(custom,target);
  input.setActive(true);
  for (const code of ['Digit6','Numpad6']) assert.equal(key(target,'keydown',code).defaultPrevented,false);
  for (const modifiers of [{ctrlKey:true},{metaKey:true},{altKey:true},{isComposing:true}]) {
    assert.equal(key(target,'keydown','Numpad1',modifiers).defaultPrevented,false);
    assert.equal(input.read('p1').s1,false);
  }
  key(target,'keydown','Digit1');
  key(target,'keydown','Numpad1',{ctrlKey:true});
  key(target,'keyup','Numpad1',{ctrlKey:true});
  const down = input.read('p1');
  assert.equal(down.s1,true);
  assert.equal(down.holdS1,true);
  key(target,'keyup','Digit1',{ctrlKey:true});
  assert.equal(input.read('p1').holdS1,false);
  input.destroy();
});

test('rebind or blur drops all number aliases and rejects conflicts without corrupting the active mapping', () => {
  const custom = structuredClone(bindings);
  custom.p1.left = 'Numpad3';
  const target = new EventTarget();
  const input = createInput(custom,target);
  input.setActive(true);
  key(target,'keydown','Numpad3');
  key(target,'keydown','Digit3');
  assert.equal(input.read('p1').x,-1);
  const conflict = structuredClone(custom);
  conflict.p2.s2 = 'Digit3';
  assert.throws(()=>input.setBindings(conflict),/input.p2.s2/);
  assert.equal(input.read('p1').x,-1);
  target.dispatchEvent(new Event('blur'));
  assert.equal(input.read('p1').x,0);
  key(target,'keydown','Digit3',{repeat:true});
  assert.equal(input.read('p1').x,0);
  key(target,'keydown','Numpad3');
  input.setBindings(bindings);
  assert.equal(input.read('p1').x,0);
  assert.equal(key(target,'keydown','Digit3').defaultPrevented,false);
  input.destroy();
});
