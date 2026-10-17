import { toast } from "sonner";
import { createProfile, pickProfile, renameProfile, setDicePlace, type ActionResult } from "../actions";
import { getProfileNameBar, type DicePlace, type Profile } from "../domain/profiles";
import { useAppStore } from "../stores/useAppStore";

// The id of the profile picked at this screen, or null before one is.
export function useProfileId(): string | null {
  return useAppStore((s) => s.profile?.id ?? null);
}

// Where whoever is at this screen rolls their dice.
export function useDicePlace(): DicePlace {
  return useAppStore((s) => s.profile?.dice ?? 'screen');
}

// The profile picked at this screen, the others there are, and picking,
// making and renaming one. Picking or making one fetches again every list
// that depends on who is at the screen.
export function useProfile() {
  const profile = useAppStore((s) => s.profile);
  const profiles = useAppStore((s) => s.profileList);
  const setProfile = useAppStore((s) => s.setProfile);
  const refresh = useAppStore((s) => s.updateProfileList);
  const refreshCharacters = useAppStore((s) => s.updatePlayerCharacterList);
  const refreshCollections = useAppStore((s) => s.updateCollections);
  const refreshCampaigns = useAppStore((s) => s.updateCampaignList);
  const dev = useAppStore((s) => s.devServer);

  const switchTo = async (pending: Promise<ActionResult<Profile>>) => {
    const res = await pending;
    if (!res.ok) { toast.error(res.error); return; }
    setProfile(res.data);
    refresh();
    refreshCharacters();
    refreshCollections();
    refreshCampaigns();
  };

  const rename = async (name: string) => {
    if (!profile || name.trim() === profile.name) return;
    const res = await renameProfile(profile.id, name);
    if (!res.ok) { toast.error(res.error); return; }
    setProfile(res.data);
    refresh();
  };

  const setDice = async (dice: DicePlace) => {
    const res = await setDicePlace(dice);
    if (!res.ok) { toast.error(res.error); return; }
    setProfile(res.data);
  };

  return {
    profile, profiles, rename, setDice, nameBar: getProfileNameBar, dev,
    pick: (id: string) => switchTo(pickProfile(id)),
    create: (name: string) => switchTo(createProfile(name)),
  } as const;
}
