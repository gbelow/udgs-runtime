import { releaseSpell } from "../domain/character/commands";
import { SustainedRow, getSustainedDigest, getSustainedRows } from "../domain/combat/projections/sustained";
import type { SpellKey } from "../domain/spells";
import { useCombatStore } from "../stores/useCombatStore";
import { useActiveCharacterUpdate } from "./useActiveCharacterSelector";

// The spells the active fighter is holding, and letting one go. Gated on a
// digest of the rows, as the action panel is.
export function useSustainedPanel() {
  useCombatStore(getSustainedDigest);
  const rows: SustainedRow[] = getSustainedRows(useCombatStore.getState());
  const update = useActiveCharacterUpdate();
  const release = (key: SpellKey) => update(releaseSpell(key));
  return { rows, release } as const;
}
