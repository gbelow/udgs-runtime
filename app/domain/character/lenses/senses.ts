import { Character, Lens, Sense, Senses } from "../../types";
import { composeLens, makeInvertingSetter, makePropLens } from "./factories";
import { getBuffBonus } from "../rules/effects";
import { getSenses } from "../rules/senses";

export const sensesLens: Lens<Character, Senses> = makePropLens<Character, "senses">("senses");

export function makeSenseEntryLens(senseName: keyof Senses): Lens<Character, Sense> {
  return composeLens(sensesLens, makePropLens<Senses, keyof Senses>(senseName));
}

// A field of a sense as it is in play, mutations and all, set on the
// character's own stored sense.
function makeSenseFieldLens<K extends keyof Sense>(senseName: keyof Senses, field: K): Lens<Character, Sense[K]> {
  const stored = composeLens(makeSenseEntryLens(senseName), makePropLens<Sense, K>(field));
  return { get: (c) => getSenses(c)[senseName][field], set: stored.set };
}

export function makeSenseRangePenaltyLens(senseName: keyof Senses): Lens<Character, number> {
  return makeSenseFieldLens(senseName, "rangePenalty");
}

// The stored bonus plus what abilities add to the sense.
export function getSenseBonus(c: Character, senseName: keyof Senses): number {
  return c.senses[senseName].bonus + getBuffBonus(c, `sense:${senseName}`);
}

export function makeSenseBonusLens(senseName: keyof Senses): Lens<Character, number> {
  const base = composeLens(makeSenseEntryLens(senseName), makePropLens<Sense, "bonus">("bonus"));
  const getter = (c: Character) => getSenseBonus(c, senseName);
  return { get: getter, set: makeInvertingSetter(getter, base.get, base.set) };
}

export function makeSenseActiveLens(senseName: keyof Senses): Lens<Character, boolean> {
  return makeSenseFieldLens(senseName, "active");
}

export function makeSenseReactiveLens(senseName: keyof Senses): Lens<Character, boolean> {
  return makeSenseFieldLens(senseName, "reactive");
}

export function makeSensePenaltyLens(senseName: keyof Senses): Lens<Character, number> {
  return makeSenseFieldLens(senseName, "penalty");
}

// combat.tex "Smell": "Range of smell is 0, by default" — in metres, null
// for a sense that reaches as far as it is triggered.
export function makeSenseRangeLens(senseName: keyof Senses): Lens<Character, number | null> {
  return makeSenseFieldLens(senseName, "range");
}

export function makeSensePartialLens(senseName: keyof Senses): Lens<Character, boolean> {
  return makeSenseFieldLens(senseName, "partial");
}

export function makeSenseHasSenseLens(senseName: keyof Senses): Lens<Character, boolean> {
  return makeSenseFieldLens(senseName, "hasSense");
}
