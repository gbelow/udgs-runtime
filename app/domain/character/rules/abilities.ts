import { CampaignCharacter, Character } from '../../types'
import { ABILITIES, AbilityKey, FamilyKey, getAbilityLevel, getFamilyStages, hasAbility } from '../../abilities'
import { getUnmetRequirements, holdsRequirement } from './requirements'
import { LearningPrice, getTalentMultiplier } from './learning'
import { canAfford } from './cost'
import { getSurgeBar } from './surge'
import { effectsOn } from './effects'
import { getSTA } from './characteristics'

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

// Whether a use gives STA back. STA is only counted once a combat or chase
// has started (`charged`), and none comes back past the character's STA, so
// away from a fight or at full STA the use would pay its price for nothing.
function restoresSTA(key: AbilityKey): boolean {
  return effectsOn(ABILITIES[key].effect, 'instant').some((e) => e.type === 'heal' && e.effect.of === 'STA')
}

// Whether a learned active ability can be fired right now: its price met,
// no surge barring it, and, where it gives back STA, a fight to give it in
// and room below the character's STA to give it to.
export function canUseAbility(c: CampaignCharacter, key: AbilityKey, charged: boolean): boolean {
  return canAfford(c, ABILITIES[key].cost, charged) && !getSurgeBar(c)
    && (!restoresSTA(key) || (charged && c.resources.STA < getSTA(c)))
}
