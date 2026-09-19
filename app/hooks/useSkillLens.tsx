import { skillLenses, skillTermGetters, Term, termsDigest, termsView } from "../domain/character/lenses";
import { Character, Skills } from "../domain/types";
import { useActiveCharacterDerived, useActiveCharacterSelector, useActiveCharacterUpdate } from "./useActiveCharacterSelector";

export function useSkillLens(skillName: keyof Skills) {
  const lens = skillLenses[skillName];
  const update = useActiveCharacterUpdate();

  // Select the derived value INSIDE the store selector so re-renders are gated
  // on the computed output (Object.is), not the whole-character reference —
  // a one-field mutation does not drag every skill subscriber into a re-render.
  const value = useActiveCharacterSelector((c: Character) => lens.get(c)) ?? 0;

  // Per-term breakdown, feeding both the tooltip and the affliction colouring in
  // SkillTooltip. Gated on a digest of the terms rather than on `value`: two
  // modifiers that cancel, a renamed trainable, or a term crossing zero all
  // change what is displayed without moving the sum. `?.` guards keys not in
  // the registry.
  const terms: Term[] =
    useActiveCharacterDerived((c: Character) => skillTermGetters[skillName]?.(c) ?? [], termsDigest) ?? [];

  const setValue = (newValue: number) => {
    update((c) => lens.set(c, newValue));
  };

  return [value, setValue, terms, termsView(terms)] as const;
}
