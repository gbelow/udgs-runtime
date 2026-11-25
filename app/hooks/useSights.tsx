import { useEffect, useRef } from "react";
import { getKnown, getFirstOwn, noteSights } from "../domain/scene/projections/sights";
import { useCampaignStore } from "../stores/useCampaignStore";
import { useCombatStore } from "../stores/useCombatStore";
import { useSightStore } from "../stores/useSightStore";
import { useTableStore } from "../stores/useTableStore";
import { useRollerCheck } from "./useControl";
import { useRole } from "./useRole";

// What the player at the screen knows of the fight, noted at every change to
// it; a GM knows all of it.
export function useSights() {
  const { gmTools } = useRole();
  const rolls = useRollerCheck();
  const live = useRef(rolls);
  live.current = rolls;
  const mode = useTableStore((s) => s.mode);
  const owners = useCampaignStore((s) => s.owners);

  useEffect(() => {
    if (gmTools) { useSightStore.setState({ player: false }); return; }
    const note = () => {
      const state = useCombatStore.getState();
      const before = useSightStore.getState();
      const own = Object.keys(state.characters).filter((id) => live.current(id).own);
      const memory = noteSights(before.memory, state, own, mode !== "guest");
      const picked = state.activeCharacterId;
      const last = picked && own.includes(picked) ? picked : before.last && own.includes(before.last) ? before.last : getFirstOwn(state, own);
      useSightStore.setState({ player: true, own, memory, known: getKnown(state, own, memory), last });
    };
    note();
    return useCombatStore.subscribe(note);
  }, [gmTools, mode, owners]);
}

// Whether a player at the screen knows character `id` to be in the fight; a GM
// knows everyone.
export function useKnows(): (id: string) => boolean {
  const player = useSightStore((s) => s.player);
  const known = useSightStore((s) => s.known);
  return (id) => !player || known.includes(id);
}

// Whose eyes the board is seen through, and whether that is the screen's to
// choose: a player always looks through the last of theirs they picked.
export function useEyes(): { player: boolean; on: boolean; toggle: () => void } {
  const player = useSightStore((s) => s.player);
  const eyes = useSightStore((s) => s.eyes);
  const setEyes = useSightStore((s) => s.setEyes);
  return { player, on: player || eyes, toggle: () => setEyes(!eyes) };
}
