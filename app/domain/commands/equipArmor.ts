import { scaleArmor } from "../selectors/helpers"
import { Character, Armor, CharacterUpdater } from '../types'

export function equipArmor(  
  armor: Armor
): CharacterUpdater {
  if (!armor) {
    throw new Error('Armor is required')
  }
  if (!armor.name || typeof armor.name !== 'string') {
    throw new Error('Armor must have a valid name')
  }
  if (typeof armor.type !== 'string' || !['light', 'medium', 'heavy'].includes(armor.type)) {
    throw new Error('Armor must have a valid type (light, medium, or heavy)')
  }
  if (typeof armor.RES !== 'number' || typeof armor.TGH !== 'number' || typeof armor.INS !== 'number') {
    throw new Error('Armor must have valid RES, TGH, and INS values')
  }

  return (character: Character) => ({ ...character, armor: scaleArmor(armor, character.characteristics.size) })
}

export function putGauntlets(character: Character): Character {
  
  return({
    ...character,
    ['hasGauntlets']: character.hasGauntlets ? 0 : 1
  })
}

export function putHelm(character: Character): Character {
  
  return({
    ...character,
    ['hasHelm']: character.hasHelm ? 0 : 1
  })
}