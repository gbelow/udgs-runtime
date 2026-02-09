import { movementLenses, skillLenses } from "../domain/selectors";
import { Movement, Skills } from "../domain/types";
import { useActiveCharacter } from "./useActiveCharacter";

export function useMovementLens(movementName: keyof Movement) {
  const lens = movementLenses[movementName];
  const { character, update } = useActiveCharacter();

  // Selector optimization: Only re-renders if the Lens output changes,
  // regardless of which store triggered the update.
  const value = character ? lens.get(character) : 0;

  const setValue = (newValue: number) => {
    update((c) => lens.set(c, newValue));
  };

  return [value, setValue] as const;
}