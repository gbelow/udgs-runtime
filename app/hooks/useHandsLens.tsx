import { holdItem, regripItem, dropItem, putOnFromHands, slingShield, unslingShield, throwOffShield } from "../domain/item/commands";
import { wearFromHands } from "../domain/character/commands";
import { getCatalogItem } from "../domain/item/rules/items";
import { Grip } from "../domain/item/rules/hands";
import { getHandsPanel, HandsPanelView } from "../domain/item/projections/hands";
import type { Character, CharacterUpdater } from "../domain/types";
import type { Updater } from "../domain/combat/types";
import { useAppStore } from "../stores/useAppStore";
import { useCombatStore } from "../stores/useCombatStore";
import { dropToFloor, throwOffShieldToFloor } from "../domain/combat/commands/floor";
import { useActiveCharacterDerived, useActiveCharacterUpdate } from "./useActiveCharacterSelector";
import { usePendingItem } from "./useItemLens";

const EMPTY: HandsPanelView = { hands: [], held: [], back: null, freeHolding: 0, canHold: null, lamingHold: false };

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

  // in a fight what is let go of lands on the floor; on the sheet it is gone
  const letGo = (toFloor: (characterId: string) => Updater, gone: CharacterUpdater) => {
    const combat = useCombatStore.getState();
    if (tab !== "edit" && combat.activeCharacterId) combat.updateCombatState(toFloor(combat.activeCharacterId));
    else update(gone);
  };

  const drop = (itemId: string) => {
    letGo((id) => dropToFloor(id, itemId), dropItem(itemId));
    if (pending?.source === 'hand' && pending.itemId === itemId) setPending(null);
  };

  const wear = (itemId: string) => {
    update(wearFromHands(itemId));
    if (pending?.source === 'hand' && pending.itemId === itemId) setPending(null);
  };

  const putOn = (itemId: string) => {
    update(putOnFromHands(itemId));
    if (pending?.source === 'hand' && pending.itemId === itemId) setPending(null);
  };

  const sling = (itemId: string) => {
    update(slingShield(itemId));
    if (pending?.source === 'hand' && pending.itemId === itemId) setPending(null);
  };

  const unsling = () => {
    update(unslingShield());
  };

  const throwOff = () => {
    letGo(throwOffShieldToFloor, throwOffShield());
  };

  return { panel, hold, regrip, drop, wear, putOn, sling, unsling, throwOff } as const;
}
