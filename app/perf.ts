// Performance measurement helpers for the domain read-side.
//
// Every derived value the system can compute is reachable through a registered
// lens/getter. Flattening those registries into one list gives a "full
// projection" of a character — one pass over it recomputes *every* derived
// stat from scratch, which is exactly what the render layer does on a read.
// Measuring that pass is the most direct way to show the cost of "derived,
// never stored": no cache, just arithmetic, re-run on every read.

import { Character } from "./domain/types";
import {
  skillLenses,
  characteristicLenses,
  movementLenses,
  senseLenses,
  miscLenses,
  magicGetters,
} from "./domain/character/lenses";

export type ProjectionEntry = {
  name: string;
  get: (c: Character) => unknown;
  // Present when the underlying lens is settable (skills, characteristics,
  // movement, misc, sense sub-lenses). Absent for read-only magic getters.
  set?: (c: Character, value: unknown) => Character;
};

function buildEntries(): ProjectionEntry[] {
  const list: ProjectionEntry[] = [];
  for (const [k, lens] of Object.entries(skillLenses))
    list.push({ name: `skill.${k}`, get: (c) => lens.get(c), set: (c, v) => lens.set(c, v as number) });
  for (const [k, lens] of Object.entries(characteristicLenses))
    list.push({ name: `char.${k}`, get: (c) => lens.get(c), set: (c, v) => lens.set(c, v as number) });
  for (const [k, lens] of Object.entries(movementLenses))
    list.push({ name: `move.${k}`, get: (c) => lens.get(c), set: (c, v) => lens.set(c, v as number) });
  for (const [k, s] of Object.entries(senseLenses)) {
    list.push({ name: `sense.${k}.rangePenalty`, get: (c) => s.rangePenalty.get(c), set: (c, v) => s.rangePenalty.set(c, v as number) });
    list.push({ name: `sense.${k}.bonus`, get: (c) => s.bonus.get(c), set: (c, v) => s.bonus.set(c, v as number) });
    list.push({ name: `sense.${k}.penalty`, get: (c) => s.penalty.get(c), set: (c, v) => s.penalty.set(c, v as number) });
    list.push({ name: `sense.${k}.range`, get: (c) => s.range.get(c), set: (c, v) => s.range.set(c, v as number | null) });
    list.push({ name: `sense.${k}.reactive`, get: (c) => s.reactive.get(c), set: (c, v) => s.reactive.set(c, v as boolean) });
    list.push({ name: `sense.${k}.active`, get: (c) => s.active.get(c), set: (c, v) => s.active.set(c, v as boolean) });
    list.push({ name: `sense.${k}.hasSense`, get: (c) => s.hasSense.get(c), set: (c, v) => s.hasSense.set(c, v as boolean) });
  }
  for (const [k, g] of Object.entries(magicGetters))
    list.push({ name: `magic.${k}`, get: (c) => (g as (c: Character) => unknown)(c) });
  for (const [k, lens] of Object.entries(miscLenses))
    list.push({ name: `misc.${k}`, get: (c) => lens.get(c), set: (c, v) => lens.set(c, v as number) });
  return list;
}

let cachedEntries: ProjectionEntry[] | null = null;
export function projectionEntries(): ProjectionEntry[] {
  return (cachedEntries ??= buildEntries());
}

/** Run every registered lens/getter once against a character. Returns the count. */
export function runFullProjection(c: Character): number {
  const list = projectionEntries();
  for (let i = 0; i < list.length; i++) list[i].get(c);
  return list.length;
}

export type ProjectionTiming = {
  count: number;
  iterations: number;
  totalMs: number;
  usPerChar: number;
  opsPerMs: number;
};

/** Time `iterations` full projections of one character. Warmed up so the JIT
 *  doesn't skew the first pass. */
export function measureProjection(c: Character, iterations = 1000): ProjectionTiming {
  runFullProjection(c); // warmup
  const start = performance.now();
  for (let i = 0; i < iterations; i++) runFullProjection(c);
  const totalMs = performance.now() - start;
  const count = projectionEntries().length;
  return {
    count,
    iterations,
    totalMs,
    usPerChar: (totalMs * 1000) / iterations,
    opsPerMs: (count * iterations) / totalMs,
  };
}

/** Time one full projection pass over every character in a collection. */
export function measureProjectionBatch(
  chars: Character[]
): { chars: number; totalMs: number; usPerChar: number } {
  if (!chars.length) return { chars: 0, totalMs: 0, usPerChar: 0 };
  for (const c of chars) runFullProjection(c); // warmup
  const start = performance.now();
  for (const c of chars) runFullProjection(c);
  const totalMs = performance.now() - start;
  return { chars: chars.length, totalMs, usPerChar: (totalMs * 1000) / chars.length };
}
