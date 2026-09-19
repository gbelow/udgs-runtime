import { useShallow } from "zustand/shallow";
import { doffArmor, equipArmor } from "../domain/character/commands";
import { ArmorPanelView, getArmorPanel, getEquipView, WearView } from "../domain/character/lenses/armor";
import { DamageTierRow, getDamageTiers } from "../domain/character/lenses/gear";
import { Character } from "../domain/types";
import { useAppStore } from "../stores/useAppStore";
import { useActiveCharacterDerived, useActiveCharacterSelector, useActiveCharacterUpdate } from "./useActiveCharacterSelector";
import { usePendingItem } from "./useItemLens";

// Stable default for the no-active-character case.
const BARE: ArmorPanelView = { name: 'Skin', worn: null, burdenPenalty: 0, deflection: 4, properties: '', notes: '' };

// The armor as the body presents it — the worn item's, or the creature's own —
// in one shape gated on a digest of itself (cf. useWeaponLens). Armor goes on
// where the item is, in the container or hands panels, or straight from the
// catalog pick here — the panel is a destination for it like a slot group is;
// here is also where it comes off.
export function useArmorLens() {
  const update = useActiveCharacterUpdate();
  const pending = useAppStore((s) => s.pendingItem);
  const setPending = useAppStore((s) => s.setPendingItem);
  const pendingItem = usePendingItem();
  const fromCatalog = pending?.source === 'catalog' ? pendingItem : null;

  const panel: ArmorPanelView = useActiveCharacterDerived(getArmorPanel, JSON.stringify) ?? BARE;

  // Whether the catalog pick could be put straight on; null when there is no
  // pick or it is not armor.
  const equipView: WearView | null =
    useActiveCharacterSelector(useShallow((c: Character) => (fromCatalog ? getEquipView(c, fromCatalog) : null))) ?? null;

  const drop = () => {
    update(doffArmor(null));
    if (pending?.source === 'worn') setPending(null);
  };

  // Puts the catalog pick on. The pick stays pending, as it does when placed
  // in a slot, so the same armor can dress the next character too.
  const equip = () => {
    if (fromCatalog) update(equipArmor(fromCatalog));
  };

  return { panel, equipView, equip, drop } as const;
}

// combat.tex "Damage Tiers" — the full table, computed in the domain.
export function useDamageTiers(): DamageTierRow[] {
  // Gated on a digest of the rows themselves rather than on the armor and TGH
  // the table happens to read today, so a tier that starts depending on
  // something else stays fresh without anyone remembering to subscribe to it.
  return useActiveCharacterDerived(getDamageTiers, JSON.stringify) ?? [];
}
