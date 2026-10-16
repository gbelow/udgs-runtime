import { canControl, getControlBar, getOwner } from "../domain/profiles";
import { TAB_OWNER, useAppStore } from "../stores/useAppStore";
import { useCampaignStore } from "../stores/useCampaignStore";
import { useCombatStore } from "../stores/useCombatStore";
import { useCampaignRole } from "./useRole";
import { useProfileId } from "./useProfile";

// Whether whoever is at the screen plays a character in play, asked of its
// id when it is asked: in a handler, as of the click.
export function useControlCheck(): (id: string) => boolean {
  const role = useCampaignRole();
  const profile = useProfileId();
  const listed = useAppStore((s) => s.playerCharacterList);
  return (id) => canControl(getOwner(id, useCampaignStore.getState().owners, listed), profile, role);
}

// Why whoever is at the screen cannot play character `id`, or null when they
// can; a sheet nobody plays, being edited, made or a race's, is always
// theirs to change.
export function useControlBar(id: string | null): string | null {
  const role = useCampaignRole();
  const profile = useProfileId();
  const listed = useAppStore((s) => s.playerCharacterList);
  const profiles = useAppStore((s) => s.profileList);
  const owner = useCampaignStore((s) => (id ? getOwner(id, s.owners, listed) : undefined));
  return id === null ? null : getControlBar(owner, profile, role, profiles);
}

// The same, for the character the tab shows.
export function useActiveControlBar(): string | null {
  const owner = TAB_OWNER[useAppStore((s) => s.selectedGameTab)];
  const campaignId = useCampaignStore((s) => s.activeCharacterId);
  const combatId = useCombatStore((s) => s.activeCharacterId);
  return useControlBar(owner === "campaign" ? campaignId : owner === "combat" ? combatId : null);
}
