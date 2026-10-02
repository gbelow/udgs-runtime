import type { Character, Weapon, WeaponAttack, WeaponProperty } from '../../types'
import { getWieldedWeapons, isAttackUsable, type Wielded } from '../../item/rules/hands'
import { getLoadableAmmo, type AmmoStack } from '../../item/rules/ammo'
import { type AttackVariant, getAttacksList, isWieldable } from '../../character/rules/gear'

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

// gear.tex "Size Scaling", "Small/One/Two hands", "Weapon Breakage": a row
// the character can fire right now.
export function isRowUsable(c: Character, row: WeaponRow): boolean {
  return !row.wielded.broken && isWieldable(row.weapon, c) && isAttackUsable(row.atk.handed, row.wielded.grip)
}

// The variations the row can be fired as, priced against the character as
// they stand.
export function getRowVariants(c: Character, row: WeaponRow): AttackVariant[] {
  return getAttacksList({ atk: row.atk, weapon: row.weapon })(c)
}

// gear.tex "Quiver": a row that loads ammunition fires only with some in a
// quick slot; the stack it was declared with, while it can still load it.
export function isRowLoadable(c: Character, row: WeaponRow): boolean {
  return !row.atk.ammo || getLoadableAmmo(c, row.weapon, row.atk).length > 0
}

export function getRowAmmo(c: Character, row: WeaponRow, ammoId: string): AmmoStack | null {
  return getLoadableAmmo(c, row.weapon, row.atk).find((s) => s.item.id === ammoId) ?? null
}

// gear.tex "Bodkin: arrows are penetrating", "Broadhead: arrows are
// bladed": a shot has its row's properties and those of what it is loaded
// with.
export function getRowProperties(c: Character, row: WeaponRow, ammoId: string): WeaponProperty[] {
  const ammo = row.atk.ammo ? getRowAmmo(c, row, ammoId) : null
  return [...row.atk.properties, ...(ammo?.ammo.properties ?? []).filter((p) => !row.atk.properties.includes(p))]
}

export function findRowVariant(c: Character, row: WeaponRow, variant: string): AttackVariant | null {
  return getRowVariants(c, row).find((v) => v.name === variant) ?? null
}
