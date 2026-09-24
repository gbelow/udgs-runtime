import { holdItem, regripItem, dropItem } from "../domain/item/commands";
import { wearFromHands } from "../domain/character/commands";
import { getCatalogItem } from "../domain/item/rules/items";
import { Grip } from "../domain/item/rules/hands";
import { getHandsPanel, HandsPanelView } from "../domain/item/projections/hands";
import { Character } from "../domain/types";
import { useAppStore } from "../stores/useAppStore";
import { useCombatStore } from "../stores/useCombatStore";
import { dropToFloor } from "../domain/combat/commands/floor";
import { useActiveCharacterDerived, useActiveCharacterUpdate } from "./useActiveCharacterSelector";
import { usePendingItem } from "./useItemLens";

const EMPTY: HandsPanelView = { hands: [], held: [], freeHolding: 0, canHold: null, lamingHold: false };

// The hands and what they hold, in one shape gated on a digest of itself (cf.
// useContainerLens). The pending catalog item is an input — the panel says
// whether the hands could take it — so the digest covers that too.
export function useHandsLens() {
  const update = useActiveCharacterUpdate();
  const pending = useAppStore((s) => s.pendingItem);
  const tab = useAppStore((s) => s.selectedGameTab);
  const setPending = useAppStore((s) => s.setPendingItem);
  const pendingItem = usePendingItem();
  const fromCatalog = pending?.source === 'catalog' ? pendingItem : null;

  const panel: HandsPanelView =
    useActiveCharacterDerived((c: Character) => getHandsPanel(c, fromCatalog ?? undefined), JSON.stringify) ?? EMPTY;

  // Takes the pending catalog pick straight into the hands.
  const hold = (grip: Grip) => {
    if (pending?.source !== 'catalog') return;
    const item = getCatalogItem(pending.key, pending.amount, pending.scale);
    if (!item) return;
    update(holdItem(item, grip));
  };

  const regrip = (itemId: string, grip: Grip) => {
    update(regripItem(itemId, grip));
  };

  // in a fight what is dropped lands on the floor; on the sheet it is gone
  const drop = (itemId: string) => {
    const combat = useCombatStore.getState();
    if (tab !== "edit" && combat.activeCharacterId) combat.updateCombatState(dropToFloor(combat.activeCharacterId, itemId));
    else update(dropItem(itemId));
    if (pending?.source === 'hand' && pending.itemId === itemId) setPending(null);
  };

  const wear = (itemId: string) => {
    update(wearFromHands(itemId));
    if (pending?.source === 'hand' && pending.itemId === itemId) setPending(null);
  };

  return { panel, hold, regrip, drop, wear } as const;
}
