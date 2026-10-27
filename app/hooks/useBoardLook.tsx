import { useEffect, useState } from "react";
import { LIFT_LEAST, LIFT_MOST, LIFT_PER_METRE } from "../domain/lists";

// How this viewer sees the board: from the front, higher ground lifted up the
// screen, or from above, and how much a metre lifts. A per-viewer
// convenience kept in the browser, never part of the fight.
export type BoardLook = { front: boolean; lift: number; setFront: (front: boolean) => void; setLift: (lift: number) => void };

const KEY = "chargenfallow.boardLook";

type Stored = { front: boolean; lift: number };
const DEFAULT: Stored = { front: true, lift: LIFT_PER_METRE };

function read(): Stored {
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? "null");
    const lift = typeof raw?.lift === "number" && raw.lift >= LIFT_LEAST && raw.lift <= LIFT_MOST ? raw.lift : DEFAULT.lift;
    return { front: typeof raw?.front === "boolean" ? raw.front : DEFAULT.front, lift };
  } catch {
    return DEFAULT;
  }
}

function write(look: Stored) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(look));
  } catch {
    // the look just is not remembered
  }
}

export function useBoardLook(): BoardLook {
  const [look, setLook] = useState<Stored>(DEFAULT);
  useEffect(() => setLook(read()), []);
  const change = (next: Stored) => {
    setLook(next);
    write(next);
  };
  return {
    ...look,
    setFront: (front) => change({ ...look, front }),
    setLift: (lift) => change({ ...look, lift: Number.isFinite(lift) ? Math.min(LIFT_MOST, Math.max(LIFT_LEAST, lift)) : look.lift }),
  };
}
