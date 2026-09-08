import { skillLenses, skillTermGetters, Term } from "../domain/character/lenses";
import { Character, Skills } from "../domain/types";
import { useAppStore } from "../stores/useAppStore";
import { readActiveCharacter, useActiveCharacterSelector, useActiveCharacterUpdate } from "./useActiveCharacterSelector";

export function useSkillLens(skillName: keyof Skills) {
  const lens = skillLenses[skillName];
  const update = useActiveCharacterUpdate();
  const tab = useAppStore((s) => s.selectedGameTab);

  // Select the derived value INSIDE the store selector so re-renders are gated
  // on the computed output (Object.is), not the whole-character reference —
  // a one-field mutation does not drag every skill subscriber into a re-render.
  const value = useActiveCharacterSelector((c: Character) => lens.get(c)) ?? 0;

  // Per-term breakdown for the tooltip. Derived non-reactively from the active
  // character snapshot: term getters allocate a fresh array of fresh objects on
  // every call, which defeats useShallow (one-level) and trips
  // useSyncExternalStore's getServerSnapshot cache check. Gating the component's
  // re-render on `value` above keeps this fresh — terms only changes when the
  // inputs that move `value` move. `?.` guards keys not in the registry.
  const active = readActiveCharacter(tab);
  const terms: Term[] = active ? (skillTermGetters[skillName]?.(active) ?? []) : [];

  const setValue = (newValue: number) => {
    update((c) => lens.set(c, newValue));
  };

  return [value, setValue, terms] as const;
}
