import type { Coord, LightLevel } from "../domain/scene/types";
import type { TerrainBrush } from "../domain/types";
import { BoardView, getBoardView, getBoardViewDigest } from "../domain/scene/projections/boardView";
import { resolveClick } from "../domain/scene/commands/click";
import { createBoard, removeBoard, setLight } from "../domain/scene/commands/board";
import { useCombatStore } from "../stores/useCombatStore";

// The board as drawn, and the clicks on it. Gated on a digest of the view,
// like the action panel. What a click means is the domain's to say
// (`resolveClick`); every click is dispatched blindly.
export function useBoard() {
  useCombatStore(getBoardViewDigest);
  const view: BoardView = getBoardView(useCombatStore.getState());
  const update = useCombatStore((s) => s.updateCombatState);
  const setActiveCharacter = useCombatStore((s) => s.setActiveCharacter);

  const create = (radius: number) => update(createBoard(radius));
  const remove = () => update(removeBoard);
  const click = (c: Parameters<typeof resolveClick>[0], brush: TerrainBrush | null = null) =>
    update(resolveClick(c, { brush, newId: () => crypto.randomUUID() }));

  const clickCell = (cell: Coord, brush: TerrainBrush | null) => click({ on: 'cell', cell }, brush);
  const clickToken = (id: string) => click({ on: 'token', id });
  const clickFloorItem = (itemId: string) => click({ on: 'floor', itemId });
  const place = (id: string) => setActiveCharacter(id);
  const turn = () => click({ on: 'turn' });
  const light = (level: LightLevel) => update(setLight(level));

  return { view, create, remove, clickCell, clickToken, clickFloorItem, place, turn, light } as const;
}
