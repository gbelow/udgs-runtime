import type { Character, Damage, DamageComponent, Delivery } from '../../types'
import { getForce } from '../../character/rules/skills'
import { getHardness } from '../../item/rules/items'
import type { WeaponRow } from './weaponRow'

// What an attack delivers, as a damage effect with the degree its test came
// to, before anything is bought on it.

export type Defense = Pick<Damage, 'defense' | 'defenseAP' | 'defenseWeaponKey' | 'block' | 'shield'>
export const UNDEFENDED: Defense = { defense: 'none', defenseAP: 0, defenseWeaponKey: '', block: 0, shield: false }

// A damage effect on its way, at a degree already decided by the producer.
export function delivering(name: string, damage: Damage, degree: Delivery['degree']): Delivery {
  return { effect: { name, trigger: 'instant', type: 'damage', effect: damage }, degree, test: null, when: null, then: [], locks: null }
}

// A row's damage as it leaves the weapon, nothing yet bought: the
// components given, the row's hardness and properties, its wielder's force,
// where it lands and what met it there.
export function getRowDamage(wielder: Character, row: WeaponRow, damage: DamageComponent[], location: Damage['location'], defense: Defense = UNDEFENDED): Damage {
  return {
    damage,
    hardness: getHardness(row.atk.material),
    force: getForce(wielder),
    properties: row.atk.properties,
    location,
    ...defense,
    bypass: false,
    bust: false,
    smash: false,
  }
}
