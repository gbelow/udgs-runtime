import { movementCostLenses, movementLenses } from "../domain/character/lenses";
import { Character, Movement } from "../domain/types";
import { useActiveCharacterSelector, useActiveCharacterUpdate } from "./useActiveCharacterSelector";

export function useMovementLens(movementName: keyof Movement, field: 'distance' | 'AP' | 'STA' = 'distance') {
  const lens = field === 'distance' ? movementLenses[movementName] : movementCostLenses[movementName][field];
  const update = useActiveCharacterUpdate();

  // Select the derived value INSIDE the store selector so re-renders are gated
  // on the computed output (Object.is), not the whole-character reference.
  const value = useActiveCharacterSelector((c: Character) => lens.get(c)) ?? 0;

  const setValue = (newValue: number) => {
    update((c) => lens.set(c, newValue));
  };

  return [value, setValue] as const;
}
