import { rollFull } from "../domain/combat/dice";
import { resolvePending } from "../domain/character/commands";
import { PendingRow, getPendingDigest, getPendingRows } from "../domain/character/lenses/pending";
import { useActiveCharacterDerived, useActiveCharacterUpdate } from "./useActiveCharacterSelector";

// The effects waiting on the active character's own die, and the die. Gated
// on a digest of the rows, as the affliction board is.
export function usePendingLens() {
  const update = useActiveCharacterUpdate();
  const rows: PendingRow[] = useActiveCharacterDerived(getPendingRows, getPendingDigest) ?? [];
  const roll = (index: number) => update(resolvePending(index, rollFull(Math.random)));
  return { rows, roll } as const;
}
