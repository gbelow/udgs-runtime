import { CampaignCharacter, Character } from "../domain/types";
import { useAppStore } from "../stores/useAppStore";
import { useCharacterStore } from "../stores/useCharacterStore";
import {  useCombatStore } from "../stores/useCombatStore";


export function useGetActiveCharacter(): Character | CampaignCharacter | null {
  const characterStore = useCharacterStore()
  const appStore = useAppStore(s => s)

    if(appStore.selectedGameTab == 'edit' && characterStore.character){
      return characterStore.character
    }
    return null
}

export function useGetActiveCampaignCharacter(): CampaignCharacter | null {
  const combatStore = useCombatStore()
  const appStore = useAppStore(s => s)

    const combatChar: CampaignCharacter | null = combatStore.getActiveCharacter()
    if(appStore.selectedGameTab == 'play' && combatChar ){
      return combatChar
    }
    return null
}