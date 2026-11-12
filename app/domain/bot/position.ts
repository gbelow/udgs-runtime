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
import { getBestOf, getBestReading, getDrawnByAction, getReadings, getUnanswered, type Reading } from './reading'
import { surge } from '../scene/commands/turn'
import { getSurgeTurnBar } from '../scene/rules/turn'
import { canSurge } from '../character/rules/surge'
import { applyMove, type Move } from './move'

// Where to walk, as a means to an attack. For each foe the character could
// attack from somewhere it can reach and still pay for the attack, the cells
// it could attack that foe from are looked at, where it stands and the
// cheapest walks: of these, the one that draws the least from opportunity
// attacks (those the walk draws, and for a shot those the shot draws from
// whoever has it in melee reach), then the one where the foes could do the
// least to it, then the shortest. Where it can attack no one this turn, it
// runs at the nearest foe as far as it can, to the cell nearer that foe where
// the foes could do the least to it. And where a foe could hurt it where it
// stands and its surge is still to make, it may run away instead: a movement
// surge and a run as far from the foes as it reaches. All in harm
// (harm.ts), read off the quick readings (reading.ts), the foes where they stand.

export type Spot = {
  movement: 'basic' | 'run'
  // made with a movement surge first
  surged: boolean
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

export function standingAt(state: SceneState, id: string, at: Placement, paid: { AP: number; STA: number }): SceneState {
  const c = state.characters[id]
  const moved = withPlacements(state, { [id]: at })
  return { ...moved, characters: { ...moved.characters, [id]: { ...c, resources: { ...c.resources, AP: c.resources.AP - paid.AP, STA: c.resources.STA - paid.STA } } } }
}

export function walkMove(id: string, movement: 'basic' | 'run', path: Coord[], surged = false): Move {
  return [...(surged ? [{ kind: 'surge', args: [id, 'movement'] }] as Move : []), { kind: 'declare', args: [id, { kind: 'move' }] }, { kind: 'amend', args: [{ movement, path }] }, { kind: 'commit', args: [] }]
}

// The foes the panel offers an opportunity attack on the walk once it is
// committed.
function drawnBy(state: SceneState, id: string, movement: 'basic' | 'run', to: ReachableCell, foes: string[], newId: () => string): string[] {
  if (to.steps === 0) return []
  const committed = applyMove(state, walkMove(id, movement, to.path), () => 5, newId)
  const open = getOpenAction(committed)
  if (!open || open.actorId !== id || open.step !== 'react') return []
  return foes.filter((foe) => getAvailableActions(committed, foe).some((o) => o.available && o.draft.kind === 'opportunityAttack'))
}

export type Walk = { movement: 'basic' | 'run'; to: ReachableCell; at: Placement }

// The reachable cells for each kind of movement, from the state as it stands
// (a surge made or not), less those in a foe's space, narrowed to the cells
// `pick` keeps before the path to each is drawn.
export function getWalks(state: SceneState, id: string, foeCells: Coord[], newId: () => string, movements: readonly ('basic' | 'run')[] = ['basic', 'run'], pick: (cells: ReachableCell[]) => ReachableCell[] = (cells) => cells): Walk[] {
  const declared = declareAction(id, { kind: 'move' }, newId)(state)
  if (getOpenAction(declared)?.kind !== 'move') return []
  const walks: Walk[] = []
  for (const movement of movements) {
    const moving = amendAction({ movement })(declared)
    const aimed = getOpenAction(moving)
    if (aimed?.kind !== 'move') continue
    for (const to of pick(getReachableCells(moving, aimed).filter((cell) => setDistance([cell.cell], foeCells) > 0))) {
      walks.push({ movement, to, at: getPathPlacements(moving, aimed, to.path).at(-1) ?? { ...state.board!.placements[id], cell: to.cell } })
    }
  }
  return walks
}

export const costOf = (to: ReachableCell) => to.cost.AP + to.cost.STA

export function getSpots(state: SceneState, party: Party, id: string, newId: () => string): Spot[] {
  const foes = getLiveFoes(state, party)
  const foeCells = new Map(foes.flatMap((f) => { const cell = state.board?.placements[f]?.cell; return cell ? [[f, cell] as const] : [] }))
  const self = state.characters[id]
  const origin = state.board?.placements[id]?.cell
  if (!origin || foeCells.size === 0 || !self) return []
  const walks = getWalks(state, id, [...foeCells.values()], newId)

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
  const offense = (walk: Walk, foe: string) => getBestOf(state, read(walk, id, foe, false), me(walk), state.characters[foe])?.harm ?? 0
  const danger = (walk: Walk) => [...foeCells.keys()].reduce((sum, foe) => sum + (getBestOf(state, read(walk, foe, id, true), state.characters[foe], me(walk))?.harm ?? 0), 0)
  const drawn = (walk: Walk, shooting: boolean) => {
    const there = standingAt(state, id, walk.at, walk.to.cost)
    const walked = drawnBy(state, id, walk.movement, walk.to, foes, newId).reduce((sum, foe) => sum + (getBestReading(there, foe, id)?.harm ?? 0), 0)
    return walked + (shooting ? getDrawnByAction(there, id, foes) : 0)
  }
  // Whether the attack the character would make on the foe from there is a
  // shot, the hardest it could pay for.
  const shoots = (walk: Walk, foe: string) => getBestOf(state, read(walk, id, foe, false), me(walk), state.characters[foe])?.reading.kind === 'shoot'
  const spot = (walk: Walk, dealt: number, shooting = false, surged = false): Spot => {
    const taken = danger(walk)
    const lost = drawn(walk, shooting)
    return { movement: walk.movement, surged, to: walk.to, offense: dealt, danger: taken, drawn: lost, gap: setDistance([walk.to.cell], [...foeCells.values()]), score: dealt - taken - lost }
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
  }).sort((a, b) => b.most - a.most)
  const offered = new Map<string, Spot>()
  const offer = (s: Spot | null) => { if (s && s.to.steps > 0) offered.set(`${s.surged} ${s.to.cell.q},${s.to.cell.r}`, s) }
  const here: Walk = { movement: 'basic', to: { cell: origin, steps: 0, cost: { AP: 0, STA: 0 }, path: [] }, at: state.board!.placements[id] }
  if (targets.length > 0) {
    for (const { foe, from } of targets) {
      // For a shot, the cells it draws the least from are looked at first.
      const exposure = (walk: Walk) => (shoots(walk, foe) ? getDrawnByAction(standingAt(state, id, walk.at, walk.to.cost), id, foes) : 0)
      const nearest = from.map((walk) => ({ walk, exposed: exposure(walk) })).sort((a, b) => a.exposed - b.exposed || costOf(a.walk.to) - costOf(b.walk.to)).map(({ walk }) => walk)
      const looked = [...(offense(here, foe) > 0 ? [here] : []), ...nearest]
      offer(best(looked.map((walk) => spot(walk, offense(walk, foe), shoots(walk, foe)))))
    }
  } else {
    offer(approach())
  }
  offer(flight())
  return [...offered.values()]

  // No one to attack this turn: run at the nearest foe as far as the AP goes.
  function approach(): Spot | null {

    const [nearest] = [...foeCells.entries()].sort((a, b) => setDistance([origin!], [a[1]]) - setDistance([origin!], [b[1]]))
    const now = setDistance([origin!], [nearest[1]])
    for (const movement of ['run', 'basic'] as const) {
      const nearer = walks.filter((walk) => walk.movement === movement && setDistance([walk.to.cell], [nearest[1]]) < now)
      if (nearer.length === 0) continue
      const most = Math.max(...nearer.map((walk) => walk.to.cost.AP))
      const furthest = nearer.filter((walk) => walk.to.cost.AP === most)
        .map((walk) => ({ walk, danger: danger(walk) }))
        .sort((a, b) => a.danger - b.danger)
      return best(furthest.map(({ walk }) => spot(walk, 0)))
    }
    return null
  }

  // What the foes could do to the character at a cell whatever AP they
  // have: each one's hardest blow alone.
  function potential(walk: Walk): number {
    return [...foeCells.keys()].reduce((sum, foe) => sum + Math.max(0, ...read(walk, foe, id, false).map(getUnanswered)), 0)
  }

  // Running away, besides repositioning: a movement surge and a run as far
  // from the foes as it reaches, of the farthest cells the one where the foes
  // could do the least to it whatever their AP, when a foe could hurt it where
  // it stands.
  function flight(): Spot | null {
    if (getSurgeTurnBar(state, id, 'movement') || !canSurge('movement')(self!) || potential(here) === 0) return null
    const surged = surge(id, 'movement')(state)
    const away = getWalks(surged, id, [...foeCells.values()], newId).filter((walk) => walk.movement === 'run')
      .map((walk) => ({ walk, gap: setDistance([walk.to.cell], [...foeCells.values()]) }))
    const farthest = Math.max(...away.map((a) => a.gap))
    if (away.length === 0 || farthest <= setDistance([origin!], [...foeCells.values()])) return null
    const [chosen] = away.filter((a) => a.gap === farthest)
      .map(({ walk }) => ({ walk, potential: potential(walk) }))
      .sort((a, b) => a.potential - b.potential || costOf(a.walk.to) - costOf(b.walk.to))
    return spot(chosen.walk, 0, false, true)
  }
}
