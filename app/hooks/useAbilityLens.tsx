import { isChargedIn } from "../domain/scene/rules/started";
import { forgetAbility, learnAbility, toggleAbility, useAbility } from "../domain/character/commands";
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
    useActiveCharacterDerived((c: Character, fight) => getAbilityCatalogRows(c, isChargedIn(fight)), JSON.stringify) ?? [];

  const learned: AbilityFamilyView[] =
    useActiveCharacterDerived((c: Character, fight) => getLearnedAbilityRows(c, isChargedIn(fight)), JSON.stringify) ?? [];

  const learn = (key: AbilityKey) => {
    update(learnAbility(key));
  };

  const forget = (key: AbilityKey) => {
    update(forgetAbility(key));
  };

  const toggle = (key: AbilityKey) => {
    update(toggleAbility(key));
  };

  const use = (key: AbilityKey) => {
    update(useAbility(key));
  };

  return { catalog, learned, learn, forget, toggle, use } as const;
}
