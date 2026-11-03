import { useCallback, useMemo, useRef, useState } from "react";
import { getCellAt } from "../domain/scene/projections/boardView";

// What the board's canvas is zoomed and panned by: the buttons beside it reach
// the stage drawing it, and are told whether it is zoomed. A per-viewer
// convenience, never part of the fight.
export type BoardCamera = {
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
  zoomed: boolean;
  attach: (stage: Pick<BoardCamera, "zoomIn" | "zoomOut" | "reset"> | null) => void;
  setZoomed: (zoomed: boolean) => void;
};

export function useBoardCamera(): BoardCamera {
  const stage = useRef<Pick<BoardCamera, "zoomIn" | "zoomOut" | "reset"> | null>(null);
  const [zoomed, setZoomed] = useState(false);
  const attach = useCallback((s: Pick<BoardCamera, "zoomIn" | "zoomOut" | "reset"> | null) => { stage.current = s; }, []);
  return useMemo(() => ({
    zoomIn: () => stage.current?.zoomIn(),
    zoomOut: () => stage.current?.zoomOut(),
    reset: () => stage.current?.reset(),
    zoomed,
    attach,
    setZoomed,
  }), [zoomed, attach]);
}

// The cell a point of the board's plane picks (`getCellAt`).
export function useCellAt() {
  return getCellAt;
}
