import { CampaignCharacter, Effect, Trigger } from "../../types"
import { effectsDue } from "../lenses/effects"
import { payCost } from "./cost"

// The effect processor: the one place that knows how an effect changes the
// character when its trigger fires. Only mutating kinds do anything here — a
// cost is a drain taken as-is, with no affordability check, so it can leave
// a pool negative. Buffs and suppressions are never applied: they are read
// off the catalogs by the lenses for as long as their source is in effect.
export function applyEffects(effects: Effect[]): (c: CampaignCharacter) => CampaignCharacter {
  return (c: CampaignCharacter) =>
    effects.reduce((acc, effect) => {
      switch (effect.type) {
        case 'cost': return payCost(effect.effect)(acc)
        case 'buff':
        case 'suppression':
        case 'flash':
          return acc
      }
    }, c)
}

// Runs the processor over everything in effect that falls due on a trigger:
// what the round change calls for `end_round`. An entry's own instant
// effects are applied by the command that adds it, never through here, so a
// second addition cannot re-fire what the first already applied.
export function applyTrigger(trigger: Trigger): (c: CampaignCharacter) => CampaignCharacter {
  return (c: CampaignCharacter) => applyEffects(effectsDue(c, trigger))(c)
}
