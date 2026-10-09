import type { Degree } from '../../types'
import { SWIM_FAILURE_SINK } from '../../tables'
import type { Action, CombatState, HeldRoll, Updater } from '../types'
import { rollModed, type Dice, type RollMode } from '../../play/dice'
import { getHeldBar, getHeldRoll, type HeldKind } from '../rules/heldRoll'
import { getHeldModes, getHeldTest, type CalledKind } from '../rules/heldTest'
import { getDegree, resolveTest } from '../../play/test'
import { sink } from './swim'

// What a held test leaves on the fight, once, at the moment it is made:
// `degree` is the roll against the DL it was made at (combat.tex "Swimming":
// "On a failure, ... the character ... sinks 1m"). A climb's or a balance
// test's first die is the move's own, which lands what it came to.
const HELD_EFFECTS: Record<HeldKind, (id: string, degree: Degree) => Updater> = {
  swim: (id, degree) => (degree === 'miss' ? sink(id, SWIM_FAILURE_SINK) : (state) => state),
  climb: () => (state) => state,
  balance: () => (state) => state,
  stealth: () => (state) => state,
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
export function rollHeld(id: string, kind: CalledKind, mode: RollMode, dice: Dice): Updater {
  return (state) => {
    const test = getHeldTest(state, id, kind)
    if (!test || getHeldBar(state, id, kind) || !getHeldModes(state.characters[id], kind).includes(mode)) return state
    const { die, score, skillTerms } = resolveTest(test, (explodes) => rollModed(mode, explodes, dice))
    return holdRoll(id, kind, { mode, die, skill: test.skill, score, skillTerms }, test.DL)(state)
  }
}

// The held test an action's die was thrown as: a swim test a move opened, a
// climb, a walk across difficult ground.
function getThrownKind(action: Action): HeldKind | null {
  if (action.kind === 'swimTest') return 'swim'
  return action.kind === 'move' ? action.test : null
}

// The roll of a held test thrown as an action's die, written down as its
// actor's for the round as it is thrown.
export function holdThrown(state: CombatState, action: Action): CombatState {
  const kind = getThrownKind(action)
  const { actorId, roll } = action
  if (!kind || !roll || getHeldRoll(state, actorId, kind)) return state
  const mode = action.kind === 'move' ? action.mode : 'normal'
  return holdRoll(actorId, kind, { mode, die: roll.die, skill: roll.score - roll.die, score: roll.score, skillTerms: roll.skillTerms }, roll.DL)(state)
}

// The table's ruling on combat.tex "Balance": a fall has the faller test
// their balance again — a fall of its own, or a move that ended in one.
export function dropFallenBalance(state: CombatState, action: Action): CombatState {
  const fell = action.kind === 'fall' || (action.kind === 'move' && !!action.facts?.fell)
  return fell ? { ...state, heldTests: state.heldTests.filter((t) => t.id !== action.actorId || t.kind !== 'balance') } : state
}
