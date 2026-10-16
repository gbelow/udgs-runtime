import { getExperienceView, type ExperienceView } from "../domain/character/lenses/experience";
import { useActiveCharacterDerived } from "./useActiveCharacterSelector";

export function useExperience(): ExperienceView | null {
  return useActiveCharacterDerived(getExperienceView, JSON.stringify);
}
