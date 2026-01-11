import { CampaignCharacter, CampaignCharacterSchema, Character } from "./types"

function makeFightName(char: CampaignCharacter, characters: Record<string, CampaignCharacter>){
  let newName = char.name
  let count = 1
  while(Object.values(characters).find(el => el.fightName == newName) ){
    count++
    newName = char.name + count
  }
  return newName
}

export function addCharacterToCombat(char: CampaignCharacter, characters: Record<string, CampaignCharacter>) : CampaignCharacter {
  const fightName = makeFightName(char, characters)
  return { ...char, fightName }
}

export function isCampaignCharacter(
  c: Character | CampaignCharacter
): c is CampaignCharacter {
  return CampaignCharacterSchema.safeParse(c).success
}
