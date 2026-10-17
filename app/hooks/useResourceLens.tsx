import { makeResourceLens } from "../domain/character/lenses/factories";
import { Character, Resources } from "../domain/types";
import { isCampaignCharacter } from "../domain/utils";
import { useActiveCharacterSelector, useActiveCharacterUpdate } from "./useActiveCharacterSelector";

export function useResourceLens(keyName: keyof Resources) {
  const lens = makeResourceLens(keyName);
  const update = useActiveCharacterUpdate();

  // Resources are campaign-only; gate on the derived number so a one-field
  // change doesn't re-render every resource subscriber.
  const value =
    useActiveCharacterSelector((c: Character) => (isCampaignCharacter(c) ? lens.get(c) : 0)) ?? 0;

  const setValue = (newValue: number) => {
    update({ kind: 'setResource', args: [keyName, newValue] });
  };

  return [value, setValue] as const;
}
