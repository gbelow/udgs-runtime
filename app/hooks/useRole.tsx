import { getCampaignRole, hasGmTools, type Role } from "../domain/profiles";
import { useAppStore } from "../stores/useAppStore";
import { useCampaignStore } from "../stores/useCampaignStore";
import { useProfileId } from "./useProfile";

// The role of whoever is at the screen in the campaign in play.
export function useCampaignRole(): Role {
  const devServer = useAppStore((s) => s.devServer);
  const profile = useProfileId();
  return useCampaignStore((s) => getCampaignRole(s.file.members, profile, devServer));
}

// Whether whoever is at the screen has the GM mode switch, and whether it is
// on.
export function useRole() {
  const gmTools = hasGmTools(useCampaignRole());
  const gmMode = useAppStore((s) => s.gmMode);
  const setGmMode = useAppStore((s) => s.setGmMode);
  return { gmTools, gm: gmTools && gmMode, setGmMode } as const;
}

// Whether the screen acts as the GM: GM mode is on and the role has it.
export function useActingAsGm(): boolean {
  return useRole().gm;
}
