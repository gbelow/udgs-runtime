import type { Character, HeavyRange } from '../../types'
import { getHeavyRange } from '../../weaponProperties'
import { SHOTS } from '../../tables'
import { findWeaponRow } from './weaponRow'

// combat.tex "Heavy Attack": "It is possible to make a heavy attack with
// weapons that have the 'heavy' property", declared on the strike beside its
// variation ("The variations can be combined, but braced and hook attack
// cannot be combined with anything"). gear.tex "Heavy I/II/III": "Having a
// higher degree of heavy allows using any lower degree. Having heavy I-III
// or similar means that heavy I is minimum, and normal attacks are not
// allowed."

type Made = { weaponKey: string; attack: string; variant: string; heavy?: number }

// The degrees a strike made with the row and variation may be heavy at;
// null when it cannot be heavy at all.
export function getHeavyDegrees(c: Character, made: Made): HeavyRange | null {
  if (made.variant !== SHOTS.shoot.variant) return null
  const row = findWeaponRow(c, made.weaponKey, made.attack)
  return row ? getHeavyRange(row.atk) : null
}

// The degree the strike is made heavy at: the one declared, within what the
// row allows, so a row with a minimum is never struck below it.
export function getHeavyDegree(c: Character, made: Made): number {
  const range = getHeavyDegrees(c, made)
  return range ? Math.min(range.max, Math.max(range.min, made.heavy ?? 0)) : 0
}
