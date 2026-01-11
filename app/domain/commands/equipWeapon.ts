import { Character, CharacterUpdater, Weapon } from '../types'

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

  return (character: Character) => ({
    ...character,
    weapons: {
      ...character.weapons,
      [weapon.name]: weapon
    }
  })
}

