import { validateBindings } from './config.mjs';

/**
 * Translate physical keyboard codes into actions for two independent actors.
 * Enable the receiver only while a battle accepts input. Read each player once
 * per simulation tick. Direction and charge persist, while action edges drain.
 */
export function createInput(initialBindings, target = window) {
  let bindings;
  let assigned;
  let active = false;
  const held = new Set();
  const pressed = new Set();

  function clear() {
    held.clear();
    pressed.clear();
  }

  function setBindings(next) {
    validateBindings(next);
    bindings = {p1: {...next.p1}, p2: {...next.p2}};
    assigned = new Set([...Object.values(bindings.p1), ...Object.values(bindings.p2)]);
    clear();
  }

  function userShortcut(event) {
    return event.metaKey || event.ctrlKey || event.altKey || event.isComposing;
  }

  function keydown(event) {
    if (!active || !assigned.has(event.code) || userShortcut(event)) return;
    event.preventDefault();
    if (event.repeat || held.has(event.code)) return;
    held.add(event.code);
    pressed.add(event.code);
  }

  function keyup(event) {
    if (!active || !assigned.has(event.code)) return;
    if (!userShortcut(event)) event.preventDefault();
    held.delete(event.code);
  }

  const document = target.document;
  function visibilityChange() {
    if (document.hidden) clear();
  }

  setBindings(initialBindings);
  target.addEventListener('keydown', keydown);
  target.addEventListener('keyup', keyup);
  target.addEventListener('blur', clear);
  document?.addEventListener('visibilitychange', visibilityChange);

  return {
    read(player) {
      if (!Object.hasOwn(bindings, player)) throw new RangeError('未知的输入玩家');
      const map = bindings[player];
      return {
        x: Number(held.has(map.right)) - Number(held.has(map.left)),
        y: Number(held.has(map.down)) - Number(held.has(map.up)),
        basic: pressed.delete(map.basic),
        s1: pressed.delete(map.s1),
        s2: pressed.delete(map.s2),
        defend: pressed.delete(map.defend),
        ult: pressed.delete(map.ult),
        holdS1: held.has(map.s1),
      };
    },
    clear,
    setBindings,
    setActive(enabled) {
      if (active !== enabled) clear();
      active = enabled;
    },
    destroy() {
      active = false;
      clear();
      target.removeEventListener('keydown', keydown);
      target.removeEventListener('keyup', keyup);
      target.removeEventListener('blur', clear);
      document?.removeEventListener('visibilitychange', visibilityChange);
    },
  };
}

/**
 * Run fixed simulation ticks from monotonic requestAnimationFrame timestamps.
 * Call reset when suspending or starting a match. It is safe to reset during
 * a tick: leftover elapsed time belongs to the finished match and is dropped.
 */
export function createClock(hz, callback) {
  if (!Number.isFinite(hz) || hz <= 0) throw new RangeError('逻辑帧率必须大于零');
  let start = null;
  let completed = 0;
  return {
    advance(now) {
      if (!Number.isFinite(now)) throw new RangeError('无效的帧时间');
      if (start === null) start = now;
      // Compensate for floating-point roundoff at exact frame boundaries.
      const due = Math.floor((now - start) * hz / 1000 + 1e-8);
      let count = 0;
      while (start !== null && completed < due) {
        completed++;
        count++;
        callback();
      }
      return count;
    },
    reset() {
      start = null;
      completed = 0;
    },
  };
}
