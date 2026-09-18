import type { AttackKind, AttackType, Range, WeaponProperty } from './types'
import { MELEE_RANGES, SHOT_RANGES } from './lists'

// gear.tex "Heavy I/II/III": "Having a higher degree of heavy allows using any
// lower degree. Having heavy I-III or similar means that heavy I is minimum,
// and normal attacks are not allowed." That is two bounds, not six spellings:
// `min` is the lowest heavy degree available and `max` the highest, with
// `min === 0` meaning the normal (non-heavy) attack is still allowed.
export type HeavyRange = { min: number; max: number }

const HEAVY: Partial<Record<WeaponProperty, HeavyRange>> = {
  'heavy I': { min: 0, max: 1 },
  'heavy II': { min: 0, max: 2 },
  'heavy III': { min: 0, max: 3 },
  'heavy I-II': { min: 1, max: 2 },
  'heavy I-III': { min: 1, max: 3 },
  'heavy II-III': { min: 2, max: 3 },
}

export function hasProperty(properties: readonly WeaponProperty[], property: WeaponProperty): boolean {
  return properties.includes(property)
}

// The heavy degrees an attack offers, or null when it has no heavy property.
export function getHeavyRange(properties: readonly WeaponProperty[]): HeavyRange | null {
  for (const property of properties) {
    const range = HEAVY[property]
    if (range) return range
  }
  return null
}

// gear.tex "Short, Long I/II" are melee reaches; every other range is a shot
// or a throw (combat.tex "Throw", "Shoot"), so an attack's range decides what
// kind of attack it is.
export function getAttackKind(range: Range): AttackKind {
  if ((MELEE_RANGES as readonly string[]).includes(range)) return 'melee'
  return (SHOT_RANGES as readonly string[]).includes(range) ? 'shoot' : 'throw'
}

// Which skill the attack is rolled with: strike for melee, accuracy for both
// kinds of ranged attack (combat.tex "Accuracy": "a throw or shot").
export function getAttackType(range: Range): AttackType {
  return getAttackKind(range) === 'melee' ? 'melee' : 'ranged'
}
