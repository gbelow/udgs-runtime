import { useMemo } from "react";
import { addItemToContainer, removeItemFromContainer, drawItem, storeItem } from "../domain/item/commands";
import { getCatalogItem, getHeldItem, getItemCatalogRows, ItemCatalogRow } from "../domain/item/lenses";
import { Item, SlotKind } from "../domain/types";
import { useAppStore } from "../stores/useAppStore";
import { useActiveCharacterSelector, useActiveCharacterUpdate } from "./useActiveCharacterSelector";

// The catalog is static, so it is projected once per module rather than once
// per render.
const CATALOG_ROWS: ItemCatalogRow[] = getItemCatalogRows();

// The pending selection as the item it would place — what the container and
// hands panels test each destination against. A catalog pick is stamped
// afresh here and again on placement, so no two placements share an id; a
// stack from the hands is the stack itself, so putting it away keeps its id.
export function usePendingItem(): Item | null {
  const pending = useAppStore((s) => s.pendingItem);
  const heldId = pending?.source === 'hand' ? pending.itemId : '';
  const held = useActiveCharacterSelector((c) => (heldId ? getHeldItem(c, heldId) ?? null : null));
  return useMemo(() => {
    if (!pending) return null;
    if (pending.source === 'hand') return held;
    return getCatalogItem(pending.key, pending.amount) ?? null;
  }, [pending, held]);
}

// Picking an item, then a destination: the sidebar or hands panel sets the
// selection, the container or hands panel places it. Every half goes through
// the active-character adapters, so this serves the edit sheet and a
// character in combat alike.
export function useItemLens() {
  const update = useActiveCharacterUpdate();
  const pending = useAppStore((s) => s.pendingItem);
  const setPending = useAppStore((s) => s.setPendingItem);
  const pendingItem = usePendingItem();

  const select = (key: string, amount = 1) => {
    setPending({ source: 'catalog', key, amount: Math.max(1, Math.floor(amount) || 1) });
  };

  const setAmount = (amount: number) => {
    if (pending?.source === 'catalog') select(pending.key, amount);
  };

  // A stack in the hands, waiting for the slot group it goes into.
  const selectHeld = (itemId: string) => {
    setPending({ source: 'hand', itemId });
  };

  const clear = () => setPending(null);

  const place = (containerKey: string, slot: SlotKind) => {
    if (!pending) return;
    if (pending.source === 'hand') {
      update(storeItem(pending.itemId, containerKey, slot));
      clear();
      return;
    }
    const item = getCatalogItem(pending.key, pending.amount);
    if (!item) return;
    update(addItemToContainer(containerKey, slot, item));
  };

  const remove = (containerKey: string, itemId: string, amount?: number) => {
    update(removeItemFromContainer(containerKey, itemId, amount));
  };

  const draw = (containerKey: string, itemId: string) => {
    update(drawItem(containerKey, itemId));
  };

  return { catalog: CATALOG_ROWS, pending, pendingItem, select, setAmount, selectHeld, clear, place, remove, draw } as const;
}
