import { getRosterParties, getCombatRosterDigest, getPartiesPanel, getPartiesPanelDigest, type CombatRosterEntry, type PartiesPanel, type RosterParty } from "../domain/scene/projections/roster";
import { useActingAsGm } from "./useRole";
import { getSceneCards, getSceneCardsDigest, type SceneCardParty } from "../domain/scene/projections/cards";
import { getRoundChange, getRoundChangeDigest, type RoundChangeView } from "../domain/scene/projections/roundChange";
import { getOpenAction } from "../domain/scene/rules/log";
import { getCowardBar, getMoraleDigest, getMoraleRows, getTablePressureDigest, getTablePressureRows, MoraleRow, TablePressureRow } from "../domain/scene/projections/morale";
import { getBreakFreeView, getMockeryView, type MockeryView } from "../domain/scene/projections/domination";
import { getLeadershipView, type LeadershipView } from "../domain/scene/projections/providence";
import { getHeldDigest, getHeldRows, type HeldTestRow } from "../domain/scene/projections/heldTests";
import { getGearBar } from "../domain/scene/rules/turn";
import { FollowControls, getSurgeViews, getEndCombatNote, getFollowControls, getNextRoundClosing, getNextRoundNote, getContestModeOptions, getTurnControls, TurnControls, type SurgeView } from "../domain/scene/projections/turn";
import type { RollMode } from "../domain/play/dice";
import { getReturnBar } from "../domain/scene/rules/fight";
import { useCombatStore } from "../stores/useCombatStore";
import { useGmPickStore } from "../stores/useGmPickStore";
import { useActiveCharacterSelector } from "./useActiveCharacterSelector";
import { useShallow } from "zustand/shallow";
import { useSceneDispatch } from "./useSceneDispatch";
import { useFollowPick } from "./useFollowPick";

const NONE: string[] = [];

// Fight-level primitives. Both go through the store selector, so a change to a
// combatant's sheet does not re-render the round counter.
export function useCombatState() {
  const round = useCombatStore((s) => s.round);
  // An action being played out holds the fight: whoever it names must stay
  // in it until it resolves.
  const hasOpenAction = useCombatStore((s) => getOpenAction(s) !== null);
  const nextRoundBar = useCombatStore(getNextRoundNote);
  const nextRoundClosing = useCombatStore(useShallow(getNextRoundClosing));
  const returnBar = useCombatStore(getReturnBar);
  const endCombatBar = useCombatStore(getEndCombatNote);

  return { round, hasOpenAction, nextRoundBar, nextRoundClosing, returnBar, endCombatBar } as const;
}

// How many are in the fight, seen from the run screen's other modes.
export function useFighterCount(): number {
  return useCombatStore((s) => Object.keys(s.characters).length);
}

export function useCombatRoster(): {
  parties: RosterParty[];
  pick: (entry: CombatRosterEntry) => void;
  picked: string[];
} {
  // Gate on a digest of the roster, then build it — the entries are freshly
  // allocated, so they cannot gate themselves by identity.
  useCombatStore(getCombatRosterDigest);
  const parties = getRosterParties(useCombatStore.getState());
  const setActiveCharacter = useCombatStore((s) => s.setActiveCharacter);
  const dispatch = useSceneDispatch();
  const picked = useGmPickStore((s) => (s.picking ? s.picked : NONE));
  const { take } = useFollowPick();

  // A click on the roster marks whom to follow while that is being picked,
  // aims the open action while it is waiting for a target, and switches the
  // active character otherwise.
  const pick = (entry: CombatRosterEntry) => {
    if (take(entry.id)) return;
    if (useGmPickStore.getState().picking) useGmPickStore.getState().toggle(entry.id);
    else if (entry.targetable) dispatch({ kind: "target", args: [entry.id] });
    else setActiveCharacter(entry.id);
  };

  return { parties, pick, picked };
}

// The fight with no board, one card per character by party; a click does what
// a click on the roster does.
export function useSceneCards(): {
  parties: SceneCardParty[];
  pick: (entry: CombatRosterEntry) => void;
  picked: string[];
} {
  useCombatStore(getSceneCardsDigest);
  const parties = getSceneCards(useCombatStore.getState());
  const { pick, picked } = useCombatRoster();
  return { parties, pick, picked };
}

// The round change for the middle of the run screen, null while the round is
// played in turns; gated on a digest since the view is freshly allocated.
export function useRoundChange(): { view: RoundChangeView | null; pick: (entry: CombatRosterEntry) => void } {
  useCombatStore(getRoundChangeDigest);
  const view = getRoundChange(useCombatStore.getState());
  const { pick } = useCombatRoster();
  return { view, pick };
}

// The active character's party and the ones they could join, gated on a
// digest since the picker is freshly allocated.
export function usePartiesPanel(): PartiesPanel {
  useCombatStore(getPartiesPanelDigest);
  return getPartiesPanel(useCombatStore.getState());
}

// Why the active character's gear cannot be handled now, or null.
// Outside a fight nothing holds the gear to a turn.
export function useGearBar(): string | null {
  const gm = useActingAsGm();
  return useActiveCharacterSelector((c, fight) => (fight ? getGearBar(fight, c.id, gm) : null)) ?? null;
}

// gear.tex "Equipment Breakage": whether the fight plays with it.
export function useBreakage(): boolean {
  return useCombatStore((s) => s.breakage);
}

const NO_ONE = 'no active character'
const NO_TURN: TurnControls = { holder: '', inTurn: false, start: NO_ONE, contesting: false, contest: NO_ONE, contenders: '', contestMode: 'normal', roll: NO_ONE, end: NO_ONE, result: '', mustStart: '', stealth: '', duty: '' }

// play.tex "Combat" — the turn buttons for the active character, flat
// primitives gated shallowly.
const NO_MODES: RollMode[] = ['normal']

// How the active character may throw their cunning in the contest for the
// turn; a list of plain words, so it gates shallowly.
export function useContestModes(): RollMode[] {
  return useCombatStore(useShallow((s) => (s.activeCharacterId ? getContestModeOptions(s, s.activeCharacterId) : NO_MODES)))
}

export function useTurnControls(): TurnControls {
  return useCombatStore(useShallow((s) => (s.activeCharacterId ? getTurnControls(s, s.activeCharacterId) : NO_TURN)));
}

// combat.tex "Action surge" — one row per surge for the active character,
// gated on a digest since the rows are freshly allocated.
export function useSurgeViews(): SurgeView[] {
  useCombatStore((s) => (s.activeCharacterId ? JSON.stringify(getSurgeViews(s, s.activeCharacterId)) : ''));
  const s = useCombatStore.getState();
  return s.activeCharacterId ? getSurgeViews(s, s.activeCharacterId) : [];
}

// combat.tex "Follow" — whom the active character follows and whom they may
// mark, gated on a digest since the rows are freshly allocated.
export function useFollowControls(): FollowControls {
  useCombatStore((s) => {
    if (!s.activeCharacterId) return '';
    const f = getFollowControls(s, s.activeCharacterId);
    return `${f.marked}|${f.options.map((o) => `${o.id}:${o.bar ?? ''}`).join('|')}`;
  });
  const s = useCombatStore.getState();
  return s.activeCharacterId ? getFollowControls(s, s.activeCharacterId) : { marked: '', options: [] };
}

// combat.tex "Morale" — who the round called to a test and how each went,
// gated on a digest since the rows are freshly allocated.
export function useMorale(): MoraleRow[] {
  useCombatStore(getMoraleDigest);
  return getMoraleRows(useCombatStore.getState());
}

// combat.tex "Morale", "Pressure" — the pressure the table has set on each
// fighter, gated on a digest since the rows are freshly allocated.
export function useTablePressure(): TablePressureRow[] {
  useCombatStore(getTablePressureDigest);
  return getTablePressureRows(useCombatStore.getState());
}

// The tests held for the round (combat.tex "Swimming") — who is owed one and
// each one's result, gated on a digest since the rows are freshly allocated.
export function useHeldTests(): HeldTestRow[] {
  useCombatStore(getHeldDigest);
  return getHeldRows(useCombatStore.getState());
}

// creating.tex "Limit Stress Actions": why the table cannot take the active
// character for a coward, or null.
export function useCowardBar(): string | null {
  return useCombatStore((s) => (s.activeCharacterId ? getCowardBar(s, s.activeCharacterId) : NO_ONE));
}

// abilities.tex "Mockery": the active character's mock, null when they have
// not learned it.
export function useMockery(): MockeryView | null {
  const view = useCombatStore(useShallow((s) => (s.activeCharacterId ? getMockeryView(s, s.activeCharacterId) : null)));
  return view;
}

// abilities.tex "Leadership": the active character's rally at the round
// change, null when they have not learned it.
export function useLeadership(): LeadershipView | null {
  return useCombatStore(useShallow((s) => (s.activeCharacterId ? getLeadershipView(s, s.activeCharacterId) : null)));
}

// combat.tex "Dominated": why the active character cannot test to break out.
export function useBreakFreeBar(): string | null {
  return useCombatStore((s) => (s.activeCharacterId ? getBreakFreeView(s, s.activeCharacterId) : NO_ONE));
}
