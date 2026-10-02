import { SOCIAL_ACTIONS, type SocialAction } from '../../tables'
import type { CombatState } from '../types'
import { getAggravators, getMoraleBar, getMoraleDL, getSocialValue } from '../rules/morale'
import { getSocialBar } from '../rules/social'
import { getFightName } from '../rules/fighters'
import { perState } from './perState'

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
  limitStress: boolean
}

// combat.tex "Morale": everyone the round called to a test, what weighs on
// them and, once made, how it went.
function buildMoraleRows(state: CombatState): MoraleRow[] {
  return state.morale.filter((call) => state.characters[call.id]).map(({ id, roll }) => ({
    id,
    name: getFightName(state, id),
    DL: roll?.DL ?? getMoraleDL(state, id),
    aggravators: getAggravators(state, id).map((t) => `${t.label} +${t.value}`).join(', '),
    bar: getMoraleBar(state, id),
    result: roll ? `${roll.mode} · will ${roll.skill} + die ${roll.die} = ${roll.score} vs DL ${roll.DL} → ${roll.degree}` : '',
    limitStress: roll?.limitStress ?? false,
  }))
}

export type SocialPanel = {
  // why nothing can be said now, null while it can
  bar: string | null
  // what each one weighs on the morale DL
  value: number
  kinds: readonly SocialAction[]
  // whom it can be said to
  targets: { id: string; name: string }[]
}

// combat.tex "Social actions": for the character, what saying one costs them
// in value and who is there to say it to.
export function getSocialPanel(state: CombatState, id: string): SocialPanel {
  const c = state.characters[id]
  const targets = Object.keys(state.characters).filter((t) => t !== id).map((t) => ({ id: t, name: getFightName(state, t) }))
  return { bar: getSocialBar(state, id, 'intimidate', targets.map((t) => t.id)), value: c ? getSocialValue(c) : 0, kinds: SOCIAL_ACTIONS, targets }
}

export const getMoraleRows = perState(buildMoraleRows)

export const getMoraleDigest = perState((state) => JSON.stringify(getMoraleRows(state)))
