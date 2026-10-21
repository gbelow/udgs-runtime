import { AfflictionKeySchema, DamageKindSchema, DamageSchema, SkillKeySchema, type AfflictionKey, type DamageKind, type Delivery, type Skills } from '../../types'
import type { SceneState } from '../types'
import { getOpenAction } from './log'
import { getFallDL } from './fall'

// What the GM lays on characters: an effect, and the test they roll for it.
// The effect is chosen before the test is rolled; the degree of the roll
// then decides how hard it lands (a fall by its own table, the rest turned
// against the effect as a reflex is).

export const IMPOSE_EFFECTS = ['damage', 'affliction', 'cost', 'fall'] as const
export type ImposeEffect = typeof IMPOSE_EFFECTS[number]

export const IMPOSE_SKILLS: readonly (keyof Skills)[] = SkillKeySchema.options
export const IMPOSE_DAMAGE_KINDS: readonly DamageKind[] = DamageKindSchema.options
export const IMPOSE_AFFLICTIONS: readonly AfflictionKey[] = AfflictionKeySchema.options

// The form's fields; the ones that do not belong to the effect picked are
// left alone. `skill` null is no test: the effect lands at once.
export type ImposeDraft = {
  effect: ImposeEffect
  skill: keyof Skills | null
  DL: number
  damageKind: DamageKind
  amount: number
  affliction: AfflictionKey
  AP: number
  STA: number
  height: number
}

export const IMPOSE_DRAFT: ImposeDraft = { effect: 'damage', skill: 'reflex', DL: 8, damageKind: 'blunt', amount: 4, affliction: 'prone', AP: 0, STA: 0, height: 4 }

// The effect the draft names, with the name the log gives it.
function getImposedEffect(d: ImposeDraft): Delivery['effect'] {
  const base = { trigger: 'instant' } as const
  switch (d.effect) {
    case 'damage': return { ...base, name: `${d.amount} ${d.damageKind} damage`, type: 'damage', effect: DamageSchema.parse({ damage: [{ kind: d.damageKind, value: d.amount }] }) }
    case 'affliction': return { ...base, name: d.affliction, type: 'affliction', effect: { key: d.affliction, cure: false } }
    case 'cost': return { ...base, name: `${d.AP} AP, ${d.STA} STA`, type: 'cost', effect: { AP: d.AP, STA: d.STA, exhaustion: 0, IL: 0, ET: 0 } }
    case 'fall': return { ...base, name: `fall of ${d.height} m`, type: 'fall', effect: { height: d.height } }
  }
}

export function getImposed(d: ImposeDraft): Delivery {
  const effect = getImposedEffect(d)
  const test = d.effect === 'fall' ? { roll: 'balance', DL: getFallDL(d.height), direct: true } as const : d.skill ? { roll: d.skill, DL: d.DL } : null
  return { effect, degree: null, test, when: null, then: [], locks: null }
}

// combat.tex "Balance": a fall is tested against the DL its height sets, so
// the form shows that DL rather than asking for one.
export function getImposedDL(d: ImposeDraft): number | null {
  return d.effect === 'fall' ? getFallDL(d.height) : d.skill ? d.DL : null
}

// Why nothing can be laid on `ids` now, or null.
export function getImposeBar(state: SceneState, ids: string[]): string | null {
  if (getOpenAction(state)) return 'an action is being played out'
  return ids.length === 0 ? 'pick who it falls on' : null
}
