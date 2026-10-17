import type { CharacterCommand } from "../domain/character/commands/registry";
import { Character, Lens } from "../domain/types";
import { useActiveCharacterSelector, useActiveCharacterUpdate } from "./useActiveCharacterSelector";

// A primitive lens over the active character, as a [value, setValue] pair,
// set by the command that names the same lens. The value is selected inside
// the store selector so re-renders are gated on it, not on the
// whole-character reference.
export function useLens<T>(lens: Lens<Character, T>, fallback: T, set: (value: T) => CharacterCommand) {
  const update = useActiveCharacterUpdate();
  const value = useActiveCharacterSelector((c: Character) => lens.get(c)) ?? fallback;
  const setValue = (newValue: T) => update(set(newValue));
  return [value, setValue] as const;
}
