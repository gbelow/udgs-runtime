import type { Coord, LightLevel } from "../domain/scene/types";
import type { TerrainBrush } from "../domain/types";
import { BoardView, getBoardView, getBoardViewDigest } from "../domain/scene/projections/boardView";
import { readClick, type Click } from "../domain/scene/commands/click";
import { useCombatStore } from "../stores/useCombatStore";
import { useSceneDispatch } from "./useSceneDispatch";

// The board as drawn, and the clicks on it. Gated on a digest of the view,
// like the action panel. What a click means, and whom it acts for, is the
// domain's to say (`readClick`): a click that picks a character is this
// screen's alone, and any other is sent as a scene command with whom the
// screen has picked.
export function useBoard() {
  useCombatStore(getBoardViewDigest);
  const view: BoardView = getBoardView(useCombatStore.getState());
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
  const turn = (reposition: boolean) => click({ on: 'turn' }, null, reposition);
  const light = (level: LightLevel) => dispatch({ kind: "light", args: [level] });

  return { view, create, remove, clickCell, clickToken, clickFloorItem, place, turn, light } as const;
}
