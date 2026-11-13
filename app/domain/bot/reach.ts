import type { MovementKind } from '../types'
import type { SceneState } from '../scene/types'
import { getMovementOptions, type ReachableCell } from '../scene/rules/move'
import { getReachableCells } from '../scene/rules/board/reach'
import { getOpenAction } from '../scene/rules/log'
import { amendAction, declareAction } from '../scene/commands/action'
import { surge } from '../scene/commands/turn'

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
}

const NO_IDS = () => 'reach'

function fastest(state: SceneState, id: string): MovementKind | null {
  const c = state.characters[id]
  if (!c) return null
  const open = getMovementOptions(state, c).filter((o): o is typeof o & { kind: MovementKind } => o.available && o.speed > 0)
  return open.reduce<(typeof open)[number] | null>((best, o) => (!best || o.speed > best.speed ? o : best), null)?.kind ?? null
}

function read(state: SceneState, id: string): Reach | null {
  const surged = surge(id, 'movement')(state)
  const from = surged === state ? state : surged
  const movement = fastest(from, id)
  if (!movement) return null
  const moving = amendAction({ movement })(declareAction(id, { kind: 'move' }, NO_IDS)(from))
  const open = getOpenAction(moving)
  if (open?.kind !== 'move' || open.actorId !== id || open.movement !== movement) return null
  return { movement, surged: surged !== state, cells: getReachableCells(moving, open) }
}

// A state is replaced, never changed, so a character's reach in it is read once.
const known = new WeakMap<SceneState, Map<string, Reach | null>>()

export function getReach(state: SceneState, id: string): Reach | null {
  const byId = known.get(state) ?? new Map<string, Reach | null>()
  known.set(state, byId)
  if (!byId.has(id)) byId.set(id, read(state, id))
  return byId.get(id) ?? null
}
