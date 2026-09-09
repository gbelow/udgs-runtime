import { equipArmor } from "../domain/character/commands";
import { DamageTierRow, getDamageTiers } from "../domain/character/lenses/gear";
import { Armor, ArmorSchema, Character } from "../domain/types";
import { useActiveCharacterDerived, useActiveCharacterSelector, useActiveCharacterUpdate } from "./useActiveCharacterSelector";

// Stable default for the no-active-character case.
const DEFAULT_ARMOR: Armor = ArmorSchema.parse({});

export function useArmorLens() {
  const update = useActiveCharacterUpdate();

  // armor is a state-held object ref — Object.is gates re-renders to actual
  // armor changes (equipArmor produces a new ref via structural sharing).
  const value: Armor =
    useActiveCharacterSelector((c: Character) => c.armor) ?? DEFAULT_ARMOR;

  const setValue = (newValue: Armor) => {
    update(equipArmor(newValue));
  };

  return [value, setValue] as const;
}

// combat.tex "Damage Tiers" — the full table, computed in the domain.
export function useDamageTiers(): DamageTierRow[] {
  // Gated on a digest of the rows themselves rather than on the armor and TGH
  // the table happens to read today, so a tier that starts depending on
  // something else stays fresh without anyone remembering to subscribe to it.
  return useActiveCharacterDerived(getDamageTiers, JSON.stringify) ?? [];
}
