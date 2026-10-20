import type { CastPlan, Decision, Exploring, Group, GroupKind } from "../domain/exploration/types";
import { getMoments, getMomentsDigest, type MomentView } from "../domain/campaign/projections/timeline";
import { getNodeOptions, type MapOptions } from "../domain/campaign/projections/maps";
import type { At, Sequence } from "../domain/campaign/types";
import type { SlotKind } from "../domain/types";
import { getTableParties, type TablePartiesView } from "../domain/scene/projections/tableParties";
import type { CombatRosterEntry } from "../domain/scene/projections/roster";
import { useCampaignRoster } from "./useCampaign";
import { useSceneCards } from "./useCombatState";
import { getTimelineClash } from "../domain/campaign/rules/clock";
import { getExplorationPanel, getPartiesDigest, getPartiesView, type ExplorationPanel, type PartiesView } from "../domain/exploration/projections/exploration";
import { getSaveLogBar } from "../domain/scene/rules/fight";
import type { TableCommand } from "../domain/scene/commands/tableRegistry";
import { getPassBar, getToDowntimeBar } from "../domain/exploration/rules/exploration";
import { getActiveCharacter } from "../domain/scene/rules/fighters";
import { useCampaignStore, type CampaignStore } from "../stores/useCampaignStore";
import { useCombatStore } from "../stores/useCombatStore";
import { useAppStore } from "../stores/useAppStore";
import { useAutoThrow, useDieAnswer } from "./useDieCalls";
import { useCampaignDispatch, useExplorationDispatch, useTableDispatch } from "./useSceneDispatch";
import { getCallRows, getDiceBar, type CallRow } from "../domain/play/calls";
import { getRosterName } from "../domain/campaign/rules/roster";

const exploring = (s: CampaignStore): Exploring & { campaign: CampaignStore } => ({ campaign: s, exploration: s.exploration });

// The parties, gated on a digest since the view is freshly allocated.
export function useParties(): PartiesView {
  useCampaignStore((s) => getPartiesDigest(exploring(s)));
  return getPartiesView(exploring(useCampaignStore.getState()));
}

// The moments the parties in play are living, gated on a digest since the
// view is freshly allocated.
export function useMoments(): MomentView[] {
  useCampaignStore(getMomentsDigest);
  return getMoments(useCampaignStore.getState());
}

// The campaign's parties and the fight's joined by id, and the pick of a
// fighter; gated by the two views it joins.
export function useTableParties(sequence?: Sequence): TablePartiesView & { pick: (entry: CombatRosterEntry) => void } {
  const roster = useCampaignRoster();
  const { parties: cards, pick } = useSceneCards();
  return { ...getTableParties(roster, cards, sequence), pick };
}

// Why the fight's log cannot be saved to the journal now.
export function useSaveLogBar(): string | null {
  return useCombatStore(getSaveLogBar);
}

// Why the campaign parties in the fight should not meet yet: they are on
// different timelines.
export function useFightTimelineClash(): string | null {
  const fightParties = useCombatStore((s) => s.partyOf);
  useCampaignStore((s) => s.parties);
  return getTimelineClash(useCampaignStore.getState(), Object.values(fightParties));
}

// Every node of the campaign's maps a party can be put on.
export function useNodeOptions(): MapOptions[] {
  return useCampaignStore((s) => getNodeOptions(s.maps));
}

// Why the ET cannot pass now.
export function usePassBar(): string | null {
  return useCampaignStore((s) => getPassBar(exploring(s)));
}

// Why the party cannot leave exploration for downtime now.
export function useToDowntimeBar(partyId: string): string | null {
  return useCampaignStore((s) => getToDowntimeBar(exploring(s), partyId));
}

// survival.tex "Exhaustion", "Rest", "Wear" — the plans for the coming ET
// open to the party's active character. The panel reads that character, where
// their party is, and what exploration keeps, so their references are the
// gate.
export function useExploration(): ExplorationPanel {
  const c = useCampaignStore(getActiveCharacter);
  useCampaignStore((s) => s.parties);
  useCampaignStore((s) => s.partyOf);
  useCampaignStore((s) => s.maps);
  useCampaignStore((s) => s.exploration);
  return getExplorationPanel(exploring(useCampaignStore.getState()), c?.id ?? null);
}

// Why no plan may change: the passing ET waits on dice.
export function useETDiceBar(): string | null {
  return useCampaignStore((s) => getDiceBar(s.exploration.calls));
}

// The tests the passing ET has called for, gated on the calls themselves.
export function useETCalls(): CallRow[] {
  useCampaignStore((s) => s.exploration.calls);
  const s = useCampaignStore.getState();
  return getCallRows(s.exploration.calls, (id) => getRosterName(s, id));
}

// The answer to a test the ET calls for.
export function useETAnswer() {
  const send = useExplorationDispatch();
  return useDieAnswer(
    () => useCampaignStore.getState().exploration.calls,
    (callId, die, source) => send({ kind: "answer", args: [callId, die, source] }),
  );
}

// The ET's dice that are this screen's own, answered by themselves.
export function useETAutoThrow() {
  useAutoThrow(useCampaignStore((s) => s.exploration.calls), useETAnswer());
}

export function usePartyCommands() {
  const send = useCampaignDispatch();
  const sendTable = useTableDispatch();
  const explore = useExplorationDispatch();
  const pick = useCampaignStore((s) => s.setActiveCharacter);
  const setTab = useAppStore((s) => s.setSelectedGameTab);

  // the plans and the meals are the active character's own
  const withActive = (run: (id: string) => void) => {
    const id = useCampaignStore.getState().activeCharacterId;
    if (id) run(id);
  };

  // Whoever is sent to a scene is followed into it, and the last to come
  // back from it is followed back to exploring.
  const toFight = (command: TableCommand) => {
    if (sendTable(command)) setTab('scene');
  };
  const comeBack = (command: TableCommand) => {
    if (sendTable(command) && Object.keys(useCombatStore.getState().characters).length === 0) setTab('exploration');
  };

  return {
    pick,
    joinGroup: (groupId: string) => withActive((id) => explore({ kind: "joinGroup", args: [id, groupId] })),
    rest: (resting: boolean) => withActive((id) => explore({ kind: "rest", args: [id, resting] })),
    planCast: (key: string) => withActive((id) => explore({ kind: "planCast", args: [id, key] })),
    setCast: (settings: Partial<Omit<CastPlan, 'key'>>) => withActive((id) => explore({ kind: "setCast", args: [id, settings] })),
    eat: (nutrition: number) => withActive((id) => explore({ kind: "eat", args: [id, nutrition] })),
    eatFood: (itemId: string) => withActive((id) => explore({ kind: "eatFood", args: [id, itemId] })),
    takeItem: (itemId: string) => withActive((id) => explore({ kind: "takeItem", args: [id, itemId] })),
    drink: () => withActive((id) => explore({ kind: "drink", args: [id] })),
    takeFromPile: (partyId: string, itemId: string, containerKey: string, slot: SlotKind) => withActive((id) => explore({ kind: "takeFromPile", args: [id, partyId, itemId, containerKey, slot] })),
    setExposure: (partyId: string, exposure: number) => send({ kind: "setPartyExposure", args: [partyId, exposure] }),
    setLit: (partyId: string, lit: boolean) => send({ kind: "setPartyLit", args: [partyId, lit] }),
    setPlace: (partyId: string, at: At | null) => send({ kind: "setPartyPlace", args: [partyId, at] }),
    setDayETs: (dayETs: number) => send({ kind: "setDayETs", args: [dayETs] }),
    merge: (fromId: string, intoId: string) => send({ kind: "mergeParties", args: [fromId, intoId] }),
    setActive: (partyId: string, active: boolean) => send({ kind: "setPartyActive", args: [partyId, active] }),
    addGroup: (partyId: string, kind: GroupKind) => explore({ kind: "addGroup", args: [partyId, kind] }),
    removeGroup: (partyId: string, groupId: string) => explore({ kind: "removeGroup", args: [partyId, groupId] }),
    setGroup: (partyId: string, groupId: string, settings: Partial<Pick<Group, 'DL' | 'mode' | 'target' | 'seek' | 'tool'>>) => explore({ kind: "setGroup", args: [partyId, groupId, settings] }),
    setRoller: (partyId: string, groupId: string, roller: string) => explore({ kind: "setRoller", args: [partyId, groupId, roller] }),
    decide: (id: string, decision: Decision) => explore({ kind: "decide", args: [id, decision] }),
    passET: () => explore({ kind: "passET", args: [] }),
    adjustMet: (index: number, adjust: number) => explore({ kind: "adjustMet", args: [index, adjust] }),
    resolvePlan: (partyId: string, groupId: string) => explore({ kind: "resolvePlan", args: [partyId, groupId] }),
    toDowntime: (partyId: string) => explore({ kind: "toDowntime", args: [partyId] }),
    partyToScene: (partyId: string) => toFight({ kind: "sendPartyToFight", args: [partyId] }),
    toScene: (id: string) => toFight({ kind: "sendToFight", args: [[id]] }),
    partyBack: (partyId: string, ets: number) => comeBack({ kind: "returnPartyFromFight", args: [partyId, ets] }),
    back: (id: string, ets: number) => comeBack({ kind: "returnFromFight", args: [[id], ets] }),
    saveLog: () => sendTable({ kind: "saveFightLog", args: [] }),
  };
}
