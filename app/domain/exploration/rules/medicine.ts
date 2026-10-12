import type { CampaignCharacter, Character, Degree } from '../../types'
import type { CastPlan } from '../types'
import type { Test } from '../../play/test'
import { ABILITIES, hasAbility } from '../../abilities'
import { getKnowledgeTestTerms } from '../../character/rules/knowledge'
import { sumTerms } from '../../character/rules/terms'
import { getCarriedItems } from '../../item/rules/items'

// abilities.tex "Medicine": the abilities used over an ET and the DL of each
// one's test.
export const ET_MEDICINE = {
  'bone-setting': { DL: 3 },
} as const satisfies Record<string, { DL: number }>

export type ETMedicineKey = keyof typeof ET_MEDICINE

export function isETMedicine(key: string): key is ETMedicineKey {
  return Object.hasOwn(ET_MEDICINE, key)
}

// The ones the character has learned.
export function getETMedicine(c: Character): ETMedicineKey[] {
  return (Object.keys(ET_MEDICINE) as ETMedicineKey[]).filter((key) => hasAbility(c, key))
}

// The gear the ability's requirements name ("Splint").
function getNeededName(key: ETMedicineKey): string {
  return ABILITIES[key].requirements.flat().find((r) => r.kind === 'gear')?.name ?? ''
}

// The gear the ability requires, carried.
function getNeeded(c: Character, key: ETMedicineKey) {
  return getCarriedItems(c).find((i) => i.name === getNeededName(key)) ?? null
}

// What stands between the medic and using it over the coming ET.
export function getETTreatBar(c: Character, key: ETMedicineKey): string | null {
  if (!hasAbility(c, key)) return `${ABILITIES[key].name} not learned`
  return getNeeded(c, key) ? null : `needs ${getNeededName(key)}`
}

// "Bone Setting": "The test only needs to be done once per wound" — the
// wounds of the patient not set yet.
export function getUnsetWounds(c: CampaignCharacter): number[] {
  return c.injuries.wounds.flatMap((w, index) => (w.perDay > 0 ? [] : [index]))
}

// How many it may be used on: one wound's bearer.
export const TREAT_COUNT = 1

// Why the plan cannot be carried out as it stands, or null: no wound named,
// or one already set.
export function getETTreatPlanBar(patients: readonly CampaignCharacter[], plan: CastPlan): string | null {
  if (patients.length === 0) return 'aimed at nobody'
  const wound = plan.wound === null ? undefined : patients[0].injuries.wounds[plan.wound]
  if (!wound) return 'no wound named'
  return wound.perDay > 0 ? 'wound already set' : null
}

// "make a medicine test" — story.tex "Knowledge": 2x the knowledge.
export function getETTreatTest(c: Character, key: ETMedicineKey): Test {
  return { skill: sumTerms(getKnowledgeTestTerms('medicine')(c)), DL: ET_MEDICINE[key].DL, explodes: false, scale: 'degrees' }
}

// "Bone Setting": "It heals 0/1/2/2 per day"; "A crit does not spend the ET".
export const BONE_SETTING_PER_DAY: Record<Degree, number> = { miss: 0, graze: 1, hit: 2, critical: 2 }

export function isETSpared(key: ETMedicineKey, degree: Degree): boolean {
  return key === 'bone-setting' && degree === 'critical'
}
