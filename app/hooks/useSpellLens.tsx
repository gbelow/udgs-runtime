import { getSpellCatalogRows, getSpellSheetRows, SpellCatalogRow, SpellSheetRow } from "../domain/character/lenses/spells";
import type { SpellKey } from "../domain/spells";
import { Character, SpellMethod } from "../domain/types";
import { useActiveCharacterDerived, useActiveCharacterUpdate } from "./useActiveCharacterSelector";

// Same shape as useAbilityLens: both projections depend on the character and
// are gated on a digest of themselves.
export function useSpellLens() {
  const update = useActiveCharacterUpdate();

  const catalog: SpellCatalogRow[] =
    useActiveCharacterDerived((c: Character) => getSpellCatalogRows(c), JSON.stringify) ?? [];

  const learned: SpellSheetRow[] =
    useActiveCharacterDerived((c: Character) => getSpellSheetRows(c), JSON.stringify) ?? [];

  const learn = (key: SpellKey, method: SpellMethod) => {
    update({ kind: 'learnSpell', args: [key, method] });
  };

  const forget = (key: SpellKey) => {
    update({ kind: 'forgetSpell', args: [key] });
  };

  const practice = (key: SpellKey, delta: number) => {
    update({ kind: 'practiceSpell', args: [key, delta] });
  };

  const release = (key: SpellKey) => {
    update({ kind: 'releaseSpell', args: [key] });
  };

  return { catalog, learned, learn, forget, practice, release } as const;
}
