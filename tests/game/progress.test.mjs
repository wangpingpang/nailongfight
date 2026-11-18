import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {loadConfig} from '../../src/game/config.mjs'
import {createProgressStore} from '../../src/game/progress.mjs'

const config = await loadConfig(async file => ({ok:true, json:async () => JSON.parse(await readFile(file))}))
const initial = config.economy.initialCharacter
const starters = Object.fromEntries(config.roster.map(id => [id,1]))
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
  assert.deepEqual(store.read().profile.levels, starters)
  assert.deepEqual(store.read().profile.unlockedStages,['stage_01'])
  const first = await store.settle(win('one'))
  assert.deepEqual(first.receipt, {points:50, first:true, unlockedCharacter:null, nextStage:'stage_02'})
  assert.deepEqual(first.profile.levels, starters)
  const duplicate = await store.settle(win('one'))
  assert.equal(duplicate.profile.points, 50)
  assert.deepEqual(duplicate.receipt, first.receipt)
  assert.equal((await store.upgrade(initial, 1)).profile.points, 0)
  assert.equal((await store.upgrade(initial, 1)).changed, false)
  assert.deepEqual(createProgressStore(config,storage).read().profile.levels,{...starters,[initial]:2})
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
  await Promise.all([a.upgrade(initial,1), b.upgrade(initial,1)])
  assert.equal(b.read().profile.points,20)
  assert.equal(a.read().profile.levels[initial],2)
})

test('practice, draws, failure and exit issue no reward; locked stage cannot pay out', async () => {
  const store=createProgressStore(config,memory())
  for (const [mode,winner] of [['vs_ai',1],['pvp',1],['training',1],['pve',2],['pve',null]]) {
    const r=await store.settle({mode,winner,id:mode+winner,stageId:'stage_01'})
    assert.equal(r.receipt.points,0)
  }
  assert.equal((await store.settle(win('locked','stage_03'))).changed,false)
  assert.deepEqual(store.read().profile.clearedStages,[])
  assert.deepEqual(store.read().profile.levels,starters)
})

test('corrupt active save recovers the backup visibly; two bad copies are preserved', async () => {
  const storage=memory()
  const store=createProgressStore(config,storage)
  await store.settle(win('w'))
  await store.upgrade(initial,1)
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
  const attempt=await store.upgrade(initial,1)
  assert.equal(attempt.changed,false)
  assert.equal(attempt.profile.points,50)
  assert.equal(attempt.profile.levels[initial],1)
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
  assert.equal((await store.updateSettings({selectedCharacter:'courier'})).changed,true)
  assert.equal((await store.updateSettings({selectedCharacter:'melee'})).changed,false)
  assert.equal(store.read().profile.settings.selectedCharacter,'courier')
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


function legacyPlayer() {
  return {
    schema_version:1, config_version:'0.1.0', points:79,
    levels:{shell:3, cloud:2}, clearedStages:['stage_01'], unlockedStages:['stage_01','stage_02'],
    settings:{selectedCharacter:'cloud', volume:.25},
    settlements:{first:{points:50, first:true, unlockedCharacter:'cloud', nextStage:'stage_02'}}
  }
}

test('a legacy account keeps its currency, levels, unlocks and receipts when the roster changes', async () => {
  const storage = memory()
  const original = legacyPlayer()
  const key = 'echo-ring.progress.v1'
  storage.setItem(key,JSON.stringify(original))
  const store = createProgressStore(config,storage)
  const opened = store.read()
  assert.equal(opened.blocked,false)
  assert.equal(opened.profile.points,79)
  assert.deepEqual(opened.profile.levels,{...original.levels,...starters})
  assert.deepEqual(opened.profile.clearedStages,original.clearedStages)
  assert.deepEqual(opened.profile.unlockedStages,original.unlockedStages)
  assert.deepEqual(opened.profile.settlements,original.settlements)
  assert.equal(opened.profile.settings.volume,.25)
  assert.equal(opened.profile.settings.selectedCharacter,initial)
  assert.equal(opened.profile.legacySelectedCharacter,'cloud')
  assert.equal((await store.settle(win('first'))).profile.points,79)
  const stageTwo = await store.settle(win('second','stage_02'))
  assert.equal(stageTwo.profile.points,159)
  assert.equal(stageTwo.receipt.points,80)
  assert.equal((await store.upgrade('shell',3)).changed,false)
  assert.equal((await store.updateSettings({selectedCharacter:'cloud'})).changed,false)
  const saved = await store.updateSettings({selectedCharacter:'sacred'})
  const reopened = createProgressStore(config,storage).read()
  assert.equal(reopened.profile.schema_version,2)
  assert.equal(reopened.profile.settings.selectedCharacter,'sacred')
  assert.deepEqual(reopened.profile,saved.profile)
  assert.deepEqual(reopened.profile.levels,{...original.levels,...starters})
  assert.equal((await store.settle(win('second','stage_02'))).profile.points,159)
})

test('a valid legacy backup is migrated; corrupted legacy balances never reset silently', async () => {
  const storage = memory()
  const key = 'echo-ring.progress.v1'
  const invalid = {...legacyPlayer(),points:-10}
  storage.setItem(key,JSON.stringify(invalid))
  storage.setItem(key+'.backup',JSON.stringify(legacyPlayer()))
  const store = createProgressStore(config,storage)
  assert.match(store.read().notice,/备份/)
  assert.equal(store.read().profile.points,79)
  assert.equal(store.read().profile.legacySelectedCharacter,'cloud')
  const upgraded = await store.upgrade(initial,1)
  assert.equal(upgraded.profile.points,29)
  assert.equal(upgraded.profile.levels[initial],2)
  assert.equal(store.read().profile.settings.selectedCharacter,initial)
  storage.setItem(key,JSON.stringify(invalid))
  storage.setItem(key+'.backup','broken')
  assert.equal(store.read().blocked,true)
  assert.equal((await store.updateSettings({selectedCharacter:'laughing'})).blocked,true)
  assert.equal(storage.getItem(key),JSON.stringify(invalid))
})

test('a larger starting roster adds its newcomers without resetting an existing selected fighter', async () => {
  const storage = memory()
  const original = createProgressStore(config,storage).read().profile
  const newcomer = config.roster.at(-1)
  delete original.levels[newcomer]
  original.config_version = 'earlier-roster'
  original.settings.selectedCharacter = 'laughing'
  original.levels.laughing = 4
  original.points = 180
  storage.setItem('echo-ring.progress.v1',JSON.stringify(original))
  const store = createProgressStore(config,storage)
  const {profile,blocked} = store.read()
  assert.equal(blocked,false)
  assert.equal(profile.levels[newcomer],1)
  assert.equal(profile.levels.laughing,4)
  assert.equal(profile.settings.selectedCharacter,'laughing')
  assert.equal(profile.points,180)
  const result = await store.updateSettings({volume:.75})
  assert.deepEqual(store.read().profile,result.profile)
})

const previousInput = {
  p1:{up:'KeyW',down:'KeyS',left:'KeyA',right:'KeyD',basic:'KeyF',s1:'KeyG',s2:'KeyH',defend:'KeyR',ult:'KeyT'},
  p2:{up:'ArrowUp',down:'ArrowDown',left:'ArrowLeft',right:'ArrowRight',basic:'KeyJ',s1:'KeyK',s2:'KeyL',defend:'KeyO',ult:'KeyP'}
}

function withStoredBindings(bindings, original = legacyPlayer()) {
  const storage = memory()
  original.settings.bindings = structuredClone(bindings)
  storage.setItem('echo-ring.progress.v1',JSON.stringify(original))
  return {storage, store:createProgressStore(config,storage)}
}

test('previously saved factory bindings follow the new defaults across both old profile schemas', async () => {
  const modern = createProgressStore(config,memory()).read().profile
  delete modern.bindings_version
  modern.config_version = '0.1.1+fighters.0.4'
  modern.points = 79
  modern.settings.volume = .25
  for (const old of [legacyPlayer(),modern]) {
    const {store,storage} = withStoredBindings(previousInput,old)
    const migrated = store.read()
    assert.equal(migrated.blocked,false)
    assert.deepEqual(migrated.profile.settings.bindings,config.input)
    assert.deepEqual(migrated.profile.settlements,old.settlements)
    assert.deepEqual(migrated.profile.unlockedStages,old.unlockedStages)
    assert.equal(migrated.profile.settings.volume,.25)
    assert.equal(migrated.profile.points,79)
    // An explicit choice made in this version must survive a subsequent reload,
    // even when it exactly reproduces the factory layout of a previous release.
    assert.equal((await store.updateSettings({bindings:previousInput})).changed,true)
    assert.deepEqual(createProgressStore(config,storage).read().profile.settings.bindings, previousInput)
  }
})

test('valid custom layouts survive an upgrade without migrating unchanged slots', async () => {
  const custom = structuredClone(previousInput)
  custom.p1.basic = 'KeyQ'
  custom.p2.s2 = 'Numpad4'
  const {store,storage} = withStoredBindings(custom)
  assert.deepEqual(store.read().profile.settings.bindings,custom)
  const updated = await store.updateSettings({reduceEffects:true})
  assert.deepEqual(createProgressStore(config,storage).read().profile,updated.profile)
  assert.deepEqual(updated.profile.settings.bindings, custom)
})

test('old distinct physical digits that are now aliases remap only the colliding slot', async () => {
  const custom = structuredClone(previousInput)
  custom.p1.basic = 'Digit1'
  custom.p2.basic = 'Numpad1'
  custom.p2.s1 = 'Digit2'
  const {store,storage} = withStoredBindings(custom)
  const migrated = store.read()
  assert.equal(migrated.blocked,false)
  assert.match(migrated.notice,/键位/)
  assert.equal(migrated.profile.points,79)
  assert.deepEqual(migrated.profile.levels,{...starters,shell:3,cloud:2})
  const map = migrated.profile.settings.bindings
  const changed = []
  for (const player of ['p1','p2']) for (const action of Object.keys(custom[player])) {
    if (custom[player][action] !== map[player][action]) changed.push([player,action])
  }
  assert.deepEqual(changed,[['p2','basic']])
  assert.equal(map.p1.basic,'Digit1')
  assert.equal(map.p2.s1,'Digit2')
  assert.notEqual(map.p2.basic,'Digit1')
  assert.equal((await store.settle(win('first'))).profile.points,79)
  assert.equal((await store.updateSettings({volume:.6})).changed,true)
  const loaded = createProgressStore(config,storage).read()
  assert.deepEqual(loaded.profile.settings.bindings,map)
  assert.equal(loaded.notice,'')
})
