import type { CampaignUpdater } from "../domain/campaign/types";
import type { CastPlan, Decision, Exploring, ExplorationUpdater, Group, GroupKind } from "../domain/exploration/types";
import { getMoments, getMomentsDigest, type MomentView } from "../domain/campaign/projections/timeline";
import { getNodeOptions, type MapOptions } from "../domain/campaign/projections/maps";
import type { At } from "../domain/campaign/types";
import { getTimelineClash } from "../domain/campaign/rules/clock";
import { getExplorationPanel, getPartiesDigest, getPartiesView, type ExplorationPanel, type PartiesView } from "../domain/exploration/projections/exploration";
import { answerET, drink as drinkFor, eat as eatFor, eatFood as eatFoodFor, passET as passClock, takeItem as takeItemFor, toDowntime } from "../domain/exploration/commands/exploration";
import { addGroup as addGroupTo, decide as decideFor, joinGroup as joinGroupOf, planCast as planCastOf, removeGroup as removeGroupOf, setCast as setCastOf, setGroup as setGroupOf, setResting, setRoller as setRollerOf } from "../domain/exploration/commands/plans";
import { mergeParties as mergeInto, setPartyExposure, setPartyLit, setPartyPlace } from "../domain/campaign/commands/parties";
import { passTimeTo, placeOnTimeline, setDayETs, setPartyActive } from "../domain/campaign/commands/clock";
import { returnFromFight, returnPartyFromFight, saveFightLog, sendPartyToFight, sendToFight } from "../domain/scene/commands/fight";
import { getSaveLogBar } from "../domain/scene/rules/fight";
import type { TableUpdater } from "../domain/scene/types";
import { getGroupActor, getPassBar, getToDowntimeBar } from "../domain/exploration/rules/exploration";
import type { Actor } from "../domain/profiles";
import { getActiveCharacter } from "../domain/scene/rules/fighters";
import { useCampaignStore, type CampaignStore } from "../stores/useCampaignStore";
import { useCombatStore } from "../stores/useCombatStore";
import { useAppStore } from "../stores/useAppStore";
import { useActGate } from "./useControl";
import { useAutoThrow, useDieAnswer, useThrower } from "./useDieCalls";
import { getCallRows, getDiceBar, type CallRow } from "../domain/play/calls";
import { getRosterName } from "../domain/campaign/rules/roster";

const exploring = (s: CampaignStore): Exploring => ({ campaign: s, exploration: s.exploration });

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

const newId = () => crypto.randomUUID();

// The answer to a test the ET calls for.
export function useETAnswer() {
  const updateExploration = useCampaignStore((s) => s.updateExploration);
  return useDieAnswer(
    () => useCampaignStore.getState().exploration.calls,
    (callId, die, source, thrower) => updateExploration(answerET(callId, die, source, thrower, newId)),
  );
}

// The dice tray opened by itself for the dice the ET calls for.
export function useETAutoThrow() {
  useAutoThrow(useCampaignStore((s) => s.exploration.calls), useETAnswer());
}

export function usePartyCommands() {
  const updateCampaignState = useCampaignStore((s) => s.updateCampaignState);
  const updateTable = useCampaignStore((s) => s.updateTable);
  const updateExploration = useCampaignStore((s) => s.updateExploration);
  const pick = useCampaignStore((s) => s.setActiveCharacter);
  const setTab = useAppStore((s) => s.setSelectedGameTab);
  const gate = useActGate();
  const thrower = useThrower();

  const as = (actor: Actor, run: () => void) => { if (gate(actor)) run(); };
  const asGm = (run: () => void) => as("gm", run);
  const asGroup = (partyId: string, run: () => void, settings?: Partial<Group>) => as(getGroupActor(exploring(useCampaignStore.getState()), partyId, settings), run);
  const withActive = (run: (id: string) => void) => {
    const id = useCampaignStore.getState().activeCharacterId;
    if (id) as({ id }, () => run(id));
  };
  const asActive = (command: (id: string) => CampaignUpdater) => withActive((id) => updateCampaignState(command(id)));
  const planActive = (command: (id: string) => ExplorationUpdater) => withActive((id) => updateExploration(command(id)));

  const comeBack = (updater: TableUpdater) => {
    updateTable(updater);
    if (Object.keys(useCombatStore.getState().characters).length === 0) setTab('exploration');
  };

  return {
    pick,
    joinGroup: (groupId: string) => planActive((id) => joinGroupOf(id, groupId)),
    rest: (resting: boolean) => planActive((id) => setResting(id, resting)),
    planCast: (key: string) => planActive((id) => planCastOf(id, key)),
    setCast: (settings: Partial<Omit<CastPlan, 'key'>>) => planActive((id) => setCastOf(id, settings)),
    eat: (nutrition: number) => asActive((id) => eatFor(id, nutrition)),
    eatFood: (itemId: string) => asActive((id) => eatFoodFor(id, itemId)),
    takeItem: (itemId: string) => asActive((id) => takeItemFor(id, itemId)),
    drink: () => asActive(drinkFor),
    setExposure: (partyId: string, exposure: number) => asGm(() => updateCampaignState(setPartyExposure(partyId, exposure))),
    setLit: (partyId: string, lit: boolean) => asGm(() => updateCampaignState(setPartyLit(partyId, lit))),
    setPlace: (partyId: string, at: At | null) => asGm(() => updateCampaignState(setPartyPlace(partyId, at))),
    setDayETs: (dayETs: number) => asGm(() => updateCampaignState(setDayETs(dayETs))),
    merge: (fromId: string, intoId: string) => asGm(() => updateCampaignState(mergeInto(fromId, intoId))),
    setActive: (partyId: string, active: boolean) => asGm(() => updateCampaignState(setPartyActive(partyId, active))),
    sync: (partyId: string, how: 'place' | 'pass', to: number) => asGm(() => updateCampaignState(how === 'place' ? placeOnTimeline(partyId, to) : passTimeTo(partyId, to))),
    addGroup: (partyId: string, kind: GroupKind) => asGroup(partyId, () => updateExploration(addGroupTo(partyId, kind, newId))),
    removeGroup: (partyId: string, groupId: string) => asGroup(partyId, () => updateExploration(removeGroupOf(partyId, groupId))),
    setGroup: (partyId: string, groupId: string, settings: Partial<Pick<Group, 'DL' | 'mode' | 'target' | 'seek' | 'tool'>>) => asGroup(partyId, () => updateExploration(setGroupOf(partyId, groupId, settings)), settings),
    setRoller: (partyId: string, groupId: string, roller: string) => asGroup(partyId, () => updateExploration(setRollerOf(partyId, groupId, roller))),
    decide: (id: string, decision: Decision) => as({ id }, () => updateExploration(decideFor(id, decision))),
    passET: () => asGm(() => updateExploration(passClock(thrower, newId))),
    toDowntime: (partyId: string) => asGm(() => updateExploration(toDowntime(partyId))),
    // Whoever is sent to a scene is followed into it, and the last to come
    // back from it is followed back to exploring.
    partyToScene: (partyId: string) => asGm(() => { updateTable(sendPartyToFight(partyId)); setTab('scene'); }),
    toScene: (id: string) => asGm(() => { updateTable(sendToFight([id])); setTab('scene'); }),
    partyBack: (partyId: string, ets: number) => asGm(() => comeBack(returnPartyFromFight(partyId, ets))),
    back: (id: string, ets: number) => asGm(() => comeBack(returnFromFight([id], ets))),
    saveLog: () => asGm(() => updateTable(saveFightLog)),
  };
}
