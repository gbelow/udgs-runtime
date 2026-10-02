import { getCombatRoster, getCombatRosterDigest, CombatRosterEntry } from "../domain/combat/projections/roster";
import { setTarget } from "../domain/combat/commands/action";
import { getOpenAction } from "../domain/combat/rules/log";
import { getMoraleDigest, getMoraleRows, MoraleRow } from "../domain/combat/projections/morale";
import { getNextRoundBar } from "../domain/combat/rules/turn";
import { getCombatSurgeOptions, getTurnControls, TurnControls } from "../domain/combat/projections/turn";
import type { SurgeOption } from "../domain/character/lenses/surge";
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

  return { round, hasActiveCharacter, hasOpenAction, nextRoundBar } as const;
}

export function useCombatRoster(): {
  roster: CombatRosterEntry[];
  pick: (entry: CombatRosterEntry) => void;
} {
  // Gate on a digest of the roster, then build it — the entries are freshly
  // allocated, so they cannot gate themselves by identity.
  useCombatStore(getCombatRosterDigest);
  const roster = getCombatRoster(useCombatStore.getState());
  const setActiveCharacter = useCombatStore((s) => s.setActiveCharacter);
  const update = useCombatStore((s) => s.updateCombatState);

  // A click on the roster aims the open action while it is waiting for a
  // target, and switches the active character otherwise.
  const pick = (entry: CombatRosterEntry) => {
    if (entry.targetable) update(setTarget(entry.id));
    else setActiveCharacter(entry.id);
  };

  return { roster, pick };
}

const NO_ONE = 'no active character'
const NO_TURN: TurnControls = { holder: '', inTurn: false, start: NO_ONE, contesting: false, contest: NO_ONE, contenders: '', roll: NO_ONE, end: NO_ONE, result: '', agreed: false, breakage: true, breakageBar: NO_ONE }

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
