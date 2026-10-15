import { characteristicLenses, characteristicTermGetters, Term, termsDigest, termsView } from "../domain/character/lenses";
import { getAttributeLevelUp, type AttributeLevelUpView } from "../domain/character/lenses/attributes";
import { Character, Characteristics } from "../domain/types";
import { useActiveCharacterDerived, useActiveCharacterSelector, useActiveCharacterUpdate } from "./useActiveCharacterSelector";

export function useCharacteristicLens(characteristicName: keyof Characteristics) {
  const lens = characteristicLenses[characteristicName];
  const update = useActiveCharacterUpdate();

  // Select the derived value INSIDE the store selector so re-renders are gated
  // on the computed output (Object.is), not the whole-character reference.
  const value = useActiveCharacterSelector((c: Character) => lens.get(c)) ?? 0;

  // Per-term breakdown (only derived characteristics like STR/AGI/STA have one),
  // gated on a digest of the terms — see useSkillLens.
  const terms: Term[] =
    useActiveCharacterDerived((c: Character) => characteristicTermGetters[characteristicName]?.(c) ?? [], termsDigest) ?? [];

  const setValue = (newValue: number) => {
    update((c) => lens.set(c, newValue));
  };

  return [value, setValue, terms, termsView(terms)] as const;
}

// creating.tex "Improving attributes": the next point of each attribute and
// the balance that prices it.
export function useAttributeLevelUp(): AttributeLevelUpView | null {
  return useActiveCharacterDerived(getAttributeLevelUp, JSON.stringify);
}
