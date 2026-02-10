import { isCampaignCharacter } from "../domain/utils";
import { useActiveCharacter } from "./useActiveCharacter";

export function useActiveCharacterData() {
  const { character } = useActiveCharacter();

  if (character && isCampaignCharacter(character)) {
    return { 
      fightName: character.fightName, 
      hasActionSurge: character.hasActionSurge, 
      notes: character.notes 
    };
  }

  return { fightName: "", hasActionSurge: false, notes: character?.notes };
}