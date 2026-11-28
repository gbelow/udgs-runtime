import { useEffect, useState } from "react";

// How the boxes docked on the bottom corners of the screen are sized, as the
// screen left them: the character's state on the left, the log on the right,
// each a width and a height in pixels, or null where it fits what it holds.
// The state fits what it holds until it is dragged; the log, which only grows,
// starts at the size of a few lines. Kept in this browser only; read after mounting, so the
// server and the first render agree.
const KEY = "fallow.docks.v2";

export type DockSide = "left" | "right";
// the boxes, and the sheet's window, which only its height is kept of
export type DockKey = DockSide | "sheet";
export type DockSize = { width: number | null; height: number | null };

const LIMITS = { width: { least: 200, most: 900 }, height: { least: 80, most: 900 } } as const;
const START: Record<DockKey, DockSize> = { left: { width: null, height: null }, right: { width: 380, height: 150 }, sheet: { width: null, height: null } };

type Range = { least: number; most: number };
const clamp = (value: number, { least, most }: Range) => Math.min(most, Math.max(least, value));
const within = (value: unknown, range: Range) => (typeof value === "number" && value >= range.least && value <= range.most ? value : null);

function read(side: DockKey): DockSize {
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? "null")?.[side];
    return { width: within(raw?.width, LIMITS.width) ?? START[side].width, height: within(raw?.height, LIMITS.height) ?? START[side].height };
  } catch {
    return START[side];
  }
}

function write(side: DockKey, size: DockSize) {
  try {
    const all = JSON.parse(window.localStorage.getItem(KEY) ?? "null") ?? {};
    window.localStorage.setItem(KEY, JSON.stringify({ ...all, [side]: size }));
  } catch {
    // the size just is not remembered
  }
}

export function useDockSize(side: DockKey): DockSize & { set: (size: { width?: number; height?: number }) => void } {
  const [size, setSize] = useState<DockSize>(START[side]);
  useEffect(() => setSize(read(side)), [side]);
  const set = (next: { width?: number; height?: number }) =>
    setSize((s) => {
      const made = {
        width: next.width === undefined ? s.width : clamp(next.width, LIMITS.width),
        height: next.height === undefined ? s.height : clamp(next.height, LIMITS.height),
      };
      write(side, made);
      return made;
    });
  return { ...size, set };
}
