import { Character } from "../domain/types";
import { copyIntoPlay } from "../domain/factories";
import { isRunTab, TAB_OWNER, useAppStore } from "../stores/useAppStore";
import { useCharacterStore } from "../stores/useCharacterStore";
import { useCampaignStore } from "../stores/useCampaignStore";
import { useCampaignDispatch, useTableDispatch } from "./useSceneDispatch";

// The saved-character lists and their refreshers. Each field is selected
// separately so a list refresh does not re-render subscribers of the other.
export function useCharacterLibrary() {
  const baseCharacterList = useAppStore((s) => s.baseCharacterList);
  const playerCharacterList = useAppStore((s) => s.playerCharacterList);
  const refreshBaseList = useAppStore((s) => s.updateBaseCharacterList);
  const refreshPlayerList = useAppStore((s) => s.updatePlayerCharacterList);

  return { baseCharacterList, playerCharacterList, refreshBaseList, refreshPlayerList } as const;
}

const intoPlay = (character: Character) => copyIntoPlay(character, crypto.randomUUID());

// Loading a character means different things per tab — the editor replaces the
// one being edited, the party gains a member, a fight gains another combatant
// (who joins the party when the fight ends) — so the routing lives here
// rather than in the component that owns the click.
export function useLoadCharacter() {
  const tab = useAppStore((s) => s.selectedGameTab);
  const loadForEdit = useCharacterStore((s) => s.loadCharacter);
  const send = useTableDispatch();
  const sendCampaign = useCampaignDispatch();

  // onto the roster, into the party of whoever this screen has picked
  return (character: Character) => {
    const owner = TAB_OWNER[tab];
    if (owner === "character") loadForEdit(character);
    else if (isRunTab(tab) && owner === "campaign") {
      const { activeCharacterId: picked, partyOf } = useCampaignStore.getState();
      sendCampaign({ kind: "addToRoster", args: [intoPlay(character), picked ? partyOf[picked] : undefined] });
    }
    else if (isRunTab(tab) && owner === "combat") send({ kind: "loadIntoFight", args: [intoPlay(character)] });
  };
}

// A character picked from the catalog or the PCs, brought into a party the
// fight made.
export function useBringIntoParty() {
  const send = useTableDispatch();
  return (character: Character, partyId: string) =>
    send({ kind: "loadIntoFight", args: [intoPlay(character), partyId] });
}
