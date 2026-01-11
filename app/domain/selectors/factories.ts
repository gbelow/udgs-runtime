import { movementSelectors, skillSelectors } from ".";
import { CampaignCharacter, CampaignCharacterSchema, CampaignCharacterUpdater, Character, Characteristics, CharacterUpdater, Injuries, Movement, Resources, Skills } from "../types";
import { characteristicSelectors } from ".";
import { getDM } from "./helpers";

export function makeSkillSelector (skillName: keyof Skills){
  return((character: Character) => {
    if (!character || !skillSelectors[skillName]) return 0;
    return skillSelectors[skillName](character)
  })
}

export function makeSkillUpdater (skillName:keyof Skills, value: number):CharacterUpdater {
  return( (character: Character) => {
    const calculated = skillSelectors[skillName](character) - character.skills[skillName]
    const updated = {...character, skills: {...character.skills, [skillName]: value - calculated}}
    return updated
  }) 
}

export function makeCharacteristicSelector (characteristic: keyof Characteristics){
  return((character: Character) => {
    if (!character || !characteristicSelectors[characteristic]) return 0;
    return characteristicSelectors[characteristic](character)
  })
}

export function makeCharacteristicUpdater(characteristic: keyof Characteristics, value: number):CharacterUpdater{
  return((character: Character) => {
    // Most characteristics are stored as-is, but RES/TGH/INS are *stored* as base additive
    // terms while being *displayed* as derived effective thresholds.
    if (characteristic === 'RES' || characteristic === 'TGH' || characteristic === 'INS') {
      const dm = getDM(character)
      const STR = characteristicSelectors.STR(character)
      // Invert: effective = floor(((0.5*STR + base) * dm))
      // Pick the midpoint of the valid interval to avoid floating point edge cases.
      // We want ((0.5*STR + base) * dm) in [value, value+1).
      const base = ((value + 0.5) / dm) - 0.5 * STR

      return {
        ...character,
        characteristics: {
          ...character.characteristics,
          [characteristic]: base,
        },
      }
    }

    const calculated = characteristicSelectors[characteristic](character) - character.characteristics[characteristic]
    const updated = { ...character, characteristics: { ...character.characteristics, [characteristic]: value - calculated } }
    return updated
  })
}

export function makeMovementSelector (move: keyof Movement){
  return((character: Character) => {
    if (!character || !movementSelectors[move]) return 0;
    return movementSelectors[move](character)
  })
}

export function makeMovementUpdater(moveName: keyof Movement, value: number):CharacterUpdater{
  return((character: Character) => {
    const calculated = movementSelectors[moveName](character) - character.movement[moveName]
    const updated = {...character, movement: {...character.movement, [moveName]: value - calculated}}
    return updated
  })
}

export function makeTextSelector (keyName: keyof Character){
  return((character: Character) => {
    if (!character || !character[keyName]) return '';
    return character[keyName]
  })
}

export function makeTextUpdater(keyName: keyof Character , value: string):CharacterUpdater{
  return((character: Character) => {
    return ({...character, [keyName]: value})
  })
}

export function makeResourceSelector (keyName: keyof Resources){
  return((character: Character) => {
    const campaignCharacter=CampaignCharacterSchema.parse(character) 
    if (!campaignCharacter || !campaignCharacter.resources[keyName]) return 0;
    return campaignCharacter.resources[keyName]
  })
}

export function makeResourceUpdater(keyName: keyof Resources , value: number):CampaignCharacterUpdater{
  return((character: Character) => {
    const campaignCharacter=CampaignCharacterSchema.parse(character)
    return ({...campaignCharacter, resources:{...campaignCharacter.resources, [keyName]: value}})
  })
}

export function makeInjurySelector (keyName: keyof Injuries){
  return((character: CampaignCharacter) => {
    if (!character || !character.injuries[keyName]) return [];
    return character.injuries[keyName]
  })
}

export function makeInjuryUpdater(keyName: keyof Injuries , index: number, value: number):CampaignCharacterUpdater{
  return((character: Character) => {
    const campaignCharacter=CampaignCharacterSchema.parse(character)
    const newInjury = [...campaignCharacter.injuries[keyName]]
    newInjury[index] = value
    return ({...campaignCharacter, injuries:{...campaignCharacter.injuries, [keyName]: newInjury}})
  })
}