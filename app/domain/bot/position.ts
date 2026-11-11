import type { Coord, Placement, SceneState } from '../scene/types'
import type { ReachableCell } from '../scene/rules/move'
import { setDistance } from '../scene/rules/board/geometry'
import { getReachableCells } from '../scene/rules/board/reach'
import { getPathPlacements } from '../scene/rules/board/waypoint'
import { withPlacements } from '../scene/rules/board/board'
import { getOpenAction } from '../scene/rules/log'
import { getAvailableActions } from '../scene/rules/options'
import { amendAction, declareAction } from '../scene/commands/action'
import { getLiveFoes, type Party } from './party'
import { getBestOf, getBestReading, getReadings, type Reading } from './reading'
import { applyMove, type Move } from './move'

// Where a character could walk to, and what standing there comes to: the most
// it could do from there to any foe with the AP the walk leaves it, as the foe
// would answer it, less what every foe could do to it there, as it would
// answer with what it has left, less what the opportunity attacks the walk
// draws could do (the ones the panel offers the foes once the walk is
// committed). All in IL, read off the quick readings (reading.ts). The foes
// are taken to stand where they are: what they do next is for the fight
// played on to find out.

export type Spot = {
  movement: 'basic' | 'run'
  to: ReachableCell
  offense: number
  danger: number
  drawn: number
  // cells to the nearest foe
  gap: number
  score: number
}

// How many cells are offered, and how many more are looked at for the
// opportunity attacks their walk draws.
const OFFERED = 2
const SHORTLIST = 6

function standingAt(state: SceneState, id: string, at: Placement, paid: { AP: number; STA: number }): SceneState {
  const c = state.characters[id]
  const moved = withPlacements(state, { [id]: at })
  return { ...moved, characters: { ...moved.characters, [id]: { ...c, resources: { ...c.resources, AP: c.resources.AP - paid.AP, STA: c.resources.STA - paid.STA } } } }
}

function standing(state: SceneState, id: string, foes: string[]): { offense: number; danger: number } {
  let offense = 0
  let danger = 0
  for (const foe of foes) {
    offense = Math.max(offense, getBestReading(state, id, foe)?.IL ?? 0)
    danger += getBestReading(state, foe, id)?.IL ?? 0
  }
  return { offense, danger }
}

export function walkMove(id: string, movement: 'basic' | 'run', path: Coord[]): Move {
  return [{ kind: 'declare', args: [id, { kind: 'move' }] }, { kind: 'amend', args: [{ movement, path }] }, { kind: 'commit', args: [] }]
}

// The foes the panel offers an opportunity attack on the walk once it is
// committed.
function drawnBy(state: SceneState, id: string, spot: Spot, foes: string[], newId: () => string): string[] {
  const committed = applyMove(state, walkMove(id, spot.movement, spot.to.path), () => 5, newId)
  const open = getOpenAction(committed)
  if (!open || open.actorId !== id || open.step !== 'react') return []
  return foes.filter((foe) => getAvailableActions(committed, foe).some((o) => o.available && o.draft.kind === 'opportunityAttack'))
}

// What standing where the character stands comes to, to measure a walk
// against.
export function getHere(state: SceneState, party: Party, id: string): { offense: number; score: number; gap: number } {
  const foes = getLiveFoes(state, party)
  const origin = state.board?.placements[id]?.cell
  const cells = foes.flatMap((f) => state.board?.placements[f]?.cell ?? [])
  const { offense, danger } = standing(state, id, foes)
  return { offense, score: offense - danger, gap: origin && cells.length > 0 ? setDistance([origin], cells) : 0 }
}

// The best few cells to walk to, the best first: better than standing still,
// or, where nothing can be attacked from here, as good and nearer the foes.
// What one character can do to another changes from cell to cell only with
// the gap between them, so the readings are kept by gap as they are made,
// each from the first cell at that gap.
export function getSpots(state: SceneState, party: Party, id: string, newId: () => string): Spot[] {
  const foes = getLiveFoes(state, party)
  const foeCells = new Map(foes.flatMap((f) => { const cell = state.board?.placements[f]?.cell; return cell ? [[f, cell] as const] : [] }))
  const self = state.characters[id]
  if (!state.board?.placements[id] || foeCells.size === 0 || !self) return []
  const declared = declareAction(id, { kind: 'move' }, newId)(state)
  if (getOpenAction(declared)?.kind !== 'move') return []

  const byGap = new Map<string, Reading[]>()
  const landing = new Map<string, Placement>()
  const landers = new Map<'basic' | 'run', (to: ReachableCell) => Placement>()
  const byCell = new Map<string, Spot>()
  for (const movement of ['basic', 'run'] as const) {
    const moving = amendAction({ movement })(declared)
    const aimed = getOpenAction(moving)
    if (aimed?.kind !== 'move') continue
    const at = (to: ReachableCell) => {
      const key = `${movement} ${to.cell.q},${to.cell.r}`
      if (!landing.has(key)) landing.set(key, getPathPlacements(moving, aimed, to.path).at(-1) ?? { ...state.board!.placements[id], cell: to.cell })
      return landing.get(key)!
    }
    landers.set(movement, at)
    for (const to of getReachableCells(moving, aimed)) {
      const key = `${to.cell.q},${to.cell.r}`
      const known = byCell.get(key)
      if (known && known.to.cost.AP + known.to.cost.STA <= to.cost.AP + to.cost.STA) continue
      const gap = setDistance([to.cell], [...foeCells.values()])
      if (gap === 0) continue
      const me = { ...self, resources: { ...self.resources, AP: self.resources.AP - to.cost.AP, STA: self.resources.STA - to.cost.STA } }
      let offense = 0
      let danger = 0
      for (const [foe, cell] of foeCells) {
        const apart = setDistance([to.cell], [cell])
        const read = (from: string, on: string) => {
          const memo = `${from}>${on}@${apart}`
          if (!byGap.has(memo)) byGap.set(memo, getReadings(standingAt(state, id, at(to), to.cost), from, on))
          return byGap.get(memo)!
        }
        offense = Math.max(offense, getBestOf(state, read(id, foe), me, state.characters[foe])?.IL ?? 0)
        danger += getBestOf(state, read(foe, id), state.characters[foe], me)?.IL ?? 0
      }
      byCell.set(key, { movement, to, offense, danger, drawn: 0, gap, score: offense - danger })
    }
  }

  const here = getHere(state, party, id)
  const better = (s: Spot) => s.score > here.score || (here.offense === 0 && s.score === here.score && s.gap < here.gap)
  const ranked = (spots: Spot[]) => [...spots].sort((a, b) => b.score - a.score || a.gap - b.gap || a.to.steps - b.to.steps)
  const shortlisted = ranked([...byCell.values()].filter(better)).slice(0, SHORTLIST).map((spot) => {
    const there = standingAt(state, id, landers.get(spot.movement)!(spot.to), spot.to.cost)
    const drawn = drawnBy(state, id, spot, foes, newId).reduce((sum, foe) => sum + (getBestReading(there, foe, id)?.IL ?? 0), 0)
    return { ...spot, drawn, score: spot.score - drawn }
  })
  return ranked(shortlisted.filter(better)).slice(0, OFFERED)
}
