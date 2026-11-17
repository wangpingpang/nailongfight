const actions = ['up', 'down', 'left', 'right', 'basic', 's1', 's2', 'defend', 'ult']

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

/** Validate both players' physical key bindings, including collisions with global controls. */
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
      requireField(!used.has(key), path, '按键已占用或由浏览器保留')
      used.add(key)
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
  requireField(['melee','dash','parry','projectile','charge','delayed','leap'].includes(e.type), ep + '.type', '未知效果组件')
  if (['melee','dash','parry'].includes(e.type)) numbers(e, ['length','depth'], ep, Number.EPSILON)
  if (e.type === 'dash') number(e.distance, ep + '.distance')
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
  if (e.type === 'delayed') number(e.delay, ep + '.delay', 0, true)
  if (e.type === 'leap') {
    number(e.moveFrames, ep + '.moveFrames', 1, true)
    requireField(e.moveFrames <= s.startup, ep + '.moveFrames', '跃进必须在前摇内完成')
  }
}

function checkPassives(config) {
  table(config.passives, 'passives', (p, path) => {
    words(p, ['name','description'], path)
    requireField(['lowHpKnockback','fullChargeSpeed'].includes(p.type), path + '.type', '未知被动类型')
    reference(config.skills, p.skill, path + '.skill')
    number(p.multiplier, path + '.multiplier', Number.EPSILON)
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
  requireField(['shell','cloud','melee','ranged'].includes(c.ai), path + '.ai', '未知 AI 行为')
  requireField(Array.isArray(c.basic) && c.basic.length > 0, path + '.basic', '必须配置普攻')
  for (const skill of c.basic) {
    requireField(reference(config.skills, skill, path + '.basic').kind === 'basic', path + '.basic', '必须引用普攻')
  }
  for (const slot of ['s1','s2','ult']) {
    if (c[slot] === null && !c.playable) continue
    const skill = reference(config.skills, c[slot], path + '.' + slot)
    requireField(skill.kind === (slot === 'ult' ? 'ult' : 'skill'), path + '.' + slot, '技能槽与类型不符')
  }
  if (c.passive !== null || c.playable) {
    const passive = reference(config.passives, c.passive, path + '.passive')
    requireField([...c.basic,c.s1,c.s2,c.ult].includes(passive.skill), path + '.passive', '被动影响了角色外的技能')
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

/** Validate source data and cross-table references, throwing a path-specific error before play. */
export function validateConfig(config) {
  object(config, 'config')
  words(config, ['version','tuningNote'], 'config')
  words(object(config.uiText, 'uiText'), ['title','home','characters','stages','vs_ai','pvp','training','pve','heroDescription',
    'heroAction','modeHeading','pveDescription','pvpDescription','trainingDescription'], 'uiText')
  checkRules(config.rules)
  table(config.assets, 'assets', (asset, path) => {
    words(asset, ['path','use','author','source','license','realPersonCheck','ipCheck','status'], path)
  })
  table(config.skills, 'skills', checkSkill)
  checkPassives(config)
  table(config.characters, 'characters', (row, path) => checkCharacter(row, path, config))
  checkStages(config)
  checkAi(config.ai)
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
  const response = await fetcher(new URL('./data/game.json', import.meta.url), { cache: 'no-store' })
  if (!response.ok) throw new Error(`游戏配置读取失败（HTTP ${response.status}）`)
  return validateConfig(await response.json())
}
