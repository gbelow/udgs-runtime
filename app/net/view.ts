import { getCampaignRole, hasGmTools } from "../domain/profiles";
import { getSceneSeenBy } from "../domain/scene/projections/seen";
import { getCampaignSeenBy } from "../domain/campaign/projections/seen";
import { getExplorationSeenBy } from "../domain/exploration/projections/seen";
import { getDowntimeSeenBy } from "../domain/downtime/projections/seen";
import { getKnownBy } from "../domain/campaign/rules/seen";
import { prune } from "../domain/prune";
import type { Shared } from "./protocol";

// The characters a profile plays, in the fight or out of it.
const controlledBy = (state: Shared, profile: string): Set<string> => {
  const { campaign, scene } = state;
  const everyone = new Set([...Object.keys(campaign.characters), ...Object.keys(campaign.partyOf), ...Object.keys(scene.characters)]);
  return new Set([...everyone].filter((id) => campaign.owners[id] === profile));
};

// The table as `profile` is shown it (multiplayer-plan.md "Hidden information"):
// the whole of it for a GM, and for a player what concerns the characters they
// play. A part nothing is hidden from is the same object, so the host can
// diff the view against the last one it sent.
export function viewFor(state: Shared, profile: string): Shared {
  if (hasGmTools(getCampaignRole(state.campaign.file.members, profile, false))) return state;
  const controlled = controlledBy(state, profile);
  const known = getKnownBy(state.campaign, controlled);
  const { campaign } = state;
  const seen = {
    ...getCampaignSeenBy(campaign, known),
    exploration: getExplorationSeenBy(campaign.exploration, known),
    downtime: getDowntimeSeenBy(campaign.downtime, known),
    file: campaign.file,
    owners: prune(campaign.owners, known.hidden),
  };
  const scene = getSceneSeenBy(state.scene, controlled);
  const same = scene === state.scene && (Object.keys(seen) as (keyof typeof seen)[]).every((k) => seen[k] === campaign[k]);
  return same ? state : { scene, campaign: seen };
}
