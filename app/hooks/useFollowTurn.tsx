import { useEffect } from "react";
import { getActorBar } from "../domain/profiles";
import { useCombatStore } from "../stores/useCombatStore";
import { useViewerCheck } from "./useControl";

// Whenever a turn begins, whatever began it (a start, a flee, a turn resumed
// after one, a forced turn, the round changing), the screen picks whoever
// took it, when it is one the screen plays.
export function useFollowTurn() {
  const holder = useCombatStore((s) => s.inTurnCharacter);
  const begun = useCombatStore((s) => s.turnsBegun);
  const viewer = useViewerCheck();
  useEffect(() => {
    if (!holder || getActorBar({ id: holder }, viewer()) !== null) return;
    useCombatStore.getState().setActiveCharacter(holder);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- who is at the screen is read as the turn begins
  }, [holder, begun]);
}
