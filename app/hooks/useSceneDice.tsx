import { getCallRows, getDiceBar, type CallRow } from "../domain/play/calls";
import { getFightName } from "../domain/scene/rules/fighters";
import { useCombatStore } from "../stores/useCombatStore";
import { useAutoThrow, useDieAnswer } from "./useDieCalls";
import { useSceneDispatch } from "./useSceneDispatch";

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
  const dispatch = useSceneDispatch();
  return useDieAnswer(
    () => useCombatStore.getState().calls,
    (callId, die, source) => dispatch({ kind: "answer", args: [callId, die, source] }),
  );
}

// The scene's dice that are this screen's own, answered by themselves.
export function useSceneAutoThrow() {
  useAutoThrow(useCombatStore((s) => s.calls), useSceneAnswer());
}
