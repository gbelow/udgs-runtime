import { bleed } from "../commands/bleed";
import { heal } from "../commands/heal";
import { CampaignCharacterSchema, Character, Injuries, InjuriesSchema, Resources, Wound } from "../types";

export function makeTextLens(keyName: keyof Character){
  return {
    get: (character: Character) => {
      if (!character || !character[keyName]) return '';
      return character[keyName]
    },
    set: (character: Character, value: string) => {
      return ({...character, [keyName]: value})
    }
  }
}

export function makeResourceLens(keyName: keyof Resources){
  return {
    get: (character: Character) => {
      const campaignCharacter=CampaignCharacterSchema.parse(character) 
      if (!campaignCharacter || !campaignCharacter.resources[keyName]) return 0;
      return campaignCharacter.resources[keyName]
    },
    set: (character: Character, value: number) => {
      const campaignCharacter=CampaignCharacterSchema.parse(character)
      return ({...campaignCharacter, resources:{...campaignCharacter.resources, [keyName]: value}})
    }
  }
}

export function makeInjuryLens (){
  return {
    get: (character: Character) => {
      const campaignCharacter=CampaignCharacterSchema.parse(character) 
      if (!campaignCharacter || !campaignCharacter.injuries) return InjuriesSchema.parse({}); // Return default injuries if not present
      return campaignCharacter.injuries
    },
    set: (character: Character, keyName: keyof Injuries,  value: number | Wound) => {
      const campaignCharacter=CampaignCharacterSchema.parse(character)
      const updatedInjuries = {...campaignCharacter.injuries, [keyName]: value}
      return ({...campaignCharacter, injuries:updatedInjuries})
    },
  }
}