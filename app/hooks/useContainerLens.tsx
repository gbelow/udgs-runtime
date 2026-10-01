import { useShallow } from "zustand/shallow";
import { putOnFromCatalog, takeOffContainer } from "../domain/item/commands";
import { getPutOnView } from "../domain/item/rules/containers";
import type { MoveView } from "../domain/item/rules/costs";
import {
  BurdenView,
  ContainerPanelView,
  getBurden,
  getContainerPanels,
} from "../domain/item/projections/containers";
import { Character } from "../domain/types";
import { useAppStore } from "../stores/useAppStore";
import { useActiveCharacterDerived, useActiveCharacterSelector, useActiveCharacterUpdate } from "./useActiveCharacterSelector";
import { usePendingItem } from "./useItemLens";

// Stable default for the no-active-character case.
const NO_BURDEN: BurdenView = { penalty: 0, lame: false, label: 'none' };

// Reads and writes go through the active-character adapters, so the same hook
// serves the edit sheet and a character in combat without knowing which.
// Containers go on where the item is — a slot, the hands — or straight from
// the catalog pick here, the way armor does (cf. useArmorLens).
export function useContainerLens() {
  const update = useActiveCharacterUpdate();
  const pending = useAppStore((s) => s.pendingItem);
  const pendingItem = usePendingItem();
  const fromCatalog = pending?.source === 'catalog' ? pendingItem : null;

  // Every open container, its slot groups and their stacks, in one shape
  // gated on a digest of itself (cf. useWeaponLens). The pending item is an
  // input to the projection — each group reports whether it would take it —
  // and the digest covers that too, so a change of selection re-renders.
  const panels: ContainerPanelView[] =
    useActiveCharacterDerived((c: Character) => getContainerPanels(c, pendingItem ?? undefined), JSON.stringify) ?? [];

  // gear.tex "Containers and burden" — the character-wide penalty.
  const burden: BurdenView =
    useActiveCharacterSelector(useShallow((c: Character) => getBurden(c))) ?? NO_BURDEN;

  // Whether the catalog pick could be put straight on; null when there is no
  // pick or it is not a container one puts on.
  const putOnView: MoveView | null =
    useActiveCharacterSelector(useShallow((c: Character) => (fromCatalog ? getPutOnView(c, null, fromCatalog) : null))) ?? null;

  // Puts the catalog pick on. The pick stays pending, as it does when placed
  // in a slot, so the same container can go on the next character too.
  const putOn = () => {
    if (fromCatalog) update(putOnFromCatalog(fromCatalog));
  };

  const takeOff = (key: string) => {
    update(takeOffContainer(key));
  };

  return { panels, burden, putOnView, putOn, takeOff } as const;
}
