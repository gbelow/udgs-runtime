import type { MovementKind } from '../types'
import type { SceneState } from '../scene/types'
import { getMovementOptions, type ReachableCell } from '../scene/rules/move'
import { getReachableCells } from '../scene/rules/board/reach'
import { getOpenAction } from '../scene/rules/log'
import { toUpdater, type SceneCommand } from '../scene/commands/registry'

// Every cell the character could get to this turn. The table's ruling: a cell
// any movement reaches, the fastest one reaches too, so the reach is the
// fastest movement open to the character with the movement surge made first
// where it may be. That is a run, unless running is closed to them.
//
// Asked of the character holding the turn: a move is declared to read it.

export type Reach = {
  movement: MovementKind
  // made with a movement surge first
  surged: boolean
  cells: ReachableCell[]
  // the state the move was declared on (after the surge, where one was made),
  // and the state it was declared in to read the reach: a click on one of the
  // cells pressed on `moving`, or the same move declared on `from` by the
  // builder (bot/declare.ts), finds the reach already walked
  from: SceneState
  moving: SceneState
}

// pressed as a person presses, so that the same move declared by the builder
// (bot/declare.ts) on `from` is the same fight but for its id
const press = (state: SceneState, command: SceneCommand) => toUpdater(command, { thrower: () => 0, newId: () => 'reach' })(state)

function fastest(state: SceneState, id: string): MovementKind | null {
  const c = state.characters[id]
  if (!c) return null
  const open = getMovementOptions(state, c).filter((o): o is typeof o & { kind: MovementKind } => o.available && o.speed > 0)
  return open.reduce<(typeof open)[number] | null>((best, o) => (!best || o.speed > best.speed ? o : best), null)?.kind ?? null
}

function read(state: SceneState, id: string): Reach | null {
  const surged = press(state, { kind: 'surge', args: [id, 'movement'] })
  const from = surged === state ? state : surged
  const movement = fastest(from, id)
  if (!movement) return null
  const moving = press(press(from, { kind: 'declare', args: [id, { kind: 'move' }] }), { kind: 'amend', args: [{ movement }] })
  const open = getOpenAction(moving)
  if (open?.kind !== 'move' || open.actorId !== id || open.movement !== movement) return null
  const declared = declaredOn.get(from) ?? new Map<string, SceneState>()
  declaredOn.set(from, declared)
  declared.set(id, moving)
  return { movement, surged: surged !== state, cells: getReachableCells(moving, open), from, moving }
}

const declaredOn = new WeakMap<SceneState, Map<string, SceneState>>()

// The state a reach was read in, when its move was declared on this very
// state for this character.
export function getReachMove(state: SceneState, id: string): SceneState | null {
  return declaredOn.get(state)?.get(id) ?? null
}

// A state is replaced, never changed, so a character's reach in it is read once.
const known = new WeakMap<SceneState, Map<string, Reach | null>>()

export function getReach(state: SceneState, id: string): Reach | null {
  const byId = known.get(state) ?? new Map<string, Reach | null>()
  known.set(state, byId)
  if (!byId.has(id)) byId.set(id, read(state, id))
  return byId.get(id) ?? null
}
