import type { Character, Damage, Outcome, WeaponAttack } from '../../types'
import { getItemArmor } from '../../item/rules/items'
import { hasProperty } from '../../weaponProperties'
import { isArmorBare } from './damage'

export type BreakingBlow = { blunt: number; cut: number; piercing: boolean }
export type Breakable = { RES: number }

// What a weapon row brings to a collision besides its damage: whether it is
// a piercing row.
export function getRowBreakTerms(atk: WeaponAttack): Pick<BreakingBlow, 'piercing'> {
  return { piercing: hasProperty(atk.properties, 'piercing') }
}

// gear.tex "Equipment Breakage": the chance an object breaks under one blow.
// A blow harder than twice RES breaks it outright; one that reaches RES in
// both blunt and cut breaks it half the time, in either alone one time in
// six. gear.tex "Piercing": a piercing blow "only breaks objects when damage
// > 3x RES", and then it does.
export function getBreakChance(blow: BreakingBlow, target: Breakable): number {
  const hardest = Math.max(blow.blunt, blow.cut)
  if (hardest <= 0) return 0
  if (blow.piercing) return hardest > 3 * target.RES ? 1 : 0
  if (hardest >= 2 * target.RES) return 1
  const reaching = [blow.blunt, blow.cut].filter((d) => d > 0 && d >= target.RES).length
  return reaching === 2 ? 1 / 2 : reaching === 1 ? 1 / 6 : 0
}

// What a damage effect carries into a collision: its blunt and cutting, and
// whether it pierces.
export function getBlow({ damage, properties }: Damage): BreakingBlow {
  const total = (kind: 'blunt' | 'cut') => damage.filter((d) => d.kind === kind).reduce((sum, d) => sum + d.value, 0)
  return { blunt: total('blunt'), cut: total('cut'), piercing: hasProperty(properties, 'piercing') }
}

// The percentile is thrown 0 to 99 and an item breaks below chance x 100.
export function breaksOn(chance: number, roll: number): boolean {
  return roll < chance * 100
}

// Damage that reached a character, and what it came to on them.
export type Hit = { damage: Damage; outcome: Pick<Outcome, 'arrived'> }

// gear.tex "Equipment Breakage": the chance the armor a character wears
// breaks under what reached them in one action, whatever dealt it. The
// instances add up as one blow: the damage that arrived past the degree and
// any defense, none of it where the body was bare, nor against armor that is
// broken already. Burning is not breakage damage: it carries no blunt or
// cutting.
export function getArmorBreakChance(target: Character, hits: Hit[]): number {
  const armor = target.worn && !target.worn.broken ? getItemArmor(target.worn) : undefined
  const struck = hits.filter(({ damage }) => !isArmorBare(target, damage))
  if (!armor || struck.length === 0) return 0
  const blow: BreakingBlow = {
    blunt: struck.reduce((sum, { outcome }) => sum + outcome.arrived.blunt, 0),
    cut: struck.reduce((sum, { outcome }) => sum + outcome.arrived.cut, 0),
    piercing: struck.some(({ damage }) => hasProperty(damage.properties, 'piercing')),
  }
  return getBreakChance(blow, { RES: armor.RES })
}
