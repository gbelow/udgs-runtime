import { toast } from "sonner";
import { getCommandBar, toUpdater, type SceneCommand } from "../domain/scene/commands/registry";
import { useCombatStore } from "../stores/useCombatStore";
import { useViewerCheck } from "./useControl";
import { useThrower } from "./useDieCalls";

// A scene press sent as data from this screen: refused, why is said, and
// otherwise played into the combat store with this screen's dice and ids.
export function useSceneDispatch(): (command: SceneCommand) => void {
  const viewer = useViewerCheck();
  const thrower = useThrower();
  const updateState = useCombatStore((s) => s.updateCombatState);
  const newId = () => crypto.randomUUID();
  return (command) => {
    const why = getCommandBar(useCombatStore.getState(), command, viewer());
    if (why) toast.error(`Not yours to do: ${why}.`);
    else updateState(toUpdater(command, { thrower, newId }));
  };
}
