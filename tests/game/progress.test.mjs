import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createProgressStore} from '../../src/game/progress.mjs'

const config = JSON.parse(await readFile(new URL('../../src/game/data/game.json', import.meta.url)))
function memory() {
  const records = new Map()
  return {
    records, getItem: key => records.get(key) ?? null,
    setItem: (key, value) => records.set(key, value)
  }
}
const win = (id, stageId = 'stage_01') => ({id, stageId, mode:'pve', winner:1})

test('new profile, reward, unlock, upgrade and reload form a persistent loop', async () => {
  const storage = memory()
  const store = createProgressStore(config, storage)
  assert.deepEqual(store.read().profile.levels, {shell:1})
  assert.deepEqual(store.read().profile.unlockedStages,['stage_01'])
  const first = await store.settle(win('one'))
  assert.deepEqual(first.receipt, {points:50, first:true, unlockedCharacter:'cloud', nextStage:'stage_02'})
  assert.deepEqual(first.profile.levels, {shell:1, cloud:1})
  const duplicate = await store.settle(win('one'))
  assert.equal(duplicate.profile.points, 50)
  assert.deepEqual(duplicate.receipt, first.receipt)
  assert.equal((await store.upgrade('shell', 1)).profile.points, 0)
  assert.equal((await store.upgrade('shell', 1)).changed, false)
  assert.deepEqual(createProgressStore(config,storage).read().profile.levels,{shell:2,cloud:1})
  assert.equal((await store.settle(win('two'))).receipt.points,20)
  assert.equal((await store.settle(win('three','stage_02'))).receipt.nextStage,'stage_03')
  assert.equal((await store.settle(win('four','stage_03'))).receipt.points,120)
})

test('simultaneous claims for one battle do not issue two rewards; independent ones survive', async () => {
  const storage = memory()
  const a = createProgressStore(config,storage)
  const b = createProgressStore(config,storage)
  await Promise.all([a.settle(win('a')), b.settle(win('a')), b.settle(win('b'))])
  assert.equal(a.read().profile.points,70)
  await Promise.all([a.upgrade('shell',1), b.upgrade('shell',1)])
  assert.equal(b.read().profile.points,20)
  assert.equal(a.read().profile.levels.shell,2)
})

test('practice, draws, failure and exit issue no reward; locked stage cannot pay out', async () => {
  const store=createProgressStore(config,memory())
  for (const [mode,winner] of [['vs_ai',1],['pvp',1],['training',1],['pve',2],['pve',null]]) {
    const r=await store.settle({mode,winner,id:mode+winner,stageId:'stage_01'})
    assert.equal(r.receipt.points,0)
  }
  assert.equal((await store.settle(win('locked','stage_03'))).changed,false)
  assert.deepEqual(store.read().profile.clearedStages,[])
  assert.deepEqual(store.read().profile.levels,{shell:1})
})

test('corrupt active save recovers the backup visibly; two bad copies are preserved', async () => {
  const storage=memory()
  const store=createProgressStore(config,storage)
  await store.settle(win('w'))
  await store.upgrade('shell',1)
  const primary=[...storage.records.keys()].find(k=>!k.endsWith('.backup'))
  storage.setItem(primary,'?')
  const recovered=store.read()
  assert.match(recovered.notice,/备份/)
  assert.equal(recovered.profile.points,50)
  storage.setItem(primary+'.backup','also broken')
  assert.equal(store.read().blocked,true)
  assert.equal((await store.settle(win('new'))).blocked,true)
  assert.equal(storage.getItem(primary),'?')
})

test('an interrupted storage write cannot mint a partial reward or report success', async () => {
  const storage=memory()
  const store=createProgressStore(config,storage)
  await store.settle(win('w'))
  const primary=[...storage.records.keys()].find(k=>!k.endsWith('.backup'))
  const normal=storage.setItem
  storage.setItem=(key,value)=>{if(key===primary)throw Error('quota');normal(key,value)}
  const attempt=await store.upgrade('shell',1)
  assert.equal(attempt.changed,false)
  assert.equal(attempt.profile.points,50)
  assert.equal(attempt.profile.levels.shell,1)
  assert.ok(attempt.notice)
})

test('persisted settings are validated and a bad patch cannot damage progression', async () => {
  const store=createProgressStore(config,memory())
  assert.equal((await store.updateSettings({volume:.25})).changed,true)
  const r=await store.updateSettings({volume:-1})
  assert.equal(r.changed,false)
  assert.equal(store.read().profile.settings.volume,.25)
})

test('only an unlocked playable character can be persisted as the selected fighter', async () => {
  const store = createProgressStore(config,memory())
  assert.equal((await store.updateSettings({selectedCharacter:'cloud'})).changed,false)
  await store.settle(win('first'))
  assert.equal((await store.updateSettings({selectedCharacter:'cloud'})).changed,true)
  assert.equal((await store.updateSettings({selectedCharacter:'melee'})).changed,false)
  assert.equal(store.read().profile.settings.selectedCharacter,'cloud')
})

test('an unrecorded settlement can be retried after storage space becomes available', async () => {
  const storage=memory(), store=createProgressStore(config,storage)
  const original=storage.setItem
  storage.setItem=()=>{throw Error('full')}
  assert.equal((await store.settle(win('retry'))).receipt,undefined)
  storage.setItem=original
  assert.equal((await store.settle(win('retry'))).profile.points,50)
  assert.equal((await store.settle(win('retry'))).profile.points,50)
})
