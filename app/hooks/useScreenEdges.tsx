import { useEffect, type RefObject } from "react";
import { useScreenEdgesStore } from "../stores/useScreenEdgesStore";

// An element reports where it begins down the screen whenever it is resized
// or the window is, and that it is gone once unmounted.
function useReportTop(edge: "board" | "state", ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { setEdge } = useScreenEdgesStore.getState();
    const read = () => setEdge(edge, Math.round(el.getBoundingClientRect().top));
    read();
    const observer = new ResizeObserver(read);
    observer.observe(el);
    window.addEventListener("resize", read);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", read);
      setEdge(edge, null);
    };
  }, [edge, ref]);
}

// The board's canvas, under the board's own tools.
export const useReportBoardTop = (ref: RefObject<HTMLElement | null>) => useReportTop("board", ref);
// The box of the character's state, in the bottom left corner.
export const useReportStateTop = (ref: RefObject<HTMLElement | null>) => useReportTop("state", ref);

// Where the board's canvas begins down the screen, or null with none drawn.
export function useBoardTop(): number | null {
  return useScreenEdgesStore((s) => s.board);
}

// Where the box of the character's state begins down the screen, or null
// with none drawn.
export function useStateTop(): number | null {
  return useScreenEdgesStore((s) => s.state);
}
