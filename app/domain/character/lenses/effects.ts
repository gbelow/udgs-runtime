import { Ability, Buff, BuffTarget, Character, Cost, Effect } from '../../types'
import { ABILITIES, AbilityKey, isAbilityKey } from '../../abilities'
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

// The switched-on abilities: every `active` entry of kind ability whose key is
// still a learned toggle. `active` comes through a permissive ingest, so an
// entry that no longer satisfies that (forgotten, renamed in the book,
// re-authored as passive) is ignored rather than acted on.
export function getActiveAbilityKeys(character: Character): AbilityKey[] {
  if (!isCampaignCharacter(character)) return []
  return character.active
    .filter((entry) => entry?.kind === 'ability')
    .map((entry) => entry.key)
    .filter((key): key is AbilityKey =>
      isAbilityKey(key) && character.abilities.includes(key) && ABILITIES[key].activation === 'toggle')
}

export function isAbilityActive(character: Character, key: AbilityKey): boolean {
  return getActiveAbilityKeys(character).includes(key)
}

// Everything currently contributing: passive abilities always, toggles while
// on. Read off the catalog every time — the character holds only references.
export function getContributingEffects(character: Character): Effect[] {
  const passive = getLearnedAbilities(character)
    .filter((a) => a.activation === 'passive')
    .flatMap((a) => a.effect)
  const active = getActiveAbilityKeys(character).flatMap((key) => ABILITIES[key].effect)
  return [...passive, ...active]
}

export function collectBuffs(character: Character): Buff[] {
  return getContributingEffects(character).filter(isBuff).map((e) => e.effect)
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

// What every switched-on ability charges at a round change, summed.
export function getUpkeep(character: Character): Cost {
  const total: Cost = { AP: 0, STA: 0, exhaustion: 0, IL: 0 }
  for (const effect of getContributingEffects(character)) {
    if (effect.type !== 'cost' || effect.trigger !== 'end_round') continue
    total.AP += effect.effect.AP
    total.STA += effect.effect.STA
    total.exhaustion += effect.effect.exhaustion
    total.IL += effect.effect.IL
  }
  return total
}
