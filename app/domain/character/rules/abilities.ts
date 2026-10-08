import { Character, Grant } from '../../types'
import { ABILITIES, AbilityKey, isAbilityKey } from '../../abilities'
import { holdsRequirement } from './requirements'
import { getTalentMultiplier } from './learning'

// abilities.tex "Acquiring abilities": "It is not possible to acquire an
// ability unless the requirements are met" and each is acquired once. Every
// listed item is needed and any alternative within an item satisfies it.
export function canLearnAbility(key: AbilityKey): (c: Character) => boolean {
  return (c: Character) =>
    !c.abilities.includes(key) &&
    ABILITIES[key].requires.every((req) => c.abilities.includes(req)) &&
    ABILITIES[key].requirements.every((item) => item.some((alt) => holdsRequirement(c, alt)))
}

// Whether a learned ability gives the character the capability, whatever
// its activation: a grant is what learning it allows, not what using it
// does.
export function hasGrant(character: Character, grant: Grant): boolean {
  return character.abilities.some((key) => isAbilityKey(key) && ABILITIES[key].grants.includes(grant))
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
