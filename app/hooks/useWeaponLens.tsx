import { equipWeapon, getCharacterWeapons, unequipWeapon } from "../domain/commands/equipWeapon";
import { Weapon, WeaponSchema } from "../domain/types";
import { useActiveCharacter } from "./useActiveCharacter";

export function useWeaponLens() {
  const { character, update } = useActiveCharacter();

  const weapons: Record<string, Weapon> | {} = getCharacterWeapons(character)

  const equip = (newValue: Weapon) => {
    update(equipWeapon(newValue));
  };

  const unequip = (weaponKey: string) => {
    update(unequipWeapon(weaponKey));
  };

  return {weapons, equip, unequip} as const;
}