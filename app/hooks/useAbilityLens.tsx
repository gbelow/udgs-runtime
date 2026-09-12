import { forgetAbility, learnAbility, toggleAbility } from "../domain/character/commands";
import { AbilityFamilyView, getAbilityCatalogRows, getLearnedAbilityRows } from "../domain/character/lenses/abilities";
import type { AbilityKey } from "../domain/abilities";
import { Character } from "../domain/types";
import { useActiveCharacterDerived, useActiveCharacterUpdate } from "./useActiveCharacterSelector";

// The catalog rows depend on the character (which stages are learned, which
// is next), so unlike the gear catalogs they are a derived projection rather
// than a module constant. Both shapes are gated on a digest of themselves
// (cf. useContainerLens).
export function useAbilityLens() {
  const update = useActiveCharacterUpdate();

  const catalog: AbilityFamilyView[] =
    useActiveCharacterDerived((c: Character) => getAbilityCatalogRows(c), JSON.stringify) ?? [];

  const learned: AbilityFamilyView[] =
    useActiveCharacterDerived((c: Character) => getLearnedAbilityRows(c), JSON.stringify) ?? [];

  const learn = (key: AbilityKey) => {
    update(learnAbility(key));
  };

  const forget = (key: AbilityKey) => {
    update(forgetAbility(key));
  };

  const toggle = (key: AbilityKey) => {
    update(toggleAbility(key));
  };

  return { catalog, learned, learn, forget, toggle } as const;
}
