import { makeInjuryLens } from "../domain/selectors/factories";
import { CampaignValuesSchema, Injuries, Wound } from "../domain/types";
import { useActiveCharacter } from "./useActiveCharacter";

export function useInjuryLens() {
  const lens = makeInjuryLens();
  const { character, update } = useActiveCharacter();
  
  const injuries = character ? lens.get(character) : CampaignValuesSchema.parse({}).injuries;

  const setInjury = (keyName: keyof Injuries, newValue: number | Wound) => {
    update((c) => lens.set(c, keyName, newValue));
  };
  


  return {injuries, setInjury} as const;
  
}