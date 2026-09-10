import { addKnowledge, removeKnowledge } from "../domain/character/commands";
import { getMentalAfflictionPenalty } from "../domain/character/lenses/afflictions";
import { getAvailableKnowledges, getKnowledgeValues, knowledgesLens, makeKnowledgeLens } from "../domain/character/lenses/knowledge";
import { Character, Knowledges } from "../domain/types";
import { useActiveCharacterSelector, useActiveCharacterUpdate } from "./useActiveCharacterSelector";
import { useShallow } from "zustand/shallow";

// Stable default for the no-active-character case.
const NO_VALUES: Record<string, number> = {};
const NO_NAMES: string[] = [];

export function useKnowledgeLens() {
  const update = useActiveCharacterUpdate();

  // knowledges is a state-held object ref — Object.is gates re-renders to
  // actual knowledges changes (setters produce a new ref via structural sharing).
  const knowledges: Knowledges =
    useActiveCharacterSelector((c: Character) => knowledgesLens.get(c)) ?? ({} as Knowledges);

  // Resolved values, keyed by name — a flat record of primitives, so useShallow
  // gates the re-render on the values themselves. The mental penalty lives in
  // afflictions, not in `knowledges`, so toggling an affliction never moves the
  // reference above; it does move these values, which is what makes this the
  // subscription rather than a separate one kept only to force a render.
  const values = useActiveCharacterSelector(useShallow(getKnowledgeValues)) ?? NO_VALUES;

  // A name with no entry yet still carries the penalty, same as an untrained
  // knowledge read through its lens.
  const untrained = useActiveCharacterSelector((c: Character) => -getMentalAfflictionPenalty(c)) ?? 0;

  const getValue = (name: string) => values[name] ?? untrained;

  // The formal areas not yet held — a flat string array, so useShallow gates it.
  const available = useActiveCharacterSelector(useShallow(getAvailableKnowledges)) ?? NO_NAMES;

  const setValue = (name: string, value: number) => {
    update((c) => makeKnowledgeLens(name).set(c, value));
  };

  const add = (name: string) => {
    update(addKnowledge(name));
  };

  const remove = (name: string) => {
    update(removeKnowledge(name));
  };

  return { knowledges, available, getValue, setValue, add, remove } as const;
}
