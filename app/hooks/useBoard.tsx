import type { Coord, LightLevel } from "../domain/scene/types";
import type { TerrainBrush } from "../domain/types";
import { BoardView, getBoardView, getBoardViewDigest, getBoardViewFrom, getBoardViewFromDigest, getResizeWarning } from "../domain/scene/projections/boardView";
import { readClick, type Click } from "../domain/scene/commands/click";
import { useCombatStore } from "../stores/useCombatStore";
import { useAppStore } from "../stores/useAppStore";
import { useSceneDispatch } from "./useSceneDispatch";
import { usePendingItem } from "./useItemLens";

// The board as drawn, and the clicks on it. Gated on a digest of the view,
// like the action panel. What a click means, and whom it acts for, is the
// domain's to say (`readClick`): a click that picks a character is this
// screen's alone, and any other is sent as a scene command with whom the
// screen has picked.
export function useBoard(fromActive = false) {
  useCombatStore(fromActive ? getBoardViewFromDigest : getBoardViewDigest);
  const view: BoardView = (fromActive ? getBoardViewFrom : getBoardView)(useCombatStore.getState());
  const setActiveCharacter = useCombatStore((s) => s.setActiveCharacter);
  const dispatch = useSceneDispatch();

  const create = (radius: number) => dispatch({ kind: "createBoard", args: [radius] });
  const remove = () => dispatch({ kind: "removeBoard", args: [] });
  const click = (c: Click, brush: TerrainBrush | null = null, reposition = false) => {
    const state = useCombatStore.getState();
    const selected = state.activeCharacterId;
    const read = readClick(state, c, { brush, reposition, selected, newId: () => "" });
    if ("select" in read) setActiveCharacter(read.select);
    else dispatch({ kind: "click", args: [c, brush, reposition, selected] });
  };

  const clickCell = (cell: Coord, brush: TerrainBrush | null, reposition: boolean) => click({ on: 'cell', cell }, brush, reposition);
  const clickToken = (id: string) => click({ on: 'token', id });
  const clickFloorItem = (itemId: string) => click({ on: 'floor', itemId });
  const place = (id: string) => setActiveCharacter(id);
  // the item picked in the catalog, laid on the clicked cell by the GM
  const pending = useAppStore((s) => s.pendingItem);
  const pendingItem = usePendingItem();
  const item = pending?.source === "catalog" ? pendingItem : null;
  const placeItem = (cell: Coord) => { if (item) dispatch({ kind: "placeItem", args: [item, cell] }); };
  const removeFloorItem = (itemId: string) => dispatch({ kind: "removeFloorItem", args: [itemId] });
  const turn = (reposition: boolean) => click({ on: 'turn' }, null, reposition);
  const light = (level: LightLevel) => dispatch({ kind: "light", args: [level] });
  const resize = (radius: number) => dispatch({ kind: "resizeBoard", args: [radius] });
  const resizeWarning = (radius: number) => getResizeWarning(useCombatStore.getState(), radius);

  return { view, item, create, remove, clickCell, clickToken, clickFloorItem, place, placeItem, removeFloorItem, turn, light, resize, resizeWarning } as const;
}
