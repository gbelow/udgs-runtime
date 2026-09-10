import { isDead } from "../domain/character/lenses/afflictions";
import { composeLens, makePropLens } from "../domain/character/lenses/factories";
import { CampaignCharacter, CampaignValuesSchema, Character, Injuries } from "../domain/types";
import { isCampaignCharacter } from "../domain/utils";
import { useActiveCharacterSelector, useActiveCharacterUpdate } from "./useActiveCharacterSelector";

// Stable default for the no-active-character case (must be a module-level
// constant so the null branch doesn't allocate a fresh ref each render).
const DEFAULT_INJURIES: Injuries = CampaignValuesSchema.parse({}).injuries;
const injuryLens = makePropLens<CampaignCharacter, 'injuries'>('injuries');

export function useInjuryLens() {
  const update = useActiveCharacterUpdate();

  // injuries is a state-held object ref — Object.is gates re-renders to actual
  // injuries changes (the setter produces a new ref via structural sharing).
  const injuries: Injuries =
    useActiveCharacterSelector((c: Character) => (isCampaignCharacter(c) ? injuryLens.get(c) : null)) ?? DEFAULT_INJURIES;

  const setInjury = (keyName: keyof Injuries, newValue: number | number[]) => {
    const injuryValueLens = composeLens(injuryLens, makePropLens<Injuries, keyof Injuries>(keyName));
    update((c) => (isCampaignCharacter(c) ? injuryValueLens.set(c, newValue) : c));
  };

  // A primitive selected inside the store selector, so the render it schedules
  // is the render that recomputes it.
  const isCharacterDead = useActiveCharacterSelector((c: Character) => isDead(c)) ?? false;

  return { injuries, setInjury, isCharacterDead } as const;
}
