import { getDieBar, type Calls, type Thrower } from "../domain/play/calls";
import { realDice, rollOnScreen } from "../components/utils";
import { useActGate, useControlCheck } from "./useControl";
import { useManualDice } from "./useProfile";

// Whoever throws the dice a command calls for, from this screen: the screen
// rolls every call whose roller the one at it plays, unless they roll their
// own dice at the table, and leaves the rest waiting.
export function useThrower(): Thrower {
  const manual = useManualDice();
  const controls = useControlCheck();
  return { dice: realDice, answer: (call) => (!manual && controls(call.roller) ? rollOnScreen(call) : null) };
}

// Why a die typed in cannot be the one rolled: `explodes` for a test whose
// die explodes, and none for the tests a button makes, which never do.
export function useDieBar(): (die: number, explodes?: boolean) => string | null {
  return (die, explodes = false) => getDieBar(explodes, die);
}

// The GM's taking back of what a call a sequence keeps was made for,
// dispatched as its own cancel command.
export function useDieCancel(dispatch: (callId: string, thrower: Thrower) => void) {
  const thrower = useThrower();
  const gate = useActGate();
  return (callId: string) => { if (gate("gm")) dispatch(callId, thrower); };
}

// The answer to a call a sequence keeps in `calls`, dispatched as its own
// answer command: a die typed in, or rolled from the prompt (null).
export function useDieAnswer(read: () => Calls, dispatch: (callId: string, die: number, entered: boolean, thrower: Thrower) => void) {
  const thrower = useThrower();
  const gate = useActGate();
  return (callId: string, die: number | null) => {
    const call = read()[callId];
    if (!call || !gate({ id: call.roller })) return;
    dispatch(callId, die ?? rollOnScreen(call), die !== null, thrower);
  };
}
