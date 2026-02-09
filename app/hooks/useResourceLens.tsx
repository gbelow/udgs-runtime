import { makeResourceLens, makeTextLens } from "../domain/selectors/factories";
import { Character, Resources, Skills } from "../domain/types";
import { useActiveCharacter } from "./useActiveCharacter";

export function useResourceLens(keyName: keyof Resources) {
  const lens = makeResourceLens(keyName);
  const { character, update } = useActiveCharacter();
  
  const value = character ? lens.get(character) : 0;

  const setValue = (newValue: number) => {
    update((c) => lens.set(c, newValue));
  };

  return [value, setValue] as const;
}