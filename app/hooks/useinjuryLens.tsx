import { makeInjuryLens } from "../domain/selectors/factories";
import { CampaignValuesSchema, Injuries, Resources, ResourcesSchema, Skills } from "../domain/types";
import { useActiveCharacter } from "./useActiveCharacter";

export function useInjuryLens() {
  const lens = makeInjuryLens();
  const { character, update } = useActiveCharacter();
  
  const value = character ? lens.get(character) : CampaignValuesSchema.parse({}).injuries;

  const setValue = (keyName: keyof Injuries, index: number, newValue: number) => {
    update((c) => lens.set(c, keyName , index, newValue));
  };

  return [value, setValue] as const;
}