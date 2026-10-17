import { getMentalAfflictionPenalty } from "../domain/character/rules/afflictions";
import { getKnowledgeTerms, getSpecificKnowledgeValues } from "../domain/character/rules/knowledge";
import { sumTerms, Term, termsDigest, termsView } from "../domain/character/lenses";
import { Character, Knowledges } from "../domain/types";
import { useActiveCharacterDerived, useActiveCharacterSelector, useActiveCharacterUpdate } from "./useActiveCharacterSelector";
import { useShallow } from "zustand/shallow";

// Stable default for the no-active-character case.
const NO_VALUES: Record<string, number> = {};

// One formal knowledge, read and written like a skill.
export function useFormalKnowledgeLens(key: keyof Knowledges) {
  const update = useActiveCharacterUpdate();
  const [terms, view] = useKnowledgeTerms(key);
  const setValue = (value: number) => {
    update({ kind: 'setKnowledge', args: [key, value] });
  };
  return [sumTerms(terms), setValue, terms, view] as const;
}

export function useSpecificKnowledges() {
  const update = useActiveCharacterUpdate();

  // Resolved values, keyed by name — a flat record of primitives, so useShallow
  // gates the re-render on the values themselves, the affliction included.
  const values = useActiveCharacterSelector(useShallow(getSpecificKnowledgeValues)) ?? NO_VALUES;

  // A name with no entry yet still carries the penalty, same as a held one at 0.
  const untrained = useActiveCharacterSelector((c: Character) => -getMentalAfflictionPenalty(c)) ?? 0;

  const getValue = (name: string) => values[name] ?? untrained;

  const setValue = (name: string, value: number) => {
    update({ kind: 'setSpecificKnowledge', args: [name, value] });
  };

  const add = (name: string) => {
    update({ kind: 'addSpecificKnowledge', args: [name] });
  };

  const remove = (name: string) => {
    update({ kind: 'removeSpecificKnowledge', args: [name] });
  };

  return { names: Object.keys(values), getValue, setValue, add, remove } as const;
}

// One knowledge's breakdown, gated on a digest of the terms — see useSkillLens.
export function useKnowledgeTerms(name: string) {
  const terms: Term[] = useActiveCharacterDerived(getKnowledgeTerms(name), termsDigest) ?? [];
  return [terms, termsView(terms)] as const;
}
