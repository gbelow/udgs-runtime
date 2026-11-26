import type { CampaignCharacter, Degree } from '../../types'
import type { Action, MoveAction, SeenScene } from '../types'
import { ROUND_AP, ROUND_SECONDS } from '../../tables'
import { getAGI } from '../../character/rules/characteristics'
import { getMovementBlock } from '../../character/rules/movement'
import { coordKey, toPlane } from '../rules/board/geometry'
import { getPathPlacements } from '../rules/board/waypoint'
import { isPosture } from '../rules/move'
import { getDeliveries } from '../rules/deliveries'
import { toneOf, type Tone } from './outcomes'

// What the board plays as the fight goes on: the way a move that landed was
// walked, and what an action that landed did to each character it reached.
// The stage plays each once, when it first sees it; the fight never waits on it.

// One place a token passes on its way, the key of its cell, `seconds` after
// the one before it.
export type BoardMotionStep = { cell: string; x: number; y: number; elevation: number; seconds: number }

// The way a move was walked, from where its mover set out to where it left them.
export type BoardMotionView = { key: string; id: string; steps: BoardMotionStep[] }

// What rises off a token once an action lands on it, a line each.
export type BoardMarkerView = { key: string; id: string; lines: { text: string; tone: Tone }[] }

// the user's ruling, 2026-11-26: AGI 10 walks at the block's own pace, and a
// move takes no longer than this to play however far it goes
const AVERAGE_AGI = 10
const MOST_SECONDS = 1.5
// how many of the last actions landed are offered to be played
const RECENT = 12

const recent = (state: SeenScene) => state.landed.slice(-RECENT).flatMap((id) => (state.actions[id] ? [state.actions[id]] : []))

// combat.tex "Start" and "Movement Costs and Speeds": a round is
// `ROUND_SECONDS` of game time for `ROUND_AP`, and a block of the kind goes its
// distance for its AP; the mover's AGI quickens it.
function getSecondsPerMetre(c: CampaignCharacter, action: MoveAction): number | null {
  if (isPosture(action.movement)) return null
  const block = getMovementBlock(c, action.movement)
  if (block.distance <= 0) return null
  return ((block.AP / ROUND_AP) * ROUND_SECONDS) / block.distance / (Math.max(1, getAGI(c)) / AVERAGE_AGI)
}

function getMotion(state: SeenScene, action: MoveAction): BoardMotionView | null {
  const c = state.characters[action.actorId]
  const from = action.from
  const path = action.facts?.path ?? []
  if (!c || !from || path.length === 0 || !state.board) return null
  const pace = getSecondsPerMetre(c, action)
  if (pace === null) return null
  const placed = [from, ...getPathPlacements(state, action, path)]
  const steps = placed.map((p, i) => {
    const before = placed[i - 1]
    const metres = !before ? 0 : action.movement === 'climb' ? Math.max(1, Math.abs(p.elevation - before.elevation)) : 1
    return { cell: coordKey(p.cell), ...toPlane(p.cell), elevation: p.elevation, seconds: metres * pace }
  })
  const total = steps.reduce((sum, s) => sum + s.seconds, 0)
  const scale = total > MOST_SECONDS ? MOST_SECONDS / total : 1
  return { key: action.id, id: action.actorId, steps: steps.map((s) => ({ ...s, seconds: s.seconds * scale })) }
}

// A landed move is walked the same way for as long as its mover and the
// ground are the same, so it is worked out once for them.
const motions = new WeakMap<Action, { mover: unknown; terrain: unknown; motion: BoardMotionView | null }>()

export function getBoardMotions(state: SeenScene): BoardMotionView[] {
  return recent(state).flatMap((a) => {
    if (a.kind !== 'move') return []
    const mover = state.characters[a.actorId]
    const terrain = state.board?.terrain
    let known = motions.get(a)
    if (!known || known.mover !== mover || known.terrain !== terrain) motions.set(a, (known = { mover, terrain, motion: getMotion(state, a) }))
    return known.motion ? [known.motion] : []
  })
}

const markers = new WeakMap<Action, BoardMarkerView[]>()

// The degree each character an action reached was reached at, and the injury
// level it gave them, as the action's own record of what it changed says it.
export function getBoardMarkers(state: SeenScene): BoardMarkerView[] {
  return recent(state).flatMap((a) => {
    let known = markers.get(a)
    if (!known) markers.set(a, (known = getMarkers(a)))
    return known
  })
}

function getMarkers(a: Action): BoardMarkerView[] {
  const degrees = new Map<string, Degree>()
  for (const { id, delivery } of getDeliveries(a)) if (delivery.degree !== null && !degrees.has(id)) degrees.set(id, delivery.degree)
  const hurt = new Map<string, number>()
  for (const x of a.changes) if (x.kind === 'value' && x.what === 'injury level') hurt.set(x.id, (hurt.get(x.id) ?? 0) + x.to - x.from)
  const ids = [...new Set([...degrees.keys(), ...hurt.keys()])]
  return ids.flatMap((id): BoardMarkerView[] => {
    const degree = degrees.get(id)
    const IL = hurt.get(id) ?? 0
    const lines = [
      ...(degree ? [{ text: degree, tone: toneOf(degree) }] : []),
      ...(IL !== 0 ? [{ text: `${IL > 0 ? '+' : ''}${IL} IL`, tone: IL > 0 ? 'bad' as const : 'good' as const }] : []),
    ]
    return lines.length > 0 ? [{ key: `${a.id}:${id}`, id, lines }] : []
  })
}
