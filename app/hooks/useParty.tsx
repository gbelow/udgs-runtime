import type { CampaignUpdater, Decision, Group, GroupKind, Light } from "../domain/campaign/types";
import { getClockView, type ClockView } from "../domain/campaign/projections/clock";
import { getExplorationPanel, getPartiesDigest, getPartiesView, type ExplorationPanel, type PartiesView } from "../domain/campaign/projections/exploration";
import { drink as drinkFor, eat as eatFor, passET as passClock } from "../domain/campaign/commands/exploration";
import { addGroup as addGroupTo, decide as decideFor, joinGroup as joinGroupOf, mergeParties as mergeInto, removeGroup as removeGroupOf, setGroup as setGroupOf, setPartyExposure, setPartyLight, setResting, setRoller as setRollerOf } from "../domain/campaign/commands/parties";
import { removeFromRoster } from "../domain/campaign/commands/roster";
import { returnFromFight, sendToFight } from "../domain/campaign/commands/fight";
import { getPassBar } from "../domain/campaign/rules/exploration";
import { getActiveCharacter } from "../domain/combat/rules/fighters";
import { useCampaignStore } from "../stores/useCampaignStore";
import { useCombatStore } from "../stores/useCombatStore";
import { realDice } from "../components/utils";

// The parties, gated on a digest since the view is freshly allocated.
export function useParties(): PartiesView {
  useCampaignStore(getPartiesDigest);
  return getPartiesView(useCampaignStore.getState());
}

export function useClock(): ClockView {
  return getClockView(useCampaignStore((s) => s.clock));
}

// Why the ET cannot pass now; the fight's roster and the campaign are the gate.
export function usePassBar(): string | null {
  useCombatStore((s) => s.characters);
  useCampaignStore((s) => s.parties);
  useCampaignStore((s) => s.opening);
  return getPassBar({ campaign: useCampaignStore.getState(), fight: useCombatStore.getState() });
}

// survival.tex "Exhaustion", "Rest", "Wear" — the plans for the coming ET
// open to the party's active character. The panel reads that character, the
// parties and the ET registries, so their references are the gate.
export function useExploration(): ExplorationPanel {
  const c = useCampaignStore(getActiveCharacter);
  useCampaignStore((s) => s.parties);
  useCampaignStore((s) => s.resting);
  useCampaignStore((s) => s.rests);
  useCampaignStore((s) => s.exhaustionRolls);
  return getExplorationPanel(useCampaignStore.getState(), c?.id ?? null);
}

export function usePartyCommands() {
  const updateCampaignState = useCampaignStore((s) => s.updateCampaignState);
  const updateTable = useCampaignStore((s) => s.updateTable);
  const pick = useCampaignStore((s) => s.setActiveCharacter);

  const withActive = (run: (id: string) => void) => {
    const id = useCampaignStore.getState().activeCharacterId;
    if (id) run(id);
  };
  const asActive = (command: (id: string) => CampaignUpdater) => withActive((id) => updateCampaignState(command(id)));

  const newId = () => crypto.randomUUID();

  return {
    pick,
    joinGroup: (groupId: string) => asActive((id) => joinGroupOf(id, groupId)),
    rest: (resting: boolean) => asActive((id) => setResting(id, resting)),
    eat: (nutrition: number) => asActive((id) => eatFor(id, nutrition)),
    drink: () => asActive(drinkFor),
    leaveParty: () => asActive(removeFromRoster),
    setExposure: (partyId: string, exposure: number) => updateCampaignState(setPartyExposure(partyId, exposure)),
    setLight: (partyId: string, light: Light) => updateCampaignState(setPartyLight(partyId, light)),
    merge: (fromId: string, intoId: string) => updateCampaignState(mergeInto(fromId, intoId)),
    addGroup: (partyId: string, kind: GroupKind) => updateCampaignState(addGroupTo(partyId, kind, newId)),
    removeGroup: (partyId: string, groupId: string) => updateCampaignState(removeGroupOf(partyId, groupId)),
    setGroup: (partyId: string, groupId: string, settings: Partial<Pick<Group, 'DL' | 'mode' | 'knowledge' | 'tool'>>) => updateCampaignState(setGroupOf(partyId, groupId, settings)),
    setRoller: (partyId: string, groupId: string, roller: string) => updateCampaignState(setRollerOf(partyId, groupId, roller)),
    decide: (id: string, decision: Decision) => updateCampaignState(decideFor(id, decision)),
    passET: () => updateTable(passClock(realDice, newId)),
    sendActiveToFight: () => withActive((id) => updateTable(sendToFight([id], newId))),
    sendAllToFight: () => updateTable(sendToFight(Object.keys(useCampaignStore.getState().characters), newId)),
    returnFromFight: () => updateTable(returnFromFight(newId)),
  };
}
