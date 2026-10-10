import { getRosterParties, getCombatRosterDigest, getPartyPicker, getPartyPickerDigest, type CombatRosterEntry, type PartyPicker, type RosterParty } from "../domain/scene/projections/roster";
import { setTarget } from "../domain/scene/commands/action";
import { getOpenAction } from "../domain/scene/rules/log";
import { getMoraleDigest, getMoraleRows, getSocialPanel, getTablePressureDigest, getTablePressureRows, MoraleRow, SocialPanel, TablePressureRow } from "../domain/scene/projections/morale";
import { getHeldDigest, getHeldRows, type HeldTestRow } from "../domain/scene/projections/heldTests";
import { getNextRoundBar } from "../domain/scene/rules/turn";
import { getCombatSurgeOptions, getTurnControls, TurnControls } from "../domain/scene/projections/turn";
import type { SurgeOption } from "../domain/character/lenses/surge";
import { getReturnBar } from "../domain/scene/rules/fight";
import { useCombatStore } from "../stores/useCombatStore";
import { useShallow } from "zustand/shallow";

// Fight-level primitives. Both go through the store selector, so a change to a
// combatant's sheet does not re-render the round counter.
export function useCombatState() {
  const round = useCombatStore((s) => s.round);
  const hasActiveCharacter = useCombatStore((s) => !!s.activeCharacterId);
  // An action being played out holds the fight: whoever it names must stay
  // in it until it resolves.
  const hasOpenAction = useCombatStore((s) => getOpenAction(s) !== null);
  const nextRoundBar = useCombatStore(getNextRoundBar);
  const returnBar = useCombatStore(getReturnBar);

  return { round, hasActiveCharacter, hasOpenAction, nextRoundBar, returnBar } as const;
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

// The active character's party and the ones they could join, gated on a
// digest since the picker is freshly allocated.
export function usePartyPicker(): PartyPicker | null {
  useCombatStore(getPartyPickerDigest);
  return getPartyPicker(useCombatStore.getState());
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

const NO_SOCIAL: SocialPanel = { bar: NO_ONE, negotiateBar: NO_ONE, insultBar: NO_ONE, cowardBar: NO_ONE, surrenderBar: NO_ONE, unsurrenderBar: NO_ONE, surrendered: false, value: 0, kinds: [], insultAtDefault: false, targets: [] }

// combat.tex "Social actions" — what the active character can say and to
// whom, gated on a digest since the panel is freshly allocated.
export function useSocial(): SocialPanel {
  useCombatStore((s) => (s.activeCharacterId ? JSON.stringify(getSocialPanel(s, s.activeCharacterId)) : ''));
  const s = useCombatStore.getState();
  return s.activeCharacterId ? getSocialPanel(s, s.activeCharacterId) : NO_SOCIAL;
}
