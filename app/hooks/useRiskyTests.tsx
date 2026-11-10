import { mayRollRisky } from "../domain/character/rules/effects";
import { isCampaignCharacter } from "../domain/utils";
import type { Character } from "../domain/types";
import { useActiveCharacterSelector, useActiveCharacterUpdate } from "./useActiveCharacterSelector";

// play.tex "Safe and risky tests": whether the character keeps to risky tests
// wherever they may throw one so, and the switch; shown only to one who has
// some test they may throw riskily.
export function useRiskyTests() {
  const update = useActiveCharacterUpdate();
  const shown = useActiveCharacterSelector((c: Character) => isCampaignCharacter(c) && mayRollRisky(c)) ?? false;
  const risky = useActiveCharacterSelector((c: Character) => isCampaignCharacter(c) && c.risky) ?? false;
  const setRisky = (on: boolean) => update({ kind: 'setRisky', args: [on] });
  return { shown, risky, setRisky } as const;
}
