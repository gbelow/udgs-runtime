import { getDieBar, type Calls, type Thrower } from "../domain/play/calls";
import { realDice, throwOnScreen } from "../components/utils";
import type { DieSource } from "../domain/play/dice";
import { useTrayStore } from "../stores/useTrayStore";
import { useActGate, useControlCheck } from "./useControl";
import { useDicePlace } from "./useProfile";

// Whoever throws the dice a command calls for, from this screen: the screen
// rolls every call whose roller the one at it plays, unless they throw them in
// the dice tray or roll their own at the table, and leaves the rest waiting.
export function useThrower(): Thrower {
  const place = useDicePlace();
  const controls = useControlCheck();
  return { dice: realDice, answer: (call) => (place === 'screen' && controls(call.roller) ? throwOnScreen(call).die : null) };
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
