import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {resolveScene, validateConfig} from '../../src/game/config.mjs'
import {drawArena} from '../../src/game/art.mjs'

const sourceFile=new URL('../../src/game/data/game.json',import.meta.url)
const config=JSON.parse(await readFile(sourceFile))
const scenes=['echo-workshop','lantern-stage','melon-market','bamboo-hall','rain-tram']

test('all five module backgrounds resolve with stable IDs to local WebP assets', async () => {
  assert.deepEqual(Object.keys(config.scenes),scenes)
  assert.equal(resolveScene(config).id,'echo-workshop')
  assert.throws(()=>resolveScene(config,'missing'),/sceneId/)
  for (const id of scenes) {
    const scene=resolveScene(config,id)
    const path=config.assets[scene.asset].path
    assert.equal(path,'./assets/scenes/'+id+'.webp')
    const image=await readFile(new URL('../'+path,sourceFile))
    assert.equal(image.toString('ascii',8,12),'WEBP')
  }
})

test('missing scene references fail validation before the game starts', () => {
  const noBackground=structuredClone(config)
  noBackground.scenes['rain-tram'].asset='unknown'
  assert.throws(()=>validateConfig(noBackground),/scenes.rain-tram.asset/)
  const noDefault=structuredClone(config)
  noDefault.defaultScene='unknown'
  assert.throws(()=>validateConfig(noDefault),/defaultScene/)
})

test('battle renderer resolves the chosen scene and crops it to the viewport without stretching', t => {
  class FullSizeImage {complete=true; naturalWidth=1600; naturalHeight=900}
  const original=globalThis.Image
  globalThis.Image=FullSizeImage
  t.after(()=>{if(original===undefined) delete globalThis.Image; else globalThis.Image=original})
  const draws=[]
  const ctx=new Proxy({drawImage:(...args)=>draws.push(args)},{get:(obj,field)=>obj[field] ?? (()=>{})})
  const canvas={width:1220,height:498,getContext:()=>ctx}
  for(const sceneId of scenes) {
    const battle={config,sceneId,frame:0,events:[],telegraphs:[],actors:[],entities:[]}
    drawArena(canvas,battle)
    const [image,sx,sy,sw,sh,dx,dy,dw,dh]=draws.at(-1)
    assert.equal(image.src,config.assets[config.scenes[sceneId].asset].path)
    assert.ok(Math.abs(sw/sh-dw/dh)<1e-6)
    assert.ok(sx>=0 && sy>0)
    assert.equal(dx,0)
    assert.equal(dy,0)
    assert.deepEqual([dw,dh],[canvas.width,canvas.height])
  }
})
