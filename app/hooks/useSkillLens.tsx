import { skillLenses, skillTermGetters, sumTerms, Term, termsDigest, termsView } from "../domain/character/lenses";
import { getSituationalAfflictions } from "../domain/combat/rules/situational";
import { Character, Skills } from "../domain/types";
import { useActiveCharacterDerived, useActiveCharacterUpdate } from "./useActiveCharacterSelector";

export function useSkillLens(skillName: keyof Skills) {
  const lens = skillLenses[skillName];
  const update = useActiveCharacterUpdate();

  // Per-term breakdown, feeding the value, the tooltip and the affliction
  // colouring in SkillTooltip, with what the fight puts on the character
  // beyond the sheet. Gated on a digest of the terms rather than on their sum:
  // two modifiers that cancel, a renamed trainable, or a term crossing zero
  // all change what is displayed without moving the sum. `?.` guards keys not
  // in the registry.
  const terms: Term[] =
    useActiveCharacterDerived(
      (c: Character, fight) => skillTermGetters[skillName]?.(c, getSituationalAfflictions(fight, c.id)) ?? [],
      termsDigest,
    ) ?? [];

  const setValue = (newValue: number) => {
    update((c) => lens.set(c, newValue));
  };

  return [sumTerms(terms), setValue, terms, termsView(terms)] as const;
}
