import { toast } from "sonner";
import { getControlBar, getOwner } from "../domain/profiles";
import type { ClickActor } from "../domain/scene/commands/click";
import { TAB_OWNER, useAppStore } from "../stores/useAppStore";
import { useCampaignStore } from "../stores/useCampaignStore";
import { useCombatStore } from "../stores/useCombatStore";
import { useActingAsGm, useCampaignRole } from "./useRole";
import { useProfileId } from "./useProfile";

// Why whoever is at the screen cannot play a character in play, asked of
// its id when it is asked: in a handler, as of the click.
export function useControlBarCheck(): (id: string) => string | null {
  const role = useCampaignRole();
  const profile = useProfileId();
  const listed = useAppStore((s) => s.playerCharacterList);
  const profiles = useAppStore((s) => s.profileList);
  return (id) => getControlBar(getOwner(id, useCampaignStore.getState().owners, listed), profile, role, profiles);
}

// Whether whoever is at the screen plays a character in play, asked as
// `useControlBarCheck` is.
export function useControlCheck(): (id: string) => boolean {
  const bar = useControlBarCheck();
  return (id) => bar(id) === null;
}

// Whether a press or a click acting for `actor` may be made from the screen:
// one for a character only by whoever plays them, one with the table's own
// tools only while acting as the GM, one for nobody by anyone. Refused, why
// is said.
export function useActGate(): (actor: ClickActor) => boolean {
  const bar = useControlBarCheck();
  const gm = useActingAsGm();
  return (actor) => {
    const why = actor === null ? null : actor === "gm" ? (gm ? null : "a GM tool: switch the action bar to GM") : bar(actor.id);
    if (why) toast.error(`Not yours to do: ${why}.`);
    return why === null;
  };
}

// The same for a press acting for the character `id`, or for nobody.
export function useActForGate(): (id: string | null) => boolean {
  const gate = useActGate();
  return (id) => gate(id === null ? null : { id });
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
