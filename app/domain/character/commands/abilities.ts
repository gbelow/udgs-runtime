import { CampaignCharacter, Character } from "../../types"
import { ABILITIES, ABILITY_FAMILY_OF, AbilityKey, FamilyKey, getAbilityLevel, getLearnedAbilityKeys, hasAbility, heldAbility, isAbilityKey } from "../../abilities"
import { isCampaignCharacter } from "../../utils"
import { canLearnAbility } from "../rules/abilities"
import { effectsOn, isAbilityActive, lingers } from "../rules/effects"
import { applyEffects } from "./effects"
import { canAfford } from "../rules/cost"
import { getSurgeBar } from "../rules/surge"
import { payCost } from "./cost"

// A family set to a level; the training toward the next starts over. Level 0
// with nothing trained is no ability at all.
function withAbilityLevel<C extends Character>(c: C, family: FamilyKey, level: number): C {
  if (level <= 0) {
    const { [family]: _gone, ...abilities } = c.abilities
    return { ...c, abilities }
  }
  return { ...c, abilities: { ...c.abilities, [family]: heldAbility(family, level) } }
}

// A stage given outright, with no requirement or price asked — a race's
// abilities, a fixture's. The stages below it come with it.
export function grantAbility(key: AbilityKey): <C extends Character>(c: C) => C {
  return <C extends Character>(c: C) => {
    return hasAbility(c, key) ? c : withAbilityLevel(c, ABILITY_FAMILY_OF[key], ABILITIES[key].stage)
  }
}

export function learnAbility(key: AbilityKey): (c: Character) => Character {
  return (c: Character) => (canLearnAbility(key)(c) ? grantAbility(key)(c) : c)
}

// Forgetting takes every ability that depended on the one removed with it, so
// a character never holds a stage without the one it requires. A family drops
// to the level below the lowest of its stages removed.
export function forgetAbility(key: string): (c: Character) => Character {
  return (c: Character) => {
    if (!hasAbility(c, key)) return c
    const learned = getLearnedAbilityKeys(c)
    const removed = new Set<string>([key])
    let grew = true
    while (grew) {
      grew = false
      for (const stage of learned) {
        if (removed.has(stage)) continue
        if (ABILITIES[stage].requires.some((req) => removed.has(req))) {
          removed.add(stage)
          grew = true
        }
      }
    }
    const forgotten = learned.filter((stage) => removed.has(stage)).reduce((acc, stage) => {
      const family = ABILITY_FAMILY_OF[stage]
      return withAbilityLevel(acc, family, Math.min(getAbilityLevel(acc, family), ABILITIES[stage].stage - 1))
    }, c)
    // a forgotten toggle cannot stay switched on
    if (isCampaignCharacter(forgotten)) {
      return { ...forgotten, active: forgotten.active.filter((e) => !(e.kind === 'ability' && removed.has(e.key))) }
    }
    return forgotten
  }
}

// Switches a toggle ability on or off by adding or removing its reference in
// `active`. Only a learned toggle on a campaign character has a switch.
export function toggleAbility(key: AbilityKey): (c: Character) => Character {
  return (c: Character) => {
    if (!isCampaignCharacter(c) || !hasAbility(c, key)) return c
    if (ABILITIES[key].activation !== 'toggle') return c
    if (isAbilityActive(c, key)) {
      return { ...c, active: c.active.filter((e) => !(e.kind === 'ability' && e.key === key)) }
    }
    return { ...c, active: [...c.active, { kind: 'ability', key }] }
  }
}

// A fired ability's turn is over at the round change: once its upkeep is
// paid it stops contributing. Toggles and held spells stay.
export function expireUsedAbilities(c: CampaignCharacter): CampaignCharacter {
  const active = c.active.filter((e) => !(e.kind === 'ability' && isAbilityKey(e.key) && ABILITIES[e.key].activation === 'active'))
  return active.length === c.active.length ? c : { ...c, active }
}

// Fires an active ability. Its `cost` is the price: refused when the
// character cannot afford it, like an attack. Its instant effects are then
// processed — a cost there is a drain that lands regardless — and whatever
// else it lists, a buff or a cost due at the round change, is in effect
// until the round ends. The rest of what it does is a combat procedure the
// table resolves. Its AP and STA are paid only in a combat that has started
// (`charged`, which the fight hands in).
export function useAbility(key: AbilityKey): (c: Character, charged?: boolean) => Character {
  return (c: Character, charged = false) => {
    if (!isCampaignCharacter(c) || !hasAbility(c, key)) return c
    const ability = ABILITIES[key]
    if (ability.activation !== 'active') return c
    if (!canAfford(c, ability.cost, charged) || getSurgeBar(c)) return c
    const fired = applyEffects(effectsOn(ability.effect, 'instant'))(payCost(ability.cost, charged)(c))
    return lingers(ability) ? { ...fired, active: [...fired.active, { kind: 'ability', key }] } : fired
  }
}
