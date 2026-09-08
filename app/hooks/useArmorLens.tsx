import { equipArmor } from "../domain/character/commands";
import { DamageTierRow, getDamageTiers } from "../domain/character/lenses/gear";
import { getTGH } from "../domain/character/lenses/misc";
import { useAppStore } from "../stores/useAppStore";
import { Armor, ArmorSchema, Character } from "../domain/types";
import { readActiveCharacter, useActiveCharacterSelector, useActiveCharacterUpdate } from "./useActiveCharacterSelector";

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
  const tab = useAppStore((s) => s.selectedGameTab);

  // The table depends on the armor object and on derived TGH. Subscribe to both
  // so either one changing re-renders; the row array is freshly allocated and
  // so cannot itself go through the store selector (Object.is).
  useActiveCharacterSelector((c: Character) => c.armor);
  useActiveCharacterSelector((c: Character) => getTGH(c));

  const active = readActiveCharacter(tab);
  return active ? getDamageTiers(active) : [];
}
