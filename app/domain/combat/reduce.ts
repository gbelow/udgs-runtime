import type { CampaignCharacter } from '../types'
import type { Action, Board, CombatState } from './types'
import { payCost } from '../character/commands/cost'
import { getOutcome, Outcome } from './lenses/damage'
import { getMoveDestination } from './lenses/move'
import { getReactionsTo } from './lenses/action'

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
        // combat.tex "Balance": a move on difficult terrain at a speed the
        // test did not clear ends in a fall
        if (action.kind === 'move') return c.id === action.actorId && action.facts?.fell ? fallProne(c) : c
        if (action.kind !== 'strike' || c.id !== action.targetId || !action.facts) return c
        return takeOutcome(getOutcome(action.facts, c))(c)
    }
  }
}

function fallProne(c: CampaignCharacter): CampaignCharacter {
  return { ...c, afflictions: [...new Set([...c.afflictions, 'prone' as const])] }
}

// combat.tex "Injury level", "Bleed", "Wounds", "Interruption": the injury
// lands on the level, the bleed on its intensity, the wound joins what the
// character carries in `active` until it is healed, and a death from the
// head puts the level at the threshold that is death. A wound already
// carried is not carried twice, and its affliction is read off it rather
// than stored; only unconsciousness, which no wound carries, is written.
function takeOutcome(outcome: Outcome): (c: CampaignCharacter) => CampaignCharacter {
  return (c: CampaignCharacter) => {
    const { wound } = outcome
    const carried = wound && c.active.some((e) => e.kind === 'wound' && e.key === wound.key && (e.hand ?? null) === wound.hand)
    const active = wound && !carried
      ? [...c.active, { kind: 'wound' as const, key: wound.key, ...(wound.hand !== null ? { hand: wound.hand } : {}) }]
      : c.active
    const injuryLevel = c.injuries.injuryLevel + outcome.IL
    return {
      ...c,
      active,
      afflictions: [...new Set([...c.afflictions, ...outcome.afflictions.filter((a) => a === 'unconscious')])],
      injuries: {
        ...c.injuries,
        injuryLevel: outcome.dead ? Math.max(injuryLevel, c.injuries.deathThreshold) : injuryLevel,
        bleed: c.injuries.bleed + outcome.bleed,
      },
      resources: { ...c.resources, AP: c.resources.AP - outcome.apLoss },
    }
  }
}

// The one place an action changes the board, the same way: it reads the
// action and applies the part that moves anyone. Where a move ends was
// worked out from the fight as it stood at the resolve, so the board is
// handed the state it is part of.
export function reduceBoard(state: CombatState, action: Action, phase: Phase): (board: Board) => Board {
  return (board: Board) => {
    if (phase !== 'resolve') return board
    if (action.kind === 'move') {
      // a jump away from an opportunity attack put the mover where it landed
      if (action.facts?.stop === 'jump') return board
      const destination = action.facts ? getMoveDestination(state, action, action.facts.path) : null
      if (!destination) return board
      return { ...board, placements: { ...board.placements, [action.actorId]: destination } }
    }
    if (action.kind === 'strike') {
      // combat.tex "Evasive Jump": the defender lands where the jump said
      const jump = getReactionsTo(state, action.id).find((r) => r.kind === 'evasiveJump')
      if (!jump || jump.kind !== 'evasiveJump' || !jump.to) return board
      return { ...board, placements: { ...board.placements, [jump.actorId]: jump.to } }
    }
    return board
  }
}
