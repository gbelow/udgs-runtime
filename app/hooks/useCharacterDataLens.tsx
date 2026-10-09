import { miscLenses } from "../domain/character/lenses";
import { Character } from "../domain/types";
import { useActiveCharacterSelector, useActiveCharacterUpdate } from "./useActiveCharacterSelector";

export function useActiveCharacterDataLens(prop: keyof typeof miscLenses) {
  const lens = miscLenses[prop];
  const update = useActiveCharacterUpdate();

  // Select the derived value INSIDE the store selector so re-renders are gated
  // on the computed output (Object.is), not the whole-character reference.
  const value = useActiveCharacterSelector((c: Character) => lens.get(c)) ?? 0;

  const setValue = (newValue: number) => {
    update((c) => lens.set(c, newValue));
  };

  return [value, setValue] as const;
}
