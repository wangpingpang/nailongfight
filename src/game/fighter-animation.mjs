// Sprite timings follow the fixed-step combat parameters, including the slide before impact.
const skillSlots = {skill1:'s1', skill2:'s2', ult:'ult'}
const contactEvents = {field:'place_field', marker:'place_marker', backstep:'start_backstep', feed:'gain_fed'}

export function buildFighterAnimation(layout, fighter, clip, skills) {
  const actions = layout.actions.map(action => {
    const slot = skillSlots[action.id]
    const skillId = slot ? fighter[slot] : action.id.startsWith('basic') && fighter.basic[Number(action.id.slice(5)) - 1]
    const skill = skills[skillId]
    if (!skill) return {...action, columns:[0,1,2,3]}
    const slide = skill.effect.slideFrames ?? 0
    const anticipate = slide ? skill.startup : Math.floor(skill.startup / 2)
    return {...action, label:skill.name, skillId, columns:[0,1,2,3],
      event:contactEvents[skill.effect.type] ?? 'hitbox_active',
      durations:[anticipate, skill.startup + slide - anticipate, skill.active, skill.recovery]}
  })
  return {...clip, id:fighter.id, rows:layout.rows, columns:layout.columns, cell:layout.cell, pivot:layout.pivot, actions}
}
