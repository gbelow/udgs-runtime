import { getSTARegen } from "../domain/character/rules/characteristics";
import { getSurgeAvailability } from "../domain/character/lenses/surge";
import { getBindingSurge, getUsedSurge } from "../domain/character/rules/surge";
import { Character, SurgeKind } from "../domain/types";
import { isCampaignCharacter } from "../domain/utils";
import { useActiveCharacterSelector } from "./useActiveCharacterSelector";
import { useShallow } from "zustand/shallow";
import { TAB_OWNER, useAppStore } from "../stores/useAppStore";
import { useCampaignStore } from "../stores/useCampaignStore";
import { getFightName } from "../domain/scene/rules/fighters";
import { getRosterName } from "../domain/campaign/rules/roster";

export function useActiveCharacterData() {
  // The name the character goes by at the table is kept by whoever holds
  // them, the fight or the campaign; notes is shared. Each is a primitive
  // selected inside the store selector, so re-renders are gated on the actual
  // field value, not the whole-character reference.
  const owner = TAB_OWNER[useAppStore((s) => s.selectedGameTab)];
  const rosterName = useCampaignStore((s) => (owner === "campaign" && s.activeCharacterId ? getRosterName(s, s.activeCharacterId) : ""));
  const fightName = useActiveCharacterSelector((c: Character, fight) => (fight ? getFightName(fight, c.id) : "")) ?? "";
  const tableName = owner === "campaign" ? rosterName : fightName;
  const notes = useActiveCharacterSelector((c: Character) => c.notes) ?? '';
  const name = useActiveCharacterSelector((c: Character) => c.name) ?? '';

  const limitStress = useActiveCharacterSelector((c: Character) => c.limitStress) ?? null;

  return { tableName, notes, name, limitStress };
}

// Whether the tab has an active character, in whichever store owns it.
export function useHasActiveCharacter(): boolean {
  return useActiveCharacterSelector(() => true) ?? false;
}

// A character outside a fight has no surge to spend, and the constant keeps the
// fallback from allocating on every call.
const NO_SURGES: Record<SurgeKind, boolean> = {
  movement: false, combat: false, reaction: false, focus: false, recovery: false,
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

// combat.tex "Action surge" — the surge whose AP is still unspent, which
// binds what the character may do until it is spent or ended.
export function useBindingSurge(): SurgeKind | null {
  return useActiveCharacterSelector((c: Character) => getBindingSurge(c)) ?? null;
}
