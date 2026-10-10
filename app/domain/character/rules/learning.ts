import { Attributes, AttributesSchema, Character, Knowledges, Proficiencies, ProficienciesSchema, Skills, Talents, TalentsSchema, Trainables } from '../../types'
import { getSM } from './size'

export type TalentKey = keyof Talents
export type LearningPrice = { currency: 'XP' | 'karma'; amount: number }

// What is trained as a skill: the skills, and the formal knowledges
// (creating.tex "Learning Knowledge": learned as skills are).
export type SkillKey = keyof Skills | keyof Knowledges

// creating.tex "Skills" table, Talent column: the talent a skill is trained
// with. Null where the book marks it not trainable — it rises only through
// its proficiency, or its knowledge for Exploration. SD is not in the table.
// A formal knowledge is trained "using INT as the talent".
export const SKILL_TALENTS: Record<SkillKey, TalentKey | null> = {
  strike: 'DEX',
  defend: 'DEX',
  reflex: null,
  accuracy: 'DEX',
  grapple: null,
  SD: null,
  stealth: 'DEX',
  prestidigitation: 'DEX',
  balance: 'DEX',
  detection: null,
  health: null,
  force: null,
  swim: 'DEX',
  climb: 'DEX',
  explore: null,
  cunning: 'INT',
  will: null,
  persuasion: 'INT',
  deception: 'INT',
  insight: 'INT',
  alchemy: 'INT',
  animancy: 'INT',
  biomancy: 'INT',
  shamanism: 'INT',
  mechanics: 'INT',
  smithing: 'INT',
  chemistry: 'INT',
  medicine: 'INT',
  linguistics: 'INT',
  navigation: 'INT',
  survival: 'INT',
  'animal handling': 'INT',
}

export const SKILL_KEYS = Object.keys(SKILL_TALENTS) as SkillKey[]
export const isSkillKey = (key: keyof Trainables): key is SkillKey => key in SKILL_TALENTS

// creating.tex "Proficiencies": the talent named beside each.
export const PROFICIENCY_TALENTS: Record<keyof Proficiencies, TalentKey> = {
  melee: 'DEX',
  ranged: 'DEX',
  awareness: 'DEX',
  sorcery: 'INT',
  conviction1: 'SPI',
  conviction2: 'SPI',
  devotion: 'SPI',
  charisma: 'SPI',
}

// creating.tex "Level Limits": "talent and proficiency range from 0 to 5";
// "Improving attributes": "impossible to have any attribute higher than 20".
// Skills and knowledges have no limit.
export const MAX_TALENT = 5
export const MAX_PROFICIENCY = 5
export const MAX_ATTRIBUTE = 20

// creating.tex "Changing attributes": one point moved between attributes.
export const ATTRIBUTE_SWAP_XP = 2

// spells.tex "Learning spells": "Doing it this way costs 6 XP" — the price of
// the intuitive route, which creation charges for a spell by any route.
export const SPELL_LEARN_XP = 6

// creating.tex "Improving proficiencies": "If the talent is lower than the
// level one wants to reach, this value is multiplied by 2^x". Abilities are
// priced the same way at their training level (abilities.tex "Cost").
export function getTalentMultiplier(level: number, talent: number): number {
  return 2 ** Math.max(0, level - talent)
}

// creating.tex "Improving proficiencies": 4+4n to reach level n.
export function getProficiencyXPCost(level: number, talent: number): number {
  return (4 + 4 * level) * getTalentMultiplier(level, talent)
}

// creating.tex "Improving skills": 2+2n, "exactly the same" logic otherwise.
export function getSkillXPCost(level: number, talent: number): number {
  return (2 + 2 * level) * getTalentMultiplier(level, talent)
}

// creating.tex "Improving Talents": karma, 4+4n to reach level n.
export function getTalentKarmaCost(level: number): number {
  return 4 + 4 * level
}

export const ATTRIBUTE_KEYS = Object.keys(AttributesSchema.shape) as (keyof Attributes)[]

// creating.tex "Improving attributes": the average the trained attributes may
// reach before raising them costs more, 10+CON-SM. An ability moves it only
// through the size it gives (abilities.tex "Grow!", "Shrink!").
export function getAttributeBalance(c: Character): number {
  return 10 + c.trainables.CON.value - getSM(c)
}

// creating.tex "Improving attributes": the target value divided by 2, rounded
// down, doubled once the average of the three attributes exceeds the balance
// and raised by another +100% for every point beyond. The average is the one
// the raise would leave.
export function getAttributeXPCost(target: number, average: number, balance: number): number {
  const excess = average - balance
  return Math.floor(target / 2) * (1 + Math.max(0, Math.ceil(excess)))
}

// The XP for raising the attributes from `from` to `to`, a point at a time:
// the price of a point turns on the average it leaves, so the points are
// priced in a fixed order — always the lowest attribute next, as raising them
// evenly would.
export function getAttributeRaisesXPCost(from: number[], to: number[], balance: number): number {
  const values = [...from]
  let amount = 0
  for (;;) {
    let next = -1
    values.forEach((v, i) => { if (v < to[i] && (next < 0 || v < values[next])) next = i })
    if (next < 0) return amount
    values[next]++
    amount += getAttributeXPCost(values[next], values.reduce((a, b) => a + b, 0) / values.length, balance)
  }
}

const talentOf =(c: Character, talent: TalentKey): number => c.trainables[talent].value

// The price of the next level of a skill, or null when the book does not
// let the skill be trained on its own.
export function getSkillRaisePrice(key: SkillKey): (c: Character) => LearningPrice | null {
  return (c: Character) => {
    const talent = SKILL_TALENTS[key]
    if (talent === null) return null
    return { currency: 'XP', amount: getSkillXPCost(c.trainables[key].value + 1, talentOf(c, talent)) }
  }
}

export function getProficiencyRaisePrice(key: keyof Proficiencies): (c: Character) => LearningPrice | null {
  return (c: Character) => {
    const level = c.trainables[key].value + 1
    if (level > MAX_PROFICIENCY) return null
    return { currency: 'XP', amount: getProficiencyXPCost(level, talentOf(c, PROFICIENCY_TALENTS[key])) }
  }
}

export function getTalentRaisePrice(key: TalentKey): (c: Character) => LearningPrice | null {
  return (c: Character) => {
    const level = c.trainables[key].value + 1
    if (level > MAX_TALENT) return null
    return { currency: 'karma', amount: getTalentKarmaCost(level) }
  }
}

export function getAttributeRaisePrice(key: keyof Attributes): (c: Character) => LearningPrice | null {
  return (c: Character) => {
    const { STR, AGI, STA } = c.trainables
    const target = c.trainables[key].value + 1
    if (target > MAX_ATTRIBUTE) return null
    const average = (STR.value + AGI.value + STA.value + 1) / 3
    return { currency: 'XP', amount: getAttributeXPCost(target, average, getAttributeBalance(c)) }
  }
}

// The highest level a trainable can be raised to, null when it has no limit.
export function getTrainableLimit(key: keyof Trainables): number | null {
  if (key in ProficienciesSchema.shape) return MAX_PROFICIENCY
  if (key in TalentsSchema.shape) return MAX_TALENT
  if (key in AttributesSchema.shape) return MAX_ATTRIBUTE
  return null
}

export function getTrainableRaisePrice(key: keyof Trainables): (c: Character) => LearningPrice | null {
  if (isSkillKey(key)) return getSkillRaisePrice(key)
  if (key in ProficienciesSchema.shape) return getProficiencyRaisePrice(key as keyof Proficiencies)
  if (key in TalentsSchema.shape) return getTalentRaisePrice(key as TalentKey)
  return getAttributeRaisePrice(key as keyof Attributes)
}

// creating.tex "Changing attributes": a point out of one attribute into
// another, null when the receiving one is already at the limit.
export function getAttributeSwapPrice(to: keyof Attributes): (c: Character) => LearningPrice | null {
  return (c: Character) => c.trainables[to].value + 1 > MAX_ATTRIBUTE ? null : { currency: 'XP', amount: ATTRIBUTE_SWAP_XP }
}
