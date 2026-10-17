import { toast } from "sonner";
import { getActorBar, getCampaignRole, getOwner, isOwnRoller, type Actor, type Viewer } from "../domain/profiles";
import { TAB_OWNER, useAppStore, useAppStoreApi, type AppState } from "../stores/useAppStore";
import { useCampaignStore, type CampaignStore } from "../stores/useCampaignStore";
import { useCombatStore } from "../stores/useCombatStore";

type ViewerFields = Pick<AppState, "profile" | "devServer" | "gmMode" | "profileList" | "playerCharacterList">;

// Who is at the screen, read off the app store and the campaign in play.
const viewerOf = (app: ViewerFields, campaign: CampaignStore): Viewer => {
  const profile = app.profile?.id ?? null;
  return {
    profile, role: getCampaignRole(campaign.file.members, profile, app.devServer), gmMode: app.gmMode, profiles: app.profileList,
    ownerOf: (id) => getOwner(id, campaign.owners, app.playerCharacterList),
  };
};

// Who is at the screen, asked when it is asked: in a handler, as of the
// click, so that holding the check costs no subscription.
export function useViewerCheck(): () => Viewer {
  const app = useAppStoreApi();
  return () => viewerOf(app.getState(), useCampaignStore.getState());
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

// Whether whoever is at the screen plays a character in play, asked as
// `useActorBarCheck` is.
export function useControlCheck(): (id: string) => boolean {
  const bar = useActorBarCheck();
  return (id) => bar({ id }) === null;
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

// The same for a press acting for the character `id`, or for nobody.
export function useActForGate(): (id: string | null) => boolean {
  const gate = useActGate();
  return (id) => gate(id === null ? null : { id });
}

// Why whoever is at the screen cannot act for `actor`, or null when they
// can, kept up to date for a control drawn closed.
export function useActorBar(actor: Actor): string | null {
  const profile = useAppStore((s) => s.profile);
  const devServer = useAppStore((s) => s.devServer);
  const gmMode = useAppStore((s) => s.gmMode);
  const profileList = useAppStore((s) => s.profileList);
  const playerCharacterList = useAppStore((s) => s.playerCharacterList);
  const app = { profile, devServer, gmMode, profileList, playerCharacterList };
  return useCampaignStore((s) => getActorBar(actor, viewerOf(app, s)));
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
