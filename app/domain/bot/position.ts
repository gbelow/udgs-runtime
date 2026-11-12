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

// Where to walk, as a means to an attack. For each foe the character could
// attack from somewhere it can reach and still pay for the attack, the cells
// it could attack that foe from are looked at, the cheapest first: of these,
// the walk that draws the least from the opportunity attacks it draws, then
// the one where the foes could do the least to it, then the shortest. Where
// it can attack no one this turn, it runs at the nearest foe as far as it can,
// to the cell nearer that foe where the foes could do the least to it. All in
// IL, read off the quick readings (reading.ts), the foes where they stand.

export type Spot = {
  movement: 'basic' | 'run'
  to: ReachableCell
  // the most it could do from there to the foe it walks to attack
  offense: number
  // what every foe could do to it there
  danger: number
  // what the opportunity attacks the walk draws could do
  drawn: number
  // cells to the nearest foe
  gap: number
  score: number
}

// How many foes a walk is offered to attack, and how many of the cheapest
// cells to attack each from are looked at.
const TARGETS = 2
const SHORTLIST = 6

function standingAt(state: SceneState, id: string, at: Placement, paid: { AP: number; STA: number }): SceneState {
  const c = state.characters[id]
  const moved = withPlacements(state, { [id]: at })
  return { ...moved, characters: { ...moved.characters, [id]: { ...c, resources: { ...c.resources, AP: c.resources.AP - paid.AP, STA: c.resources.STA - paid.STA } } } }
}

export function walkMove(id: string, movement: 'basic' | 'run', path: Coord[]): Move {
  return [{ kind: 'declare', args: [id, { kind: 'move' }] }, { kind: 'amend', args: [{ movement, path }] }, { kind: 'commit', args: [] }]
}

// The foes the panel offers an opportunity attack on the walk once it is
// committed.
function drawnBy(state: SceneState, id: string, movement: 'basic' | 'run', to: ReachableCell, foes: string[], newId: () => string): string[] {
  const committed = applyMove(state, walkMove(id, movement, to.path), () => 5, newId)
  const open = getOpenAction(committed)
  if (!open || open.actorId !== id || open.step !== 'react') return []
  return foes.filter((foe) => getAvailableActions(committed, foe).some((o) => o.available && o.draft.kind === 'opportunityAttack'))
}

type Walk = { movement: 'basic' | 'run'; to: ReachableCell; at: Placement }

const costOf = (to: ReachableCell) => to.cost.AP + to.cost.STA

export function getSpots(state: SceneState, party: Party, id: string, newId: () => string): Spot[] {
  const foes = getLiveFoes(state, party)
  const foeCells = new Map(foes.flatMap((f) => { const cell = state.board?.placements[f]?.cell; return cell ? [[f, cell] as const] : [] }))
  const self = state.characters[id]
  const origin = state.board?.placements[id]?.cell
  if (!origin || foeCells.size === 0 || !self) return []
  const declared = declareAction(id, { kind: 'move' }, newId)(state)
  if (getOpenAction(declared)?.kind !== 'move') return []

  const walks: Walk[] = []
  for (const movement of ['basic', 'run'] as const) {
    const moving = amendAction({ movement })(declared)
    const aimed = getOpenAction(moving)
    if (aimed?.kind !== 'move') continue
    for (const to of getReachableCells(moving, aimed)) {
      if (setDistance([to.cell], [...foeCells.values()]) === 0) continue
      walks.push({ movement, to, at: getPathPlacements(moving, aimed, to.path).at(-1) ?? { ...state.board!.placements[id], cell: to.cell } })
    }
  }

  // What one character can do to another changes from cell to cell only with
  // the gap between them, so the readings are kept by gap as they are made,
  // each from the first cell at that gap; the blow alone for what the
  // character could do, answered for what the foes could.
  const byGap = new Map<string, Reading[]>()
  const read = (walk: Walk, from: string, on: string, answered: boolean) => {
    const apart = setDistance([walk.to.cell], [foeCells.get(from === id ? on : from)!])
    const memo = `${from}>${on}@${apart} ${answered}`
    if (!byGap.has(memo)) byGap.set(memo, getReadings(standingAt(state, id, walk.at, walk.to.cost), from, on, answered))
    return byGap.get(memo)!
  }
  const me = (walk: Walk) => ({ ...self, resources: { ...self.resources, AP: self.resources.AP - walk.to.cost.AP, STA: self.resources.STA - walk.to.cost.STA } })
  const offense = (walk: Walk, foe: string) => getBestOf(state, read(walk, id, foe, false), me(walk), state.characters[foe])?.IL ?? 0
  const danger = (walk: Walk) => [...foeCells.keys()].reduce((sum, foe) => sum + (getBestOf(state, read(walk, foe, id, true), state.characters[foe], me(walk))?.IL ?? 0), 0)
  const drawn = (walk: Walk) => {
    const there = standingAt(state, id, walk.at, walk.to.cost)
    return drawnBy(state, id, walk.movement, walk.to, foes, newId).reduce((sum, foe) => sum + (getBestReading(there, foe, id)?.IL ?? 0), 0)
  }
  const spot = (walk: Walk, dealt: number): Spot => {
    const taken = danger(walk)
    const lost = drawn(walk)
    return { movement: walk.movement, to: walk.to, offense: dealt, danger: taken, drawn: lost, gap: setDistance([walk.to.cell], [...foeCells.values()]), score: dealt - taken - lost }
  }
  const best = (spots: Spot[]) => spots.reduce<Spot | null>((a, b) => (!a || b.drawn < a.drawn || (b.drawn === a.drawn && (b.danger < a.danger || (b.danger === a.danger && costOf(b.to) < costOf(a.to)))) ? b : a), null)

  // The cheapest walk to each cell, the cheapest first.
  const cheapest = new Map<string, Walk>()
  for (const walk of walks) {
    const key = `${walk.to.cell.q},${walk.to.cell.r}`
    const known = cheapest.get(key)
    if (!known || costOf(walk.to) < costOf(known.to)) cheapest.set(key, walk)
  }
  const byCost = [...cheapest.values()].sort((a, b) => costOf(a.to) - costOf(b.to) || a.to.steps - b.to.steps)

  const targets = [...foeCells.keys()].flatMap((foe) => {
    const from = byCost.filter((walk) => offense(walk, foe) > 0)
    return from.length > 0 ? [{ foe, from, most: Math.max(...from.map((walk) => offense(walk, foe))) }] : []
  }).sort((a, b) => b.most - a.most).slice(0, TARGETS)
  if (targets.length > 0) {
    const here: Walk = { movement: 'basic', to: { cell: origin, steps: 0, cost: { AP: 0, STA: 0 }, path: [] }, at: state.board!.placements[id] }
    const stay = danger(here)
    const offered = new Map<string, Spot>()
    for (const { foe, from } of targets) {
      const chosen = best(from.slice(0, SHORTLIST).map((walk) => spot(walk, offense(walk, foe))))
      // Where the foe can be attacked from here, a walk is worth it only to
      // stand where the foes could do less, drawing nothing on the way.
      if (!chosen || (offense(here, foe) > 0 && (chosen.drawn > 0 || chosen.danger >= stay))) continue
      offered.set(`${chosen.to.cell.q},${chosen.to.cell.r}`, chosen)
    }
    return [...offered.values()]
  }

  // No one to attack this turn: run at the nearest foe as far as the AP goes.
  const [nearest] = [...foeCells.entries()].sort((a, b) => setDistance([origin], [a[1]]) - setDistance([origin], [b[1]]))
  const now = setDistance([origin], [nearest[1]])
  for (const movement of ['run', 'basic'] as const) {
    const nearer = walks.filter((walk) => walk.movement === movement && setDistance([walk.to.cell], [nearest[1]]) < now)
    if (nearer.length === 0) continue
    const most = Math.max(...nearer.map((walk) => walk.to.cost.AP))
    const furthest = nearer.filter((walk) => walk.to.cost.AP === most)
      .map((walk) => ({ walk, danger: danger(walk) }))
      .sort((a, b) => a.danger - b.danger)
      .slice(0, SHORTLIST)
    const chosen = best(furthest.map(({ walk }) => spot(walk, 0)))
    return chosen ? [chosen] : []
  }
  return []
}
