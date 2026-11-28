import { getFaceParties, getSceneCardsDigest, type FaceParty } from "../domain/scene/projections/cards";
import type { SceneState } from "../domain/scene/types";
import { useCampaignStore } from "../stores/useCampaignStore";
import { useCombatStore } from "../stores/useCombatStore";
import { useTableStore } from "../stores/useTableStore";
import { useLookAt } from "./useBoardCanvas";
import { useCombatRoster } from "./useCombatState";
import { useRollerCheck } from "./useControl";

// The characters the screen plays, as a test of each id.
function useOwn(): (state: SceneState) => string[] {
  const rolls = useRollerCheck();
  useCampaignStore((s) => s.owners);
  useTableStore((s) => s.guests);
  return (state) => Object.keys(state.characters).filter((id) => rolls(id).own);
}

// Everyone the screen knows to be in the fight, by party, each as an ally or
// an enemy of whoever it looks from, and the faces it knows of those it is not
// shown now; a click picks one as the roster does, and the board looks at them.
export function useFaceColumn(): { parties: FaceParty[]; away: { id: string; name: string }[]; picked: string[]; pick: (id: string) => void } {
  const own = useOwn();
  const { parties: known, away, pick, picked } = useCombatRoster();
  useCombatStore(getSceneCardsDigest);
  const look = useLookAt();
  const fight = useCombatStore.getState();
  const shown = new Set(known.flatMap((p) => p.entries.map((e) => e.id)));
  const parties = getFaceParties(fight, own(fight)).map((p) => ({ ...p, cards: p.cards.filter((c) => shown.has(c.id)) })).filter((p) => p.cards.length > 0);
  const entries = new Map(known.flatMap((p) => p.entries.map((e) => [e.id, e] as const)));
  return {
    parties,
    away,
    picked,
    pick: (id) => {
      const entry = entries.get(id);
      if (entry) pick(entry);
      look(id);
    },
  };
}
