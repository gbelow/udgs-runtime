import { useLayoutEffect, useRef } from "react";

// A column-wrapped flex box is sized by the browser as one column, so the
// columns past the first spill out. This gives the box the width of all its
// columns, measured again whenever its content or its height changes.
export function useFitColumns<T extends HTMLElement>() {
  const ref = useRef<T>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let height = -1;
    const fit = () => {
      el.style.minWidth = "";
      el.style.minWidth = `${el.scrollWidth}px`;
    };
    const resized = new ResizeObserver(() => {
      if (el.offsetHeight === height) return;
      height = el.offsetHeight;
      fit();
    });
    const changed = new MutationObserver(fit);
    resized.observe(el);
    changed.observe(el, { childList: true, subtree: true, characterData: true });
    return () => {
      resized.disconnect();
      changed.disconnect();
    };
  }, []);

  return ref;
}
