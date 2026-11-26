import type { SceneState } from '../types'
import type { Gauges } from '../../character/lenses/bars'
import { getTurnHolder } from '../rules/turn'
import { getOpenAction } from '../rules/log'
import { getDeclaredTargets } from '../rules/action'
import { parseCoordKey, setDistance } from '../rules/board/geometry'
import type { BoardTokenView, BoardView } from './boardView'
import { getOwing } from './turn'

// What the action bar offers a screen to look at, for the characters it plays
// (`own`): those characters to pick from, while none of them holds the turn
// and the action in play waits on none of them; and, on the turn of one of
// theirs with no action open, or with one of theirs declaring an action that
// asks whom it is aimed at, whom the one looking perceives.
export type FocusBar = { chips: boolean; targets: boolean }

export function getFocusBar(state: SceneState, own: readonly string[]): FocusBar {
  const holder = getTurnHolder(state)
  const theirs = holder !== null && own.includes(holder)
  const owed = getOwing(state).some((id) => own.includes(id))
  const open = getOpenAction(state)
  const aiming = open !== null && own.includes(open.actorId) && getDeclaredTargets(state, open).length > 0
  return { chips: !theirs && !owed, targets: theirs && (open === null || aiming) }
}

// Someone the one looking perceives on the board: their face's gauges, the
// cells between the two, edge to edge (null with the one looking off the
// board), and whether they are only heard or remembered, or on another floor.
export type TargetRow = {
  id: string
  name: string
  gauge: Gauges
  cells: number | null
  heard: boolean
  elsewhere: boolean
  // in the party of the one looking
  ally: boolean
  // a click on them aims the open action at them
  aim: boolean
}

const cellsOf = (t: BoardTokenView) => t.cells.flatMap((c) => parseCoordKey(c.key) ?? [])

// Everyone drawn on the board `view` as `eye` looks at it, but `eye` and the
// dead: foes first, the nearest first.
export function getTargetRows(view: BoardView, partyOf: Readonly<Record<string, string>>, eye: string | null): TargetRow[] {
  const from = view.tokens.find((t) => t.id === eye)
  const at = from ? cellsOf(from) : []
  const party = eye ? partyOf[eye] : undefined
  return view.tokens
    .filter((t) => t.id !== eye && t.posture !== 'dead')
    .map((t) => {
      const cells = cellsOf(t)
      return {
        id: t.id,
        name: t.name,
        gauge: t.gauge,
        cells: at.length > 0 && cells.length > 0 ? setDistance(at, cells) : null,
        heard: t.heard,
        elsewhere: t.elsewhere,
        ally: party !== undefined && partyOf[t.id] === party,
        aim: t.targetable,
      }
    })
    .sort((a, b) => Number(a.ally) - Number(b.ally) || (a.cells ?? Infinity) - (b.cells ?? Infinity) || a.name.localeCompare(b.name))
}
