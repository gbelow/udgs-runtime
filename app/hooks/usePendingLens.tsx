import { rollFull } from "../domain/combat/dice";
import { resistCurse, resolvePending } from "../domain/character/commands";
import { PendingRow, getPendingDigest, getPendingRows } from "../domain/character/lenses/pending";
import { CurseRow, getCurseDigest, getCurseRows } from "../domain/character/lenses/curses";
import { useActiveCharacterDerived, useActiveCharacterUpdate } from "./useActiveCharacterSelector";

// The effects waiting on the active character's own die, and the die. Gated
// on a digest of the rows, as the affliction board is.
export function usePendingLens() {
  const update = useActiveCharacterUpdate();
  const rows: PendingRow[] = useActiveCharacterDerived(getPendingRows, getPendingDigest) ?? [];
  const roll = (index: number) => update(resolvePending(index, rollFull(Math.random)));
  return { rows, roll } as const;
}

// The curses the active character carries, and the die that may beat one.
export function useCurseLens() {
  const update = useActiveCharacterUpdate();
  const rows: CurseRow[] = useActiveCharacterDerived(getCurseRows, getCurseDigest) ?? [];
  const resist = (key: string) => update(resistCurse(key, rollFull(Math.random)));
  return { rows, resist } as const;
}
