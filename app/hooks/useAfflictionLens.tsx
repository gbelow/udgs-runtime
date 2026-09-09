import { addAffliction } from "../domain/character/commands";
import { getAfflictions } from "../domain/character/lenses/afflictions";
import { AfflictionKey, Character } from "../domain/types";
import { isCampaignCharacter } from "../domain/utils";
import { useActiveCharacterDerived, useActiveCharacterUpdate } from "./useActiveCharacterSelector";

export function useAfflictionLens() {
  const update = useActiveCharacterUpdate();

  // getAfflictions depends on the afflictions list, the resource thresholds AND
  // the carried burden (an "over" burden is lame), and returns a fresh array
  // each call, so it cannot gate its own re-render by identity. Gate on a digest
  // of the returned list: a digest of the inputs would have to be extended by
  // hand every time the derivation grows a new one.
  const value: AfflictionKey[] =
    useActiveCharacterDerived(
      (c: Character) => (isCampaignCharacter(c) ? getAfflictions(c) : []),
      (list) => list.join(','),
    ) ?? [];

  const setValue = (affliction: AfflictionKey) => {
    update(addAffliction(affliction));
  };

  return [value, setValue] as const;
}
