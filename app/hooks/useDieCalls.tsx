import { useEffect, useRef } from "react";
import { getDieBar, getOpenCalls, type Calls, type Thrower } from "../domain/play/calls";
import { realDice, throwOnScreen } from "../components/utils";
import type { DieSource } from "../domain/play/dice";
import { useTrayStore } from "../stores/useTrayStore";
import { useActGate, useRollerCheck } from "./useControl";
import { useDicePlace } from "./useProfile";

// Whoever throws the dice a command calls for where the command is played:
// the GM's own characters' dice at once, when the GM throws on the screen;
// every other die waits for its roller's own screen to answer it
// (`useAutoThrow`).
export function useThrower(): Thrower {
  const place = useDicePlace();
  const roller = useRollerCheck();
  return { dice: realDice, answer: (call) => {
    const r = roller(call.roller);
    return place === 'screen' && r.own && !r.played ? throwOnScreen(call).die : null;
  } };
}

// Why a die typed in cannot be the one rolled: `explodes` for a test whose
// die explodes, and none for the tests a button makes, which never do.
export function useDieBar(): (die: number, explodes?: boolean) => string | null {
  return (die, explodes = false) => getDieBar(explodes, die);
}

// The answer to a call a sequence keeps in `calls`, dispatched as its own
// answer command: a die typed in, or rolled from the prompt (null) — at once,
// or, for whoever throws in the dice tray, once the dice thrown there land.
export function useDieAnswer(read: () => Calls, dispatch: (callId: string, die: number, source: DieSource, thrower: Thrower) => void) {
  const thrower = useThrower();
  const gate = useActGate();
  const place = useDicePlace();
  const ask = useTrayStore((s) => s.ask);
  return (callId: string, die: number | null) => {
    const call = read()[callId];
    if (!call || !gate({ id: call.roller })) return;
    if (die !== null) return dispatch(callId, die, 'entered', thrower);
    const thrown = throwOnScreen(call);
    if (place !== 'tray') return dispatch(callId, thrown.die, 'screen', thrower);
    ask({ id: callId, label: call.label, thrown, land: () => dispatch(callId, thrown.die, 'thrown', thrower) });
  };
}

// Every die a sequence calls for from someone whose dice are this screen's
// own (`isOwnRoller`) is answered by itself, whoever's press called for it:
// rolled at once for whoever throws on the screen, the tray opened for whoever
// throws there. Whoever rolls at the table types theirs in.
export function useAutoThrow(calls: Calls, answer: (callId: string, die: null) => void) {
  const place = useDicePlace();
  const roller = useRollerCheck();
  const due = place !== "table" ? getOpenCalls(calls).filter((c) => roller(c.roller).own).map((c) => c.id) : [];
  const throwFor = useRef(answer);
  throwFor.current = answer;
  const key = due.join(",");
  useEffect(() => {
    if (key) key.split(",").forEach((id) => throwFor.current(id, null));
  }, [key]);
}
