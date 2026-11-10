import type { Character } from "../domain/types";
import { getConvictionLevel, type ConvictionSlot } from "../domain/character/rules/requirements";
import { getStudyKey, getStudyOffers, type StudyTarget } from "../domain/character/rules/attitudes";
import { useActiveCharacterDerived, useActiveCharacterSelector, useActiveCharacterUpdate } from "./useActiveCharacterSelector";

// The XP counted on a conviction the character has adopted, and the table's
// hand on it: XP given or taken for an attitude the app does not judge, and
// XP given to something the conviction may study (abilities.json "Cunning
// Studies", abilities.tex "Adaptive Learning"), counted for both.
export function useConvictionXP(slot: ConvictionSlot) {
  const update = useActiveCharacterUpdate();
  const name = useActiveCharacterSelector((c: Character) => c.trainables[slot].name) ?? '';
  const XP = useActiveCharacterSelector((c: Character) => c.trainables[slot].XP) ?? 0;
  const adopted = useActiveCharacterSelector((c: Character) => getConvictionLevel(c, c.trainables[slot].name) !== null) ?? false;
  const offers = useActiveCharacterDerived((c: Character) => getStudyOffers(c, slot), JSON.stringify) ?? [];
  const studies = offers.map((o) => ({ key: getStudyKey(o.target), target: o.target, name: o.name, rate: o.rate }));
  const addXP = (amount: number) => update({ kind: 'addTrainingXP', args: [slot, amount] });
  const study = (target: StudyTarget, amount: number) => update({ kind: 'studyWithConviction', args: [slot, target, amount] });
  return { name, XP, adopted, studies, addXP, study } as const;
}
