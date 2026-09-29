import { healWound } from "../domain/character/commands";
import { WoundRow, getWoundDigest, getWoundRows } from "../domain/character/lenses/wounds";
import { useActiveCharacterDerived, useActiveCharacterUpdate } from "./useActiveCharacterSelector";

// The wounds the active character carries, and the healing that closes them.
export function useWoundLens() {
  const update = useActiveCharacterUpdate();
  const rows: WoundRow[] = useActiveCharacterDerived(getWoundRows, getWoundDigest) ?? [];
  const heal = (index: number, amount: number) => update(healWound(index, amount));
  return { rows, heal } as const;
}
