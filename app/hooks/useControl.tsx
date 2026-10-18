import { toast } from "sonner";
import { getActorBar, getCampaignRole, getOwner, isOwnRoller, type Actor, type Viewer } from "../domain/profiles";
import { TAB_OWNER, useAppStore, useAppStoreApi, type AppState } from "../stores/useAppStore";
import { useCampaignStore, type CampaignStore } from "../stores/useCampaignStore";
import { useCombatStore } from "../stores/useCombatStore";
import { useTableStore } from "../stores/useTableStore";

type ViewerFields = Pick<AppState, "profile" | "devServer" | "gmMode" | "profileList">;

// Profile `profile` at a screen with GM mode `gmMode`, in the campaign in
// play.
const viewerOf = (app: ViewerFields, campaign: CampaignStore, profile: string | null, gmMode: boolean): Viewer => ({
  profile, role: getCampaignRole(campaign.file.members, profile, app.devServer), gmMode, profiles: app.profileList,
  ownerOf: (id) => getOwner(id, campaign.owners),
});

// Who is at the screen, asked when it is asked: in a handler, as of the
// click, so that holding the check costs no subscription.
export function useViewerCheck(): () => Viewer {
  const app = useAppStoreApi();
  return () => { const a = app.getState(); return viewerOf(a, useCampaignStore.getState(), a.profile?.id ?? null, a.gmMode); };
}

// Who is at another screen of the table, by the profile it joined as, asked
// as `useViewerCheck` is.
export function useGuestViewerCheck(): (profile: string, gmMode: boolean) => Viewer {
  const app = useAppStoreApi();
  return (profile, gmMode) => viewerOf(app.getState(), useCampaignStore.getState(), profile, gmMode);
}

// Whether the dice of character `id` are the screen's own to throw
// (`isOwnRoller`), and whether a player plays them, asked as
// `useViewerCheck` is.
export function useRollerCheck(): (id: string) => { own: boolean; played: boolean } {
  const viewer = useViewerCheck();
  return (id) => {
    const v = viewer();
    const owner = v.ownerOf(id);
    return { own: isOwnRoller(owner, v.profile, v.role), played: owner !== undefined };
  };
}

// Why whoever is at the screen cannot act for `actor`, asked as
// `useViewerCheck` is.
function useActorBarCheck(): (actor: Actor) => string | null {
  const viewer = useViewerCheck();
  return (actor) => getActorBar(actor, viewer());
}

// Whether a press or a click acting for `actor` may be made from the screen
// (see `getActorBar`). Refused, why is said.
export function useActGate(): (actor: Actor) => boolean {
  const bar = useActorBarCheck();
  return (actor) => {
    const why = bar(actor);
    if (why) toast.error(`Not yours to do: ${why}.`);
    return why === null;
  };
}

// Why whoever is at the screen cannot act for `actor`, or null when they
// can, kept up to date for a control drawn closed.
export function useActorBar(actor: Actor): string | null {
  const profile = useAppStore((s) => s.profile);
  const devServer = useAppStore((s) => s.devServer);
  const gmMode = useAppStore((s) => s.gmMode);
  const profileList = useAppStore((s) => s.profileList);
  const app = { profile, devServer, gmMode, profileList };
  return useCampaignStore((s) => getActorBar(actor, viewerOf(app, s, profile?.id ?? null, gmMode)));
}

// Whether the screen is shown character `id` as a token only: it joined a
// table, and the character is not one it plays (`getPublicFace`). What is
// worked out against one is an estimate.
export function useIsToken(id: string | null): boolean {
  const joined = useTableStore((s) => s.mode === 'guest');
  return useControlBar(id) !== null && joined;
}

// Why only the GM may use the GM's own controls, or null for the GM.
export function useGmBar(): string | null {
  return useActorBar("gm");
}

// Why whoever is at the screen cannot play character `id`, or null when they
// can; a sheet nobody plays, being edited, made or a race's, is always
// theirs to change.
export function useControlBar(id: string | null): string | null {
  return useActorBar(id === null ? null : { id });
}

// The same, for the character the tab shows.
export function useActiveControlBar(): string | null {
  const owner = TAB_OWNER[useAppStore((s) => s.selectedGameTab)];
  const campaignId = useCampaignStore((s) => s.activeCharacterId);
  const combatId = useCombatStore((s) => s.activeCharacterId);
  return useControlBar(owner === "campaign" ? campaignId : owner === "combat" ? combatId : null);
}
