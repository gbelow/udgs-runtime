import { Ability, Buff, BuffTarget, Character, Cost, Effect, Grant, Trigger } from '../../types'
import { ABILITIES, AbilityKey, getLearnedAbilityKeys, hasAbility, isAbilityKey } from '../../abilities'
import { SPELLS, SpellKey, isSpellKey } from '../../spells'
import { isCampaignCharacter } from '../../utils'
import { getLastingEffects } from '../../item/rules/consumables'

function isBuff(effect: Effect): effect is Extract<Effect, { type: 'buff' }> {
  return effect.type === 'buff'
}

function isCost(effect: Effect): effect is Extract<Effect, { type: 'cost' }> {
  return effect.type === 'cost'
}

// The learned abilities that still resolve in the catalog.
export function getLearnedAbilities(character: Character): Ability[] {
  return getLearnedAbilityKeys(character).map((key) => ABILITIES[key])
}

// Whether a learned ability gives the character the capability, whatever
// its activation: a grant is what learning it allows, not what using it
// does.
export function hasGrant(character: Character, grant: Grant): boolean {
  return getLearnedAbilityKeys(character).some((key) => ABILITIES[key].grants.includes(grant))
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
      isAbilityKey(key) && hasAbility(character, key) && ABILITIES[key].activation !== 'passive')
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

// gear.tex "Potions and Medicine": what the potions taken and still lasting
// keep on the character.
function getPotionEffects(character: Character): Effect[] {
  if (!isCampaignCharacter(character) || !character.active.some((entry) => entry?.kind === 'potion')) return []
  return character.active.flatMap((entry) => (entry?.kind === 'potion' ? getLastingEffects(entry.key) : []))
}

// Everything currently contributing: passive abilities always, toggles and
// held spells while on, potions while they last. Read off the catalogs every
// time — the character holds only references.
export function getContributingEffects(character: Character): Effect[] {
  const passive = getLearnedAbilities(character)
    .filter((a) => a.activation === 'passive')
    .flatMap((a) => a.effect)
  const active = getActiveAbilityKeys(character).flatMap((key) => ABILITIES[key].effect)
  // a held spell contributes what it keeps doing to the caster — a buff, an
  // upkeep; what it did to anyone was delivered when it was cast
  const held = getActiveSpellKeys(character).flatMap((key) =>
    SPELLS[key].effects.flatMap((e): Effect[] => (e.target === 'self' && e.type !== 'damage' ? [{ name: e.name, trigger: e.trigger, type: e.type, effect: e.effect } as Effect] : [])))
  return [...passive, ...active, ...held, ...getPotionEffects(character)]
}

// The suppressions in effect: what blocks a rule outright for the character.
export function isSuppressed(character: Character, target: string): boolean {
  return getContributingEffects(character).some((e) => e.type === 'suppression' && e.effect.target === target)
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
  return collectBuffs(character)
    .reduce((sum, b) => b.target === target && b.operation === '+' ? sum + b.value : sum, 0)
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
