import { tagLenses, type TagLevel } from "../domain/character/lenses/tags";
import { useLens } from "./useLens";

export function useTagLens(level: TagLevel) {
  return useLens(tagLenses[level], '');
}
