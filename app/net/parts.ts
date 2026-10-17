import { realDice } from "../components/utils";
import type { Thrower } from "../domain/play/calls";
import type { Viewer } from "../domain/profiles";
import { getCommandBar, toUpdater, type SceneCommand } from "../domain/scene/commands/registry";
import { getTableCommandBar, toTableUpdater, type TableCommand } from "../domain/scene/commands/tableRegistry";
import { getCampaignCommandBar, toCampaignUpdater, type CampaignCommand } from "../domain/campaign/commands/registry";
import { getExplorationCommandBar, toExplorationUpdater, type ExplorationCommand } from "../domain/exploration/commands/registry";
import { getDowntimeCommandBar, toDowntimeUpdater, type DowntimeCommand } from "../domain/downtime/commands/registry";
import { useCombatStore } from "../stores/useCombatStore";
import { useCampaignStore } from "../stores/useCampaignStore";

const newId = () => crypto.randomUUID();

// A part of play as the screen that plays its presses sees it: the state a
// command is judged against, why a viewer may not send it, and the command
// played into the store that keeps the part, with the player's dice and ids.
export type Part<S, C> = {
  read: () => S
  bar: (state: S, command: C, viewer: Viewer) => string | null
  play: (command: C, thrower: Thrower) => void
}

export type Commands = {
  scene: SceneCommand
  table: TableCommand
  campaign: CampaignCommand
  exploration: ExplorationCommand
  downtime: DowntimeCommand
}

export type PartName = keyof Commands

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- each part judges its commands against a state of its own
export const PARTS: { [P in PartName]: Part<any, Commands[P]> } = {
  scene: {
    read: useCombatStore.getState,
    bar: getCommandBar,
    play: (command, thrower) => useCombatStore.getState().updateCombatState(toUpdater(command, { thrower, newId })),
  },
  // what crosses between the campaign and the fight
  table: {
    read: () => ({ campaign: useCampaignStore.getState(), fight: useCombatStore.getState() }),
    bar: getTableCommandBar,
    play: (command) => useCampaignStore.getState().updateTable(toTableUpdater(command, { newId })),
  },
  campaign: {
    read: useCampaignStore.getState,
    bar: getCampaignCommandBar,
    play: (command) => useCampaignStore.getState().updateCampaignState(toCampaignUpdater(command, { newId, dice: realDice })),
  },
  exploration: {
    read: () => { const s = useCampaignStore.getState(); return { campaign: s, exploration: s.exploration }; },
    bar: getExplorationCommandBar,
    play: (command, thrower) => useCampaignStore.getState().updateExploration(toExplorationUpdater(command, { thrower, newId })),
  },
  downtime: {
    read: () => { const s = useCampaignStore.getState(); return { campaign: s, downtime: s.downtime }; },
    bar: getDowntimeCommandBar,
    play: (command, thrower) => useCampaignStore.getState().updateDowntime(toDowntimeUpdater(command, { thrower })),
  },
};

const partOf = <P extends PartName>(part: P) => (PARTS as Record<PartName, unknown>)[part] as Part<unknown, Commands[P]>;

// Why `viewer` may not send `command` to part `part` as it stands now.
export const barOf = <P extends PartName>(part: P, command: Commands[P], viewer: Viewer): string | null =>
  partOf(part).bar(partOf(part).read(), command, viewer);

export const playOf = <P extends PartName>(part: P, command: Commands[P], thrower: Thrower) =>
  partOf(part).play(command, thrower);
