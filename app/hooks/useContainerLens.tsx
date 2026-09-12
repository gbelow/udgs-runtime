import { useShallow } from "zustand/shallow";
import { equipContainer, unequipContainer } from "../domain/item/commands";
import {
  BurdenView,
  ContainerPanelView,
  getBurden,
  getCatalogContainer,
  getContainerCatalogPanels,
  getContainerPanels,
} from "../domain/item/lenses";
import { Character } from "../domain/types";
import { useActiveCharacterDerived, useActiveCharacterSelector, useActiveCharacterUpdate } from "./useActiveCharacterSelector";

// Stable default for the no-active-character case.
const NO_BURDEN: BurdenView = { penalty: 0, level: 'light', label: 'light' };

// The catalog is static, so it is projected once per module rather than once
// per render.
const CATALOG_PANELS: ContainerPanelView[] = getContainerCatalogPanels();

// Reads and writes go through the active-character adapters, so the same hook
// serves the edit sheet and a character in combat without knowing which.
export function useContainerLens() {
  const update = useActiveCharacterUpdate();

  // Every equipped container, its slot groups and their stacks, in one shape
  // gated on a digest of itself (cf. useWeaponLens).
  const panels: ContainerPanelView[] =
    useActiveCharacterDerived(getContainerPanels, JSON.stringify) ?? [];

  // gear.tex "Containers and burden" — the character-wide level.
  const burden: BurdenView =
    useActiveCharacterSelector(useShallow((c: Character) => getBurden(c))) ?? NO_BURDEN;

  const equip = (catalogKey: string) => {
    const container = getCatalogContainer(catalogKey);
    if (!container) return;
    update(equipContainer(catalogKey, container));
  };

  const unequip = (key: string) => {
    update(unequipContainer(key));
  };

  return { panels, burden, catalog: CATALOG_PANELS, equip, unequip } as const;
}
