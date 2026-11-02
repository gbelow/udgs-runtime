import type { Character } from "../domain/types";
import { getConvictionLevel, type ConvictionSlot } from "../domain/character/rules/requirements";
import { useActiveCharacterSelector, useActiveCharacterUpdate } from "./useActiveCharacterSelector";

// The XP counted on a conviction the character has adopted, and the table's
// hand on it: XP given or taken for an attitude the app does not judge.
export function useConvictionXP(slot: ConvictionSlot) {
  const update = useActiveCharacterUpdate();
  const name = useActiveCharacterSelector((c: Character) => c.trainables[slot].name) ?? '';
  const XP = useActiveCharacterSelector((c: Character) => c.trainables[slot].XP) ?? 0;
  const adopted = useActiveCharacterSelector((c: Character) => getConvictionLevel(c, c.trainables[slot].name) !== null) ?? false;
  const addXP = (amount: number) => update({ kind: 'addTrainingXP', args: [slot, amount] });
  return { name, XP, adopted, addXP } as const;
}
