import test from 'node:test';
import assert from 'node:assert/strict';
import {createPerformance, updatePerformance, performanceCaption} from '../../src/game/scene-performance.mjs';

function sample(sceneId) {
  return {
    sceneId, performance:createPerformance(), frame:1, events:[], actors:[],
    entities:[], config:{rules:{tickRate:60}}
  };
}

test('a live projectile defers the spotlight, and a parried cast never triggers it', () => {
  const battle = sample('lantern-stage');
  const source = {team:1,x:3};
  const cast = {seen:new Set(),skill:{kind:'skill'}};
  battle.entities = [{cast}];
  updatePerformance(battle,[{cast,source}]);
  assert.equal(battle.performance.reaction,null);
  cast.seen.add('target');
  battle.entities = [];
  updatePerformance(battle,[]);
  assert.equal(battle.performance.reaction,null);
  updatePerformance(battle,[{cast:{...cast,seen:new Set()},source}]);
  assert.equal(battle.performance.reaction.x,3);
});

test('the courier needs a fresh free approach after a blocked entry', () => {
  const battle = sample('echo-workshop');
  const courier = {id:'left',team:1,characterId:'courier',hp:1,x:0,y:0,
    facing:1,hurtWidth:1,hurtDepth:.5,state:'SKILL'};
  const opponent = {id:'right',team:2,hp:1,x:1,y:0};
  battle.actors = [courier,opponent];
  updatePerformance(battle,[]);
  courier.state = 'IDLE';
  updatePerformance(battle,[]);
  assert.equal(performanceCaption(battle),'');
  opponent.x = 3;
  updatePerformance(battle,[]);
  opponent.x = 1;
  updatePerformance(battle,[]);
  assert.match(performanceCaption(battle), /^P1 美团袋鼠/);
  courier.state = 'HIT';
  updatePerformance(battle,[]);
  assert.equal(battle.performance.dialogue.poseInterrupted,true);
  assert.match(performanceCaption(battle), /肥嘟嘟/);
});
