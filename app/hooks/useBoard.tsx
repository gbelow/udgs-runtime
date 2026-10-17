import type { Coord, LightLevel } from "../domain/scene/types";
import type { TerrainBrush } from "../domain/types";
import { BoardView, getBoardView, getBoardViewDigest } from "../domain/scene/projections/boardView";
import { readClick, type Click } from "../domain/scene/commands/click";
import { createBoard, removeBoard, setLight } from "../domain/scene/commands/board";
import { useCombatStore } from "../stores/useCombatStore";
import { useActGate } from "./useControl";

// The board as drawn, and the clicks on it. Gated on a digest of the view,
// like the action panel. What a click means, and whom it acts for, is the
// domain's to say (`readClick`); a click is dispatched blindly once the
// screen may make it for them.
export function useBoard() {
  useCombatStore(getBoardViewDigest);
  const view: BoardView = getBoardView(useCombatStore.getState());
  const update = useCombatStore((s) => s.updateCombatState);
  const setActiveCharacter = useCombatStore((s) => s.setActiveCharacter);
  const gate = useActGate();

  const asGm = (run: () => void) => { if (gate("gmTool")) run(); };
  const create = (radius: number) => asGm(() => update(createBoard(radius)));
  const remove = () => asGm(() => update(removeBoard));
  const click = (c: Click, brush: TerrainBrush | null = null, reposition = false) => {
    const state = useCombatStore.getState();
    const read = readClick(state, c, { brush, reposition, selected: state.activeCharacterId, newId: () => crypto.randomUUID() });
    if ('select' in read) setActiveCharacter(read.select);
    else if (gate(read.actor)) update(read.apply);
  };

  const clickCell = (cell: Coord, brush: TerrainBrush | null, reposition: boolean) => click({ on: 'cell', cell }, brush, reposition);
  const clickToken = (id: string) => click({ on: 'token', id });
  const clickFloorItem = (itemId: string) => click({ on: 'floor', itemId });
  const place = (id: string) => setActiveCharacter(id);
  const turn = (reposition: boolean) => click({ on: 'turn' }, null, reposition);
  const light = (level: LightLevel) => asGm(() => update(setLight(level)));

  return { view, create, remove, clickCell, clickToken, clickFloorItem, place, turn, light } as const;
}
