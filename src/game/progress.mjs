import {canonicalKeyCode, validateBindings} from './config.mjs'

const STORE_KEY = 'echo-ring.progress.v1'
const BACKUP_KEY = STORE_KEY + '.backup'
const legacyRoster = ['shell','cloud']
const bindingVersion = 2
// Factory layout shipped in both 0.1.0 and 0.1.1. Keep this snapshot independent
// of config.input so old defaults can be distinguished from player choices.
const previousInput = {
  p1:{up:'KeyW',down:'KeyS',left:'KeyA',right:'KeyD',basic:'KeyF',s1:'KeyG',s2:'KeyH',defend:'KeyR',ult:'KeyT'},
  p2:{up:'ArrowUp',down:'ArrowDown',left:'ArrowLeft',right:'ArrowRight',basic:'KeyJ',s1:'KeyK',s2:'KeyL',defend:'KeyO',ult:'KeyP'}
}
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const safeInteger = value => Number.isSafeInteger(value) && value >= 0
const emptyReceipt = () => ({points:0, first:false, unlockedCharacter:null, nextStage:null})

function initialProfile(config) {
  const {initialStage} = config.economy
  return {
    schema_version:2, config_version:config.version, bindings_version:bindingVersion,
    points:0, levels:Object.fromEntries(config.roster.map(id => [id,1])), clearedStages:[], unlockedStages:[initialStage],
    settings:{}, settlements:{}
  }
}

function validSettings(settings, levels, roster) {
  if (!record(settings)) return false
  if ('volume' in settings && !(Number.isFinite(settings.volume) && settings.volume >= 0 && settings.volume <= 1)) return false
  if ('reduceEffects' in settings && typeof settings.reduceEffects !== 'boolean') return false
  if ('selectedCharacter' in settings && (!Object.hasOwn(levels,settings.selectedCharacter) ||
      !roster.includes(settings.selectedCharacter))) return false
  if ('bindings' in settings) {
    try { validateBindings(settings.bindings) } catch { return false }
  }
  return true
}

function decodedProfileMatches(p,config) {
  if (!record(p) || ![1,2].includes(p.schema_version) || !p.config_version || !safeInteger(p.points)) return false

  const {initialCharacter,initialStage,levelCosts} = config.economy
  const legacy = p.schema_version === 1
  const roster = legacy ? legacyRoster : config.roster
  if (!record(p.levels) || !Object.hasOwn(p.levels,legacy ? 'shell' : initialCharacter)) return false
  for (const [id,level] of Object.entries(p.levels)) {
    if ((!roster.includes(id) && !legacyRoster.includes(id)) || !Number.isInteger(level) || level < 1 || level > levelCosts.length + 1) return false
  }
  const validStages = list => Array.isArray(list) && new Set(list).size === list.length &&
    list.every(id => Object.hasOwn(config.stages,id))
  if (!validStages(p.unlockedStages) || !p.unlockedStages.includes(initialStage) ||
      !validStages(p.clearedStages) || !p.clearedStages.every(id=>p.unlockedStages.includes(id))) return false
  if (!validSettings(p.settings,p.levels,roster) || !record(p.settlements)) return false
  if (p.legacySelectedCharacter !== undefined && !legacyRoster.includes(p.legacySelectedCharacter)) return false
  return Object.values(p.settlements).every(r =>
    record(r) && safeInteger(r.points) && typeof r.first === 'boolean' &&
    (r.unlockedCharacter === null || Object.hasOwn(config.characters,r.unlockedCharacter)) &&
    (r.nextStage === null || Object.hasOwn(config.stages,r.nextStage))
  )
}

// Called only for unversioned legacy settings. Current saves may intentionally
// use the old factory controls, so a numerical config version alone is insufficient.
function migrateBindings(profile, defaults) {
  const bindings = profile.settings?.bindings
  profile.bindings_version = bindingVersion
  if (bindings === undefined) return ''
  if (!record(bindings) || !record(bindings.p1) || !record(bindings.p2)) return ''
  const slots = Object.entries(previousInput).flatMap(([player, keys]) =>
    Object.keys(keys).map(action => ({player,action,code:bindings[player][action]})))
  if (slots.every(({player,action,code}) => code === previousInput[player][action])) {
    profile.settings.bindings = structuredClone(defaults)
    return '已将原默认键位更新为本版布局。'
  }

  // Reserve all existing non-conflicting choices before repairing any aliases.
  // Exact duplicates were illegal even in the old format: handle those with
  // the existing damaged-save recovery instead of hiding unrelated corruption.
  if (slots.some(slot => typeof slot.code !== 'string') || new Set(slots.map(s => s.code)).size !== slots.length) return ''
  const used = new Set()
  const conflicts = []
  for (const slot of slots) {
    const key = canonicalKeyCode(slot.code)
    if (used.has(key)) conflicts.push(slot)
    used.add(key)
  }
  if (!conflicts.length) return ''
  const defaultKeys = slots.map(({player,action}) => defaults[player][action])
  for (const {player,action} of conflicts) {
    const candidates = [defaults[player][action], ...Object.values(defaults[player]), ...defaultKeys]
    const replacement = candidates.find(key => !used.has(canonicalKeyCode(key)))
    // The validated default layout has one distinct key per slot, so each
    // colliding slot has at least one free key after reserving the others.
    bindings[player][action] = replacement
    used.add(canonicalKeyCode(replacement))
  }
  return '数字行与小键盘现在通用，已调整重复键位。可在设置中查看。'
}

function decode(raw, config) {
  if (raw === null) return null
  try {
    const p = JSON.parse(raw)
    if (!record(p) || (p.bindings_version !== undefined && ![1,bindingVersion].includes(p.bindings_version))) return null
    const notice = p.bindings_version === bindingVersion ? '' : migrateBindings(p, config.input)
    if (!decodedProfileMatches(p,config)) return null
    const legacy = p.schema_version === 1
    if (!legacy && config.roster.every(id => Object.hasOwn(p.levels,id))) return {profile:p,notice}
    // Project old saves on read. The next successful transaction persists the
    // additions under the same origin-wide lock as rewards and upgrades.
    if (legacy && p.settings.selectedCharacter) {
      p.legacySelectedCharacter = p.settings.selectedCharacter
      p.settings.selectedCharacter = config.economy.initialCharacter
    }
    return {profile:{...p, schema_version:2, config_version:config.version,
      levels:{...initialProfile(config).levels,...p.levels}},notice}
  } catch { return null }
}

/* On origins without Web Locks, a read/write IndexedDB transaction on this single
   store serializes the synchronous localStorage read-check-write across tabs. */
function databaseLock(job) {
  return new Promise((resolve,reject) => {
    const open = indexedDB.open(STORE_KEY + '.mutex',1)
    open.onupgradeneeded = () => open.result.createObjectStore('lock')
    open.onerror = () => reject(open.error)
    open.onblocked = () => reject(new Error('无法取得存档锁'))
    open.onsuccess = () => {
      const db = open.result
      const tx = db.transaction('lock','readwrite')
      let value
      tx.objectStore('lock').get(0).onsuccess = () => {
        try { value = job() } catch (error) { tx.abort(); reject(error) }
      }
      tx.oncomplete = () => { db.close(); resolve(value) }
      tx.onabort = tx.onerror = () => { db.close(); reject(tx.error) }
    }
  })
}

function browserStorage() {
  try { return globalThis.localStorage } catch { return null }
}

/** Open the local account. Reads always return a notice and a displayable profile.
 * Writes re-read under an origin-wide lock. A stale level request is a no-op.
 * Corrupted copies are retained when neither copy can be recovered.
 */
export function createProgressStore(config, storage = browserStorage()) {
  function read() {
    const fresh = initialProfile(config)
    try {
      const raw = storage.getItem(STORE_KEY)
      const current = decode(raw, config)
      if (current) return {...current,blocked:false}
      const backup = storage.getItem(BACKUP_KEY)
      const restored = decode(backup,config)
      if (restored) return {...restored,notice:'存档异常，已从上一次有效备份恢复。' + restored.notice,blocked:false}
      if (raw === null && backup === null) return {profile:fresh,notice:'',blocked:false}
      return {profile:fresh,notice:'存档与备份无法读取，已保留原数据并暂停保存。',blocked:true}
    } catch {
      return {profile:fresh,notice:'浏览器存储不可用，当前无法保存进度。',blocked:true}
    }
  }

  async function write(edit) {
    function transaction() {
      const current = read()
      if (current.blocked) return {...current,changed:false}
      const draft = structuredClone(current.profile)
      const outcome = edit(draft)
      if (!outcome.changed) return {...current,...outcome}
      draft.config_version = config.version
      try {
        const next = JSON.stringify(draft)
        storage.setItem(BACKUP_KEY,JSON.stringify(current.profile))
        storage.setItem(STORE_KEY,next)
        return {...current,...outcome,profile:draft}
      } catch {
        return {...current,notice:'保存失败，请检查浏览器存储空间后重试。',changed:false}
      }
    }
    try {
      if (globalThis.navigator?.locks) return await navigator.locks.request(STORE_KEY,transaction)
      if (globalThis.indexedDB) return await databaseLock(transaction)
      // Synchronous injected stores in headless simulations run in one JS realm.
      if (typeof window === 'undefined') return transaction()
      throw new Error('无可用存档锁')
    } catch {
      return {...read(),notice:'无法独占写入存档，请关闭其他游戏标签页后重试。',changed:false}
    }
  }

  return {
    read,
    /** Settle a completed match exactly once and return the original reward on replay. */
    settle({id,mode,winner,stageId}) {
      return write(p => {
        if (typeof id !== 'string' || !id || Object.hasOwn(Object.prototype,id) ||
            !['vs_ai','training','pvp','pve'].includes(mode) || ![1,2,null].includes(winner))
          return {changed:false,notice:'对局结果无效。'}
        if (Object.hasOwn(p.settlements,id)) return {changed:false,receipt:p.settlements[id]}
        const r = emptyReceipt()
        if (mode === 'pve') {
          if (!p.unlockedStages.includes(stageId)) return {changed:false,notice:'关卡尚未开放。'}
          if (winner === 1) {
            const stage = config.stages[stageId]
            r.first = !p.clearedStages.includes(stageId)
            r.points = r.first ? stage.firstReward : stage.repeatReward
            p.points += r.points
            if (r.first) {
              p.clearedStages.push(stageId)
              if (stage.unlockCharacter && !Object.hasOwn(p.levels,stage.unlockCharacter)) {
                p.levels[stage.unlockCharacter] = 1
                r.unlockedCharacter = stage.unlockCharacter
              }
              if (stage.unlockStage && !p.unlockedStages.includes(stage.unlockStage)) {
                p.unlockedStages.push(stage.unlockStage)
                r.nextStage = stage.unlockStage
              }
            }
          }
        }
        p.settlements[id] = r
        return {changed:true,receipt:r}
      })
    },
    /** Buy a single level only if the account still displays the requested starting level. */
    upgrade(characterId, expectedLevel) {
      return write(p => {
        if (!config.roster.includes(characterId) || !Object.hasOwn(p.levels,characterId)) return {changed:false,notice:'当前无法培养此角色。'}
        const level = p.levels[characterId]
        if (level !== expectedLevel) return {changed:false,notice:'等级已更新。'}
        const cost = config.economy.levelCosts[level-1]
        if (cost === undefined) return {changed:false,notice:'已达本版上限。'}
        if (p.points < cost) return {changed:false,notice:'练习点不足。'}
        p.points -= cost
        p.levels[characterId] += 1
        return {changed:true}
      })
    },
    /** Persist valid controls and preferences without replacing unrelated fields. */
    updateSettings(patch) {
      return write(p => {
        if (!record(patch) || Object.keys(patch).some(key=>!['volume','reduceEffects','bindings','selectedCharacter'].includes(key)))
          return {changed:false,notice:'设置项目无效。'}
        const settings = {...p.settings,...patch}
        if (!validSettings(settings,p.levels,config.roster)) return {changed:false,notice:'设置值或键位无效。'}
        p.settings = settings
        return {changed:true}
      })
    }
  }
}
