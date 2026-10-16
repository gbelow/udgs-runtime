import { getCallRows, getDiceBar, type CallRow } from "../domain/play/calls";
import { getFightName } from "../domain/scene/rules/fighters";
import { answerScene, cancelCall } from "../domain/scene/commands/answer";
import { getCancelling } from "../domain/scene/rules/calls";
import { useCombatStore } from "../stores/useCombatStore";
import { useDieAnswer, useDieCancel } from "./useDieCalls";

// Why nothing else may be done in the scene: it waits on dice.
export function useSceneDiceBar(): string | null {
  return useCombatStore((s) => getDiceBar(s.calls));
}

// The dice the scene has called for, gated on the calls themselves.
export function useSceneCalls(): CallRow[] {
  useCombatStore((s) => s.calls);
  const s = useCombatStore.getState();
  return getCallRows(s.calls, (id) => getFightName(s, id), (c) => getCancelling(s, c.id) !== null);
}

// The GM's taking back of the action or reaction a die the scene called for
// answers.
export function useSceneCancel() {
  const updateCombatState = useCombatStore((s) => s.updateCombatState);
  return useDieCancel((callId, thrower) => updateCombatState(cancelCall(callId, thrower, () => crypto.randomUUID())));
}

// The answer to a die the scene called for.
export function useSceneAnswer() {
  const updateCombatState = useCombatStore((s) => s.updateCombatState);
  return useDieAnswer(
    () => useCombatStore.getState().calls,
    (callId, die, entered, thrower) => updateCombatState(answerScene(callId, die, entered, thrower, () => crypto.randomUUID())),
  );
}
