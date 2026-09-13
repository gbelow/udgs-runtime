import { CampaignCharacter, Character, EffectSchema } from "../../types"
import { ABILITIES, AbilityKey, isAbilityKey } from "../../abilities"
import { isCampaignCharacter } from "../../utils"
import { canLearnAbility } from "../lenses/abilities"
import { getUpkeep, isAbilityActive } from "../lenses/effects"
import { updateSTA } from "./bleed"

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
    return { ...c, abilities: c.abilities.filter((a) => !removed.has(a)) }
  }
}

// Switches a toggle ability on or off. On: its effects join activeEffects as
// fresh copies (ids are per instance); off: everything stamped with its key
// leaves. Only a learned toggle on a campaign character has a switch.
export function toggleAbility(key: AbilityKey): (c: Character) => Character {
  return (c: Character) => {
    if (!isCampaignCharacter(c) || !c.abilities.includes(key)) return c
    const ability = ABILITIES[key]
    if (ability.activation !== 'toggle') return c
    if (isAbilityActive(c, key)) {
      return { ...c, activeEffects: c.activeEffects.filter((e) => e.name !== key) }
    }
    const copies = ability.effect.map((e) => EffectSchema.parse({ ...e, id: undefined }))
    return { ...c, activeEffects: [...c.activeEffects, ...copies] }
  }
}

// Charges the upkeep of everything switched on. STA goes through updateSTA so
// a character who cannot pay bleeds for it like any other STA loss.
export function payUpkeep(c: CampaignCharacter): CampaignCharacter {
  const upkeep = getUpkeep(c)
  if (upkeep.AP === 0 && upkeep.STA === 0 && upkeep.exhaustion === 0 && upkeep.IL === 0) return c
  const paid = updateSTA(c.resources.STA - upkeep.STA)(c)
  return {
    ...paid,
    resources: { ...paid.resources, AP: paid.resources.AP - upkeep.AP, exhaustion: paid.resources.exhaustion + upkeep.exhaustion },
    injuries: { ...paid.injuries, injuryLevel: paid.injuries.injuryLevel + upkeep.IL },
  }
}

// Fires an active ability: the price is paid and nothing else moves — the
// effect is a combat procedure the table resolves. Refused when the character
// cannot afford it, like an attack.
export function useAbility(key: AbilityKey): (c: Character) => Character {
  return (c: Character) => {
    if (!isCampaignCharacter(c) || !c.abilities.includes(key)) return c
    const { activation, cost } = ABILITIES[key]
    if (activation !== 'active') return c
    if (c.resources.AP < cost.AP || c.resources.STA < cost.STA) return c
    const paid = updateSTA(c.resources.STA - cost.STA)(c)
    return { ...paid, resources: { ...paid.resources, AP: paid.resources.AP - cost.AP } }
  }
}
