import { CampaignCharacter, CampaignCharacterUpdater, Character } from "../domain/types";
import { isCampaignCharacter } from "../domain/utils";
import { useAppStore } from "../stores/useAppStore";
import { useCharacterStore } from "../stores/useCharacterStore";
import { useCombatStore } from "../stores/useCombatStore";


export function useActiveCharacterUpdater(){
  const characterStore = useCharacterStore()
  const appStore = useAppStore(s => s)

  return((updater : (c: Character | CampaignCharacter) => Character | CampaignCharacter) => {
    if(appStore.selectedGameTab == 'edit'){
      characterStore.updateCharacter(updater)
    }
  })
}

export function useActiveCampaignCharacterUpdater(){
  const combatStore = useCombatStore()
  const appStore = useAppStore(s => s)

  return((updater : (c: CampaignCharacter) => CampaignCharacter) => {
    
    if(appStore.selectedGameTab == 'play'){
      const activeCharacter = combatStore.getActiveCharacter()
      if(!activeCharacter || !isCampaignCharacter(activeCharacter)) return
      combatStore.updateActiveCharacter(updater)
    }
  })
}