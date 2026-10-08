import { ABILITIES, getLearnedAbilityKeys } from '../../abilities'
import { CREATION_ATTRIBUTE } from '../../tables'
import { Attributes, AttributesSchema, Character, Proficiencies, ProficienciesSchema, Skills, SkillsSchema, TalentsSchema } from '../../types'
import { getAbilityXPCost } from './abilities'
import { PROFICIENCY_TALENTS, SKILL_TALENTS, TalentKey, getAttributeRaisesXPCost, getProficiencyXPCost, getSkillXPCost, getTalentKarmaCost } from './learning'
import { getSM } from './size'

const SKILL_KEYS = Object.keys(SkillsSchema.shape) as (keyof Skills)[]
const PROFICIENCY_KEYS = Object.keys(ProficienciesSchema.shape) as (keyof Proficiencies)[]
const TALENT_KEYS = Object.keys(TalentsSchema.shape) as TalentKey[]
const ATTRIBUTE_KEYS = Object.keys(AttributesSchema.shape) as (keyof Attributes)[]

const sum = (values: number[]): number => values.reduce((total, n) => total + n, 0)

// Every level from 1 to the one held, each at its own price, plus the XP
// trained toward the next. Priced at the talent the character holds now.
function levelsWorth(level: number, banked: number, price: (level: number) => number): number {
  let total = banked
  for (let n = 1; n <= level; n++) total += price(n)
  return total
}

// abilities.tex "Cost": every learned stage's karma, a flaw's negative karma
// counting against the rest; creating.tex "Improving Talents": every talent
// level, the ones creation gave counted as bought.
export function getTotalKarma(c: Character): number {
  const abilities = getLearnedAbilityKeys(c).map((key) => ABILITIES[key].karma)
  const talents = TALENT_KEYS.map((key) => levelsWorth(c.trainables[key].value, 0, getTalentKarmaCost))
  return sum(abilities) + sum(talents)
}

// abilities.tex "Cost": every learned stage priced in XP, plus the XP trained
// toward each family's next stage. A karma-priced stage costs no XP.
export function getAbilitiesXP(c: Character): number {
  const stages = getLearnedAbilityKeys(c).filter((key) => !ABILITIES[key].karma).map((key) => getAbilityXPCost(key)(c))
  const banked = Object.values(c.abilities).map((a) => a.XP)
  return sum(stages) + sum(banked)
}

// creating.tex "Improving proficiencies".
export function getProficienciesXP(c: Character): number {
  return sum(PROFICIENCY_KEYS.map((key) => {
    const { value, XP } = c.trainables[key]
    const talent = c.trainables[PROFICIENCY_TALENTS[key]].value
    return levelsWorth(value, XP, (level) => getProficiencyXPCost(level, talent))
  }))
}

// creating.tex "Improving skills": a skill the book does not let be trained
// on its own counts only the XP it holds.
export function getSkillsXP(c: Character): number {
  return sum(SKILL_KEYS.map((key) => {
    const { value, XP } = c.trainables[key]
    const talentKey = SKILL_TALENTS[key]
    if (talentKey === null) return XP
    const talent = c.trainables[talentKey].value
    return levelsWorth(value, XP, (level) => getSkillXPCost(level, talent))
  }))
}

// creating.tex "Learning Knowledge": learned as skills are, "using INT as the
// talent".
export function getKnowledgesXP(c: Character): number {
  const INT = c.trainables.INT.value
  return sum(Object.values(c.knowledges).map(({ value, XP }) => levelsWorth(value, XP, (level) => getSkillXPCost(level, INT))))
}

// creating.tex "Improving attributes": every point above the 8 creation
// starts from, plus the XP trained toward the next.
export function getAttributesXP(c: Character): number {
  const to = ATTRIBUTE_KEYS.map((key) => c.trainables[key].value)
  const from = to.map(() => CREATION_ATTRIBUTE)
  const banked = ATTRIBUTE_KEYS.map((key) => c.trainables[key].XP)
  return getAttributeRaisesXPCost(from, to, c.trainables.CON.value, getSM(c)) + sum(banked)
}

export function getTotalXP(c: Character): number {
  return getAbilitiesXP(c) + getProficienciesXP(c) + getSkillsXP(c) + getKnowledgesXP(c) + getAttributesXP(c)
}
