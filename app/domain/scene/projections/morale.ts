import type { SceneState } from '../types'
import { getAggravators, getEnemyNear, getFatefulBar, getHypeUpBar, getMoraleBar, getMoraleDLOf, getMoraleModes, getPressureKey, getSkipMoraleBar } from '../rules/morale'
import { hasGrant } from '../../character/rules/effects'
import { describeThrow } from '../../character/rules/terms'
import type { RollMode } from '../../play/dice'
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
  // the ways the character may throw it
  modes: RollMode[]
  // the test as it was made, '' before it is
  result: string
  // whether an enemy is within 30 m as the board measures it, null where the
  // board cannot tell and the table says
  enemyNear: boolean | null
  // the character's limit stress action as it stands when the test activated
  // it, else null
  limitStress: string | null
  // what is still owed of it this round, null when nothing is
  owed: string | null
  // abilities.tex "Hype up": null when the character has not learned it or
  // has not tested yet, else why they cannot enrage themselves now ('' when
  // they can)
  hypeUp: string | null
  // abilities.json "Hype Up": null unless the character chose whether to be
  // tested, else why they cannot pass it up now ('' when they can)
  skip: string | null
  // abilities.tex "Fateful": null unless the test is left open, else why it
  // cannot be rerolled now ('' when it can); it can always be kept
  reroll: string | null
}

// combat.tex "Morale": everyone the round called to a test, what weighs on
// them and, once made, how it went.
function buildMoraleRows(state: SceneState): MoraleRow[] {
  return state.morale.filter((call) => state.characters[call.id]).map(({ id, roll, optional }) => {
    const aggravators = getAggravators(state, id)
    return {
      id,
      name: getFightName(state, id),
      DL: roll?.DL ?? getMoraleDLOf(aggravators),
      aggravators: aggravators.map((t) => `${t.label} +${t.value}`).join(', '),
      bar: getMoraleBar(state, id),
      enemyNear: getEnemyNear(state, id),
      modes: getMoraleModes(state.characters[id]),
      result: roll ? `${roll.open ? 'open · ' : ''}${roll.mode} · ${describeThrow(roll.die, roll.skill, roll.skillTerms, 'will', roll.score)} vs DL ${roll.DL} → ${roll.degree}${roll.resisted ? ` · +${roll.resisted} against the compulsion` : ''}${roll.rerolled ? ' · rerolled' : ''}${roll.hyped ? ' · hyped up' : ''}` : '',
      limitStress: roll?.limitStress ? getStressAction(state, id) ?? 'not chosen' : null,
      owed: getStressOwed(state, id),
      hypeUp: roll && hasGrant(state.characters[id], 'hypeUp') ? getHypeUpBar(state, id) ?? '' : null,
      skip: optional && !roll ? getSkipMoraleBar(state, id) ?? '' : null,
      reroll: roll?.open ? getFatefulBar(state, id) ?? '' : null,
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
