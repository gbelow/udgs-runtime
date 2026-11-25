import { useEffect, useRef, useState } from "react";
import { getContestView, type ContestView } from "../domain/scene/projections/turn";
import { getContestable, getTurnHolder, isContestDue } from "../domain/scene/rules/turn";
import { isContestPending } from "../domain/scene/rules/contest";
import { isBot } from "../domain/profiles";
import type { SceneState } from "../domain/scene/types";
import type { RollMode } from "../domain/play/dice";
import { playOf } from "../net/parts";
import { useAppStoreApi } from "../stores/useAppStore";
import { useBotLogStore } from "../stores/useBotLogStore";
import { useCampaignStore } from "../stores/useCampaignStore";
import { useCombatStore } from "../stores/useCombatStore";
import { readFight } from "../stores/useKeptFight";
import { useTableStore } from "../stores/useTableStore";
import { useGuestViewerCheck, useRollerCheck } from "./useControl";
import { useThrower } from "./useDieCalls";
import { useSceneDispatch } from "./useSceneDispatch";

// How long the bots are given to ask for a contest before it may close, and how
// often the clock is read.
const BOTS_MS = 900;
const TICK_MS = 200;

// The time to contest a turn, for the characters the screen answers for, the
// seconds left of it, or, while someone thinks about it, of the time to decide
// (null with no limit on it), how much of it that is in percent, and the
// presses.
export function useContest(): { view: ContestView | null; left: number | null; share: number; think: () => void; pick: (id: string) => void; mode: (id: string, mode: RollMode) => void; settle: (contest: boolean) => void; close: () => void } {
  const rolls = useRollerCheck();
  const dispatch = useSceneDispatch();
  useCampaignStore((s) => s.owners);
  const own = (s: SceneState) => Object.keys(s.characters).filter((id) => rolls(id).own);
  useCombatStore((s) => JSON.stringify(getContestView(s, own(s))));
  const turn = useCombatStore((s) => (isContestPending(s) ? s.turnsBegun : null));
  const paused = useBotLogStore((s) => s.paused);
  const fight = useCombatStore.getState();
  const view = getContestView(fight, own(fight));
  const seconds = view?.seconds ?? 0;
  const decide = view?.decideSeconds ?? 0;
  const held = view?.held ?? false;
  // how long the time has run, and how long ago someone first asked for time
  const [run, setRun] = useState(0);
  const [thought, setThought] = useState<number | null>(null);
  useEffect(() => { setRun(0); setThought(null); }, [turn]);
  useEffect(() => { if (held) setThought((was) => was ?? 0); }, [held]);
  useEffect(() => {
    if (turn === null || paused) return;
    const timer = setInterval(() => {
      setRun((was) => was + TICK_MS / 1000);
      setThought((was) => (was === null ? null : was + TICK_MS / 1000));
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [turn, paused]);
  const given = held ? decide : seconds;
  const left = held && decide === 0 ? null : Math.max(0, given - (held ? thought ?? 0 : run));
  const ids = () => (view?.own ?? []).map((c) => c.id);
  return {
    view, left, share: left === null ? 0 : (left / Math.max(1, given)) * 100,
    think: () => dispatch({ kind: "thinkContest", args: [ids()] }),
    pick: (id) => dispatch({ kind: "toggleContest", args: [id] }),
    mode: (id, mode) => dispatch({ kind: "contestMode", args: [id, mode] }),
    settle: (contest) => dispatch({ kind: "settleContest", args: [ids(), contest] }),
    close: () => dispatch({ kind: "closeContest", args: [] }),
  };
}

// Who the time to contest waits on at the table: the characters of everyone
// there but whoever plays the holder; a bot's are asked by the screen that
// plays it.
function getPeople(state: SceneState, ownerOf: (id: string) => string | undefined, seated: readonly string[]): string[] {
  const holder = getTurnHolder(state);
  const holderOf = holder ? ownerOf(holder) : undefined;
  return Object.keys(state.characters).filter((id) => {
    const owner = ownerOf(id);
    return owner !== holderOf && (owner === undefined || (!isBot(owner) && seated.includes(owner)));
  });
}

// The table's clock for the time to contest a turn, kept on the screen that
// keeps the table (never a guest's): it is closed as `isContestDue` says, and
// stands still while the bots are paused.
export function useContestClock() {
  const mode = useTableStore((s) => s.mode);
  const app = useAppStoreApi();
  const viewerOf = useGuestViewerCheck();
  const thrower = useThrower();
  const live = useRef({ viewerOf, thrower });
  live.current = { viewerOf, thrower };

  useEffect(() => {
    if (mode === "guest") return;
    let turn: number | null = null;
    let run = 0;
    let thought: number | null = null;
    const tick = () => {
      const state = readFight();
      if (!isContestPending(state)) { turn = null; return; }
      if (turn !== state.turnsBegun) { turn = state.turnsBegun; run = 0; thought = null; }
      const paused = useBotLogStore.getState().paused;
      if (thought === null && state.thinking.length > 0) thought = 0;
      if (!paused) { run += TICK_MS; if (thought !== null) thought += TICK_MS; }
      const { viewerOf, thrower } = live.current;
      const me = app.getState().profile?.id ?? null;
      const { ownerOf } = viewerOf(me ?? "", false);
      const seated = [...useTableStore.getState().guests.map((g) => g.profile), ...(me ? [me] : [])];
      const botsMay = !paused && getContestable(state).some((id) => isBot(ownerOf(id) ?? ""));
      if (botsMay && run < BOTS_MS) return;
      if (isContestDue(state, getPeople(state, ownerOf, seated), run / 1000, thought === null ? null : thought / 1000)) playOf("scene", { kind: "closeContest", args: [] }, thrower);
    };
    const timer = setInterval(tick, TICK_MS);
    return () => clearInterval(timer);
  }, [mode, app]);
}

// How long the GM gives the time to contest a turn, and whoever asks for time
// to decide.
export function useContestSeconds(): { seconds: number; set: (seconds: number) => void; decide: number; setDecide: (seconds: number) => void } {
  const seconds = useCombatStore((s) => s.contestSeconds);
  const decide = useCombatStore((s) => s.contestDecideSeconds);
  const dispatch = useSceneDispatch();
  return {
    seconds, set: (seconds) => dispatch({ kind: "setContestSeconds", args: [seconds] }),
    decide, setDecide: (seconds) => dispatch({ kind: "setContestDecideSeconds", args: [seconds] }),
  };
}
