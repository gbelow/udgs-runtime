import { scaleWeapon } from '../lenses/helpers'
import { Character, CharacterUpdater, Weapon, WeaponSchema } from '../../types'

export function equipWeapon(
  weapon: Weapon
): CharacterUpdater {
  if (!weapon) {
    throw new Error('Weapon is required')
  }
  if (!weapon.name || typeof weapon.name !== 'string') {
    throw new Error('Weapon must have a valid name')
  }
  if (!weapon.attacks || !Array.isArray(weapon.attacks) || weapon.attacks.length === 0) {
    throw new Error('Weapon must have at least one attack')
  }

  // Size-scale on equip, mirroring equipArmor. Callers pass the catalog weapon
  // at its chosen scale; the stored weapon is already scaled, so nothing
  // downstream may scale it a second time.
  return (character: Character) => ({
    ...character,
    weapons: {
      ...character.weapons,
      [weapon.name]: WeaponSchema.parse(scaleWeapon(weapon, weapon.scale))
    }
  })
}

export function unequipWeapon(
  weaponKey: string
): CharacterUpdater {
  if (!weaponKey || typeof weaponKey !== 'string') {
    throw new Error('Weapon key is required and must be a string')
  }

  return (character: Character) => {
    if (!character.weapons || !character.weapons[weaponKey]) {
      // Weapon not found, return character unchanged
      return character
    }
    const { [weaponKey]: _, ...remainingWeapons } = character.weapons
    return {
      ...character,
      weapons: remainingWeapons
    }
  }
}

export function getCharacterWeapons(character: Character | null): Record<string, Weapon> {
  if(!character?.weapons) return {}
  return character.weapons
}

