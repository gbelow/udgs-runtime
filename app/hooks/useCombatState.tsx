import { getRosterParties, getCombatRosterDigest, getPartiesPanel, getPartiesPanelDigest, type CombatRosterEntry, type PartiesPanel, type RosterParty } from "../domain/scene/projections/roster";
import { useActingAsGm } from "./useRole";
import { setTarget } from "../domain/scene/commands/action";
import { getSceneCards, getSceneCardsDigest, type SceneCardParty } from "../domain/scene/projections/cards";
import { getRoundChange, getRoundChangeDigest, type RoundChangeView } from "../domain/scene/projections/roundChange";
import { getOpenAction } from "../domain/scene/rules/log";
import { getCowardBar, getMoraleDigest, getMoraleRows, getTablePressureDigest, getTablePressureRows, MoraleRow, TablePressureRow } from "../domain/scene/projections/morale";
import { getHeldDigest, getHeldRows, type HeldTestRow } from "../domain/scene/projections/heldTests";
import { getGearBar, getNextRoundBar } from "../domain/scene/rules/turn";
import { getCombatSurgeOptions, getTurnControls, TurnControls } from "../domain/scene/projections/turn";
import type { SurgeOption } from "../domain/character/lenses/surge";
import { getReturnBar, getEndCombatBar } from "../domain/scene/rules/fight";
import { useCombatStore } from "../stores/useCombatStore";
import { useActiveCharacterSelector } from "./useActiveCharacterSelector";
import { useShallow } from "zustand/shallow";

// Fight-level primitives. Both go through the store selector, so a change to a
// combatant's sheet does not re-render the round counter.
export function useCombatState() {
  const round = useCombatStore((s) => s.round);
  // An action being played out holds the fight: whoever it names must stay
  // in it until it resolves.
  const hasOpenAction = useCombatStore((s) => getOpenAction(s) !== null);
  const nextRoundBar = useCombatStore(getNextRoundBar);
  const returnBar = useCombatStore(getReturnBar);
  const endCombatBar = useCombatStore(getEndCombatBar);

  return { round, hasOpenAction, nextRoundBar, returnBar, endCombatBar } as const;
}

// How many are in the fight, seen from the run screen's other modes.
export function useFighterCount(): number {
  return useCombatStore((s) => Object.keys(s.characters).length);
}

export function useCombatRoster(): {
  parties: RosterParty[];
  pick: (entry: CombatRosterEntry) => void;
} {
  // Gate on a digest of the roster, then build it — the entries are freshly
  // allocated, so they cannot gate themselves by identity.
  useCombatStore(getCombatRosterDigest);
  const parties = getRosterParties(useCombatStore.getState());
  const setActiveCharacter = useCombatStore((s) => s.setActiveCharacter);
  const update = useCombatStore((s) => s.updateCombatState);

  // A click on the roster aims the open action while it is waiting for a
  // target, and switches the active character otherwise.
  const pick = (entry: CombatRosterEntry) => {
    if (entry.targetable) update(setTarget(entry.id));
    else setActiveCharacter(entry.id);
  };

  return { parties, pick };
}

// The fight with no board, one card per character by party; a click does what
// a click on the roster does.
export function useSceneCards(): {
  parties: SceneCardParty[];
  pick: (entry: CombatRosterEntry) => void;
} {
  useCombatStore(getSceneCardsDigest);
  const parties = getSceneCards(useCombatStore.getState());
  const { pick } = useCombatRoster();
  return { parties, pick };
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

const NO_ONE = 'no active character'
const NO_TURN: TurnControls = { holder: '', inTurn: false, start: NO_ONE, contesting: false, contest: NO_ONE, contenders: '', roll: NO_ONE, end: NO_ONE, result: '', agreed: false, breakage: true, breakageBar: NO_ONE, stealth: '' }

// play.tex "Combat" — the turn buttons for the active character, flat
// primitives gated shallowly.
export function useTurnControls(): TurnControls {
  return useCombatStore(useShallow((s) => (s.activeCharacterId ? getTurnControls(s, s.activeCharacterId) : NO_TURN)));
}

// combat.tex "Action surge" — one row per surge for the active character,
// gated on a digest since the rows are freshly allocated.
export function useCombatSurgeOptions(): SurgeOption[] {
  useCombatStore((s) => (s.activeCharacterId ? getCombatSurgeOptions(s, s.activeCharacterId).map((o) => `${o.kind}:${o.title}:${o.available ? 1 : 0}:${o.used ? 1 : 0}`).join('|') : ''));
  const s = useCombatStore.getState();
  return s.activeCharacterId ? getCombatSurgeOptions(s, s.activeCharacterId) : [];
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
