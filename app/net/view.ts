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

// What `profile` is shown of the table, in words for the GM to check who
// sees what: the characters they play, the tokens they are shown, those the
// fight leaves out, their party-mates, and how much of the logs they get.
export type ViewSummary = {
  played: string[]; tokens: string[]; leftOut: string[]; partyMates: string[]
  parties: { shown: number; of: number }; journal: { shown: number; of: number }; log: { shown: number; of: number }
}

export function describeView(state: Shared, profile: string): ViewSummary {
  const view = viewFor(state, profile);
  const controlled = controlledBy(state, profile);
  const nameOf = (id: string) => state.campaign.characters[id]?.name ?? state.scene.characters[id]?.name ?? id;
  const names = (ids: string[]) => ids.map(nameOf);
  const inFight = Object.keys(state.scene.characters);
  const mates = Object.keys(view.campaign.partyOf).filter((id) => !controlled.has(id));
  return {
    played: names([...controlled]),
    tokens: names(Object.keys(view.scene.characters).filter((id) => !controlled.has(id))),
    leftOut: names(inFight.filter((id) => !view.scene.characters[id])),
    partyMates: names(mates),
    parties: { shown: Object.keys(view.campaign.parties).length, of: Object.keys(state.campaign.parties).length },
    journal: { shown: view.campaign.journal.length, of: state.campaign.journal.length },
    log: { shown: Object.keys(view.scene.actions).length, of: Object.keys(state.scene.actions).length },
  };
}
