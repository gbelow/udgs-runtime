import { characteristicLenses, skillLenses } from "../domain/selectors";
import { Characteristics, Skills } from "../domain/types";
import { useCharacterStore } from "../stores/useCharacterStore";
import { useActiveCharacter } from "./useActiveCharacter";

export function useCharacteristicLens(characteristicName: keyof Characteristics) {
  const lens = characteristicLenses[characteristicName];
  const { character, update } = useActiveCharacter();

  // Selector optimization: Only re-renders if the Lens output changes,
  // regardless of which store triggered the update.
  const value = character ? lens.get(character) : 0;

  const setValue = (newValue: number) => {
    update((c) => lens.set(c, newValue));
  };

  return [value, setValue] as const;
}