import { useMemo } from "react";
import { addItemToContainer, removeItemFromContainer } from "../domain/item/commands";
import { getCatalogItem, getItemCatalogRows, ItemCatalogRow } from "../domain/item/lenses";
import { Item, SlotKind } from "../domain/types";
import { useAppStore } from "../stores/useAppStore";
import { useActiveCharacterUpdate } from "./useActiveCharacterSelector";

// The catalog is static, so it is projected once per module rather than once
// per render.
const CATALOG_ROWS: ItemCatalogRow[] = getItemCatalogRows();

// The pending selection as the item it would stamp — what the container panel
// tests each slot group against. Memoized on the selection so the same
// choice is one object across renders; the stack actually placed is stamped
// afresh so no two placements share an id.
export function usePendingItem(): Item | null {
  const pending = useAppStore((s) => s.pendingItem);
  return useMemo(
    () => (pending ? getCatalogItem(pending.key, pending.amount) ?? null : null),
    [pending],
  );
}

// Picking an item, then a slot group: the sidebar sets the selection, the
// container panel places it. Both halves go through the active-character
// adapters, so this serves the edit sheet and a character in combat alike.
export function useItemLens() {
  const update = useActiveCharacterUpdate();
  const pending = useAppStore((s) => s.pendingItem);
  const setPending = useAppStore((s) => s.setPendingItem);
  const pendingItem = usePendingItem();

  const select = (key: string, amount = 1) => {
    setPending({ key, amount: Math.max(1, Math.floor(amount) || 1) });
  };

  const setAmount = (amount: number) => {
    if (pending) select(pending.key, amount);
  };

  const clear = () => setPending(null);

  const place = (containerKey: string, slot: SlotKind) => {
    if (!pending) return;
    const item = getCatalogItem(pending.key, pending.amount);
    if (!item) return;
    update(addItemToContainer(containerKey, slot, item));
  };

  const remove = (containerKey: string, itemId: string, amount?: number) => {
    update(removeItemFromContainer(containerKey, itemId, amount));
  };

  return { catalog: CATALOG_ROWS, pending, pendingItem, select, setAmount, clear, place, remove } as const;
}
