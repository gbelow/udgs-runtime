import { isChargedIn } from "../domain/scene/rules/started";
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
    update({ kind: 'learnAbility', args: [key] });
  };

  const forget = (key: AbilityKey) => {
    update({ kind: 'forgetAbility', args: [key] });
  };

  const toggle = (key: AbilityKey) => {
    update({ kind: 'toggleAbility', args: [key] });
  };

  const use = (key: AbilityKey) => {
    update({ kind: 'useAbility', args: [key] });
  };

  return { catalog, learned, learn, forget, toggle, use } as const;
}
