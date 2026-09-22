import { useShallow } from "zustand/shallow";
import { equipContainer, unequipContainer } from "../domain/item/commands";
import { getCatalogContainer } from "../domain/item/rules/containers";
import {
  BurdenView,
  ContainerPanelView,
  getBurden,
  getContainerCatalogPanels,
  getContainerPanels,
} from "../domain/item/projections/containers";
import { Character } from "../domain/types";
import { useActiveCharacterDerived, useActiveCharacterSelector, useActiveCharacterUpdate } from "./useActiveCharacterSelector";
import { usePendingItem } from "./useItemLens";

// Stable default for the no-active-character case.
const NO_BURDEN: BurdenView = { penalty: 0, lame: false, label: 'none' };

// The catalog is static, so it is projected once per module rather than once
// per render.
const CATALOG_PANELS: ContainerPanelView[] = getContainerCatalogPanels();

// Reads and writes go through the active-character adapters, so the same hook
// serves the edit sheet and a character in combat without knowing which.
export function useContainerLens() {
  const update = useActiveCharacterUpdate();
  const pendingItem = usePendingItem();

  // Every equipped container, its slot groups and their stacks, in one shape
  // gated on a digest of itself (cf. useWeaponLens). The pending item is an
  // input to the projection — each group reports whether it would take it —
  // and the digest covers that too, so a change of selection re-renders.
  const panels: ContainerPanelView[] =
    useActiveCharacterDerived((c: Character) => getContainerPanels(c, pendingItem ?? undefined), JSON.stringify) ?? [];

  // gear.tex "Containers and burden" — the character-wide penalty.
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
