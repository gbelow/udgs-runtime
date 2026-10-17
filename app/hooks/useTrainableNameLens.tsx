import { makeTrainableNameLens } from "../domain/character/lenses/factories";
import { Character, Trainables } from "../domain/types";
import { useActiveCharacterSelector, useActiveCharacterUpdate } from "./useActiveCharacterSelector";

export function useTrainableNameLens(trainableName: keyof Trainables) {
  const lens = makeTrainableNameLens<Character>(trainableName);
  const update = useActiveCharacterUpdate();

  // Select the string inside the store selector so re-renders are gated on the
  // value, not the whole-character reference.
  const value = useActiveCharacterSelector((c: Character) => lens.get(c)) ?? '';

  const setValue = (newValue: string) => {
    update({ kind: 'setTrainableName', args: [trainableName, newValue] });
  };

  return [value, setValue] as const;
}
