import type { Degree } from '../../types'
import { SWIM_FAILURE_SINK } from '../../tables'
import type { CombatState, HeldRoll, SwimTestAction, Updater } from '../types'
import { rollModed, type Dice, type RollMode } from '../dice'
import { getHeldBar, getHeldRoll, type HeldKind } from '../rules/heldRoll'
import { getHeldModes, getHeldTest } from '../rules/heldTest'
import { getDegree, resolveTest } from '../rules/test'
import { sink } from './swim'

// What a held test leaves on the fight, once, at the moment it is made:
// `degree` is the roll against the DL it was made at (combat.tex "Swimming":
// "On a failure, ... the character ... sinks 1m").
const HELD_EFFECTS: Record<HeldKind, (id: string, degree: Degree) => Updater> = {
  swim: (id, degree) => (degree === 'miss' ? sink(id, SWIM_FAILURE_SINK) : (state) => state),
}

// Writes down the roll a character made on a held test, where the round
// called them to it or not, and lets it work on the fight.
export function holdRoll(id: string, kind: HeldKind, roll: HeldRoll, DL: number): Updater {
  return (state) => {
    const heldTests = [...state.heldTests.filter((t) => t.id !== id || t.kind !== kind), { id, kind, roll }]
    return HELD_EFFECTS[kind](id, getDegree(roll.score, DL))({ ...state, heldTests })
  }
}

// A held test rolled for the call the round made: as the player decides,
// normally, safely or riskily.
export function rollHeld(id: string, kind: HeldKind, mode: RollMode, dice: Dice): Updater {
  return (state) => {
    const test = getHeldTest(state, id, kind)
    if (!test || getHeldBar(state, id, kind) || !getHeldModes(state.characters[id], kind).includes(mode)) return state
    const { die, score } = resolveTest(test, (explodes) => rollModed(mode, explodes, dice))
    return holdRoll(id, kind, { mode, die, skill: test.skill, score }, test.DL)(state)
  }
}

// The roll of a swim test a move opened, written down as the swimmer's for the
// round as it is thrown.
export function holdSwimTest(state: CombatState, action: SwimTestAction): CombatState {
  const { actorId, roll } = action
  if (!roll || getHeldRoll(state, actorId, 'swim')) return state
  return holdRoll(actorId, 'swim', { mode: 'normal', die: roll.die, skill: roll.score - roll.die, score: roll.score }, roll.DL)(state)
}
