import { NEEDS_FOCUS } from '../../character/rules/surge'
import { isCombatStarted } from './started'
import { DamageSchema, type CampaignCharacter, type Degree } from '../../types'
import type { ActionCost } from '../../character/rules/actionCosts'
import type { Term } from '../../character/rules/terms'
import { ABILITIES, hasAbility, type AbilityKey } from '../../abilities'
import { canAfford, canAffordOrHold, CANNOT_AFFORD } from '../../character/rules/cost'
import { getKnowledgeTestTerms } from '../../character/rules/knowledge'
import { landed } from '../../character/rules/production'
import { getHealth, getHealthTerms } from '../../character/rules/skills'
import type { CauterizeAction, FirstAidAction, SceneState, TendWoundsAction } from '../types'
import { getAdjacentIds } from './board/board'

export type MedicineKind = 'firstAid' | 'tendWounds' | 'cauterize'

// The ability each medicine action is the use of.
const ABILITY: Record<MedicineKind, AbilityKey> = {
  firstAid: 'first-aid',
  tendWounds: 'tend-wounds',
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

// Why the character cannot make the action now, or null. All are marked
// concentration in the catalog (abilities.tex "Medicine"): the focus surge,
// and held over for want of the AP.
export function getMedicineBar(state: SceneState, c: CampaignCharacter, kind: MedicineKind): string | null {
  if (!hasAbility(c, ABILITY[kind])) return `${ABILITIES[ABILITY[kind]].name} not learned`
  if (isCombatStarted(state) && c.usedSurge !== 'focus') return NEEDS_FOCUS
  if (kind === 'tendWounds' && c.injuries.bleed === 0) return 'not bleeding'
  if (kind !== 'tendWounds' && getMedicineTargets(state, c.id).length === 0) return 'nobody bleeding within reach'
  const cost = getMedicineCost(kind)
  return (isConcentrationAbility(kind) ? canAffordOrHold(c, cost, isCombatStarted(state)) : canAfford(c, cost, isCombatStarted(state))) ? null : CANNOT_AFFORD
}

// Whether the catalog marks the ability the action is the use of as
// requiring concentration.
export function isConcentrationAbility(kind: MedicineKind): boolean {
  return ABILITIES[ABILITY[kind]].concentration
}

// The ability a medicine action is the use of.
export function getMedicineAbility(kind: MedicineKind): AbilityKey {
  return ABILITY[kind]
}

// abilities.tex "First Aid": "Make a test of medicine + target's health
// against a DL equal to the bleeding".
export function getFirstAidTerms(state: SceneState, root: FirstAidAction): { skill: Term[]; DL: Term[] } | null {
  const actor = state.characters[root.actorId]
  const target = root.targetId ? state.characters[root.targetId] : undefined
  return actor && target ? { skill: [...getKnowledgeTestTerms('medicine')(actor), { label: "target's health", value: getHealth(target) }], DL: [{ label: 'bleed', value: target.injuries.bleed }] } : null
}

// abilities.json "Tend Wounds": a health test against the actor's own bleed.
export function getTendWoundsTerms(state: SceneState, root: TendWoundsAction): { skill: Term[]; DL: Term[] } | null {
  const actor = state.characters[root.actorId]
  return actor ? { skill: getHealthTerms(actor), DL: [{ label: 'bleed', value: actor.injuries.bleed }] } : null
}

// "Reduces bleeding by 0/0/1/2", First Aid's and Tend Wounds' alike.
const FIRST_AID_BLEED: Record<Degree, number> = { miss: 0, graze: 0, hit: 1, critical: 2 }

const stopBleed = (name: string, amount: number) =>
  landed({ name, trigger: 'instant', type: 'heal', effect: { of: 'bleed', amount, nutrition: 0, wound: null, part: null } })

// "Reduces bleeding by 0/0/1/2"; the bleed it staunches on a hit or crit is
// the reducer's, read off the roll.
export function getFirstAidFacts(root: FirstAidAction): FirstAidAction['facts'] {
  const bleed = FIRST_AID_BLEED[root.roll?.degree ?? 'miss']
  return root.targetId ? { [root.targetId]: bleed > 0 ? [stopBleed('first aid', bleed)] : [] } : {}
}

// Tend Wounds lowers the bleed as First Aid does, and staunches nothing.
export function getTendWoundsFacts(root: TendWoundsAction): TendWoundsAction['facts'] {
  const bleed = FIRST_AID_BLEED[root.roll?.degree ?? 'miss']
  return { [root.actorId]: bleed > 0 ? [stopBleed('tend wounds', bleed)] : [] }
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
