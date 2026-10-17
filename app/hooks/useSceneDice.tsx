import { getCallRows, getDiceBar, type CallRow } from "../domain/play/calls";
import { getFightName } from "../domain/scene/rules/fighters";
import { answerScene } from "../domain/scene/commands/answer";
import { useCombatStore } from "../stores/useCombatStore";
import { useAutoThrow, useDieAnswer } from "./useDieCalls";

// Why nothing else may be done in the scene: it waits on dice.
export function useSceneDiceBar(): string | null {
  return useCombatStore((s) => getDiceBar(s.calls));
}

// The dice the scene has called for, gated on the calls themselves.
export function useSceneCalls(): CallRow[] {
  useCombatStore((s) => s.calls);
  const s = useCombatStore.getState();
  return getCallRows(s.calls, (id) => getFightName(s, id));
}

// The answer to a die the scene called for.
export function useSceneAnswer() {
  const updateCombatState = useCombatStore((s) => s.updateCombatState);
  return useDieAnswer(
    () => useCombatStore.getState().calls,
    (callId, die, source, thrower) => updateCombatState(answerScene(callId, die, source, thrower, () => crypto.randomUUID())),
  );
}

// The dice tray opened by itself for the dice the scene calls for.
export function useSceneAutoThrow() {
  useAutoThrow(useCombatStore((s) => s.calls), useSceneAnswer());
}
