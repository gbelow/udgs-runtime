import { getSTARegen } from "../domain/character/lenses/characteristics";
import { canSurge, getUsedSurge } from "../domain/character/lenses/surge";
import { Character, SurgeKind } from "../domain/types";
import { isCampaignCharacter } from "../domain/utils";
import { useActiveCharacterSelector } from "./useActiveCharacterSelector";

export function useActiveCharacterData() {
  // fightName is campaign-only; notes is shared. Each is a
  // primitive selected inside the store selector, so re-renders are gated on
  // the actual field value, not the whole-character reference.
  const fightName =
    useActiveCharacterSelector((c: Character) => (isCampaignCharacter(c) ? (c.fightName ?? '') : '')) ?? '';
  const notes = useActiveCharacterSelector((c: Character) => c.notes) ?? '';

  return { fightName, notes };
}

// combat.tex "Action surge" — `usedSurge` says which surge was spent (nothing
// else knows that); `canSurge` says which buttons are still live, which adds the
// STA the character can afford. Every value crosses the store selector as a
// primitive: a selector returning an object would have to be useShallow-wrapped,
// and one wrapper cannot span the two stores useActiveCharacterSelector
// subscribes — they thrash its single memo cache and never settle.
export function useSurges(): { usedSurge: SurgeKind | null; canSurge: Record<SurgeKind, boolean> } {
  const usedSurge = useActiveCharacterSelector((c: Character) =>
    isCampaignCharacter(c) ? getUsedSurge(c) : null) ?? null;
  const movement = useActiveCharacterSelector((c: Character) =>
    isCampaignCharacter(c) && canSurge('movement')(c)) ?? false;
  const combat = useActiveCharacterSelector((c: Character) =>
    isCampaignCharacter(c) && canSurge('combat')(c)) ?? false;
  const reaction = useActiveCharacterSelector((c: Character) =>
    isCampaignCharacter(c) && canSurge('reaction')(c)) ?? false;
  const focus = useActiveCharacterSelector((c: Character) =>
    isCampaignCharacter(c) && canSurge('focus')(c)) ?? false;

  return { usedSurge, canSurge: { movement, combat, reaction, focus } };
}

// combat.tex "Rest" — STA recovered by the Rest action. A primitive, so it goes
// straight through the store selector.
export function useSTARegen(): number {
  return useActiveCharacterSelector((c: Character) => getSTARegen(c)) ?? 0;
}
