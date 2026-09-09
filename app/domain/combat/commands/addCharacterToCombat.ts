import { CampaignCharacter } from "@/app/domain/types"

function makeFightName(char: CampaignCharacter, characters: Record<string, CampaignCharacter>){
  let newName = char.name
  
  let count = 1
  while(Object.values(characters).find(el => el.fightName == newName) ){
    count++
    newName = char.name + count
  }
  return newName
}


// A fight holds instances, not characters: the same sheet can be added twice and
// the two copies take damage independently. `fightName` already disambiguates
// them for display, and the id does the same for storage — a copy whose id is
// already in the fight is issued a fresh one, so it cannot overwrite the entry
// that is keyed by it. The first copy keeps its id, which is what lets a player
// character loaded into combat still save back over its own record. The id
// source is injected to keep this deterministic.
export function addCharacterToCombat(
  char: CampaignCharacter,
  characters: Record<string, CampaignCharacter>,
  newId: () => string,
) : CampaignCharacter {
  const fightName = makeFightName(char, characters)
  const id = characters[char.id] ? newId() : char.id
  return { ...char, id, fightName }
}
