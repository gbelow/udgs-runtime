import { Character, Grant } from '../../types'
import { ABILITIES, AbilityKey, isAbilityKey } from '../../abilities'
import { holdsRequirement } from './requirements'
import { getAbilities, getRaceBonus, isRacialAbility } from './race'

// abilities.tex "Acquiring abilities": "It is not possible to acquire an
// ability unless the requirements are met" and each is acquired once. Every
// listed item is needed and any alternative within an item satisfies it.
export function canLearnAbility(key: AbilityKey): (c: Character) => boolean {
  return (c: Character) =>
    !getAbilities(c).includes(key) &&
    ABILITIES[key].requires.every((req) => getAbilities(c).includes(req)) &&
    ABILITIES[key].requirements.every((item) => item.some((alt) => holdsRequirement(c, alt)))
}

// Whether a learned ability gives the character the capability, whatever
// its activation: a grant is what learning it allows, not what using it
// does.
export function hasGrant(character: Character, grant: Grant): boolean {
  return getAbilities(character).some((key) => isAbilityKey(key) && ABILITIES[key].grants.includes(grant))
}

// creating.tex "Talent and Learning": the XP price doubles for every level
// the training level sits above the character's talent. A karma-priced
// ability costs no XP, and neither does one the race has (creating.tex
// "Races"), which is never learned.
export function getAbilityXPCost(key: AbilityKey): (c: Character) => number {
  return (c: Character) => {
    if (isRacialAbility(c, key)) return 0
    const { XPcost, talent } = ABILITIES[key]
    const shortfall = talent.reduce((worst, t) => Math.max(worst, t.level - c.trainables[t.property].value - getRaceBonus(c, t.property)), 0)
    return XPcost * 2 ** shortfall
  }
}
