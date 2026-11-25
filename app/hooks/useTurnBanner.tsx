import { useEffect, useRef, useState } from "react";
import { getTurnBanner, type TurnBanner } from "../domain/scene/projections/turn";
import { useCombatStore } from "../stores/useCombatStore";
import { useControlBar } from "./useControl";

// Whose turn it is, whether whoever is at the screen plays them, and whose has
// just ended, until another begins.
export function useTurnBanner(): { view: TurnBanner | null; own: boolean; ended: string | null } {
  useCombatStore((s) => JSON.stringify(getTurnBanner(s)));
  const view = getTurnBanner(useCombatStore.getState());
  const own = useControlBar(view?.holder?.id ?? null) === null;
  const name = view?.holder?.name ?? null;
  const last = useRef<string | null>(null);
  const [ended, setEnded] = useState<string | null>(null);
  useEffect(() => {
    if (name !== null) setEnded(null);
    else if (last.current !== null) setEnded(last.current);
    last.current = name;
  }, [name, view?.turn]);
  return { view, own, ended };
}
