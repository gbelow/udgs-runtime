import { SOCIAL_ACTIONS, type SocialAction } from '../../tables'
import type { SceneState } from '../types'
import { getAggravators, getMoraleBar, getMoraleDLOf, getPressureKey, getSocialValue } from '../rules/morale'
import { getInsultBar, getSayBar, getSocialBar, getSocialTargets, getSurrenderBar, getUnsurrenderBar } from '../rules/social'
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

export type SocialPanel = {
  // why nothing can be said now, null while it can
  bar: string | null
  // why the character cannot negotiate, and cannot raise or lower the surrender flag
  negotiateBar: string | null
  // why the abusive cannot insult now, and why they cannot be taken for a coward
  insultBar: string | null
  cowardBar: string | null
  surrenderBar: string | null
  unsurrenderBar: string | null
  surrendered: boolean
  // what each one weighs on the morale DL
  value: number
  // each kind, and whether it has someone to be said to with nobody picked
  kinds: { kind: SocialAction; atDefault: boolean }[]
  insultAtDefault: boolean
  // whom it can be said to, in place of the default group
  targets: { id: string; name: string }[]
}

// combat.tex "Social actions": for the character, what saying one costs them
// in value and who is there to say it to.
export function getSocialPanel(state: SceneState, id: string): SocialPanel {
  const c = state.characters[id]
  const targets = Object.keys(state.characters).filter((t) => t !== id).map((t) => ({ id: t, name: getFightName(state, t) }))
  return {
    bar: getSayBar(state, id, 'intimidate', targets.map((t) => t.id)),
    negotiateBar: getSocialBar(state, id),
    insultBar: getInsultBar(state, id, targets.map((t) => t.id)),
    cowardBar: getStressSocial(state, id) ? null : 'not compelled to a social action',
    surrenderBar: getSurrenderBar(state, id),
    unsurrenderBar: getUnsurrenderBar(state, id),
    surrendered: state.surrendered.includes(id),
    value: c ? getSocialValue(c) : 0,
    kinds: SOCIAL_ACTIONS.map((kind) => ({ kind, atDefault: getSocialTargets(state, id, kind, []).length > 0 })),
    insultAtDefault: getSocialTargets(state, id, 'insult', []).length > 0,
    targets,
  }
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
