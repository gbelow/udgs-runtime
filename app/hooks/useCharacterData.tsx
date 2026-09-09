import { getSTARegen } from "../domain/character/lenses/characteristics";
import { getSurgeAvailability, getUsedSurge } from "../domain/character/lenses/surge";
import { Character, SurgeKind } from "../domain/types";
import { isCampaignCharacter } from "../domain/utils";
import { useActiveCharacterSelector } from "./useActiveCharacterSelector";
import { useShallow } from "zustand/shallow";

export function useActiveCharacterData() {
  // fightName is campaign-only; notes is shared. Each is a
  // primitive selected inside the store selector, so re-renders are gated on
  // the actual field value, not the whole-character reference.
  const fightName =
    useActiveCharacterSelector((c: Character) => (isCampaignCharacter(c) ? (c.fightName ?? '') : '')) ?? '';
  const notes = useActiveCharacterSelector((c: Character) => c.notes) ?? '';

  return { fightName, notes };
}

// A character outside a fight has no surge to spend, and the constant keeps the
// fallback from allocating on every call.
const NO_SURGES: Record<SurgeKind, boolean> = {
  movement: false, combat: false, reaction: false, focus: false,
}

// combat.tex "Action surge" — `usedSurge` says which surge was spent, which
// nothing else knows; `canSurge` says which buttons are live, which adds what
// the character can afford.
export function useSurges(): { usedSurge: SurgeKind | null; canSurge: Record<SurgeKind, boolean> } {
  const usedSurge = useActiveCharacterSelector((c: Character) =>
    isCampaignCharacter(c) ? getUsedSurge(c) : null) ?? null;
  const canSurge = useActiveCharacterSelector(
    useShallow((c: Character) => (isCampaignCharacter(c) ? getSurgeAvailability(c) : NO_SURGES)),
  ) ?? NO_SURGES;

  return { usedSurge, canSurge };
}

// combat.tex "Rest" — STA recovered by the Rest action. A primitive, so it goes
// straight through the store selector.
export function useSTARegen(): number {
  return useActiveCharacterSelector((c: Character) => getSTARegen(c)) ?? 0;
}
