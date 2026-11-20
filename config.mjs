import {buildFighterAnimation} from './fighter-animation.mjs'

const actions = ['up', 'down', 'left', 'right', 'basic', 's1', 's2', 'defend', 'ult']
export const FLOOR_WIDTH_FRACTION = .91
export const CAMERA_HARD_INSET = .08

function requireField(condition, path, description) {
  if (!condition) throw new Error(`配置错误 · ${path} · ${description}`)
}

function object(value, path) {
  requireField(value && typeof value === 'object' && !Array.isArray(value), path, '需要对象')
  return value
}

function words(record, keys, path) {
  for (const key of keys) {
    requireField(typeof record[key] === 'string' && record[key].trim().length > 0, `${path}.${key}`, '需要非空文本')
  }
}

function number(value, path, min = 0, integer = false) {
  requireField(Number.isFinite(value) && value >= min && (!integer || Number.isSafeInteger(value)),
    path, integer ? `需要大于等于 ${min} 的整数` : `需要大于等于 ${min} 的数值`)
}

function numbers(record, keys, path, min = 0, integer = false) {
  for (const key of keys) number(record[key], `${path}.${key}`, min, integer)
}

function table(record, path, check) {
  object(record, path)
  requireField(Object.keys(record).length > 0, path, '表不能为空')
  for (const [id, row] of Object.entries(record)) {
    const item = `${path}.${id}`
    object(row, item)
    requireField(/^[A-Za-z][\w.-]*$/.test(id) && row.id === id, item + '.id', '记录 ID 必须与键一致')
    check(row, item)
  }
}

function reference(records, id, path) {
  requireField(typeof id === 'string' && Object.hasOwn(records, id), path, '引用不存在')
  return records[id]
}

/** Both physical number banks select the same bindings for the six game number keys. */
export function canonicalKeyCode(code) {
  return typeof code === 'string' && /^Numpad[1-6]$/.test(code) ? 'Digit' + code.at(-1) : code
}

/** Validate both players' physical key bindings, including shared number keys and global controls. */
export function validateBindings(bindings) {
  object(bindings, 'input')
  const used = new Set(['Escape', 'Tab', 'ControlLeft', 'ControlRight',
    'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight', 'ShiftLeft', 'ShiftRight'])
  for (const player of ['p1', 'p2']) {
    const keys = object(bindings[player], 'input.' + player)
    for (const action of actions) {
      const path = `input.${player}.${action}`
      const key = keys[action]
      requireField(typeof key === 'string' && /^[A-Z][A-Za-z0-9]+$/.test(key), path, '需要有效的 KeyboardEvent.code')
      const code = canonicalKeyCode(key)
      requireField(!used.has(code), path, '按键已占用或由浏览器保留')
      used.add(code)
    }
  }
  return bindings
}

function checkRules(r) {
  object(r, 'rules')
  numbers(r, ['tickRate','duelLimit','comboHitLimit','comboLockLimit','comboResetFree','evadeFrames',
    'escapeFrames','defenseMoveFrames','downFrames','getupFrames'], 'rules', 1, true)
  numbers(r, ['evadeCd','escapeCd','evadeInvulnFrames','inputBuffer','cancelAfterHitFrames','resumeSeconds'],
    'rules', 0, true)
  numbers(r, ['arenaWidth','arenaDepth','energyMax'], 'rules', Number.EPSILON)
  numbers(r, ['energyStart','basicEnergy','skillEnergy','hurtEnergyRate','knockdownDistance','evadeDistance','escapeDistance'], 'rules')
  requireField(r.energyStart <= r.energyMax, 'rules.energyStart', '初始能量超出上限')
  requireField(r.defenseMoveFrames <= Math.min(r.evadeFrames, r.escapeFrames), 'rules.defenseMoveFrames', '位移超过动作时长')
  requireField(r.evadeInvulnFrames <= r.evadeFrames, 'rules.evadeInvulnFrames', '无敌时间超过动作时长')
  requireField(Array.isArray(r.comboScale) && r.comboScale.length === r.comboHitLimit, 'rules.comboScale', '每个连击序号需有倍率')
  r.comboScale.forEach((scale, i) => number(scale, `rules.comboScale[${i}]`))
  if (r.impactHoldFrames !== undefined) {
    const path = 'rules.impactHoldFrames'
    const durations = object(r.impactHoldFrames, path)
    numbers(durations, ['light','medium','heavy','ultimate','guard'], path, 0, true)
  }
}

function checkCamera(camera, arenaWidth) {
  object(camera, 'camera')
  number(camera.viewFraction, 'camera.viewFraction', Number.EPSILON)
  requireField(camera.viewFraction <= 1, 'camera.viewFraction', '取景宽度不能超过整幅场景')
  number(camera.edgeInset, 'camera.edgeInset', CAMERA_HARD_INSET)
  requireField(camera.edgeInset < .5, 'camera.edgeInset', '两侧跟随区之间须有可用空间')
  number(camera.maxSeparation, 'camera.maxSeparation', Number.EPSILON)
  const visibleWorldWidth = arenaWidth * camera.viewFraction / FLOOR_WIDTH_FRACTION
  requireField(camera.maxSeparation <= visibleWorldWidth * (1 - 2 * CAMERA_HARD_INSET),
    'camera.maxSeparation', '最大间距必须为画面两端的角色各留出至少 8% 的宽度')
}

function checkSkill(s, path) {
  words(s, ['name','description'], path)
  requireField(['basic','skill','ult'].includes(s.kind), path + '.kind', '未知技能种类')
  numbers(s, ['startup','recovery','cd','stun'], path, 0, true)
  number(s.active, path + '.active', 1, true)
  numbers(s, ['cost','coeff','knockback'], path)
  requireField(typeof s.knockdown === 'boolean', path + '.knockdown', '需要布尔值')
  const ep = path + '.effect'
  const e = object(s.effect, ep)
  requireField(['melee','dash','parry','projectile','charge','delayed','leap','backstep','semicircle','circle','field','marker','slide','feed'].includes(e.type), ep + '.type', '未知效果组件')
  if (['melee','dash','parry'].includes(e.type)) numbers(e, ['length','depth'], ep, Number.EPSILON)
  if (e.type === 'dash' || e.type === 'backstep') number(e.distance, ep + '.distance')
  if (['semicircle','circle','field','slide'].includes(e.type)) number(e.radius, ep + '.radius', Number.EPSILON)
  if (['circle','field','marker'].includes(e.type)) number(e.offset, ep + '.offset')
  if (['field','marker'].includes(e.type)) number(e.life, ep + '.life', 1, true)
  if (e.type === 'field') {
    number(e.slow, ep + '.slow')
    requireField(e.slow <= 1, ep + '.slow', '减速倍率超过 1')
  }
  if (e.type === 'slide') {
    number(e.distance, ep + '.distance', Number.EPSILON)
    number(e.maxDistance, ep + '.maxDistance', e.distance)
    number(e.slideFrames, ep + '.slideFrames', 1, true)
  }
  if (e.type === 'parry') {
    numbers(e, ['counterStartup','counterRecovery'], ep, 0, true)
    number(e.counterActive, ep + '.counterActive', 1, true)
  }
  if (['projectile','charge'].includes(e.type)) {
    numbers(e, ['diameter','speed'], ep, Number.EPSILON)
    number(e.lifetime, ep + '.lifetime', 1, true)
    number(e.offset, ep + '.offset')
  }
  if (e.type === 'charge') {
    number(e.chargeFrames, ep + '.chargeFrames', 1, true)
    number(e.releaseFrames, ep + '.releaseFrames', 0, true)
    number(e.maxCoeff, ep + '.maxCoeff', s.coeff)
    number(e.maxDiameter, ep + '.maxDiameter', e.diameter)
    number(e.chargeMoveScale, ep + '.chargeMoveScale')
  }
  if (['delayed','leap'].includes(e.type)) {
    number(e.offset, ep + '.offset')
    number(e.radius, ep + '.radius', Number.EPSILON)
  }
  if (e.type === 'delayed') {
    number(e.delay, ep + '.delay', 0, true)
    if (e.warnOnSpawnOnly !== undefined)
      requireField(typeof e.warnOnSpawnOnly === 'boolean', ep + '.warnOnSpawnOnly', '需要布尔值')
  }
  if (e.type === 'leap') {
    if (e.landAtBody !== undefined)
      requireField(typeof e.landAtBody === 'boolean', ep + '.landAtBody', '需要布尔值')
    number(e.moveFrames, ep + '.moveFrames', 1, true)
    requireField(e.moveFrames <= s.startup, ep + '.moveFrames', '跃进必须在前摇内完成')
  }
}

function checkPassives(config) {
  table(config.passives, 'passives', (p, path) => {
    words(p, ['name','description'], path)
    requireField(['lowHpKnockback','fullChargeSpeed','beat','mirth','resonance','arrival','fed','hitRefund'].includes(p.type), path + '.type', '未知被动类型')
    reference(config.skills, p.skill, path + '.skill')
    if (['lowHpKnockback','fullChargeSpeed'].includes(p.type)) number(p.multiplier, path + '.multiplier', Number.EPSILON)
    if (['beat','mirth','resonance','fed'].includes(p.type)) number(p.bonusCoeff, path + '.bonusCoeff')
    if (p.type === 'beat') {
      number(p.period, path + '.period', 1, true)
      number(p.window, path + '.window', 0, true)
      requireField(2 * p.window < p.period, path + '.window', '拍点窗口应小于周期')
    }
    if (p.type === 'mirth') {
      reference(config.skills, p.grantSkill, path + '.grantSkill')
      number(p.duration, path + '.duration', 1, true)
      number(p.boostRadius, path + '.boostRadius', Number.EPSILON)
    }
    if (p.type === 'resonance') {
      const field = reference(config.skills, p.fieldSkill, path + '.fieldSkill')
      requireField(field.effect.type === 'field', path + '.fieldSkill', '共鸣需要光环技能')
    }
    if (p.type === 'fed') {
      const grant = reference(config.skills, p.grantSkill, path + '.grantSkill')
      requireField(grant.effect.type === 'feed', path + '.grantSkill', '饱腹状态需要蓄能技能')
      number(p.duration, path + '.duration', 1, true)
      number(p.speedMultiplier, path + '.speedMultiplier', 1)
    }
    if (p.type === 'arrival' || p.type === 'hitRefund') {
      requireField(['s1','s2'].includes(p.reduceSlot), path + '.reduceSlot', '需要普通技能槽')
      number(p.reduceFrames, path + '.reduceFrames', 1, true)
    }
    if (p.type === 'lowHpKnockback') {
      number(p.threshold, path + '.threshold')
      requireField(p.threshold <= 1, path + '.threshold', '生命比例应当在 0 至 1 之间')
    }
  })
}

function checkCharacter(c, path, config) {
  words(c, ['name','role','description','theme','playstyle'], path)
  numbers(c, ['hp','attack','speed','hurtWidth','hurtDepth'], path, Number.EPSILON)
  requireField(c.hurtWidth <= config.rules.arenaWidth && c.hurtDepth <= config.rules.arenaDepth,
    path, '受击框超出场地')
  requireField(typeof c.playable === 'boolean' && typeof c.canDefend === 'boolean', path, '角色权限需要布尔值')
  reference(config.assets, c.asset, path + '.asset')
  reference(config.ai, c.ai, path + '.ai')
  requireField(typeof config.ai[c.ai] === 'object', path + '.ai', 'AI 行为需要参数表')
  requireField(Array.isArray(c.basic) && c.basic.length > 0, path + '.basic', '必须配置普攻')
  for (const skill of c.basic) {
    requireField(reference(config.skills, skill, path + '.basic').kind === 'basic', path + '.basic', '必须引用普攻')
  }
  for (const slot of ['s1','s2','ult']) {
    if (c[slot] === null && !c.playable) continue
    const skill = reference(config.skills, c[slot], path + '.' + slot)
    requireField(skill.kind === (slot === 'ult' ? 'ult' : 'skill'), path + '.' + slot, '技能槽与类型不符')
  }
  if (c.animation !== undefined) reference(config.animations, c.animation, path + '.animation')
  if (c.passive !== null || c.playable) {
    const passive = reference(config.passives, c.passive, path + '.passive')
    const kit = [...c.basic,c.s1,c.s2,c.ult]
    for (const key of ['skill','grantSkill','fieldSkill']) {
      if (passive[key] !== undefined) requireField(kit.includes(passive[key]), path + '.passive', '被动引用了角色外的技能')
    }
  }
}

function checkArenaPoint(x, y, path, rules, fighter) {
  const halfWidth = (fighter?.hurtWidth ?? 0) / 2
  const halfDepth = (fighter?.hurtDepth ?? 0) / 2
  number(x, path + '.x', halfWidth)
  number(y, path + '.y', halfDepth)
  requireField(x <= rules.arenaWidth - halfWidth, path + '.x', '横向出生点超出场地')
  requireField(y <= rules.arenaDepth - halfDepth, path + '.y', '纵向出生点超出场地')
}

function checkStages(config) {
  const {spawn, rules, economy, characters, stages} = config
  object(spawn, 'spawn')
  numbers(spawn, ['waveDelay','warningFrames'], 'spawn', 0, true)
  number(spawn.minDistance, 'spawn.minDistance')
  number(spawn.maxPerWave, 'spawn.maxPerWave', 1, true)
  requireField(spawn.warningFrames <= spawn.waveDelay, 'spawn.warningFrames', '预警超过刷怪间隔')
  const playable = Object.values(characters).filter(c => c.playable)
  requireField(playable.length > 0, 'characters', '至少需要一名可玩角色')
  for (const fighter of playable) {
    checkArenaPoint(spawn.playerX, spawn.playerY, 'spawn.player', rules, fighter)
    checkArenaPoint(spawn.opponentX, spawn.opponentY, 'spawn.opponent', rules, fighter)
  }
  if (config.camera) requireField(Math.abs(spawn.playerX - spawn.opponentX) <= config.camera.maxSeparation,
    'spawn.opponentX', '开场间距超过双人镜头的最大间距')
  table(stages, 'stages', (s, path) => {
    words(s, ['name','description'], path)
    numbers(s, ['firstReward','repeatReward'], path, 0, true)
    if (s.unlockCharacter !== null) requireField(reference(characters, s.unlockCharacter, path + '.unlockCharacter').playable,
      path + '.unlockCharacter', '解锁对象必须可出战')
    if (s.unlockStage !== null) reference(stages, s.unlockStage, path + '.unlockStage')
    requireField(Array.isArray(s.waves) && s.waves.length > 0, path + '.waves', '关卡必须包含波次')
    s.waves.forEach((wave, i) => {
      const wavePath = `${path}.waves[${i}]`
      requireField(Array.isArray(wave) && wave.length > 0 && wave.length <= spawn.maxPerWave,
        wavePath, '敌人数应在每波上限内')
      wave.forEach((enemy, j) => {
        const enemyPath = `${wavePath}[${j}]`
        object(enemy, enemyPath)
        const fighter = reference(characters, enemy.characterId, enemyPath + '.characterId')
        numbers(enemy, ['hp','attack'], enemyPath, Number.EPSILON)
        checkArenaPoint(enemy.x, enemy.y, enemyPath, rules, fighter)
      })
    })
  })
  object(economy, 'economy')
  requireField(reference(characters, economy.initialCharacter, 'economy.initialCharacter').playable, 'economy.initialCharacter', '初始角色必须可出战')
  reference(stages, economy.initialStage, 'economy.initialStage')
  number(economy.growthRate, 'economy.growthRate')
  requireField(Array.isArray(economy.levelCosts) && economy.levelCosts.length > 0, 'economy.levelCosts', '需要各等级花费')
  economy.levelCosts.forEach((v, i) => number(v, `economy.levelCosts[${i}]`, 0, true))
  const reached = new Set()
  let stageId = economy.initialStage
  while (stageId !== null) {
    requireField(!reached.has(stageId), `stages.${stageId}.unlockStage`, '解锁链构成循环')
    reached.add(stageId)
    stageId = stages[stageId].unlockStage
  }
  requireField(reached.size === Object.keys(stages).length, 'stages', '存在无法到达的关卡')
}

function checkAi(ai) {
  object(ai, 'ai')
  number(ai.interval, 'ai.interval', 1, true)
  number(ai.escapeAfter, 'ai.escapeAfter', 0, true)
  number(ai.alignTolerance, 'ai.alignTolerance')
  for (const [profile, fields] of [
    ['shell',['approach','meleeRange','parryRange']], ['cloud',['trapRange','chargeMin','chargeMax','keepMin','keepMax']],
    ['melee',['range']], ['ranged',['keepMin','keepMax']]
  ]) numbers(object(ai[profile], 'ai.' + profile), fields, 'ai.' + profile, Number.EPSILON)
  requireField(ai.cloud.chargeMin <= ai.cloud.chargeMax, 'ai.cloud.chargeMax', '射程上下限颠倒')
  for (const id of ['ranged','cloud']) requireField(ai[id].keepMin <= ai[id].keepMax, 'ai.' + id, '走位范围上下限颠倒')
}


const r1RequiredActions = ['idle','move','evade','escape','hit','down','getup','death','basic1','basic2','basic3','block','skill1','skill2','ult','victory']
const requiredActionIds = ['idle','run','basic','evade','s1','s2','ult','hit','escape','down','getup','defeat']

function checkFighterModule(config) {
  const {roleModule, roster, characters, assets, animations, economy} = config
  words(object(roleModule, 'roleModule'), ['version','name','sourceCommit','rightsStatus','tuningNote'], 'roleModule')
  requireField(Array.isArray(roster) && roster.length && new Set(roster).size === roster.length,
    'roster', '出场名单必须非空且无重复')
  for (const id of roster) {
    const fighter = reference(characters, id, 'roster')
    requireField(fighter.playable, 'roster', '出场名单包含不可玩角色')
    numbers(config.ai[fighter.ai], ['meleeRange','approachRange'], 'ai.' + fighter.ai, Number.EPSILON)
    if (fighter.presentation === 'procedural') {
      words(object(fighter.metadata, 'characters.' + id + '.metadata'), ['sourceName','sourceVersion'], 'characters.' + id + '.metadata')
    } else if (fighter.presentation !== 'sample') {
      reference(animations, fighter.animation, 'characters.' + id + '.animation')
    }
  }
  requireField(Array.isArray(economy.initialCharacters) && economy.initialCharacters.includes(economy.initialCharacter)
    && economy.initialCharacters.every(id => roster.includes(id)), 'economy.initialCharacters', '初始出战角色不属于出场名单')
  if (Object.keys(object(animations, 'animations')).length === 0) return
  table(animations, 'animations', (clip, path) => {
    reference(assets, clip.prototype, path + '.prototype')
    object(clip.sheets, path + '.sheets')
    if (clip.cell) {
      requireField(Array.isArray(clip.cell) && clip.cell.length === 2, path + '.cell', '需要帧宽和帧高')
      requireField(Array.isArray(clip.pivot) && clip.pivot.length === 2, path + '.pivot', '需要脚底锚点')
      for (let axis = 0; axis < 2; axis++) {
        number(clip.cell[axis], path + '.cell[' + axis + ']', 1, true)
        number(clip.pivot[axis], path + '.pivot[' + axis + ']', 0, true)
        requireField(clip.pivot[axis] <= clip.cell[axis], path + '.pivot', '锚点超出画格')
      }
    }
    const sheetKeys = new Set([...(clip.cell ? ['A','B','C','D'] : ['A','B','C']), ...Object.keys(clip.sheets)])
    for (const key of sheetKeys) reference(assets, clip.sheets[key], path + '.sheets.' + key)
    numbers(clip, ['rows','columns'], path, 1, true)
    requireField(Array.isArray(clip.actions), path + '.actions', '需要动作列表')
    const ids = new Set()
    for (const [index, action] of clip.actions.entries()) {
      const ap = path + '.actions[' + index + ']'
      object(action, ap)
      words(action, ['id','label','sheet'], ap)
      requireField(!ids.has(action.id), ap + '.id', '动作 ID 重复')
      ids.add(action.id)
      reference(clip.sheets, action.sheet, ap + '.sheet')
      if (action.openingPose) {
        const pose = action.openingPose
        reference(clip.sheets, pose.sheet, ap + '.openingPose.sheet')
        number(pose.row, ap + '.openingPose.row', 0, true)
        number(pose.column, ap + '.openingPose.column', 0, true)
        requireField(pose.row < clip.rows && pose.column < clip.columns, ap + '.openingPose', '起势超出图集')
      }
      number(action.row, ap + '.row', 0, true)
      requireField(action.row < clip.rows, ap + '.row', '超出图集行数')
      requireField(Array.isArray(action.columns) && action.columns.length > 0, ap + '.columns', '动作必须含有关键姿态')
      requireField(Array.isArray(action.durations) && action.durations.length === action.columns.length,
        ap + '.durations', '每个姿态需要逻辑帧时长')
      requireField(typeof action.loop === 'boolean', ap + '.loop', '需要循环标记')
      for (const [j, column] of action.columns.entries()) {
        number(column, ap + '.columns[' + j + ']', 0, true)
        requireField(column < clip.columns, ap + '.columns[' + j + ']', '超出图集列数')
        number(action.durations[j], ap + '.durations[' + j + ']', clip.cell && action.skillId && j !== 2 ? 0 : 1, true)
      }
    }
    const required = clip.cell ? r1RequiredActions : requiredActionIds
    requireField(required.every(id => ids.has(id)), path + '.actions', '缺少战斗状态需要的动作')
  })
}

/** Combine the host rules with the selected roster without changing a saved configuration snapshot. */
export function applyFighterModule(base, module) {
  object(base, 'config')
  object(module, 'fighterModule')
  object(module.metadata, 'fighterModule.metadata')
  requireField(Array.isArray(module.roster) && module.roster.length > 0, 'fighterModule.roster', '缺少出场名单')
  const result = structuredClone(base)
  for (const key of ['characters','skills','passives','assets','ai']) {
    const rows = object(module[key], 'fighterModule.' + key)
    for (const [id, data] of Object.entries(rows)) {
      requireField(!Object.hasOwn(result[key], id), 'fighterModule.' + key + '.' + id, '与宿主稳定 ID 冲突')
      result[key][id] = structuredClone(data)
    }
  }
  result.roleModule = structuredClone(module.metadata)
  result.version = base.version + '+fighters.' + module.metadata.version
  result.roster = [...module.roster]
  result.animations = structuredClone(module.animations)
  if (module.animationLayout) {
    for (const [id, clip] of Object.entries(result.animations)) {
      result.animations[id] = buildFighterAnimation(module.animationLayout, result.characters[id], clip, result.skills)
    }
  }
  result.economy.initialCharacters = structuredClone(module.initialCharacters)
  result.economy.initialCharacter = module.initialCharacters?.[0]
  result.rules.resetComboOnStunExit = module.rules?.resetComboOnStunExit === true
  for (const [stageId, characterId] of Object.entries(module.replacedUnlocks ?? {})) {
    reference(result.stages, stageId, 'fighterModule.replacedUnlocks.' + stageId).unlockCharacter = characterId
  }
  for (const [stageId, rule] of Object.entries(module.stageOpponents ?? {})) {
    const path = 'fighterModule.stageOpponents.' + stageId
    const stage = reference(result.stages, stageId, path)
    words(rule, ['description'], path)
    stage.description = rule.description
    for (const [previous, replacement] of Object.entries(object(rule.replace, path + '.replace'))) {
      reference(result.characters, replacement, path + '.replace.' + previous)
      const targets = stage.waves.flat().filter(enemy => enemy.characterId === previous)
      requireField(targets.length > 0, path + '.replace.' + previous, '关卡中没有要替换的敌人')
      for (const enemy of targets) enemy.characterId = replacement
    }
  }
  return result
}

/** Resolve the selected environment by stable ID, defaulting only when no ID was supplied. */
export function resolveScene(config, sceneId = config.defaultScene) {
  return reference(config.scenes, sceneId, 'sceneId')
}

function checkSceneMusic(config) {
  const {tracks, defaultVolume} = object(config.sceneMusic, 'sceneMusic')
  number(defaultVolume, 'sceneMusic.defaultVolume')
  requireField(defaultVolume <= 1, 'sceneMusic.defaultVolume', '音量须在0到1之间')
  object(tracks, 'sceneMusic.tracks')
  for (const id of Object.keys(config.scenes)) {
    const label = 'sceneMusic.tracks.' + id
    const track = reference(tracks, id, label)
    words(track, ['title','path'], label)
    requireField(/^\.\/assets\/music\/[a-z0-9_-]+\.ogg$/.test(track.path), label + '.path', '需要本地 Ogg 曲目')
    number(track.sampleRate, label + '.sampleRate', 1, true)
    number(track.loopStartSample, label + '.loopStartSample', 0, true)
    number(track.loopEndSample, label + '.loopEndSample', track.loopStartSample + 1, true)
  }
}

function checkFighterAudio(config) {
  const {banks, gains, heavyStartup, stepFrames} = object(config.fighterAudio, 'fighterAudio')
  object(banks, 'fighterAudio.banks')
  for (const [id, bank] of Object.entries(banks)) {
    if (config.roleModule) reference(config.characters, id, 'fighterAudio.banks.' + id)
    requireField(typeof bank === 'string' && /^[a-z0-9_-]+$/.test(bank), 'fighterAudio.banks.' + id, '需要素材目录名')
  }
  object(gains, 'fighterAudio.gains')
  const cues = ['basic1','basic2','basic3','skill1','skill2','ult','hit','block','move','evade','windup','victory']
  for (const cue of cues) {
    number(gains[cue], 'fighterAudio.gains.' + cue)
    requireField(gains[cue] <= 1, 'fighterAudio.gains.' + cue, '音量必须在 0 到 1 之间')
  }
  requireField(Object.keys(gains).length === cues.length, 'fighterAudio.gains', '含未定义的音效')
  number(stepFrames, 'fighterAudio.stepFrames', 1, true)
  number(heavyStartup, 'fighterAudio.heavyStartup', 0, true)
}

/** Validate source data and cross-table references, throwing a path-specific error before play. */
export function validateConfig(config) {
  object(config, 'config')
  words(config, ['version','tuningNote'], 'config')
  words(object(config.uiText, 'uiText'), ['title','home','characters','stages','vs_ai','pvp','training','pve','heroDescription',
    'heroAction','modeHeading','pveDescription','pvpDescription','trainingDescription'], 'uiText')
  checkRules(config.rules)
  if (config.camera !== undefined) checkCamera(config.camera, config.rules.arenaWidth)
  table(config.assets, 'assets', (asset, path) => {
    words(asset, ['path','use','author','source','license','realPersonCheck','ipCheck','status'], path)
  })
  table(config.scenes, 'scenes', (scene, path) => {
    words(scene, ['name','alt'], path)
    reference(config.assets, scene.asset, path + '.asset')
  })
  reference(config.scenes, config.defaultScene, 'defaultScene')
  table(config.skills, 'skills', checkSkill)
  checkPassives(config)
  table(config.characters, 'characters', (row, path) => checkCharacter(row, path, config))
  if (config.fighterAudio) checkFighterAudio(config)
  if (config.sceneMusic) checkSceneMusic(config)
  checkStages(config)
  checkAi(config.ai)
  if (config.roleModule) checkFighterModule(config)
  validateBindings(config.input)
  return config
}

/** Read a fresh validated config snapshot from the served game or the standalone HTML build. */
export async function loadConfig(fetcher = globalThis.fetch, page = globalThis.document) {
  const inline = page?.getElementById('inline-game-config')
  if (inline) {
    const config = validateConfig(JSON.parse(inline.textContent))
    const manifest = page.getElementById('inline-game-assets')
    if (manifest) {
      const paths = object(JSON.parse(manifest.textContent), 'inline-game-assets')
      for (const asset of Object.values(config.assets)) {
        if (Object.hasOwn(paths, asset.path)) asset.path = paths[asset.path]
      }
    }
    return config
  }
  async function fetchTable(filename) {
    const response = await fetcher(new URL('./data/' + filename, import.meta.url), { cache: 'no-store' })
    if (!response.ok) throw new Error(`游戏配置读取失败（${filename}，HTTP ${response.status}）`)
    return response.json()
  }
  const base = await fetchTable('game.json')
  if (!base.fighterModule) return validateConfig(base)
  requireField(typeof base.fighterModule === 'string' && /^[A-Za-z0-9-]+\.json$/.test(base.fighterModule),
    'fighterModule', '需要 data 目录内的模块名')
  const fighters = await fetchTable(base.fighterModule)
  return validateConfig(applyFighterModule(base, fighters))
}
