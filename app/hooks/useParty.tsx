import type { CampaignUpdater } from "../domain/campaign/types";
import type { Decision, Exploring, ExplorationUpdater, Group, GroupKind } from "../domain/exploration/types";
import { getClockView, type ClockView } from "../domain/campaign/projections/clock";
import { getExplorationPanel, getPartiesDigest, getPartiesView, type ExplorationPanel, type PartiesView } from "../domain/exploration/projections/exploration";
import { drink as drinkFor, eat as eatFor, passET as passClock } from "../domain/exploration/commands/exploration";
import { addGroup as addGroupTo, decide as decideFor, joinGroup as joinGroupOf, removeGroup as removeGroupOf, setGroup as setGroupOf, setResting, setRoller as setRollerOf } from "../domain/exploration/commands/plans";
import { loadMap as loadMapOf, mergeParties as mergeInto, setPartyExposure, setPartyLit, setPartyNode, unloadMap } from "../domain/campaign/commands/parties";
import { setDayETs } from "../domain/campaign/commands/clock";
import { useMapNames } from "./useMap";
import { removeFromRoster } from "../domain/campaign/commands/roster";
import { returnFromFight, sendToFight } from "../domain/campaign/commands/fight";
import { getPassBar } from "../domain/exploration/rules/exploration";
import { getActiveCharacter } from "../domain/scene/rules/fighters";
import { useCampaignStore, type CampaignStore } from "../stores/useCampaignStore";
import { realDice } from "../components/utils";

const exploring = (s: CampaignStore): Exploring => ({ campaign: s, exploration: s.exploration });

// The parties, gated on a digest since the view is freshly allocated.
export function useParties(): PartiesView {
  useCampaignStore((s) => getPartiesDigest(exploring(s)));
  return getPartiesView(exploring(useCampaignStore.getState()));
}

export function useClock(): ClockView {
  return getClockView(useCampaignStore((s) => s.clock));
}

// Why the ET cannot pass now.
export function usePassBar(): string | null {
  return useCampaignStore((s) => getPassBar(exploring(s)));
}

// survival.tex "Exhaustion", "Rest", "Wear" — the plans for the coming ET
// open to the party's active character. The panel reads that character, where
// their party is, and what exploration keeps, so their references are the
// gate.
export function useExploration(): ExplorationPanel {
  const c = useCampaignStore(getActiveCharacter);
  useCampaignStore((s) => s.parties);
  useCampaignStore((s) => s.partyOf);
  useCampaignStore((s) => s.clock);
  useCampaignStore((s) => s.map);
  useCampaignStore((s) => s.exploration);
  return getExplorationPanel(exploring(useCampaignStore.getState()), c?.id ?? null);
}

export function usePartyCommands() {
  const updateCampaignState = useCampaignStore((s) => s.updateCampaignState);
  const updateTable = useCampaignStore((s) => s.updateTable);
  const updateExploration = useCampaignStore((s) => s.updateExploration);
  const pick = useCampaignStore((s) => s.setActiveCharacter);
  const { mapList } = useMapNames();

  const withActive = (run: (id: string) => void) => {
    const id = useCampaignStore.getState().activeCharacterId;
    if (id) run(id);
  };
  const asActive = (command: (id: string) => CampaignUpdater) => withActive((id) => updateCampaignState(command(id)));
  const planActive = (command: (id: string) => ExplorationUpdater) => withActive((id) => updateExploration(command(id)));

  const newId = () => crypto.randomUUID();

  return {
    pick,
    joinGroup: (groupId: string) => planActive((id) => joinGroupOf(id, groupId)),
    rest: (resting: boolean) => planActive((id) => setResting(id, resting)),
    eat: (nutrition: number) => asActive((id) => eatFor(id, nutrition)),
    drink: () => asActive(drinkFor),
    leaveParty: () => asActive(removeFromRoster),
    setExposure: (partyId: string, exposure: number) => updateCampaignState(setPartyExposure(partyId, exposure)),
    setLit: (partyId: string, lit: boolean) => updateCampaignState(setPartyLit(partyId, lit)),
    setNode: (partyId: string, node: string | null) => updateCampaignState(setPartyNode(partyId, node)),
    loadMap: (name: string) => updateCampaignState(name in mapList ? loadMapOf(mapList[name]) : unloadMap),
    setDayETs: (dayETs: number) => updateCampaignState(setDayETs(dayETs)),
    merge: (fromId: string, intoId: string) => updateCampaignState(mergeInto(fromId, intoId)),
    addGroup: (partyId: string, kind: GroupKind) => updateExploration(addGroupTo(partyId, kind, newId)),
    removeGroup: (partyId: string, groupId: string) => updateExploration(removeGroupOf(partyId, groupId)),
    setGroup: (partyId: string, groupId: string, settings: Partial<Pick<Group, 'DL' | 'mode' | 'target' | 'seek' | 'tool'>>) => updateExploration(setGroupOf(partyId, groupId, settings)),
    setRoller: (partyId: string, groupId: string, roller: string) => updateExploration(setRollerOf(partyId, groupId, roller)),
    decide: (id: string, decision: Decision) => updateExploration(decideFor(id, decision)),
    passET: () => updateExploration(passClock(realDice, newId)),
    sendActiveToFight: () => withActive((id) => updateTable(sendToFight([id], newId))),
    sendAllToFight: () => updateTable(sendToFight(Object.keys(useCampaignStore.getState().characters), newId)),
    returnFromFight: () => updateTable(returnFromFight(newId)),
  };
}
