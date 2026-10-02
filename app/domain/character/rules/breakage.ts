import type { WeaponAttack } from '../../types'
import { getHardness } from '../../item/rules/items'
import { hasProperty } from '../../weaponProperties'

export type BreakingBlow = { blunt: number; cut: number; hardness: number; piercing: boolean }
export type Breakable = { RES: number; hardness: number }

// What a weapon row brings to a collision besides its damage: the hardness of
// what it is made of, and whether it is a piercing row.
export function getRowBreakTerms(atk: WeaponAttack): Pick<BreakingBlow, 'hardness' | 'piercing'> {
  return { hardness: getHardness(atk.material), piercing: hasProperty(atk.properties, 'piercing') }
}

// gear.tex "Equipment Breakage": the chance an object breaks under one blow.
// A blow harder than twice RES breaks it outright; one that reaches RES in
// both blunt and cut breaks it half the time, in either alone one time in
// six. Only what can be cut breaks (the attacker harder than the object), and
// "Breakage and Hardness": a blow from hardness 1 or 2 puts nothing at risk.
// gear.tex "Piercing": a piercing blow "only breaks objects when damage > 3x
// RES", and then it does.
export function getBreakChance(blow: BreakingBlow, target: Breakable): number {
  if (blow.hardness <= 2 || blow.hardness <= target.hardness) return 0
  const hardest = Math.max(blow.blunt, blow.cut)
  if (blow.piercing) return hardest > 3 * target.RES ? 1 : 0
  if (hardest >= 2 * target.RES) return 1
  const reaching = [blow.blunt, blow.cut].filter((d) => d >= target.RES).length
  return reaching === 2 ? 1 / 2 : reaching === 1 ? 1 / 6 : 0
}
