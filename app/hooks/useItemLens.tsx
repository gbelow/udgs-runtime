import { useMemo } from "react";
import { addItemToContainer, removeItemFromContainer, drawItem, storeItem } from "../domain/item/commands";
import { doffArmor, wearFromContainer } from "../domain/character/commands";
import { GEAR_SIZE, getCatalogItem, getHeldItem, getItemCatalogRows, ItemCatalogRow } from "../domain/item/lenses";
import { getSize } from "../domain/character/lenses/misc";
import { Item, SlotKind } from "../domain/types";
import { useAppStore } from "../stores/useAppStore";
import { useActiveCharacterSelector, useActiveCharacterUpdate } from "./useActiveCharacterSelector";

// The catalog is static, so it is projected once per size picked rather than
// once per render.
const catalogRowsAt = new Map<number, ItemCatalogRow[]>();
function getCatalogRows(scale: number): ItemCatalogRow[] {
  let rows = catalogRowsAt.get(scale);
  if (!rows) {
    rows = getItemCatalogRows(scale);
    catalogRowsAt.set(scale, rows);
  }
  return rows;
}

// The pending selection as the item it would place — what the container and
// hands panels test each destination against. A catalog pick is stamped
// afresh here and again on placement, so no two placements share an id; a
// stack from the hands or the armor on the back is the stack itself, so
// putting it away keeps its id.
export function usePendingItem(): Item | null {
  const pending = useAppStore((s) => s.pendingItem);
  const heldId = pending?.source === 'hand' ? pending.itemId : '';
  const held = useActiveCharacterSelector((c) => (heldId ? getHeldItem(c, heldId) ?? null : null));
  const worn = useActiveCharacterSelector((c) => (pending?.source === 'worn' ? c.worn : null));
  return useMemo(() => {
    if (!pending) return null;
    if (pending.source === 'hand') return held;
    if (pending.source === 'worn') return worn ?? null;
    return getCatalogItem(pending.key, pending.amount, pending.scale) ?? null;
  }, [pending, held, worn]);
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
  // Gear is picked at the character's own size unless another is asked for.
  const ownSize = useActiveCharacterSelector(getSize) ?? GEAR_SIZE;
  const scale = pending?.source === 'catalog' ? pending.scale : ownSize;
  const amount = pending?.source === 'catalog' ? pending.amount : 1;
  const catalog = getCatalogRows(scale);

  const select = (key: string, at: { amount?: number; scale?: number } = {}) => {
    setPending({
      source: 'catalog',
      key,
      amount: Math.max(1, Math.floor(at.amount ?? amount) || 1),
      scale: Math.max(1, Math.min(7, Math.floor(at.scale ?? scale) || scale)),
    });
  };

  const setAmount = (amount: number) => {
    if (pending?.source === 'catalog') select(pending.key, { amount });
  };

  const setScale = (scale: number) => {
    if (pending?.source === 'catalog') select(pending.key, { scale });
  };

  // A stack in the hands, waiting for the slot group it goes into.
  const selectHeld = (itemId: string) => {
    setPending({ source: 'hand', itemId });
  };

  // The worn armor, waiting for the slot group it is put away in.
  const selectWorn = () => {
    setPending({ source: 'worn' });
  };

  const clear = () => setPending(null);

  const place = (containerKey: string, slot: SlotKind) => {
    if (!pending) return;
    if (pending.source === 'hand') {
      update(storeItem(pending.itemId, containerKey, slot));
      clear();
      return;
    }
    if (pending.source === 'worn') {
      update(doffArmor({ containerKey, slot }));
      clear();
      return;
    }
    const item = getCatalogItem(pending.key, pending.amount, pending.scale);
    if (!item) return;
    update(addItemToContainer(containerKey, slot, item));
  };

  const remove = (containerKey: string, itemId: string, amount?: number) => {
    update(removeItemFromContainer(containerKey, itemId, amount));
  };

  const draw = (containerKey: string, itemId: string) => {
    update(drawItem(containerKey, itemId));
  };

  const wear = (containerKey: string, itemId: string) => {
    update(wearFromContainer(containerKey, itemId));
  };

  return { catalog, pending, pendingItem, amount, scale, select, setAmount, setScale, selectHeld, selectWorn, clear, place, remove, draw, wear } as const;
}
