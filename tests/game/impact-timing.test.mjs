import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {validateConfig} from '../../src/game/config.mjs';
import {impactHoldFrames} from '../../src/game/impact-timing.mjs';

const config = JSON.parse(readFileSync(new URL('../../src/game/data/game.json', import.meta.url)));
const durations = config.rules.impactHoldFrames;

test('simultaneous contact takes only the strongest hold in either attack order', () => {
  const events = [{type:'hit',impact:'medium'}, {type:'hit',impact:'heavy'}, {type:'parry',impact:'guard'}];
  assert.equal(impactHoldFrames(events, durations), durations.heavy);
  assert.equal(impactHoldFrames(events.reverse(), durations), durations.heavy);
  assert.equal(impactHoldFrames([...events, {type:'hit',impact:'ultimate'}], durations), durations.ultimate);
});

test('startup, placement and standalone KO do not hold the simulation', () => {
  const events = ['action','stop','spawn','ko'].map(type => ({type,impact:'heavy'}));
  assert.equal(impactHoldFrames(events, durations), 0);
  assert.equal(impactHoldFrames([{type:'hit',impact:'light'}], {light:0}), 0);
  assert.equal(impactHoldFrames([{type:'hit',impact:'light'}]), 0);
});

test('authored hold durations require whole non-negative frame counts for every grade', () => {
  for (const value of [-1, 1.5, null, undefined]) {
    const invalid = structuredClone(config);
    invalid.rules.impactHoldFrames.light = value;
    assert.throws(() => validateConfig(invalid), /rules\.impactHoldFrames\.light/);
  }
});
