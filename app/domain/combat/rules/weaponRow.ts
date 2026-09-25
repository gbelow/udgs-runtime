import type { Character, Weapon, WeaponAttack } from '../../types'
import { getWieldedWeapons, isAttackUsable, type Wielded } from '../../item/rules/hands'
import { isWieldable } from '../../character/rules/gear'

// A weapon row is named the way the hands name it: the wielded key (an item
// id or `natural:<name>`) and the attack row's name.
export type WeaponRow = { wielded: Wielded; weapon: Weapon; atk: WeaponAttack }

// Every row of every weapon in the character's hands, usable or not.
export function getWeaponRows(c: Character): WeaponRow[] {
  return getWieldedWeapons(c).flatMap((wielded) => wielded.weapon.attacks.map((atk) => ({ wielded, weapon: wielded.weapon, atk })))
}

export function findWeaponRow(c: Character, weaponKey: string, attack: string): WeaponRow | null {
  const wielded = getWieldedWeapons(c).find((w) => w.key === weaponKey)
  if (!wielded) return null
  const atk = wielded.weapon.attacks.find((a) => a.name === attack)
  return atk ? { wielded, weapon: wielded.weapon, atk } : null
}

// gear.tex "Size Scaling", "Small/One/Two hands": a row the character can fire
// right now.
export function isRowUsable(c: Character, row: WeaponRow): boolean {
  return isWieldable(row.weapon, c) && isAttackUsable(row.atk.handed, row.wielded.grip)
}
