import { Character } from "../../types"
import { ABILITIES, AbilityKey, isAbilityKey } from "../../abilities"
import { canLearnAbility } from "../lenses/abilities"

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
