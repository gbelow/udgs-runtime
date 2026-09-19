import {
  getWeaponPanels,
  getWeaponPanelsDigest,
  WeaponPanelView,
} from "../domain/character/lenses/gear";
import { useActiveCharacterDerived } from "./useActiveCharacterSelector";

export function useWeaponLens() {
  // Every weapon in the hands, its attack rows and each row's variants, in one
  // shape gated on a digest of itself. Digesting the output rather than the
  // inputs is the point: the old version subscribed to the weapons record and
  // STR by hand, which was correct only for as long as those stayed the whole
  // dependency set.
  const panels: WeaponPanelView[] =
    useActiveCharacterDerived(getWeaponPanels, getWeaponPanelsDigest) ?? [];

  return { panels } as const;
}
