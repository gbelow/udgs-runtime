import type { CampaignCharacter } from '../types'
import type { Action } from './types'
import { payCost } from '../character/commands/cost'
import { getOutcome, Outcome } from './lenses/damage'

// The two moments an action touches a character: `roll`, when the die is
// thrown and the price leaves the actor in the same step, and `resolve`, when
// what the action did lands on whoever it was done to.
export type Phase = 'roll' | 'resolve'

// The one place an action changes a character. It reads the action and the
// character's part in it — actor, target, nobody — and applies only that
// part, so a fight can run every character through it and the ones an action
// does not concern come out untouched. Everything it needs is on the action:
// what had to be looked up across two characters was written there by the
// command that made the transition; the target turns the attacker's facts
// into an injury with nothing but its own armor and toughness.
export function reduceCharacter(action: Action, phase: Phase): (c: CampaignCharacter) => CampaignCharacter {
  return (c: CampaignCharacter) => {
    switch (phase) {
      case 'roll':
        if (c.id !== action.actorId || !action.cost) return c
        return payCost({ ...action.cost, exhaustion: 0, IL: 0, ET: 0 })(c)
      case 'resolve':
        if (action.kind !== 'strike' || c.id !== action.targetId || !action.facts) return c
        return takeOutcome(getOutcome(action.facts, c))(c)
    }
  }
}

// combat.tex "Injury level", "Bleed", "Wounds", "Interruption": the injury
// lands on the level, the bleed on its intensity, the wound's own IL on the
// wound list ("tracked separately from the main IL"), and a death from the
// head puts the level at the threshold that is death.
function takeOutcome(outcome: Outcome): (c: CampaignCharacter) => CampaignCharacter {
  return (c: CampaignCharacter) => {
    // an affliction the target already carries is not toggled off again
    const afflicted = { ...c, afflictions: [...new Set([...c.afflictions, ...outcome.afflictions])] }
    const injuryLevel = afflicted.injuries.injuryLevel + outcome.IL
    return {
      ...afflicted,
      injuries: {
        ...afflicted.injuries,
        injuryLevel: outcome.dead ? Math.max(injuryLevel, afflicted.injuries.deathThreshold) : injuryLevel,
        bleed: afflicted.injuries.bleed + outcome.bleed,
        wounds: outcome.wound?.heal != null ? [...afflicted.injuries.wounds, outcome.wound.heal] : afflicted.injuries.wounds,
      },
      resources: { ...afflicted.resources, AP: afflicted.resources.AP - outcome.apLoss },
    }
  }
}
