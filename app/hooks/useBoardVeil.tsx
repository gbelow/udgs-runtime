import { useMemo, useState } from "react";
import type { BoardView } from "../domain/scene/projections/boardView";
import { getVeiledGroups } from "../domain/scene/projections/frontView";

// The space the pointer is on and what is drawn over it or over any cell the
// board has picked (a destination, a landing, an aim), which is blurred so
// that what lies behind it can be seen. A per-viewer convenience.
export function useBoardVeil(view: BoardView) {
  const [lit, setLit] = useState<string | null>(null);
  const veiled = useMemo(() => {
    const picked = view.cells.filter((c) => c.chosen || c.isDestination || c.isJumpTo || c.isCenter).map((c) => c.key);
    return getVeiledGroups(view, lit === null ? picked : [lit, ...picked]);
  }, [view, lit]);
  return { lit, setLit, veiled } as const;
}
