import { useMemo } from "react";
import { describeView, type ViewSummary } from "../net/view";
import { sharedOf } from "../net/protocol";
import { useAppStore } from "../stores/useAppStore";
import { useCampaignStore } from "../stores/useCampaignStore";
import { useCombatStore } from "../stores/useCombatStore";

// What the GM checks of a player: the members of the campaign who play, and
// what the table shows one of them (`describeView`).
export function useViewAs(profile: string): { players: { id: string; name: string }[]; summary: ViewSummary | null } {
  const profileList = useAppStore((s) => s.profileList);
  const members = useCampaignStore((s) => s.file.members);
  const scene = useCombatStore((s) => s);
  const campaign = useCampaignStore((s) => s);
  const players = useMemo(() => profileList.filter((p) => members[p.id] === "player").map((p) => ({ id: p.id, name: p.name })), [profileList, members]);
  const summary = useMemo(() => (profile ? describeView(sharedOf(scene, campaign), profile) : null), [scene, campaign, profile]);
  return { players, summary };
}
