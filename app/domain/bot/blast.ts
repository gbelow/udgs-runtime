import type { Coord } from '../types'
import type { Action, ActionOf, BlastAction, ExplosionAction, MoveAction, SceneState } from '../scene/types'
import type { Degree } from '../scene/types'
import { appendActions, replaceActions } from '../scene/commands/log'
import { makeAction } from '../scene/factories'
import { getAction, getReactionsTo, getRootOf } from '../scene/rules/log'
import { answersByDetection, getBlastOf, getExplosionFacts, getSprayPitch, isSpray, type BlastShape } from '../scene/rules/explosion'
import { getEscapeBeforeBlast } from '../scene/rules/reactionMoves'
import { getOwnCost } from '../scene/rules/action'
import { getReactionTest } from '../scene/rules/attack'
import { outcomeOf } from '../scene/rules/damage'
import { getTestMode } from '../character/rules/effects'
import { getDegree } from '../play/test'
import { placeAt, withPlacements } from '../scene/rules/board/board'
import { getFaceOdds } from './odds'
import type { ActionCost } from '../character/rules/actionCosts'
import type { SpecWeights } from './cost'

// An explosion as a character in it reads it (combat.tex "Explosions",
// "Avoiding an Explosion"): the harm it does to someone standing at a cell,
// the escape each degree of the reflex opens, and how likely each degree is.
// The harm is read off the table's own facts of the blast, with the character
// put on the cell, and a shield's block of it with the block's test come to a
// degree. Nothing here decides.

// The explosion that `id` has been opened a move out of, and the blast it goes
// off as once the moves are made; null for any other move.
export function getEscapedBlast(view: SceneState, move: MoveAction): BlastShape | null {
  const opener = move.spawnedBy ? getAction(view, move.spawnedBy) : null
  const root = opener?.kind === 'avoidExplosion' ? getRootOf(view, opener) : null
  if (root?.kind !== 'explosion') return null
  const blast = Object.values(view.actions).find((a): a is BlastAction => a.kind === 'blast' && a.spawnedBy === root.id)
  return blast ?? getBlastOf(view, root)
}

// The harm the blast does to `id` standing at `cell` (where it stands for
// null). A spray, aimed once everyone has moved (combat.tex "Sprays"), is read
// at the direction that does it the most. `blocked`: the explosion whose
// block, declared in `view`, is read.
export function getBlastHarm(view: SceneState, blast: BlastShape, id: string, cell: Coord | null, w: SpecWeights, blocked: string | null = null): number {
  const placed = view.board?.placements[id]
  const c = view.characters[id]
  if (!c || !placed) return 0
  const at = cell ? withPlacements(view, { [id]: placeAt(view.board, placed, cell) }) : view
  const aims: BlastShape[] = !isSpray(blast) || blast.direction !== null ? [blast] : ([0, 1, 2, 3, 4, 5] as const).map((direction): BlastShape => ({ ...blast, direction, pitch: getSprayPitch(at, blast.actorId, cell ?? placed.cell) }))
  return aims.reduce((most, aim) => {
    const harm = (getExplosionFacts(at, aim, blocked)[id] ?? []).reduce((sum, delivery) => {
      const outcome = outcomeOf(delivery, c)
      return outcome ? sum + w.IL * outcome.IL + w.bleed * outcome.bleed : sum
    }, 0)
    return Math.max(most, harm)
  }, 0)
}

const reflexOf = (view: SceneState, root: ExplosionAction, id: string): Action | undefined =>
  getReactionsTo(view, root.id).find((r) => r.actorId === id && (r.kind === 'avoidExplosion' || r.kind === 'blockExplosion'))

// How likely the test of `id`'s answer to the explosion, declared in `view`, is
// to come to each degree. A detonation's is the detection already made of
// whoever set it off, read as a critical.
export function getReflexOdds(view: SceneState, root: ExplosionAction, id: string): Record<Degree, number> | null {
  const reaction = reflexOf(view, root, id)
  const odds: Record<Degree, number> = { miss: 0, graze: 0, hit: 0, critical: 0 }
  if (!reaction) return null
  if (answersByDetection(view, reaction)) return { ...odds, critical: 1 }
  const test = getReactionTest(view, root, reaction)
  getFaceOdds(getTestMode(view.characters[id])).forEach((p, face) => { odds[getDegree(face + test.skill, test.DL)] += p })
  return odds
}

// The price of `id`'s answer, declared in `view`.
export function getReflexCost(view: SceneState, root: ExplosionAction, id: string): ActionCost | null {
  const reaction = reflexOf(view, root, id)
  return reaction ? getOwnCost(view, reaction) : null
}

// The fight with `id`'s block of the explosion, declared in `view`, rolled to a degree.
export function withBlock(view: SceneState, root: ExplosionAction, id: string, degree: Degree): SceneState {
  const reaction = reflexOf(view, root, id)
  if (reaction?.kind !== 'blockExplosion') return view
  return replaceActions(view, [{ ...reaction, cost: getOwnCost(view, reaction), roll: { die: 0, DL: 0, score: 0, degree, HOP: 0, skillTerms: [], DLTerms: [] } }])
}

// The fight with the escape the degree opens open for `id` to declare, its
// `avoidExplosion` declared in `view`; null for a degree that opens none.
export function withEscape(view: SceneState, root: ExplosionAction, id: string, degree: Degree): SceneState | null {
  const reaction = getReactionsTo(view, root.id).find((r): r is ActionOf<'avoidExplosion'> => r.actorId === id && r.kind === 'avoidExplosion')
  // the reflex is priced only once it is paid
  const move = reaction && getEscapeBeforeBlast({ ...reaction, cost: getOwnCost(view, reaction) }, degree)
  return reaction && move ? appendActions(view, [makeAction('move', { id: 'escape', actorId: id, spawnedBy: reaction.id, ...move })]) : null
}
