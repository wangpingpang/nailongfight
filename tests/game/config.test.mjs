import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { applyFighterModule, validateConfig, loadConfig, validateBindings, canonicalKeyCode } from '../../src/game/config.mjs'

const file = new URL('../../src/game/data/game.json', import.meta.url)
const source = JSON.parse(await readFile(file, 'utf8'))
const fighters = JSON.parse(await readFile(new URL(source.fighterModule, file), 'utf8'))

test('default data loads and a new request observes revised tuning', async () => {
  let revision = structuredClone(source)
  const fetcher = async url => ({ ok: true, json: async () => structuredClone(url.pathname.endsWith(source.fighterModule) ? fighters : revision) })
  const first = await loadConfig(fetcher)
  revision.skills['shell.s1'].cd = 600
  const next = await loadConfig(fetcher)
  assert.equal(first.skills['shell.s1'].cd, 480)
  assert.equal(next.skills['shell.s1'].cd, 600)
  assert.equal(next.skills['shell.s1'].cd / next.rules.tickRate, 10)
})

test('configuration read errors remain visible to the caller', async () => {
  await assert.rejects(() => loadConfig(async () => ({ ok: false, status: 404 })), /404/)
  await assert.rejects(() => loadConfig(async () => ({ ok: true, json: () => ({}) })), /version/)
})

for (const [name, mutate, match] of [
  ['negative cooldown', c => { c.skills['shell.s1'].cd = -1 }, /shell.s1.cd/],
  ['missing skill', c => { c.characters.shell.s1 = 'shell.missing' }, /characters.shell.s1/],
  ['mismatched record ID', c => { c.skills['shell.s1'].id = 'shell.s2' }, /shell.s1.id/],
  ['unreachable charge limit', c => { c.skills['cloud.s1'].effect.chargeFrames = 0 }, /chargeFrames/],
  ['invalid stage enemy', c => { c.stages.stage_01.waves[0][0].characterId = 'missing' }, /characterId/],
  ['outside arena', c => { c.stages.stage_01.waves[0][0].x = 50 }, /waves.*x/],
  ['invalid unlock', c => { c.stages.stage_01.unlockCharacter = 'missing' }, /unlockCharacter/],
  ['duplicate key across players', c => { c.input.p2.basic = c.input.p1.basic }, /input.p2.basic/],
  ['reserved global key', c => { c.input.p1.basic = 'Escape' }, /input.p1.basic/],
  ['missing asset', c => { c.characters.cloud.asset = 'missing' }, /characters.cloud.asset/],
  ['invalid type', c => { c.rules.tickRate = '60' }, /tickRate/],
  ['truncated combo scaling', c => { c.rules.comboScale = [1] }, /comboScale/],
  ['broken passive skill', c => { c.passives['shell.steady'].skill = 'missing' }, /passives.*skill/],
]) {
  test('rejects ' + name, () => {
    const config = structuredClone(source)
    mutate(config)
    assert.throws(() => validateConfig(config), match)
  })
}

test('saved bindings use the same validation as initial configuration', () => {
  assert.equal(validateBindings(source.input), source.input)
  const bindings = structuredClone(source.input)
  delete bindings.p2.defend
  assert.throws(() => validateBindings(bindings), /input.p2.defend/)
})

test('only number keys one through six alias their keypad partner', () => {
  for (let n = 0; n <= 9; n++) {
    assert.equal(canonicalKeyCode('Digit' + n), 'Digit' + n)
    assert.equal(canonicalKeyCode('Numpad' + n), (n >= 1 && n <= 6 ? 'Digit' : 'Numpad') + n)
  }
  for (const code of ['NumpadEnter','Enter','ArrowDown','KeyA','NumpadDecimal']) assert.equal(canonicalKeyCode(code),code)
})

test('rejects aliased number keys both within one player and across players, including remapped spare keys', () => {
  for (const player of ['p1','p2']) {
    for (const [first,second] of [['Numpad6','Digit6'],['Digit6','Numpad6']]) {
      const bindings = structuredClone(source.input)
      bindings.p1.basic = first
      bindings[player].s1 = second
      assert.throws(() => validateBindings(bindings), new RegExp('input[.]' + player + '[.]s1'))
    }
  }
  const bindings = structuredClone(source.input)
  bindings.p1.basic = 'Digit7'
  bindings.p2.basic = 'Numpad7'
  assert.equal(validateBindings(bindings),bindings)
  assert.equal(bindings.p2.basic,'Numpad7')
})

test('standalone build validates source then resolves supplied local artwork', async () => {
  const uri = 'data:image/svg+xml;base64,PHN2Zy8+'
  const elements = {
    'inline-game-config': { textContent: JSON.stringify(source) },
    'inline-game-assets': { textContent: JSON.stringify({ './assets/shell.svg': uri }) },
  }
  const page = { getElementById: id => elements[id] }
  const config = await loadConfig(() => assert.fail('offline build attempted a request'), page)
  assert.equal(config.assets.shell.path, uri)
  assert.equal(config.assets.cloud.path, './assets/cloud.svg')
  assert.equal(config.characters.shell.hp, source.characters.shell.hp)
})

test('the current roster installs six independent kits, three unaltered sample identities and a procedural fighter', () => {
  const game = validateConfig(applyFighterModule(source, fighters))
  assert.deepEqual(game.roster, ['melancholy', 'laughing', 'sacred', 'courier', 'nailong', 'doubao'])
  assert.deepEqual(game.economy.initialCharacters, game.roster)
  assert.equal(game.characters.shell.playable, true)
  assert.ok(!game.roster.includes('shell'))
  assert.equal(game.characters.courier.name, '美团袋鼠')
  assert.equal(game.skills['melancholy.s2'].effect.type, 'semicircle')
  assert.equal(game.skills['laughing.s2'].effect.moveFrames, 16)
  assert.equal(game.skills['sacred.s1'].effect.life, 120)
  assert.equal(game.skills['courier.s2'].effect.slideFrames, 12)
  assert.equal(game.characters.nailong.name, '奶龙')
  assert.equal(game.characters.doubao.metadata.sourceName, '豆包')
  assert.equal(game.characters.doubao.presentation, 'procedural')
  assert.equal(game.skills['nailong.s2'].effect.type, 'feed')
  assert.equal(game.passives['nailong.passive'].duration, 480)
  assert.equal(game.passives['doubao.passive'].reduceFrames, 60)
  assert.equal(game.rules.resetComboOnStunExit, true)
  assert.equal(game.stages.stage_01.unlockCharacter, null)
  assert.deepEqual(game.stages.stage_03.waves[0][0], {...source.stages.stage_03.waves[0][0], characterId:'sacred'})
  assert.equal(source.stages.stage_03.waves[0][0].characterId, 'cloud')
  assert.equal(Object.keys(game.animations).length, 5)
  assert.equal(game.characters.melancholy.asset, game.characters.laughing.asset)
  assert.equal(game.characters.laughing.asset, game.characters.sacred.asset)
  for (const id of game.roster.filter(id => id !== 'doubao')) {
    assert.equal(game.characters[id].presentation, 'atlas')
    assert.deepEqual(game.animations[id].pivot, [128,232])
    assert.match(game.assets[game.characters[id].asset].path, /-model\.webp$/)
  }
  assert.equal(source.economy.initialCharacter, 'shell')
  assert.equal(source.stages.stage_01.unlockCharacter, 'cloud')
})

test('invalid animation data, passive references and duplicate stable IDs block loading', () => {
  const merged = () => applyFighterModule(source, fighters)
  let game = merged()
  game.characters.melancholy.animation = 'missing'
  assert.throws(() => validateConfig(game), /characters.melancholy.animation/)
  game = merged()
  game.passives['sacred.passive'].fieldSkill = 'melancholy.n1'
  assert.throws(() => validateConfig(game), /sacred.passive.fieldSkill/)
  game = merged()
  game.skills['courier.s2'].effect.slideFrames = 0
  assert.throws(() => validateConfig(game), /courier.s2.effect.slideFrames/)
  const conflicting = structuredClone(fighters)
  conflicting.characters.shell = source.characters.shell
  assert.throws(() => applyFighterModule(source, conflicting), /fighterModule.characters.shell/)
})

test('a missing configured character module halts loading instead of reverting to the archived roster', async () => {
  const failed = async url => url.pathname.endsWith('game.json')
    ? {ok:true, json:async () => source}
    : {ok:false, status:404}
  await assert.rejects(() => loadConfig(failed), /fighters-v04.json.*404/)
})

test('all six attacks per R1 fighter align the contact drawing with the skill event', () => {
  const game = applyFighterModule(source, fighters)
  for (const [id, clip] of Object.entries(game.animations)) {
    assert.equal(clip.actions.length, 16)
    const attacks = clip.actions.filter(action => action.skillId)
    assert.equal(attacks.length, 6)
    for (const action of attacks) {
      const skill = game.skills[action.skillId]
      const durations = action.durations
      assert.equal(durations.length, 4)
      assert.equal(durations[0] + durations[1], skill.startup + (skill.effect.slideFrames ?? 0))
      assert.equal(durations[2], skill.active)
      assert.equal(durations[3], skill.recovery)
      assert.equal(action.loop, false, id + ' / ' + action.id)
    }
  }
})

test('R1 attacks with zero startup or recovery retain the configured active frame', () => {
  const module = structuredClone(fighters)
  const skill = module.skills['melancholy.n1']
  skill.startup = 0
  skill.recovery = 0
  const game = validateConfig(applyFighterModule(source, module))
  const action = game.animations.melancholy.actions.find(clip => clip.id === 'basic1')
  assert.deepEqual(action.durations,[0,0,skill.active,0])
})
