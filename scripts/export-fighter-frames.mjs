import {readFile, writeFile} from 'node:fs/promises'
import {applyFighterModule, validateConfig} from '../src/game/config.mjs'

const readData = async file => JSON.parse(await readFile(new URL('../src/game/data/' + file, import.meta.url), 'utf8'))
const base = await readData('game.json')
const module = await readData(base.fighterModule)
const config = validateConfig(applyFighterModule(base, module))
const {cell, pivot} = module.animationLayout
const fighters = Object.entries(config.animations).map(([game_id, clip]) => {
  const character = config.characters[game_id]
  const actions = clip.actions.map(action => {
    const stem = clip.sheets[action.sheet]
    const frames = action.columns.map((column, frame_index) => ({
      frame_index, column, duration:action.durations[frame_index], pivot,
      file:'frames/' + stem + '/r' + action.row + 'c' + column + '.png',
      ...(action.event && frame_index === 2 ? {event:action.event} : {})
    }))
    return {id:action.id, label:action.label, sheet:'atlases/' + stem + '.png',
      row:action.row, loop:action.loop, ...(action.skillId ? {skill_id:action.skillId} : {}), frames}
  })
  return {id:clip.sourceId, game_id, name:character.name, model:'atlases/' + clip.family + '-model.png', actions}
})
const index = {version:'R1.1', fps:config.rules.tickRate, cell, pivot, fighters}
if (!process.argv[2]) throw new Error('请指定输出 JSON 路径')
await writeFile(process.argv[2], JSON.stringify(index, null, 2) + '\n')
