import type { SceneState } from '../types'
import { getAggravators, getMoraleBar, getMoraleDLOf, getPressureKey } from '../rules/morale'
import { getStressAction, getStressOwed, getStressSocial } from '../rules/stress'
import { getFightName } from '../rules/fighters'
import { perState } from '../../perState'

export type MoraleRow = {
  id: string
  name: string
  DL: number
  // what the DL is made of, as one line
  aggravators: string
  // why the test cannot be made now, null while it waits to be
  bar: string | null
  // the test as it was made, '' before it is
  result: string
  // the character's limit stress action as it stands when the test activated
  // it, else null
  limitStress: string | null
  // what is still owed of it this round, null when nothing is
  owed: string | null
}

// combat.tex "Morale": everyone the round called to a test, what weighs on
// them and, once made, how it went.
function buildMoraleRows(state: SceneState): MoraleRow[] {
  return state.morale.filter((call) => state.characters[call.id]).map(({ id, roll }) => {
    const aggravators = getAggravators(state, id)
    return {
      id,
      name: getFightName(state, id),
      DL: roll?.DL ?? getMoraleDLOf(aggravators),
      aggravators: aggravators.map((t) => `${t.label} +${t.value}`).join(', '),
      bar: getMoraleBar(state, id),
      result: roll ? `${roll.mode} · will ${roll.skill} + die ${roll.die} = ${roll.score} vs DL ${roll.DL} → ${roll.degree}` : '',
      limitStress: roll?.limitStress ? getStressAction(state, id) ?? 'not chosen' : null,
      owed: getStressOwed(state, id),
    }
  })
}

// creating.tex "Limit Stress Actions": why the table cannot take the
// character for a coward, or null — only one compelled to a social action.
export function getCowardBar(state: SceneState, id: string): string | null {
  return getStressSocial(state, id) ? null : 'not compelled to a social action'
}

export const getMoraleRows = perState(buildMoraleRows)

export const getMoraleDigest = perState((state) => JSON.stringify(getMoraleRows(state)))

export type TablePressureRow = { id: string; name: string; value: number }

// combat.tex "Morale", "Pressure": each party in the fight (and whoever is in
// none) and the pressure the table has set on it.
export const getTablePressureRows = perState((state): TablePressureRow[] => {
  const keys = [...new Set(Object.keys(state.characters).map((id) => getPressureKey(state, id)))]
  return keys.map((key) => ({ id: key, name: state.parties[key]?.name ?? 'no party', value: state.tablePressure[key] ?? 0 }))
})

export const getTablePressureDigest = perState((state) => JSON.stringify(getTablePressureRows(state)))
