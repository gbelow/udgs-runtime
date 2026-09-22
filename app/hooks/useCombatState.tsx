import { getCombatRoster, getCombatRosterDigest, CombatRosterEntry } from "../domain/combat/projections/roster";
import { setTarget } from "../domain/combat/commands/action";
import { getOpenAction } from "../domain/combat/rules/action";
import { useCombatStore } from "../stores/useCombatStore";

// Fight-level primitives. Both go through the store selector, so a change to a
// combatant's sheet does not re-render the round counter.
export function useCombatState() {
  const round = useCombatStore((s) => s.round);
  const hasActiveCharacter = useCombatStore((s) => !!s.activeCharacterId);
  // An action being played out holds the fight: whoever it names must stay
  // in it until it resolves.
  const hasOpenAction = useCombatStore((s) => getOpenAction(s) !== null);

  return { round, hasActiveCharacter, hasOpenAction } as const;
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
