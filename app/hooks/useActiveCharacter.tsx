import { CampaignCharacter, Character } from "../domain/types";
import { isCampaignCharacter } from "../domain/utils";
import { useAppStore } from "../stores/useAppStore";
import { useCharacterStore } from "../stores/useCharacterStore";
import { useCombatStore } from "../stores/useCombatStore";

export function useActiveCharacter() {
  const selectedTab = useAppStore(s => s.selectedGameTab);
  
  const char = useCharacterStore(s => s.character);
  const combatChar = useCombatStore(s => s.getActiveCharacter());

  const activeChar = selectedTab === 'edit' ? char : combatChar;

  const updateCharacter = useCharacterStore(s => s.updateCharacter);
  const updateCombatActive = useCombatStore(s => s.updateActiveCharacter);

  // We define the updater to work on "Whatever the active character type is"
  const unifiedUpdate = <T extends Character>(updater: (c: T) => T) => {
    if (selectedTab === 'edit') {
      // Cast is safe here because we know we are in 'edit' tab
      updateCharacter(updater as unknown as (c: Character) => Character);
    } else if (selectedTab === 'play') {
      updateCombatActive(updater as unknown as (c: CampaignCharacter) => CampaignCharacter);
    }
  };

  return { character: activeChar, update: unifiedUpdate };
}