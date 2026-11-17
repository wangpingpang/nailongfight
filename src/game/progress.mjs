import {validateBindings} from './config.mjs'

const STORE_KEY = 'echo-ring.progress.v1'
const BACKUP_KEY = STORE_KEY + '.backup'
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const safeInteger = value => Number.isSafeInteger(value) && value >= 0
const emptyReceipt = () => ({points:0, first:false, unlockedCharacter:null, nextStage:null})

function initialProfile(config) {
  const {initialCharacter, initialStage} = config.economy
  return {
    schema_version:1, config_version:config.version,
    points:0, levels:{[initialCharacter]:1}, clearedStages:[], unlockedStages:[initialStage],
    settings:{}, settlements:{}
  }
}

function validSettings(settings, levels, config) {
  if (!record(settings)) return false
  if ('volume' in settings && !(Number.isFinite(settings.volume) && settings.volume >= 0 && settings.volume <= 1)) return false
  if ('reduceEffects' in settings && typeof settings.reduceEffects !== 'boolean') return false
  if ('selectedCharacter' in settings && (!Object.hasOwn(levels,settings.selectedCharacter) ||
      !config.characters[settings.selectedCharacter]?.playable)) return false
  if ('bindings' in settings) {
    try { validateBindings(settings.bindings) } catch { return false }
  }
  return true
}

function decodedProfileMatches(p,config) {
  if (!record(p) || p.schema_version !== 1 || !p.config_version || !safeInteger(p.points)) return false

  const {initialCharacter,initialStage,levelCosts} = config.economy
  if (!record(p.levels) || !Object.hasOwn(p.levels,initialCharacter)) return false
  for (const [id,level] of Object.entries(p.levels)) {
    if (!config.characters[id]?.playable || !Number.isInteger(level) || level < 1 || level > levelCosts.length + 1) return false
  }
  const validStages = list => Array.isArray(list) && new Set(list).size === list.length &&
    list.every(id => Object.hasOwn(config.stages,id))
  if (!validStages(p.unlockedStages) || !p.unlockedStages.includes(initialStage) ||
      !validStages(p.clearedStages) || !p.clearedStages.every(id=>p.unlockedStages.includes(id))) return false
  if (!validSettings(p.settings,p.levels,config) || !record(p.settlements)) return false
  return Object.values(p.settlements).every(r =>
    record(r) && safeInteger(r.points) && typeof r.first === 'boolean' &&
    (r.unlockedCharacter === null || Object.hasOwn(config.characters,r.unlockedCharacter)) &&
    (r.nextStage === null || Object.hasOwn(config.stages,r.nextStage))
  )
}

function decode(raw, config) {
  if (raw === null) return null
  try {
    const p = JSON.parse(raw)
    return decodedProfileMatches(p,config) ? p : null
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
      const profile = decode(raw, config)
      if (profile) return {profile,notice:'',blocked:false}
      const backup = storage.getItem(BACKUP_KEY)
      const restored = decode(backup,config)
      if (restored) return {profile:restored,notice:'存档异常，已从上一次有效备份恢复。',blocked:false}
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
        if (!Object.hasOwn(p.levels,characterId)) return {changed:false,notice:'角色尚未解锁。'}
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
        if (!validSettings(settings,p.levels,config)) return {changed:false,notice:'设置值或键位无效。'}
        p.settings = settings
        return {changed:true}
      })
    }
  }
}
