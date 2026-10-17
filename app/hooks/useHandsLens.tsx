import { isChargedIn } from "../domain/scene/rules/started";
import { useActingAsGm } from "./useRole";
import { getCatalogItem } from "../domain/item/rules/items";
import { Grip } from "../domain/item/rules/hands";
import { getHandsPanel, HandsPanelView } from "../domain/item/projections/hands";
import type { Character } from "../domain/types";
import type { GearCommand } from "../domain/character/commands/registry";
import type { SceneCommand } from "../domain/scene/commands/registry";
import { isFightTab, useAppStore } from "../stores/useAppStore";
import { useCombatStore } from "../stores/useCombatStore";
import { useSceneDispatch } from "./useSceneDispatch";
import { useActiveCharacterDerived, useActiveInventoryUpdate } from "./useActiveCharacterSelector";
import { usePendingItem } from "./useItemLens";

const EMPTY: HandsPanelView = { hands: [], held: [], back: null, freeHolding: 0, canHold: null, lamingHold: false };

// The hands and what they hold, in one shape gated on a digest of itself (cf.
// useContainerLens). The pending catalog item is an input — the panel says
// whether the hands could take it — so the digest covers that too.
export function useHandsLens() {
  const update = useActiveInventoryUpdate();
  const pending = useAppStore((s) => s.pendingItem);
  const tab = useAppStore((s) => s.selectedGameTab);
  const gm = useActingAsGm();
  const dispatch = useSceneDispatch();
  const setPending = useAppStore((s) => s.setPendingItem);
  const pendingItem = usePendingItem();
  const fromCatalog = pending?.source === 'catalog' ? pendingItem : null;

  const panel: HandsPanelView =
    useActiveCharacterDerived((c: Character, fight) => getHandsPanel(c, isChargedIn(fight), fromCatalog ?? undefined), JSON.stringify) ?? EMPTY;

  // Takes the pending catalog pick straight into the hands.
  const hold = (grip: Grip) => {
    if (pending?.source !== 'catalog') return;
    const item = getCatalogItem(pending.key, pending.amount, pending.scale);
    if (!item) return;
    update({ kind: 'holdItem', args: [item, grip] });
  };

  const regrip = (itemId: string, grip: Grip) => {
    update({ kind: 'regripItem', args: [itemId, grip] });
  };

  // in a fight what is let go of lands on the floor; on the sheet it is gone
  const letGo = (toFloor: (characterId: string) => SceneCommand, gone: GearCommand) => {
    const combat = useCombatStore.getState();
    if (isFightTab(tab) && combat.activeCharacterId) dispatch(toFloor(combat.activeCharacterId));
    else update(gone);
  };

  const drop = (itemId: string) => {
    letGo((id) => ({ kind: 'dropToFloor', args: [id, itemId, gm] }), { kind: 'dropItem', args: [itemId] });
    if (pending?.source === 'hand' && pending.itemId === itemId) setPending(null);
  };

  const wear = (itemId: string) => {
    update({ kind: 'wearFromHands', args: [itemId] });
    if (pending?.source === 'hand' && pending.itemId === itemId) setPending(null);
  };

  const putOn = (itemId: string) => {
    update({ kind: 'putOnFromHands', args: [itemId] });
    if (pending?.source === 'hand' && pending.itemId === itemId) setPending(null);
  };

  const sling = (itemId: string) => {
    update({ kind: 'slingShield', args: [itemId] });
    if (pending?.source === 'hand' && pending.itemId === itemId) setPending(null);
  };

  const unsling = () => {
    update({ kind: 'unslingShield', args: [] });
  };

  const throwOff = () => {
    letGo((id) => ({ kind: 'throwOffShield', args: [id, gm] }), { kind: 'throwOffShield', args: [] });
  };

  return { panel, hold, regrip, drop, wear, putOn, sling, unsling, throwOff } as const;
}
