import { Ability, Buff, BuffTarget, Character, Effect } from '../../types'
import { ABILITIES, isAbilityKey } from '../../abilities'
import { isCampaignCharacter } from '../../utils'

function isBuff(effect: Effect): effect is Extract<Effect, { type: 'buff' }> {
  return effect.type === 'buff'
}

// The learned abilities that still resolve in the catalog. A character saved
// before a rename can carry a retired key, so an unknown one is skipped rather
// than thrown on, the same way afflictions are read.
export function getLearnedAbilities(character: Character): Ability[] {
  return character.abilities
    .filter(isAbilityKey)
    .map((key) => ABILITIES[key])
}

// Buffs can come from two sources: passive abilities (always contribute
// while learned) and activeEffects (toggle/active abilities, only while on).
export function collectBuffs(character: Character): Buff[] {
  const passive = getLearnedAbilities(character)
    .filter((a) => a.activation === 'passive')
    .flatMap((a) => a.effect)

  const active: Effect[] = isCampaignCharacter(character)
    ? character.activeEffects
    : []

  return [...passive, ...active].filter(isBuff).map((e) => e.effect)
}

export function groupBuffsByTarget(buffs: Buff[]): Record<string, Buff[]> {
  const grouped: Record<string, Buff[]> = {}
  for (const buff of buffs) {
    (grouped[buff.target] ??= []).push(buff)
  }
  return grouped
}

export function getBuffsForTarget(character: Character, target: BuffTarget): Buff[] {
  return groupBuffsByTarget(collectBuffs(character))[target] ?? []
}

// The additive total a target receives from everything the character has on.
// Only `+` buffs are summed: a `*` or `set` cannot be expressed as one term of
// a breakdown, and no ability uses one yet.
export function getBuffBonus(character: Character, target: BuffTarget): number {
  return getBuffsForTarget(character, target)
    .filter((b) => b.operation === '+')
    .reduce((sum, b) => sum + b.value, 0)
}
