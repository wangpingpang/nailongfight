import {test} from 'node:test';
import assert from 'node:assert/strict';
import {drawArena, recordBattleFeedback} from '../../src/game/art.mjs';

class Picture {
  complete = true;
  naturalWidth = 1152;
  naturalHeight = 768;
}
globalThis.Image = Picture;

// Capture draw commands without adding a native canvas/browser dependency to unit tests.
function paint(battle, settings={}) {
  const ops=[];
  const ctx=new Proxy({}, {
    get(_, name) {
      if (name==='measureText') return () => ({width:18});
      return (...args) => ops.push([name,...args]);
    },
    set(_, name, value) { ops.push([name,value]); return true; }
  });
  drawArena({width:1000,height:410,getContext:()=>ctx},battle,settings);
  return ops;
}
function fixture(tier='heavy', dir=1, sheet=false) {
  const p2={id:'p2',characterId:'defender',team:2, facing:-dir,
    x:8+dir, y:3, hp:500, maxHp:800, age:0, duration:18,state:'HIT'};
  const actions=[{id:'hit',sheet:'B',row:3,columns:[0,1],durations:[3,3]}];
  const cfg={rules:{arenaWidth:16,arenaDepth:6},scenes:{yard:{asset:'yard'}},defaultScene:'yard',
    assets:{yard:{path:'yard'},body:{path:'body'},atlas:{path:'atlas'}},
    characters:{defender:{asset:'body',animation:sheet?'defender':undefined}},
    animations: {defender:{actions,columns:6,rows:4,sheets:{A:'atlas',B:'atlas'}}}};
  const event={type:tier==='guard'?'parry':'hit',impact:tier,dir,
    sourceId:'p1', targetId:'p2',x:8-dir*.5,y:3,targetX:8,targetY:3,damage:82};
  return {config:cfg,mode:'training',frame:10,events:[event],actors:[p2],entities:[],telegraphs:[]};
}
const marks = (ops, label) => ops.filter(([name,text])=>name==='fillText' && text===label);
const zoom = ops => ops.find(([op,x,y]) => op==='scale' && x===y && x>1)?.[1] ?? 1;

test('capture spans skipped renders, repeated draws and held ticks without replaying an impact',()=>{
  const battle=fixture();
  recordBattleFeedback(battle);
  recordBattleFeedback(battle);
  battle.frame++;
  battle.events=[];
  recordBattleFeedback(battle);
  const first=paint(battle);
  assert.equal(marks(first,'−82').length,1);
  assert.deepEqual(first,paint(battle));
  recordBattleFeedback(battle,true);
  assert.ok(zoom(paint(battle))<zoom(first));
  for(let i=0;i<35;i++) recordBattleFeedback(battle,true);
  assert.equal(marks(paint(battle),'−82').length,0);
  assert.equal(battle.frame,11);
});

test('heavy contacts kick the camera and both asset types; mirroring reverses recoil',()=>{
  for(const sheet of [false,true]) for(const dir of [-1,1]) {
    const b=fixture('heavy',dir,sheet), ops=paint(b);
    assert.ok(ops.some(([op,a])=>op==='rotate' && dir*a>.18));
    assert.ok(ops.some(([op,filter])=>op==='filter' && filter.includes('brightness')));
    assert.ok(zoom(ops)>zoom(paint(fixture('light',dir,sheet))));
    assert.ok(zoom(ops)<1.04);
    // The rendered ground ring starts on the pre-knockback target and converges
    // to the post-hit center while the game clock is held.
    const ring=records=>records.find(([op])=>op==='ellipse');
    const initial=ring(ops);
    for(let t=0;t<6;t++) recordBattleFeedback(b,true);
    const later=ring(paint(b));
    assert.equal(initial[1],500);
    assert.ok((later[1]-initial[1])*dir>50);
  }
});

test('reduced effects keep the result legible, suppress impulse and flash, and separate parry from damage',()=>{
  const b=fixture('guard');
  const normal=paint(b);
  assert.equal(marks(normal,'招架').length,1);
  assert.equal(marks(normal,'−82').length,0);
  const reduced=paint(fixture('ultimate'),{reduceEffects:true});
  assert.equal(zoom(reduced),1);
  assert.equal(marks(reduced,'−82').length,1);
  assert.equal(reduced.some(([op])=>op==='filter'),false);
});
