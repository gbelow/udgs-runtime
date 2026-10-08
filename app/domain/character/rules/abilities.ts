import { Character, Grant } from '../../types'
import { ABILITIES, AbilityKey, FamilyKey, getAbilityLevel, getFamilyStages, getLearnedAbilityKeys, hasAbility } from '../../abilities'
import { getUnmetRequirements, holdsRequirement } from './requirements'
import { LearningPrice, getTalentMultiplier } from './learning'

// abilities.tex "Acquiring abilities": "It is not possible to acquire an
// ability unless the requirements are met" and each is acquired once. Every
// listed item is needed and any alternative within an item satisfies it.
export function canLearnAbility(key: AbilityKey): (c: Character) => boolean {
  return (c: Character) => !hasAbility(c, key) && meetsAbilityRequirements(key)(c)
}

// What stands between the character and an ability, in the book's words:
// the stage before it, and every requirement item it falls short of.
export function getUnmetAbilityRequirements(key: AbilityKey): (c: Character) => string[] {
  return (c: Character) => [...new Set([
    ...ABILITIES[key].requires.filter((req) => !hasAbility(c, req)).map((req) => ABILITIES[req as AbilityKey].name),
    ...getUnmetRequirements(c, ABILITIES[key].requirements),
  ])]
}

export function meetsAbilityRequirements(key: AbilityKey): (c: Character) => boolean {
  return (c: Character) =>
    ABILITIES[key].requires.every((req) => hasAbility(c, req)) &&
    ABILITIES[key].requirements.every((item) => item.some((alt) => holdsRequirement(c, alt)))
}

// Whether a learned ability gives the character the capability, whatever
// its activation: a grant is what learning it allows, not what using it
// does.
export function hasGrant(character: Character, grant: Grant): boolean {
  return getLearnedAbilityKeys(character).some((key) => ABILITIES[key].grants.includes(grant))
}

// abilities.tex "Cost": the listed price at its training level, priced by
// the creation rules — doubled for every level the training level sits above
// the character's talent. A karma-priced ability costs no XP.
export function getAbilityXPCost(key: AbilityKey): (c: Character) => number {
  return (c: Character) => {
    const { XPcost, talent } = ABILITIES[key]
    return talent.reduce((cost, t) => Math.max(cost, XPcost * getTalentMultiplier(t.level, c.trainables[t.property].value)), XPcost)
  }
}

// What the stage after a family's level costs to train, in the currency its
// price is listed in; null when there is none, or its requirements are unmet.
export function getAbilityTrainingPrice(family: FamilyKey): (c: Character) => LearningPrice | null {
  return (c: Character) => {
    const next = getFamilyStages(family)[getAbilityLevel(c, family)]
    if (!next || !canLearnAbility(next)(c)) return null
    const { karma } = ABILITIES[next]
    return karma ? { currency: 'karma', amount: karma } : { currency: 'XP', amount: getAbilityXPCost(next)(c) }
  }
}
