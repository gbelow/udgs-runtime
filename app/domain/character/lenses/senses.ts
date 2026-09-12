import { Character, Lens, Sense, Senses } from "../../types";
import { composeLens, makeInvertingSetter, makePropLens } from "./factories";
import { getBuffBonus } from "./effects";

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

export function makeSenseHasSenseLens(senseName: keyof Senses): Lens<Character, boolean> {
  return composeLens(makeSenseEntryLens(senseName), makePropLens<Sense, "hasSense">("hasSense"));
}
