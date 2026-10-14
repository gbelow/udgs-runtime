import { releaseSpell } from "../domain/character/commands";
import { SustainedRow, getSustainedDigest, getSustainedRows } from "../domain/scene/projections/sustained";
import type { SpellKey } from "../domain/spells";
import { useCombatStore } from "../stores/useCombatStore";
import { useActiveCharacterSelector, useActiveCharacterUpdate } from "./useActiveCharacterSelector";

// The spells the active fighter is holding, and letting one go: none outside
// a fight. Gated on a digest of the rows, as the action panel is.
export function useSustainedPanel() {
  const digest = useActiveCharacterSelector((_c, fight) => (fight ? getSustainedDigest(fight) : null));
  const rows: SustainedRow[] = digest === null ? [] : getSustainedRows(useCombatStore.getState());
  const update = useActiveCharacterUpdate();
  const release = (key: SpellKey) => update(releaseSpell(key));
  return { rows, release } as const;
}
