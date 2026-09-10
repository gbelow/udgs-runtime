import {
  equipWeapon,
  unequipWeapon,
  getAttackValues,
  spendAttackResources,
} from "../domain/character/commands";
import {
  AttackVariant,
  getWeaponPanels,
  getWeaponPanelsDigest,
  WeaponPanelView,
} from "../domain/character/lenses/gear";
import { Weapon } from "../domain/types";
import { isCampaignCharacter } from "../domain/utils";
import { rollFull } from "../domain/combat/dice";
import { useAppStore } from "../stores/useAppStore";
import { readActiveCharacter, useActiveCharacterDerived, useActiveCharacterUpdate } from "./useActiveCharacterSelector";

export function useWeaponLens() {
  const update = useActiveCharacterUpdate();
  const tab = useAppStore((s) => s.selectedGameTab);

  // Every equipped weapon, its attack rows and each row's variants, in one
  // shape gated on a digest of itself. Digesting the output rather than the
  // inputs is the point: the old version subscribed to the weapons record and
  // STR by hand, which was correct only for as long as those stayed the whole
  // dependency set.
  const panels: WeaponPanelView[] =
    useActiveCharacterDerived(getWeaponPanels, getWeaponPanelsDigest) ?? [];

  const equip = (newValue: Weapon) => {
    update(equipWeapon(newValue));
  };

  const unequip = (weaponKey: string) => {
    update(unequipWeapon(weaponKey));
  };

  const attack = (atk: AttackVariant, type: string, weapon: string) => {
    const active = readActiveCharacter(tab);
    if (!active || !isCampaignCharacter(active)) return;
    const newCharacter = update(spendAttackResources(atk));
    if (!newCharacter) return;
    const roll = rollFull(Math.random);
    return getAttackValues(atk, type, weapon, roll)(newCharacter);
  };

  return { panels, equip, unequip, attack } as const;
}
