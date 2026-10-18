import { toast } from "sonner";
import { barOf, playOf, type Commands, type PartName } from "../net/parts";
import { sendToHost } from "../net/session";
import type { CommandMessage } from "../net/protocol";
import { useTableStore } from "../stores/useTableStore";
import { useViewerCheck } from "./useControl";
import { useThrower } from "./useDieCalls";

// A press sent as data from this screen: refused, why is said; otherwise
// played into the store that keeps its part, with this screen's dice and ids,
// or, on a screen that joined a table, sent to its host to play, one press at
// a time and the screen changes only when the host's state arrives. Whether it
// was sent.
function useDispatchOf<P extends PartName>(part: P): (command: Commands[P]) => boolean {
  const viewer = useViewerCheck();
  const thrower = useThrower();
  return (command) => {
    const v = viewer();
    const why = barOf(part, command, v);
    if (why) { toast.error(`Not yours to do: ${why}.`); return false; }
    const table = useTableStore.getState();
    if (table.mode !== 'guest') { playOf(part, command, thrower); return true; }
    if (!table.socket || table.status !== 'open') { toast.error('Not at the table: the link to its host is down.'); return false; }
    if (table.pending) { toast.error('Wait: the host has not yet confirmed your last press.'); return false; }
    const id = crypto.randomUUID();
    table.press(id, (why) => toast.error(`The host did not play it: ${why}.`));
    sendToHost(table.socket, { kind: 'command', id, part, command, gmMode: v.gmMode } as CommandMessage);
    return true;
  };
}

export const useSceneDispatch = () => useDispatchOf('scene');

// What crosses between the campaign and the fight.
export const useTableDispatch = () => useDispatchOf('table');

export const useCampaignDispatch = () => useDispatchOf('campaign');

export const useExplorationDispatch = () => useDispatchOf('exploration');

export const useDowntimeDispatch = () => useDispatchOf('downtime');
