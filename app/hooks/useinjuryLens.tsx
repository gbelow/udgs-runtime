import { heal } from "../domain/commands/heal";
import { makeInjuryLens } from "../domain/selectors/factories";
import { CampaignValuesSchema, Injuries, Resources, ResourcesSchema, Skills, Wound } from "../domain/types";
import { isCampaignCharacter } from "../domain/utils";
import { useActiveCharacter } from "./useActiveCharacter";

export function useInjuryLens() {
  const lens = makeInjuryLens();
  const { character, update } = useActiveCharacter();
  
  const value = character ? lens.get(character) : CampaignValuesSchema.parse({}).injuries;

  const setValue = (keyName: keyof Injuries, newValue: number | Wound) => {
    update((c) => lens.set(c, keyName, newValue));
  };

  const setValueRaw = (keyName: keyof Injuries, newValue: number | Wound) => {
    update((c) => lens.setRaw(c, keyName, newValue));
  };


  return [value, setValue, setValueRaw] as const;
  
}