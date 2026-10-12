import type { CampaignCharacter, Character, Degree } from '../../types'
import type { CampaignState, Party } from '../../campaign/types'
import type { CastPlan } from '../types'
import type { Test } from '../../play/test'
import { ABILITIES, hasAbility } from '../../abilities'
import { getKnowledgeTestTerms } from '../../character/rules/knowledge'
import { sumTerms } from '../../character/rules/terms'
import { getHealth } from '../../character/rules/skills'
import { getInjuryPenalty } from '../../character/rules/afflictions'
import { getBuffBonus } from '../../character/rules/effects'
import { getCarriedItems } from '../../item/rules/items'
import { getDosesLeft } from '../../item/rules/consumables'
import { getDoseCount } from '../../item/rules/doses'
import { getInfectionExposure } from '../../campaign/rules/place'

// abilities.tex "Medicine": the abilities used over an ET and the DL of each
// one's test — Wound Triage names none, so the table enters it.
export const ET_MEDICINE = {
  'bone-setting': { DL: 3 },
  'wound-triage': { DL: null },
} as const satisfies Record<string, { DL: number | null }>

export type ETMedicineKey = keyof typeof ET_MEDICINE

export function isETMedicine(key: string): key is ETMedicineKey {
  return Object.hasOwn(ET_MEDICINE, key)
}

// The ones the character has learned.
export function getETMedicine(c: Character): ETMedicineKey[] {
  return (Object.keys(ET_MEDICINE) as ETMedicineKey[]).filter((key) => hasAbility(c, key))
}

// The gear the ability's requirements name ("Splint", "Bandages").
function getNeededName(key: ETMedicineKey): string {
  return ABILITIES[key].requirements.flat().find((r) => r.kind === 'gear')?.name ?? ''
}

// The gear the ability requires, carried.
export function getNeeded(c: Character, key: ETMedicineKey) {
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

// How many it may be used on: one wound's bearer, or "the whole team".
export function getETTreatCount(key: ETMedicineKey, reachable: number): number {
  return key === 'wound-triage' ? reachable : 1
}

// "Wound Triage": "spends resources per character per attempt" — a dose of
// bandage per patient, as many as each patient's VM asks.
export function getBandageDoses(patients: readonly Character[]): number {
  return patients.reduce((sum, p) => sum + getDoseCount(p), 0)
}

// Why the plan cannot be carried out as it stands, or null: a wound already
// set, or bandages short of the patients.
export function getETTreatPlanBar(medic: Character, key: ETMedicineKey, patients: readonly CampaignCharacter[], plan: CastPlan): string | null {
  if (patients.length === 0) return 'aimed at nobody'
  if (key === 'bone-setting') {
    const wound = plan.wound === null ? undefined : patients[0].injuries.wounds[plan.wound]
    if (!wound) return 'no wound named'
    return wound.perDay > 0 ? 'wound already set' : null
  }
  const bandages = getNeeded(medic, key)
  return bandages && getDosesLeft(bandages) >= getBandageDoses(patients) ? null : 'not enough bandages'
}

// "make a medicine test" — story.tex "Knowledge": 2x the knowledge.
export function getETTreatTest(c: Character, key: ETMedicineKey, plan: CastPlan): Test {
  return { skill: sumTerms(getKnowledgeTestTerms('medicine')(c)), DL: ET_MEDICINE[key].DL ?? plan.DL, explodes: false, scale: 'degrees' }
}

// "Bone Setting": "It heals 0/1/2/2 per day"; "A crit does not spend the ET".
export const BONE_SETTING_PER_DAY: Record<Degree, number> = { miss: 0, graze: 1, hit: 2, critical: 2 }

export function isETSpared(key: ETMedicineKey, degree: Degree): boolean {
  return key === 'bone-setting' && degree === 'critical'
}

// "Wound Triage": "It lowers the DL of the infection test by 2", on a hit
// or better (the table's ruling).
export const TRIAGE_DL = 2

// survival.tex "Infection": "Make a health test every ET. The DL is equal to
// the |Injury penalty| + infection exposure", less what treated the
// character this ET.
export function getInfectionDL(state: CampaignState, party: Party, c: CampaignCharacter, triaged: boolean): number {
  return getInjuryPenalty(c) + getInfectionExposure(state, party) + getBuffBonus(c, 'exposure:infection') - (triaged ? TRIAGE_DL : 0)
}

export function getInfectionTest(state: CampaignState, party: Party, c: CampaignCharacter, triaged: boolean): Test {
  return { skill: getHealth(c), DL: getInfectionDL(state, party, c, triaged), explodes: false, scale: 'degrees' }
}

// "The character takes 3/1/0/0 IL damage depending on the test result."
export const INFECTION_IL: Record<Degree, number> = { miss: 3, graze: 1, hit: 0, critical: 0 }
