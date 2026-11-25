import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { getContestResult, getTurnBanner, type TurnBanner } from "../domain/scene/projections/turn";
import { useCombatStore } from "../stores/useCombatStore";
import { useControlBar } from "./useControl";
import { useKnows } from "./useSights";

const CONTEST_READ_MS = 8000;

// Whose turn it is, whether whoever is at the screen plays them, and whose has
// just ended, until another begins.
export function useTurnBanner(): { view: TurnBanner | null; own: boolean; ended: string | null } {
  useCombatStore((s) => JSON.stringify(getTurnBanner(s)));
  const banner = getTurnBanner(useCombatStore.getState());
  const knows = useKnows();
  const view = banner?.holder && !knows(banner.holder.id) ? { ...banner, holder: { ...banner.holder, name: "someone unseen" } } : banner;
  const own = useControlBar(view?.holder?.id ?? null) === null;
  const name = view?.holder?.name ?? null;
  const last = useRef<string | null>(null);
  const [ended, setEnded] = useState<string | null>(null);
  useEffect(() => {
    if (name !== null) setEnded(null);
    else if (last.current !== null) setEnded(last.current);
    last.current = name;
  }, [name, view?.turn]);
  // a contest is rolled as its time closes and the turn goes on at once, so what
  // it came to is said for as long as it takes to read
  const contest = useCombatStore((s) => getContestResult(s));
  useEffect(() => { if (contest) toast.message(contest, { duration: CONTEST_READ_MS }); }, [contest]);
  return { view, own, ended };
}
