import type { Character } from "../domain/types";
import { ABILITY_FAMILIES, type FamilyKey } from "../domain/abilities";
import { getConvictionLevel, type ConvictionSlot } from "../domain/character/rules/requirements";
import { getStudies } from "../domain/character/rules/attitudes";
import { useActiveCharacterSelector, useActiveCharacterUpdate } from "./useActiveCharacterSelector";
import { useShallow } from "zustand/shallow";

const NO_STUDIES: FamilyKey[] = [];

// The XP counted on a conviction the character has adopted, and the table's
// hand on it: XP given or taken for an attitude the app does not judge, and
// XP given to an ability the conviction may study (abilities.json "Cunning
// Studies"), counted for both.
export function useConvictionXP(slot: ConvictionSlot) {
  const update = useActiveCharacterUpdate();
  const name = useActiveCharacterSelector((c: Character) => c.trainables[slot].name) ?? '';
  const XP = useActiveCharacterSelector((c: Character) => c.trainables[slot].XP) ?? 0;
  const adopted = useActiveCharacterSelector((c: Character) => getConvictionLevel(c, c.trainables[slot].name) !== null) ?? false;
  const families = useActiveCharacterSelector(useShallow((c: Character) => getStudies(c, slot))) ?? NO_STUDIES;
  const studies = families.map((family) => ({ family, name: ABILITY_FAMILIES[family].family }));
  const addXP = (amount: number) => update({ kind: 'addTrainingXP', args: [slot, amount] });
  const study = (family: FamilyKey, amount: number) => update({ kind: 'studyWithConviction', args: [slot, family, amount] });
  return { name, XP, adopted, studies, addXP, study } as const;
}
