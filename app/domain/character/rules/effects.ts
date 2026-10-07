import { Ability, Buff, BuffTarget, Character, Cost, Effect, Trigger } from '../../types'
import { ABILITIES, AbilityKey, isAbilityKey } from '../../abilities'
import { SPELLS, SpellKey, isSpellKey } from '../../spells'
import { isCampaignCharacter } from '../../utils'

function isBuff(effect: Effect): effect is Extract<Effect, { type: 'buff' }> {
  return effect.type === 'buff'
}

function isCost(effect: Effect): effect is Extract<Effect, { type: 'cost' }> {
  return effect.type === 'cost'
}

// The learned abilities that still resolve in the catalog. A character saved
// before a rename can carry a retired key, so an unknown one is skipped rather
// than thrown on, the same way afflictions are read.
export function getLearnedAbilities(character: Character): Ability[] {
  return character.abilities
    .filter(isAbilityKey)
    .map((key) => ABILITIES[key])
}

// The abilities in effect: every `active` entry of kind ability whose key is
// still a learned toggle (switched on) or a learned active one (fired this
// round, cleared at the round change). `active` comes through a permissive
// ingest, so an entry that no longer satisfies that (forgotten, renamed in
// the book, re-authored as passive) is ignored rather than acted on.
export function getActiveAbilityKeys(character: Character): AbilityKey[] {
  if (!isCampaignCharacter(character)) return []
  return character.active
    .filter((entry) => entry?.kind === 'ability')
    .map((entry) => entry.key)
    .filter((key): key is AbilityKey =>
      isAbilityKey(key) && character.abilities.includes(key) && ABILITIES[key].activation !== 'passive')
}

// Whether a fired ability has anything left to do after its instant price:
// a buff for the rest of the round, a cost at the round change.
export function lingers(ability: Ability): boolean {
  return ability.effect.some((e) => !(isCost(e) && e.trigger === 'instant'))
}

export function isAbilityActive(character: Character, key: AbilityKey): boolean {
  return getActiveAbilityKeys(character).includes(key)
}

// The spells being held: every `active` entry of kind spell whose key is
// still a known sustained spell, read as permissively as the abilities.
export function getActiveSpellKeys(character: Character): SpellKey[] {
  if (!isCampaignCharacter(character)) return []
  return character.active
    .filter((entry) => entry?.kind === 'spell')
    .map((entry) => entry.key)
    .filter((key): key is SpellKey =>
      isSpellKey(key) && key in character.spells && SPELLS[key].type === 'sustained')
}

export function isSpellActive(character: Character, key: SpellKey): boolean {
  return getActiveSpellKeys(character).includes(key)
}

// Everything currently contributing: passive abilities always, toggles and
// held spells while on. Read off the catalogs every time — the character
// holds only references.
export function getContributingEffects(character: Character): Effect[] {
  const passive = getLearnedAbilities(character)
    .filter((a) => a.activation === 'passive')
    .flatMap((a) => a.effect)
  const active = getActiveAbilityKeys(character).flatMap((key) => ABILITIES[key].effect)
  // a held spell contributes what it keeps doing to the caster — a buff, an
  // upkeep; what it did to anyone was delivered when it was cast
  const held = getActiveSpellKeys(character).flatMap((key) =>
    SPELLS[key].effects.flatMap((e): Effect[] => (e.target === 'self' && e.type !== 'damage' ? [{ name: e.name, trigger: e.trigger, type: e.type, effect: e.effect } as Effect] : [])))
  return [...passive, ...active, ...held]
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

function sumCosts(costs: Cost[]): Cost {
  const total: Cost = { AP: 0, STA: 0, exhaustion: 0, IL: 0, ET: 0 }
  for (const cost of costs) {
    total.AP += cost.AP
    total.STA += cost.STA
    total.exhaustion += cost.exhaustion
    total.IL += cost.IL
    total.ET += cost.ET
  }
  return total
}

// The effects of a list that fall due on a trigger.
export function effectsOn(effects: Effect[], trigger: Trigger): Effect[] {
  return effects.filter((e) => e.trigger === trigger)
}

// Everything in effect on the character that falls due on a trigger — what
// the effect processor applies when that trigger happens.
export function effectsDue(character: Character, trigger: Trigger): Effect[] {
  return effectsOn(getContributingEffects(character), trigger)
}

// The drain a list of effects takes on a trigger, summed. Unlike a price it
// is not checked for — it lands even if it leaves a pool negative.
export function getDrain(effects: Effect[], trigger: Trigger): Cost {
  return sumCosts(effectsOn(effects, trigger).filter(isCost).map((e) => e.effect))
}

// What everything switched on, held or fired charges at the round change.
export function getUpkeep(character: Character): Cost {
  return getDrain(getContributingEffects(character), 'end_round')
}
