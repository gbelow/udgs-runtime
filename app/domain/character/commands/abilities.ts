import { CampaignCharacter, Character } from "../../types"
import { ABILITIES, AbilityKey, isAbilityKey } from "../../abilities"
import { isCampaignCharacter } from "../../utils"
import { canLearnAbility } from "../rules/abilities"
import { effectsOn, isAbilityActive, lingers } from "../rules/effects"
import { applyEffects } from "./effects"
import { canAfford } from "../rules/cost"
import { payCost } from "./cost"

export function learnAbility(key: AbilityKey): (c: Character) => Character {
  return (c: Character) => {
    if (!canLearnAbility(key)(c)) return c
    return { ...c, abilities: [...c.abilities, key] }
  }
}

// Forgetting takes every ability that depended on the one removed with it, so
// a character never holds a stage without the one it requires.
export function forgetAbility(key: string): (c: Character) => Character {
  return (c: Character) => {
    const removed = new Set<string>([key])
    let grew = true
    while (grew) {
      grew = false
      for (const learned of c.abilities) {
        if (removed.has(learned) || !isAbilityKey(learned)) continue
        if (ABILITIES[learned].requires.some((req) => removed.has(req))) {
          removed.add(learned)
          grew = true
        }
      }
    }
    if (!c.abilities.some((a) => removed.has(a))) return c
    const abilities = c.abilities.filter((a) => !removed.has(a))
    // a forgotten toggle cannot stay switched on
    if (isCampaignCharacter(c)) {
      return { ...c, abilities, active: c.active.filter((e) => !(e.kind === 'ability' && removed.has(e.key))) }
    }
    return { ...c, abilities }
  }
}

// Switches a toggle ability on or off by adding or removing its reference in
// `active`. Only a learned toggle on a campaign character has a switch.
export function toggleAbility(key: AbilityKey): (c: Character) => Character {
  return (c: Character) => {
    if (!isCampaignCharacter(c) || !c.abilities.includes(key)) return c
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
// table resolves.
export function useAbility(key: AbilityKey): (c: Character) => Character {
  return (c: Character) => {
    if (!isCampaignCharacter(c) || !c.abilities.includes(key)) return c
    const ability = ABILITIES[key]
    if (ability.activation !== 'active') return c
    if (!canAfford(c, ability.cost)) return c
    const fired = applyEffects(effectsOn(ability.effect, 'instant'))(payCost(ability.cost)(c))
    return lingers(ability) ? { ...fired, active: [...fired.active, { kind: 'ability', key }] } : fired
  }
}
