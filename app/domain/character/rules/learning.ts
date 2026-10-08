import { Attributes, Character, Proficiencies, ProficienciesSchema, Skills, SkillsSchema, Talents, TalentsSchema, Trainables } from '../../types'
import { getSM } from './size'

export type TalentKey = keyof Talents
export type LearningPrice = { currency: 'XP' | 'karma'; amount: number }

// creating.tex "Skills" table, Talent column: the talent a skill is trained
// with. Null where the book marks it not trainable — it rises only through
// its proficiency, or its knowledge for Exploration. SD is not in the table.
export const SKILL_TALENTS: Record<keyof Skills, TalentKey | null> = {
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
}

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
// creating.tex "Learning Knowledge": knowledges are learned as skills are.
export function getSkillXPCost(level: number, talent: number): number {
  return (2 + 2 * level) * getTalentMultiplier(level, talent)
}

// creating.tex "Improving Talents": karma, 4+4n to reach level n.
export function getTalentKarmaCost(level: number): number {
  return 4 + 4 * level
}

// creating.tex "Improving attributes": the target value divided by 2, rounded
// down, doubled once the average of the three attributes exceeds 10+CON-SM
// and raised by another +100% for every point beyond. The average is the one
// the raise would leave.
export function getAttributeXPCost(target: number, average: number, CON: number, SM: number): number {
  const excess = average - (10 + CON - SM)
  return Math.floor(target / 2) * (1 + Math.max(0, Math.ceil(excess)))
}

const talentOf = (c: Character, talent: TalentKey): number => c.trainables[talent].value

// The price of the next level of a skill, or null when the book does not
// let the skill be trained on its own.
export function getSkillRaisePrice(key: keyof Skills): (c: Character) => LearningPrice | null {
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

// creating.tex "Learning Knowledge": "using INT as the talent".
export function getKnowledgeRaisePrice(name: string): (c: Character) => LearningPrice {
  return (c: Character) => ({
    currency: 'XP',
    amount: getSkillXPCost((c.knowledges[name]?.value ?? 0) + 1, talentOf(c, 'INT')),
  })
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
    return { currency: 'XP', amount: getAttributeXPCost(target, average, talentOf(c, 'CON'), getSM(c)) }
  }
}

export function getTrainableRaisePrice(key: keyof Trainables): (c: Character) => LearningPrice | null {
  if (key in SkillsSchema.shape) return getSkillRaisePrice(key as keyof Skills)
  if (key in ProficienciesSchema.shape) return getProficiencyRaisePrice(key as keyof Proficiencies)
  if (key in TalentsSchema.shape) return getTalentRaisePrice(key as TalentKey)
  return getAttributeRaisePrice(key as keyof Attributes)
}

// creating.tex "Changing attributes": a point out of one attribute into
// another, null when the receiving one is already at the limit.
export function getAttributeSwapPrice(to: keyof Attributes): (c: Character) => LearningPrice | null {
  return (c: Character) => c.trainables[to].value + 1 > MAX_ATTRIBUTE ? null : { currency: 'XP', amount: ATTRIBUTE_SWAP_XP }
}
