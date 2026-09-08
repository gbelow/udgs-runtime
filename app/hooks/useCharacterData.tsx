import { getSTARegen } from "../domain/character/lenses/characteristics";
import { Character } from "../domain/types";
import { isCampaignCharacter } from "../domain/utils";
import { useActiveCharacterSelector } from "./useActiveCharacterSelector";

export function useActiveCharacterData() {
  // fightName/hasActionSurge are campaign-only; notes is shared. Each is a
  // primitive selected inside the store selector, so re-renders are gated on
  // the actual field value, not the whole-character reference.
  const fightName =
    useActiveCharacterSelector((c: Character) => (isCampaignCharacter(c) ? (c.fightName ?? '') : '')) ?? '';
  const hasActionSurge =
    useActiveCharacterSelector((c: Character) => (isCampaignCharacter(c) ? c.hasActionSurge : false)) ?? false;
  const notes = useActiveCharacterSelector((c: Character) => c.notes) ?? '';

  return { fightName, hasActionSurge, notes };
}

// combat.tex "Rest" — STA recovered by the Rest action. A primitive, so it goes
// straight through the store selector.
export function useSTARegen(): number {
  return useActiveCharacterSelector((c: Character) => getSTARegen(c)) ?? 0;
}
