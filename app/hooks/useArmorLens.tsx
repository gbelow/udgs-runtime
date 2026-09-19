import { doffArmor } from "../domain/character/commands";
import { ArmorPanelView, getArmorPanel } from "../domain/character/lenses/armor";
import { DamageTierRow, getDamageTiers } from "../domain/character/lenses/gear";
import { useAppStore } from "../stores/useAppStore";
import { useActiveCharacterDerived, useActiveCharacterUpdate } from "./useActiveCharacterSelector";

// Stable default for the no-active-character case.
const BARE: ArmorPanelView = { name: 'Skin', worn: null, burdenPenalty: 0, deflection: 4, properties: '', notes: '' };

// The armor as the body presents it — the worn item's, or the creature's own —
// in one shape gated on a digest of itself (cf. useWeaponLens). Putting armor
// on happens where the item is, in the container or hands panels; here it
// only comes off.
export function useArmorLens() {
  const update = useActiveCharacterUpdate();
  const pending = useAppStore((s) => s.pendingItem);
  const setPending = useAppStore((s) => s.setPendingItem);

  const panel: ArmorPanelView = useActiveCharacterDerived(getArmorPanel, JSON.stringify) ?? BARE;

  const drop = () => {
    update(doffArmor(null));
    if (pending?.source === 'worn') setPending(null);
  };

  return { panel, drop } as const;
}

// combat.tex "Damage Tiers" — the full table, computed in the domain.
export function useDamageTiers(): DamageTierRow[] {
  // Gated on a digest of the rows themselves rather than on the armor and TGH
  // the table happens to read today, so a tier that starts depending on
  // something else stays fresh without anyone remembering to subscribe to it.
  return useActiveCharacterDerived(getDamageTiers, JSON.stringify) ?? [];
}
