import { Character, Lens } from "../domain/types";
import { useActiveCharacterSelector, useActiveCharacterUpdate } from "./useActiveCharacterSelector";

// A primitive lens over the active character, as a [value, setValue] pair.
// The value is selected inside the store selector so re-renders are gated on
// it, not on the whole-character reference.
export function useLens<T>(lens: Lens<Character, T>, fallback: T) {
  const update = useActiveCharacterUpdate();
  const value = useActiveCharacterSelector((c: Character) => lens.get(c)) ?? fallback;
  const setValue = (newValue: T) => update((c) => lens.set(c, newValue));
  return [value, setValue] as const;
}
