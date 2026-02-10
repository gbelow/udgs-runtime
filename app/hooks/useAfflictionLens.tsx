import { addAffliction } from "../domain/commands/addAffliction";
import { getAfflictions } from "../domain/selectors/afflictions";
import { makeResourceLens, makeTextLens } from "../domain/selectors/factories";
import { AfflictionKey, Character, Resources, Skills } from "../domain/types";
import { useActiveCharacter } from "./useActiveCharacter";

export function useAfflictionLens() {
  const { character, update } = useActiveCharacter();
  const value = character ? getAfflictions(character) : []

  const setValue = (affliction: AfflictionKey) => {
    update(addAffliction(affliction))
  };

  return [value, setValue] as const;
}