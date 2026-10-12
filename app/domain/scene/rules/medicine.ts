import { DamageSchema, type CampaignCharacter, type Degree } from '../../types'
import type { ActionCost } from '../../character/rules/actionCosts'
import type { Term } from '../../character/rules/terms'
import { ABILITIES, hasAbility, type AbilityKey } from '../../abilities'
import { canAfford } from '../../character/rules/cost'
import { getKnowledgeTestTerms } from '../../character/rules/knowledge'
import { landed } from '../../character/rules/production'
import type { CauterizeAction, FirstAidAction, SceneState } from '../types'
import { getAdjacentIds } from './board/board'

export type MedicineKind = 'firstAid' | 'cauterize'

// The ability each medicine action is the use of.
const ABILITY: Record<MedicineKind, AbilityKey> = {
  firstAid: 'first-aid',
  cauterize: 'cauterization',
}

// abilities.tex "First Aid": "on self or other" — the actor, or anyone next
// to them (the table's ruling: in melee), who is bleeding. On a fight
// without a board everyone is next to everyone.
export function getMedicineTargets(state: SceneState, actorId: string): string[] {
  const near = state.board === null ? Object.keys(state.characters) : [actorId, ...getAdjacentIds(state, actorId)]
  return near.filter((id) => state.characters[id]?.injuries.bleed > 0)
}

// What the action costs: the ability's own price (the table's ruling for
// First Aid's "full turn": 8 AP).
export function getMedicineCost(kind: MedicineKind): ActionCost {
  const { AP, STA } = ABILITIES[ABILITY[kind]].cost
  return { AP, STA }
}

// Why the character cannot make the action now, or null. Cauterization
// "Requires a focus surge", and First Aid too (the table's ruling).
export function getMedicineBar(state: SceneState, c: CampaignCharacter, kind: MedicineKind): string | null {
  if (!hasAbility(c, ABILITY[kind])) return `${ABILITIES[ABILITY[kind]].name} not learned`
  if (c.usedSurge !== 'focus') return 'needs the focus surge'
  if (getMedicineTargets(state, c.id).length === 0) return 'nobody bleeding within reach'
  return canAfford(c, getMedicineCost(kind)) ? null : 'cannot afford'
}

// abilities.tex "First Aid": "Make a medicine test against a DL equal to 2x
// bleeding".
export function getFirstAidTerms(state: SceneState, root: FirstAidAction): { skill: Term[]; DL: Term[] } | null {
  const actor = state.characters[root.actorId]
  const target = root.targetId ? state.characters[root.targetId] : undefined
  return actor && target ? { skill: getKnowledgeTestTerms('medicine')(actor), DL: [{ label: '2x bleed', value: 2 * target.injuries.bleed }] } : null
}

const FIRST_AID_BLEED: Record<Degree, number> = { miss: 0, graze: 0, hit: 1, critical: 2 }

const stopBleed = (name: string, amount: number) =>
  landed({ name, trigger: 'instant', type: 'heal', effect: { of: 'bleed', amount, nutrition: 0, wound: null, part: null } })

// "Reduces bleeding by 0/0/1/2"; the bleed it staunches on a hit or crit is
// the reducer's, read off the roll.
export function getFirstAidFacts(root: FirstAidAction): FirstAidAction['facts'] {
  const bleed = FIRST_AID_BLEED[root.roll?.degree ?? 'miss']
  return root.targetId ? { [root.targetId]: bleed > 0 ? [stopBleed('first aid', bleed)] : [] } : {}
}

// abilities.tex "Cauterization": "Causes 10 fire damage that ignores armor
// and reduces bleeding by 2" — to the flesh, without setting it burning
// (the table's ruling).
const CAUTERY = { burn: 10, bleed: 2 } as const

export function getCauterizeFacts(root: CauterizeAction): CauterizeAction['facts'] {
  if (!root.targetId) return {}
  return {
    [root.targetId]: [
      landed({ name: 'cauterization', trigger: 'instant', type: 'damage', effect: DamageSchema.parse({ damage: [{ kind: 'burn', value: CAUTERY.burn }], bare: true, sear: true }) }),
      stopBleed('cauterization', CAUTERY.bleed),
    ],
  }
}
