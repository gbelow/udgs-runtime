import { scaleArmor } from "../lenses/helpers"
import { Character, Armor, CharacterUpdater, ArmorSchema } from '../../types'

export function equipArmor(  
  armor: Armor
): CharacterUpdater {
  if (!armor) {
    throw new Error('Armor is required')
  }
  if (!armor.name || typeof armor.name !== 'string') {
    throw new Error('Armor must have a valid name')
  }
  if (typeof armor.RES !== 'number' || typeof armor.INS !== 'number') {
    throw new Error('Armor must have valid RES and INS values')
  }

  return (character: Character) => ({ ...character, armor: ArmorSchema.parse(scaleArmor(armor, character.size)) })
}

export function unequipArmor(): CharacterUpdater {
  return (character: Character) => {
    character = {...character, armor: ArmorSchema.parse({})}
    return character
  }
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