import { useCallback, useEffect, useMemo, useState } from "react";
import type { BoardView } from "../domain/scene/projections/boardView";
import { getVeiledGroups } from "../domain/scene/projections/frontView";

const NONE: string[] = [];

const sameGroups = (a: string[], b: string[]) => a.length === b.length && a.every((g, i) => g === b[i]);

// What is drawn over the space the pointer is on or over any cell the board
// has picked (a destination, a landing, an aim), which is blurred so that what
// lies behind it can be seen. A per-viewer convenience. The space the pointer
// is on is kept by the layer that lights it (useLitCell), which tells the
// board only what is drawn over it, and only when that changes, so that the
// pointer moving over the board does not draw the board again.
export function useBoardVeil(view: BoardView) {
  const [over, setOverState] = useState<string[]>(NONE);
  const setOver = useCallback((groups: string[]) => setOverState((was) => (sameGroups(was, groups) ? was : groups)), []);
  const veiled = useMemo(() => {
    const picked = view.cells.filter((c) => c.chosen || c.isDestination || c.isJumpTo || c.isCenter).map((c) => c.key);
    const under = getVeiledGroups(view, picked);
    return over.length === 0 ? under : [...new Set([...under, ...over])];
  }, [view, over]);
  return { veiled, setOver } as const;
}

// The space the pointer is on, and what is drawn over it told to the board.
export function useLitCell(view: BoardView, setOver: (groups: string[]) => void) {
  const [lit, setLit] = useState<string | null>(null);
  const over = useMemo(() => (lit === null ? NONE : getVeiledGroups(view, [lit])), [view, lit]);
  useEffect(() => setOver(over), [over, setOver]);
  return { lit, setLit } as const;
}
