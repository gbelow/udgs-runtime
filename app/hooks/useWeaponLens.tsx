import {
  equipWeapon,
  getCharacterWeapons,
  unequipWeapon,
  AttackVariant,
  getAttacksList,
  getAttackValues,
  spendAttackResources,
} from "../domain/character/commands";
import { getSTR, } from "../domain/character/lenses/characteristics";
import { getWeaponAttackRows, WeaponAttackRow } from "../domain/character/lenses/gear";
import { Character, Weapon, WeaponAttack } from "../domain/types";
import { isCampaignCharacter } from "../domain/utils";
import { rollFull } from "../domain/combat/dice";
import { useAppStore } from "../stores/useAppStore";
import { readActiveCharacter, useActiveCharacterSelector, useActiveCharacterUpdate } from "./useActiveCharacterSelector";

// Stable default for the no-active-character case.
const EMPTY_WEAPONS: Record<string, Weapon> = {};

export function useWeaponLens() {
  const update = useActiveCharacterUpdate();
  const tab = useAppStore((s) => s.selectedGameTab);

  // getCharacterWeapons returns the state-held weapons record ref, so Object.is
  // gates re-renders to actual weapons changes (equip/unequip produce a new ref).
  const weapons: Record<string, Weapon> =
    useActiveCharacterSelector((c: Character) => getCharacterWeapons(c)) ?? EMPTY_WEAPONS;

  // The attack table depends on STR (via the STRmod rule) as well as on the
  // weapons record. Subscribe to STR as a primitive so a STR change re-renders
  // the table; the row arrays themselves are freshly allocated and so cannot go
  // through the store selector (Object.is) — same reason as term arrays.
  useActiveCharacterSelector((c: Character) => getSTR(c));

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

  const getVariantsList = (atk: WeaponAttack) => {
    const c = readActiveCharacter(tab);
    if (!c) return;
    return getAttacksList({ atk })(c);
  };

  // Fully-computed rows of a weapon's attack table. Every number is final —
  // WeaponPanel renders them and does no arithmetic of its own.
  const getAttackRows = (weapon: Weapon): WeaponAttackRow[] => {
    const c = readActiveCharacter(tab);
    if (!c) return [];
    return getWeaponAttackRows(weapon)(c);
  };

  return { weapons, equip, unequip, attack, getVariantsList, getAttackRows } as const;
}
