import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { validateConfig, loadConfig, validateBindings } from '../../src/game/config.mjs'

const file = new URL('../../src/game/data/game.json', import.meta.url)
const source = JSON.parse(await readFile(file, 'utf8'))

test('default data loads and a new request observes revised tuning', async () => {
  let revision = structuredClone(source)
  const fetcher = async () => ({ ok: true, json: async () => structuredClone(revision) })
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
