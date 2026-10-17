import { toast } from "sonner";
import { realDice } from "../components/utils";
import type { Viewer } from "../domain/profiles";
import { getCommandBar, toUpdater, type SceneCommand } from "../domain/scene/commands/registry";
import { getTableCommandBar, toTableUpdater, type TableCommand } from "../domain/scene/commands/tableRegistry";
import { getCampaignCommandBar, toCampaignUpdater, type CampaignCommand } from "../domain/campaign/commands/registry";
import { getExplorationCommandBar, toExplorationUpdater, type ExplorationCommand } from "../domain/exploration/commands/registry";
import { getDowntimeCommandBar, toDowntimeUpdater, type DowntimeCommand } from "../domain/downtime/commands/registry";
import { useCombatStore } from "../stores/useCombatStore";
import { useCampaignStore } from "../stores/useCampaignStore";
import { useViewerCheck } from "./useControl";
import { useThrower } from "./useDieCalls";

const newId = () => crypto.randomUUID();

// A press sent as data from this screen: refused, why is said, and otherwise
// played into the store that keeps its part, with this screen's dice and ids.
// Whether it was sent.
function useDispatchOf<S, C>(read: () => S, bar: (state: S, command: C, viewer: Viewer) => string | null, play: (command: C) => void): (command: C) => boolean {
  const viewer = useViewerCheck();
  return (command) => {
    const why = bar(read(), command, viewer());
    if (why) toast.error(`Not yours to do: ${why}.`);
    else play(command);
    return why === null;
  };
}

export function useSceneDispatch(): (command: SceneCommand) => boolean {
  const thrower = useThrower();
  const updateState = useCombatStore((s) => s.updateCombatState);
  return useDispatchOf(useCombatStore.getState, getCommandBar, (command) => updateState(toUpdater(command, { thrower, newId })));
}

// What crosses between the campaign and the fight.
export function useTableDispatch(): (command: TableCommand) => boolean {
  const updateTable = useCampaignStore((s) => s.updateTable);
  return useDispatchOf(
    () => ({ campaign: useCampaignStore.getState(), fight: useCombatStore.getState() }),
    getTableCommandBar,
    (command) => updateTable(toTableUpdater(command, { newId })),
  );
}

export function useCampaignDispatch(): (command: CampaignCommand) => boolean {
  const update = useCampaignStore((s) => s.updateCampaignState);
  return useDispatchOf(useCampaignStore.getState, getCampaignCommandBar, (command) => update(toCampaignUpdater(command, { newId, dice: realDice })));
}

export function useExplorationDispatch(): (command: ExplorationCommand) => boolean {
  const thrower = useThrower();
  const update = useCampaignStore((s) => s.updateExploration);
  return useDispatchOf(
    () => { const s = useCampaignStore.getState(); return { campaign: s, exploration: s.exploration }; },
    getExplorationCommandBar,
    (command) => update(toExplorationUpdater(command, { thrower, newId })),
  );
}

export function useDowntimeDispatch(): (command: DowntimeCommand) => boolean {
  const thrower = useThrower();
  const update = useCampaignStore((s) => s.updateDowntime);
  return useDispatchOf(
    () => { const s = useCampaignStore.getState(); return { campaign: s, downtime: s.downtime }; },
    getDowntimeCommandBar,
    (command) => update(toDowntimeUpdater(command, { thrower })),
  );
}
