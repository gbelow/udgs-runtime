import { getCombatRoster, getCombatRosterDigest, CombatRosterEntry } from "../domain/combat/lenses/activeCharacter";
import { useCombatStore } from "../stores/useCombatStore";

// Fight-level primitives. Both go through the store selector, so a change to a
// combatant's sheet does not re-render the round counter.
export function useCombatState() {
  const round = useCombatStore((s) => s.round);
  const hasActiveCharacter = useCombatStore((s) => !!s.activeCharacterId);

  return { round, hasActiveCharacter } as const;
}

export function useCombatRoster(): {
  roster: CombatRosterEntry[];
  setActiveCharacter: (id: string) => void;
} {
  // Gate on a digest of the roster, then build it — the entries are freshly
  // allocated, so they cannot gate themselves by identity.
  useCombatStore(getCombatRosterDigest);
  const roster = getCombatRoster(useCombatStore.getState());
  const setActiveCharacter = useCombatStore((s) => s.setActiveCharacter);

  return { roster, setActiveCharacter };
}
