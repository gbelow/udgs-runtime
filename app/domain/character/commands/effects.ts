import { CampaignCharacter, Effect, Trigger } from "../../types"
import { effectsDue } from "../lenses/effects"
import { deliver } from "./deliver"

// The effects a catalog entry lists, applied as they fall due: each is
// delivered at full strength, with nothing to test — a cost is a drain
// taken as-is, with no affordability check, so it can leave a pool negative.
export function applyEffects(effects: Effect[]): (c: CampaignCharacter) => CampaignCharacter {
  return (c: CampaignCharacter) =>
    effects.reduce((acc, effect) => deliver({ effect, degree: 'hit', test: null, when: null, then: [], locks: null })(acc), c)
}

// Runs the processor over everything in effect that falls due on a trigger:
// what the round change calls for `end_round`. An entry's own instant
// effects are applied by the command that adds it, never through here, so a
// second addition cannot re-fire what the first already applied.
export function applyTrigger(trigger: Trigger): (c: CampaignCharacter) => CampaignCharacter {
  return (c: CampaignCharacter) => applyEffects(effectsDue(c, trigger))(c)
}
