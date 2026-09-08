import { addAffliction } from "../domain/character/commands";
import { getAfflictions } from "../domain/character/lenses/afflictions";
import { getBurdenPenalty } from "../domain/item/lenses/containers";
import { AfflictionKey, CampaignCharacter, Character } from "../domain/types";
import { isCampaignCharacter } from "../domain/utils";
import { useAppStore } from "../stores/useAppStore";
import { readActiveCharacter, useActiveCharacterSelector, useActiveCharacterUpdate } from "./useActiveCharacterSelector";

// getAfflictions depends on the afflictions list, the resource thresholds AND
// the carried burden (an "over" burden is lame), and
// returns a fresh array each call. That can't go through the store selector
// (a fresh allocation trips useSyncExternalStore's getServerSnapshot check, and
// a single useShallow wrapper can't be shared across both stores). So we gate
// re-renders on a primitive signature of the inputs, and derive the list
// non-reactively from a character snapshot.
function afflictionSignature(c: CampaignCharacter): string {
  const r = c.resources;
  return `${c.afflictions.join(',')}|${r.hunger ?? 0}|${r.thirst ?? 0}|${r.exhaustion ?? 0}|${getBurdenPenalty(c)}`;
}

export function useAfflictionLens() {
  const update = useActiveCharacterUpdate();
  const tab = useAppStore((s) => s.selectedGameTab);

  const signature = useActiveCharacterSelector((c: Character) =>
    isCampaignCharacter(c) ? afflictionSignature(c) : '',
  );

  // `signature` gates re-renders; the derivation reads the latest character
  // non-reactively. Empty signature <=> no active campaign character.
  const active = readActiveCharacter(tab);
  const value: AfflictionKey[] =
    signature && active && isCampaignCharacter(active) ? getAfflictions(active) : [];

  const setValue = (affliction: AfflictionKey) => {
    update(addAffliction(affliction));
  };

  return [value, setValue] as const;
}
