import { makeResourceLens } from "../domain/selectors/factories";
import { Resources } from "../domain/types";
import { useActiveCharacter } from "./useActiveCharacter";

export function useResourceLens(keyName: keyof Resources) {
  const lens = makeResourceLens(keyName);
  const { character, update } = useActiveCharacter();
  
  const value = character ? lens.get(character) : 0;

  const setValue = (newValue: number) => {
    update((c) => lens.set(c, newValue));
  };
  const setRawValue = (newValue: number) => {
    update((c) => lens.setRaw(c, newValue));
  };

  return [value, setValue, setRawValue] as const;
}