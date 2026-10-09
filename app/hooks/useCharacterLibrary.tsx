import { Character } from "../domain/types";
import { useAppStore } from "../stores/useAppStore";
import { useCharacterStore } from "../stores/useCharacterStore";
import { useCampaignStore } from "../stores/useCampaignStore";

// The saved-character lists and their refreshers. Each field is selected
// separately so a list refresh does not re-render subscribers of the other.
export function useCharacterLibrary() {
  const baseCharacterList = useAppStore((s) => s.baseCharacterList);
  const playerCharacterList = useAppStore((s) => s.playerCharacterList);
  const refreshBaseList = useAppStore((s) => s.updateBaseCharacterList);
  const refreshPlayerList = useAppStore((s) => s.updatePlayerCharacterList);

  return { baseCharacterList, playerCharacterList, refreshBaseList, refreshPlayerList } as const;
}

// Loading a character means different things per tab — the editor replaces the
// one being edited, the party gains a member, a fight gains another combatant
// (who joins the party when the fight ends) — so the routing lives here
// rather than in the component that owns the click.
export function useLoadCharacter() {
  const tab = useAppStore((s) => s.selectedGameTab);
  const loadForEdit = useCharacterStore((s) => s.loadCharacter);
  const addToCombat = useCampaignStore((s) => s.loadFighter);
  const addToParty = useCampaignStore((s) => s.loadCharacter);

  return (character: Character) => {
    if (tab === "edit") loadForEdit(character);
    if (tab === "party") addToParty(character);
    if (tab === "play") addToCombat(character);
  };
}
