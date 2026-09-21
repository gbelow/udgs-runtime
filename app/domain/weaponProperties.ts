import type { AttackKind, AttackType, HeavyRange, MeleeRange, Range, WeaponAttack, WeaponProperty } from './types'
import { MELEE_RANGES, SHOT_RANGES, WEAPON_PROPERTIES } from './lists'

export function hasProperty(properties: readonly WeaponProperty[], property: WeaponProperty): boolean {
  return properties.includes(property)
}

// The heavy degrees an attack offers, or null when it has no heavy property.
export function getHeavyRange(atk: Pick<WeaponAttack, 'heavy'>): HeavyRange | null {
  return atk.heavy ?? null
}

const roman = (degree: number) => 'I'.repeat(degree)

// gear.tex "Heavy I/II/III": a bare degree ("heavy II") keeps the normal
// attack and offers every degree up to it; a range ("heavy I-III") starts at
// its minimum and forbids the normal attack.
export function getHeavyLabel({ min, max }: HeavyRange): string {
  return min === 0 ? `heavy ${roman(max)}` : `heavy ${roman(min)}-${roman(max)}`
}

// gear.tex "Weapons Properties" lists Heavy between Hook and Piercing, so the
// printed cell puts it there.
const HEAVY_PRECEDES: WeaponProperty = 'piercing'

// The attack's properties cell as the book prints it: "STR x" first, the
// listed properties in the vocabulary's order with heavy in its slot, and the
// material last when it is anything but the metal the book assumes.
export function getAttackPropertyLabels(atk: WeaponAttack): string[] {
  const order = (p: WeaponProperty) => WEAPON_PROPERTIES.indexOf(p)
  const listed = [...atk.properties].sort((a, b) => order(a) - order(b))
  const heavy = getHeavyRange(atk)
  return [
    ...(atk.STRreq !== undefined ? [`STR ${atk.STRreq}`] : []),
    ...listed.filter((p) => order(p) < order(HEAVY_PRECEDES)),
    ...(heavy ? [getHeavyLabel(heavy)] : []),
    ...listed.filter((p) => order(p) >= order(HEAVY_PRECEDES)),
    ...(atk.material !== 'metal' ? [atk.material] : []),
  ]
}

// gear.tex "Short, Long I/II" are melee reaches; every other range is a shot
// or a throw (combat.tex "Throw", "Shoot"), so an attack's range decides what
// kind of attack it is.
export function getAttackKind(range: Range): AttackKind {
  if (isMeleeRange(range)) return 'melee'
  return (SHOT_RANGES as readonly string[]).includes(range) ? 'shoot' : 'throw'
}

// The metres a ranged row prints ("100m"), or null where the range is not a
// figure of its own: a throw's comes from STR (combat.tex "Throw").
export function getPrintedRange(range: Range): number | null {
  const match = /^(\d+)m$/.exec(range)
  return match ? Number(match[1]) : null
}

export function isMeleeRange(range: Range): range is MeleeRange {
  return (MELEE_RANGES as readonly string[]).includes(range)
}

// Which skill the attack is rolled with: strike for melee, accuracy for both
// kinds of ranged attack (combat.tex "Accuracy": "a throw or shot").
export function getAttackType(range: Range): AttackType {
  return getAttackKind(range) === 'melee' ? 'melee' : 'ranged'
}
