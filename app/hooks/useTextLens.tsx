import { makePropLens } from "../domain/character/lenses/factories";
import { Character, Lens } from "../domain/types";
import { useLens } from "./useLens";

export function useTextLens(keyName: 'name' | 'notes') {
  const lens: Lens<Character, string> = makePropLens(keyName);
  return useLens(lens, '');
}
