import { NEEDS_FOCUS } from '../../character/rules/surge'
import { isCombatStarted } from './started'
import { DamageSchema, type CampaignCharacter, type Degree } from '../../types'
import type { ActionCost } from '../../character/rules/actionCosts'
import type { Term } from '../../character/rules/terms'
import { ABILITIES, hasAbility, type AbilityKey } from '../../abilities'
import { canAfford, canAffordOrHold, CANNOT_AFFORD } from '../../character/rules/cost'
import { getKnowledge, getKnowledgeTestTerms } from '../../character/rules/knowledge'
import { isDead } from '../../character/rules/afflictions'
import { isAlly } from './protection'
import { hasFightAffliction } from './situational'
import type { Test } from '../../play/test'
import { landed } from '../../character/rules/production'
import { getHealth } from '../../character/rules/skills'
import { getTendWoundsTest } from '../../character/rules/tendWounds'
import type { CauterizeAction, FirstAidAction, SceneState, TendWoundsAction } from '../types'
import { getAdjacentIds } from './board/board'

export type MedicineKind = 'firstAid' | 'tendWounds' | 'cauterize'
type LearnedMedicineKind = Exclude<MedicineKind, 'tendWounds'>

// The ability each learned medicine action is the use of. Tend Wounds is
// anyone's, learned by nobody (combat.tex "Tend Wounds").
const ABILITY: Record<LearnedMedicineKind, AbilityKey> = {
  firstAid: 'first-aid',
  cauterize: 'cauterization',
}

// combat.tex "Tend Wounds": "It takes 8 AP during combat, requires
// concentration".
const TEND_WOUNDS: ActionCost = { AP: 8, STA: 0 }

// abilities.tex "First Aid": "on self or other" — the actor, or anyone next
// to them (the table's ruling: in melee), who is bleeding. On a fight
// without a board everyone is next to everyone.
export function getMedicineTargets(state: SceneState, actorId: string): string[] {
  const near = state.board === null ? Object.keys(state.characters) : [actorId, ...getAdjacentIds(state, actorId)]
  return near.filter((id) => state.characters[id]?.injuries.bleed > 0)
}

// What the action costs: the ability's own price (the table's ruling for
// First Aid's "full turn": 8 AP), or Tend Wounds' own.
export function getMedicineCost(kind: MedicineKind): ActionCost {
  if (kind === 'tendWounds') return TEND_WOUNDS
  const { AP, STA } = ABILITIES[ABILITY[kind]].cost
  return { AP, STA }
}

// Why the character cannot make the action now, or null. All require
// concentration (abilities.tex "Medicine", combat.tex "Tend Wounds"): the
// focus surge, and held over for want of the AP.
export function getMedicineBar(state: SceneState, c: CampaignCharacter, kind: MedicineKind): string | null {
  if (kind !== 'tendWounds' && !hasAbility(c, ABILITY[kind])) return `${ABILITIES[ABILITY[kind]].name} not learned`
  if (isCombatStarted(state) && c.usedSurge !== 'focus') return NEEDS_FOCUS
  if (kind === 'tendWounds' && c.injuries.bleed === 0) return 'not bleeding'
  if (kind !== 'tendWounds' && getMedicineTargets(state, c.id).length === 0) return 'nobody bleeding within reach'
  const cost = getMedicineCost(kind)
  return (isConcentrationMedicine(kind) ? canAffordOrHold(c, cost, isCombatStarted(state)) : canAfford(c, cost, isCombatStarted(state))) ? null : CANNOT_AFFORD
}

// Whether the action requires concentration: Tend Wounds always, a learned
// one as the catalog marks its ability.
export function isConcentrationMedicine(kind: MedicineKind): boolean {
  return kind === 'tendWounds' || ABILITIES[ABILITY[kind]].concentration
}

// The ability a learned medicine action is the use of.
export function getMedicineAbility(kind: LearnedMedicineKind): AbilityKey {
  return ABILITY[kind]
}

// abilities.tex "First Aid": "Make a test of medicine + target's health
// against a DL equal to the bleeding".
export function getFirstAidTerms(state: SceneState, root: FirstAidAction): { skill: Term[]; DL: Term[] } | null {
  const actor = state.characters[root.actorId]
  const target = root.targetId ? state.characters[root.targetId] : undefined
  return actor && target ? { skill: [...getKnowledgeTestTerms('medicine')(actor), { label: "target's health", value: getHealth(target) }], DL: [{ label: 'bleed', value: target.injuries.bleed }] } : null
}

// combat.tex "Tend Wounds": "a health test vs bleed value", the actor's own.
export function getTendWoundsTerms(state: SceneState, root: TendWoundsAction): { skill: Term[]; DL: Term[] } | null {
  const actor = state.characters[root.actorId]
  return actor ? getTendWoundsTest(actor).terms : null
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

// abilities.tex "First Aid": "At the end of the fights, a character with
// first aid can add its medicine knowledge to everyone's tend wounds test":
// the best medicine among the patient's allies, themselves included, who
// have learned it and are neither dead nor unconscious (the user's ruling).
export function getAfterFightMedicine(state: SceneState, patientId: string): Term[] {
  const best = Object.values(state.characters)
    .filter((m) => isAlly(state, m.id, patientId) && hasAbility(m, ABILITY.firstAid) && !isDead(m) && !hasFightAffliction(state, m, 'unconscious'))
    .reduce<number | null>((top, m) => Math.max(top ?? -Infinity, getKnowledge('medicine')(m)), null)
  return best === null ? [] : [{ label: 'first aid: medicine', value: best }]
}

// combat.tex "Bleed": the tend wounds test made as the fight ends, with what
// a medic adds to it.
export function getAfterFightTest(state: SceneState, c: CampaignCharacter): Test {
  return getTendWoundsTest(c, getAfterFightMedicine(state, c.id))
}

// combat.tex "Tend Wounds": "stops 0/0/1/2 bleed per use", and staunches
// nothing.
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
