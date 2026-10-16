import { ABILITIES, FamilyKey, getFamilyStages, getLearnedAbilityKeys, isFamilyKey } from '../../abilities'
import { CREATION_ATTRIBUTE } from '../../tables'
import { Character, Proficiencies, Trainable, ProficienciesSchema, TalentsSchema } from '../../types'
import { getAbilityXPCost } from './abilities'
import { ATTRIBUTE_KEYS, PROFICIENCY_TALENTS, SKILL_KEYS, SKILL_TALENTS, TalentKey, getAttributeBalance, getAttributeRaisesXPCost, getProficiencyXPCost, getSkillXPCost, getTalentKarmaCost } from './learning'

const PROFICIENCY_KEYS = Object.keys(ProficienciesSchema.shape) as (keyof Proficiencies)[]
const TALENT_KEYS = Object.keys(TalentsSchema.shape) as TalentKey[]

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

// The XP spent on one thing, and the talent whose XP it was: the talent a
// skill or proficiency is learned with, the one an ability stage lists, and
// CON for the attributes, as creation charges them.
type Spent = { talent: TalentKey; XP: number }

// abilities.tex "Cost": every learned stage priced in XP, plus the XP trained
// toward each family's next stage, from the talent that stage lists. A
// karma-priced stage costs no XP.
function getAbilitiesXP(c: Character): Spent[] {
  const stages = getLearnedAbilityKeys(c).filter((key) => !ABILITIES[key].karma && ABILITIES[key].talent.length)
    .map((key) => ({ talent: ABILITIES[key].talent[0].property, XP: getAbilityXPCost(key)(c) }))
  const banked = (Object.entries(c.abilities) as [FamilyKey, Trainable][]).flatMap(([family, { value, XP }]) => {
    const next = isFamilyKey(family) ? getFamilyStages(family)[value] : undefined
    const talent = next ? ABILITIES[next].talent[0]?.property : undefined
    return talent && XP ? [{ talent, XP }] : []
  })
  return [...stages, ...banked]
}

// creating.tex "Improving proficiencies".
function getProficienciesXP(c: Character): Spent[] {
  return PROFICIENCY_KEYS.map((key) => {
    const { value, XP } = c.trainables[key]
    const talent = PROFICIENCY_TALENTS[key]
    return { talent, XP: levelsWorth(value, XP, (level) => getProficiencyXPCost(level, c.trainables[talent].value)) }
  })
}

// creating.tex "Improving skills", and "Learning Knowledge" for the formal
// knowledges. A skill the book does not let be trained on its own has no
// talent and costs none. Specific knowledges are not learned with XP.
function getSkillsXP(c: Character): Spent[] {
  return SKILL_KEYS.flatMap((key) => {
    const { value, XP } = c.trainables[key]
    const talent = SKILL_TALENTS[key]
    if (talent === null) return []
    return [{ talent, XP: levelsWorth(value, XP, (level) => getSkillXPCost(level, c.trainables[talent].value)) }]
  })
}

// creating.tex "Improving attributes": every point above the 8 creation
// starts from, plus the XP trained toward the next.
function getAttributesXP(c: Character): Spent[] {
  const to = ATTRIBUTE_KEYS.map((key) => c.trainables[key].value)
  const from = to.map(() => CREATION_ATTRIBUTE)
  const banked = ATTRIBUTE_KEYS.map((key) => c.trainables[key].XP)
  return [{ talent: 'CON', XP: getAttributeRaisesXPCost(from, to, getAttributeBalance(c)) + sum(banked) }]
}

// The XP spent from each talent's XP.
export function getXPByTalent(c: Character): Record<TalentKey, number> {
  const byTalent = Object.fromEntries(TALENT_KEYS.map((key) => [key, 0])) as Record<TalentKey, number>
  for (const { talent, XP } of [...getAttributesXP(c), ...getProficienciesXP(c), ...getSkillsXP(c), ...getAbilitiesXP(c)]) byTalent[talent] += XP
  return byTalent
}
