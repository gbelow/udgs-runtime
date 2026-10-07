import { Character, Lens, Sense, Senses } from "../../types";
import { composeLens, makeInvertingSetter, makePropLens } from "./factories";
import { getBuffBonus } from "../rules/effects";

export const sensesLens: Lens<Character, Senses> = makePropLens<Character, "senses">("senses");

export function makeSenseEntryLens(senseName: keyof Senses): Lens<Character, Sense> {
  return composeLens(sensesLens, makePropLens<Senses, keyof Senses>(senseName));
}

export function makeSenseRangePenaltyLens(senseName: keyof Senses): Lens<Character, number> {
  return composeLens(makeSenseEntryLens(senseName), makePropLens<Sense, "rangePenalty">("rangePenalty"));
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
  return composeLens(makeSenseEntryLens(senseName), makePropLens<Sense, "active">("active"));
}

export function makeSenseReactiveLens(senseName: keyof Senses): Lens<Character, boolean> {
  return composeLens(makeSenseEntryLens(senseName), makePropLens<Sense, "reactive">("reactive"));
}

export function makeSensePenaltyLens(senseName: keyof Senses): Lens<Character, number> {
  return composeLens(makeSenseEntryLens(senseName), makePropLens<Sense, "penalty">("penalty"));
}

// combat.tex "Smell": "Range of smell is 0, by default" — in metres, null
// for a sense that reaches as far as it is triggered.
export function makeSenseRangeLens(senseName: keyof Senses): Lens<Character, number | null> {
  return composeLens(makeSenseEntryLens(senseName), makePropLens<Sense, "range">("range"));
}

export function makeSenseHasSenseLens(senseName: keyof Senses): Lens<Character, boolean> {
  return composeLens(makeSenseEntryLens(senseName), makePropLens<Sense, "hasSense">("hasSense"));
}
