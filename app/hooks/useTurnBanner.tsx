import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { getContestOutcome, getTurnBanner, type ContestOutcome, type TurnBanner } from "../domain/scene/projections/turn";
import { useCombatStore } from "../stores/useCombatStore";
import { useControlBar, useRollerCheck } from "./useControl";

const CONTEST_READ_MS = 8000;

// The contest rolled for the turn, and how it went for whoever is at the screen.
export type ContestFor = ContestOutcome & { went: 'won' | 'lost' | 'watched' };

// Whose turn it is, whether whoever is at the screen plays them, and whose has
// just ended, until another begins; and the contest the turn was won in.
export function useTurnBanner(): { view: TurnBanner | null; own: boolean; ended: string | null; contest: ContestFor | null } {
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
  // a contest is rolled as its time closes and the turn goes on at once, so what
  // it came to is said for as long as it takes to read
  const rolls = useRollerCheck();
  const digest = useCombatStore((s) => JSON.stringify(getContestOutcome(s)));
  const outcome = getContestOutcome(useCombatStore.getState());
  const contest: ContestFor | null = outcome && {
    ...outcome,
    went: rolls(outcome.winner).own ? 'won' : outcome.rolls.some((r) => rolls(r.id).own) ? 'lost' : 'watched',
  };
  const told = useRef(contest);
  told.current = contest;
  useEffect(() => {
    const c = told.current;
    if (!c) return;
    const say = c.went === 'won' ? toast.success : c.went === 'lost' ? toast.error : toast.message;
    say(c.title, { description: c.rolls.map((r) => `${r.name} ${r.score}`).join(' · '), duration: CONTEST_READ_MS });
  }, [digest]);
  return { view, own, ended, contest };
}
