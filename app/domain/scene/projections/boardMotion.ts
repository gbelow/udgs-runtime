import type { CampaignCharacter, Degree } from '../../types'
import type { Action, Coord, MoveAction, SeenScene } from '../types'
import { ROUND_AP, ROUND_SECONDS } from '../../tables'
import { getAGI } from '../../character/rules/characteristics'
import { getAfflictions, isDead } from '../../character/rules/afflictions'
import { getMovementBlock } from '../../character/rules/movement'
import { coordKey, toPlane } from '../rules/board/geometry'
import { getPathPlacements } from '../rules/board/waypoint'
import { isPosture } from '../rules/move'
import { getDeliveries } from '../rules/deliveries'
import { getExplosionZones } from '../rules/explosion'
import { toneOf, type Tone } from './outcomes'

// What the board plays as the fight goes on: the way a move that landed was
// walked, the blow, shot, spell or fall an action that landed was, and what
// it did to each character it reached. Each carries `order`, its place among
// the actions landed, so the stage plays them one after another as they
// happened; it plays each once, when it first sees it, and the fight never
// waits on it.

// One place a token passes on its way, the key of its cell, `seconds` after
// the one before it.
export type BoardMotionStep = { cell: string; x: number; y: number; elevation: number; seconds: number }

// The way a move was walked, from where its mover set out to where it left
// them, and whether it was a jump, which goes through the air.
export type BoardMotionView = { key: string; order: number; id: string; jump: boolean; steps: BoardMotionStep[] }

// What rises off a token once an action lands on it, a line each.
export type BoardMarkerView = { key: string; order: number; id: string; lines: { text: string; tone: Tone }[] }

// A place on the board an action went at: a cell's key and centre.
export type BoardSpotView = { cell: string; x: number; y: number }

// What an action that landed was, as the board shows it happen: a blow
// struck in reach (the striker lunges at whom they struck, who shakes if it
// got through), a shot or a throw (a streak from the shooter to whom or where
// it went), a spell (a streak of its own colour to each it was cast at), an
// area going off (its cells flash) or a fall (the faller drops).
export type BoardStrikeView = {
  key: string
  order: number
  kind: 'melee' | 'shot' | 'spell' | 'area' | 'drop'
  actor: string
  targets: string[]
  at: BoardSpotView | null
  cells: BoardSpotView[]
  hit: boolean
}

// How a token lies: standing, prone, collapsed (combat.tex "Injuries and
// Death": prone as well), or dead.
export type BoardPosture = 'standing' | 'prone' | 'collapsed' | 'dead'

// the user's ruling, 2026-11-26: AGI 10 walks at the block's own pace, and a
// move takes no longer than this to play however far it goes
const AVERAGE_AGI = 10
const MOST_SECONDS = 1.5
// how many of the last actions landed are offered to be played
const RECENT = 12

const recent = (state: SeenScene): { action: Action; order: number }[] => {
  const from = Math.max(0, state.landed.length - RECENT)
  return state.landed.slice(from).flatMap((id, i) => (state.actions[id] ? [{ action: state.actions[id], order: from + i }] : []))
}

// combat.tex "Start" and "Movement Costs and Speeds": a round is
// `ROUND_SECONDS` of game time for `ROUND_AP`, and a block of the kind goes its
// distance for its AP; the mover's AGI quickens it.
function getSecondsPerMetre(c: CampaignCharacter, action: MoveAction): number | null {
  if (isPosture(action.movement)) return null
  const block = getMovementBlock(c, action.movement)
  if (block.distance <= 0) return null
  return ((block.AP / ROUND_AP) * ROUND_SECONDS) / block.distance / (Math.max(1, getAGI(c)) / AVERAGE_AGI)
}

function getMotion(state: SeenScene, action: MoveAction): Omit<BoardMotionView, 'order'> | null {
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
  return { key: action.id, id: action.actorId, jump: action.movement === 'jump', steps: steps.map((s) => ({ ...s, seconds: s.seconds * scale })) }
}

// A landed move is walked the same way for as long as its mover and the
// ground are the same, so it is worked out once for them.
const motions = new WeakMap<Action, { mover: unknown; terrain: unknown; motion: Omit<BoardMotionView, 'order'> | null }>()

export function getBoardMotions(state: SeenScene): BoardMotionView[] {
  return recent(state).flatMap(({ action: a, order }) => {
    if (a.kind !== 'move') return []
    const mover = state.characters[a.actorId]
    const terrain = state.board?.terrain
    let known = motions.get(a)
    if (!known || known.mover !== mover || known.terrain !== terrain) motions.set(a, (known = { mover, terrain, motion: getMotion(state, a) }))
    return known.motion ? [{ ...known.motion, order }] : []
  })
}

const markers = new WeakMap<Action, Omit<BoardMarkerView, 'order'>[]>()

// The degree each character an action reached was reached at, and the injury
// level it gave them, as the action's own record of what it changed says it.
export function getBoardMarkers(state: SeenScene): BoardMarkerView[] {
  return recent(state).flatMap(({ action: a, order }) => {
    let known = markers.get(a)
    if (!known) markers.set(a, (known = getMarkers(a)))
    return known.map((m) => ({ ...m, order }))
  })
}

function getMarkers(a: Action): Omit<BoardMarkerView, 'order'>[] {
  const degrees = new Map<string, Degree>()
  for (const { id, delivery } of getDeliveries(a)) if (delivery.degree !== null && !degrees.has(id)) degrees.set(id, delivery.degree)
  const hurt = new Map<string, number>()
  for (const x of a.changes) if (x.kind === 'value' && x.what === 'injury level') hurt.set(x.id, (hurt.get(x.id) ?? 0) + x.to - x.from)
  const ids = [...new Set([...degrees.keys(), ...hurt.keys()])]
  return ids.flatMap((id): Omit<BoardMarkerView, 'order'>[] => {
    const degree = degrees.get(id)
    const IL = hurt.get(id) ?? 0
    const lines = [
      ...(degree ? [{ text: degree, tone: toneOf(degree) }] : []),
      ...(IL !== 0 ? [{ text: `${IL > 0 ? '+' : ''}${IL} IL`, tone: IL > 0 ? 'bad' as const : 'good' as const }] : []),
    ]
    return lines.length > 0 ? [{ key: `${a.id}:${id}`, id, lines }] : []
  })
}

const spot = (cell: Coord | null): BoardSpotView | null => (cell ? { cell: coordKey(cell), ...toPlane(cell) } : null)

// Whether what the action delivered got through to anyone: a degree past a miss.
const landedOn = (a: Action): boolean => getDeliveries(a).some(({ delivery }) => delivery.degree !== null && delivery.degree !== 'miss')

function getStrike(state: SeenScene, a: Action): Omit<BoardStrikeView, 'key' | 'order'> | null {
  const base = { actor: a.actorId, targets: a.targetId ? [a.targetId] : [], at: null, cells: [], hit: landedOn(a) }
  switch (a.kind) {
    case 'strike':
    case 'grapple':
      return a.targetId ? { ...base, kind: 'melee' } : null
    case 'shoot':
      return a.targetId ? { ...base, kind: 'shot' } : null
    case 'throw':
      return a.targetId || a.to ? { ...base, kind: 'shot', at: a.targetId ? null : spot(a.to) } : null
    case 'cast': {
      const targets = a.targetId ? [a.targetId] : [...new Set(getDeliveries(a).map((d) => d.id))].filter((id) => id !== a.actorId)
      return targets.length > 0 ? { ...base, kind: 'spell', targets } : null
    }
    case 'blast':
      return a.center && state.board ? { ...base, kind: 'area', targets: [], cells: getExplosionZones(state, a).flatMap((z) => { const s = spot(z.cell); return s ? [s] : [] }) } : null
    case 'fall':
      return { ...base, kind: 'drop', targets: [] }
    default:
      return null
  }
}

const strikes = new WeakMap<Action, { terrain: unknown; strike: Omit<BoardStrikeView, 'key' | 'order'> | null }>()

export function getBoardStrikes(state: SeenScene): BoardStrikeView[] {
  return recent(state).flatMap(({ action: a, order }) => {
    const terrain = state.board?.terrain
    let known = strikes.get(a)
    if (!known || known.terrain !== terrain) strikes.set(a, (known = { terrain, strike: getStrike(state, a) }))
    return known.strike ? [{ ...known.strike, key: a.id, order }] : []
  })
}

const lying = new WeakMap<CampaignCharacter, BoardPosture>()

// How the character lies, as anyone looking can see it: dead once laid to
// rest out of every party (`layToRest`), or on a sheet the viewer plays as
// soon as they die. Read once for each sheet.
export function getBoardPosture(state: SeenScene, c: CampaignCharacter): BoardPosture {
  if (!(c.id in state.partyOf)) return 'dead'
  let posture = lying.get(c)
  if (!posture) {
    const afflictions = getAfflictions(c)
    posture = c.shown === null && isDead(c) ? 'dead' : afflictions.includes('collapsed') || afflictions.includes('unconscious') ? 'collapsed' : afflictions.includes('prone') ? 'prone' : 'standing'
    lying.set(c, posture)
  }
  return posture
}
