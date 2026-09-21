import type { Coord } from "../domain/combat/types";
import type { TerrainBrush } from "../domain/types";
import { BoardView, getBoardView, getBoardViewDigest } from "../domain/combat/lenses/boardView";
import { setTarget } from "../domain/combat/commands/action";
import { createBoard, paintTerrain, pickCell, placeCharacter, turnCharacter, turnMove } from "../domain/combat/commands/board";
import { useCombatStore } from "../stores/useCombatStore";

// The board as drawn, and the clicks on it. Gated on a digest of the view,
// like the action panel; every write is a combat command dispatched blindly.
// A click on a cell is the one place the hook chooses a command, and it
// chooses by what the view says the click means: painting if a brush is in
// hand, a path edit while a move is being declared, otherwise a placement
// of the active character by hand.
export function useBoard() {
  useCombatStore(getBoardViewDigest);
  const view: BoardView = getBoardView(useCombatStore.getState());
  const update = useCombatStore((s) => s.updateCombatState);
  const setActiveCharacter = useCombatStore((s) => s.setActiveCharacter);

  const create = (radius: number) => update(createBoard(radius));
  const clickCell = (cell: Coord, brush: TerrainBrush | null) => {
    if (brush) return update(paintTerrain(cell, brush));
    if (view.mode === 'path') return update(pickCell(cell));
    const activeId = useCombatStore.getState().activeCharacterId;
    if (view.mode === 'idle' && activeId) update(placeCharacter(activeId, cell));
  };
  // A click on a token aims the open action at it while one is waiting for a
  // target, and makes it the active character otherwise.
  const clickToken = (id: string, targetable: boolean) => {
    if (targetable) update(setTarget(id));
    else setActiveCharacter(id);
  };
  const place = (id: string) => setActiveCharacter(id);
  const turn = () => {
    if (view.mode === 'path') return update(turnMove());
    const activeId = useCombatStore.getState().activeCharacterId;
    if (activeId) update(turnCharacter(activeId));
  };

  return { view, create, clickCell, clickToken, place, turn } as const;
}
