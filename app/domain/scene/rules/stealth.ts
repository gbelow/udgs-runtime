import type { Action, SceneState, Degree, Detection, DetectionTest, StealthTurn } from '../types'
import { getArmor } from '../../character/rules/armor'
import { isMuffled } from '../../item/rules/items'
import { coordKey } from './board/geometry'
import { getPlacedFootprint } from './board/board'
import { isDead } from '../../character/rules/afflictions'
import { getSenseReaches, type SenseReach } from './detection'
import { getTurnHolder } from './turn'
import { getMoveDestination } from './board/waypoint'
import { getDegree } from '../../play/test'

// combat.tex "Stealth in combat". Every character's stealth value is rolled
// once a round and held to its end. Outside their own turn a character is
// found by the board: an active sense that takes them in unimpaired detects
// them outright, one partly impaired tests its detection against the value,
// and one totally impaired takes in nothing. In their own turn they may use
// the value against whoever they began it undetected by, less what they have
// done in the turn, and only reactions ask.

export type Noise = { AP: number; heardAP: number }

// combat.tex "Actions in stealth": "Careful movement and crawling add no
// penalty. All the other actions add -1 per AP spent", and "Hearing: Terrain
// noise and gear noise" add again per AP to an ear (gear.tex "Noisy":
// "penalizing stealth by -1 per AP during actions when worn"; "Muffled
// Boots": "Denies noise penalties from terrain"). The terrain is the
// loudest the action stands on or walks across.
export function getNoise(state: SceneState, action: Action, AP: number): Noise {
  const c = state.characters[action.actorId]
  if (!c) return { AP: 0, heardAP: 0 }
  const quiet = action.kind === 'move' && (action.movement === 'careful' || action.movement === 'crawl')
  const counted = quiet ? 0 : AP
  const gear = getArmor(c).properties.includes('noisy') ? 1 : 0
  const ground = isMuffled(c) ? 0 : getGroundNoise(state, action)
  return { AP: counted, heardAP: counted * (gear + ground) }
}

function getGroundNoise(state: SceneState, action: Action): number {
  const terrain = state.board?.terrain
  if (!terrain) return 0
  const cells = [...(getPlacedFootprint(state, action.actorId) ?? []), ...(action.kind === 'move' ? action.path : [])]
  return Math.max(0, ...cells.map((cell) => terrain[coordKey(cell)]?.noise ?? 0))
}

// The round's stealth score of a character; null for one not tested.
export function getStealthScore(state: SceneState, id: string): number | null {
  return state.heldTests.find((t) => t.id === id && t.kind === 'stealth')?.roll?.score ?? null
}

// The turn being taken, as stealth keeps it.
export function getStealthTurn(state: SceneState): StealthTurn | null {
  const holder = getTurnHolder(state)
  return state.stealthTurns.find((t) => t.turn === state.turn && t.id === holder) ?? null
}

// combat.tex "Sensory impairment": whether the score fails against a
// detection — "unless their stealth value grazes or misses against the
// reactor's detection".
function isFound(degree: Degree): boolean {
  return degree === 'graze' || degree === 'miss'
}

// Whether the observer has the hider, and the detection test that decided
// it; a null test is one decided without a roll against the stealth value.
export type Detected = Omit<Detection, 'observerId' | 'hiderId'>

const SENSED: Detected = { found: true, test: null }

// The test each sense makes of the score, less `penalty` for what it takes
// in of the turn: found by any that finds, and explained by it, or by the one
// that came closest when none does. Nothing to test with finds nothing.
function testScore(score: number, reaches: SenseReach[], penalty: (r: SenseReach) => number): Detected {
  const tests = reaches.map((r): DetectionTest => ({ score, penalty: penalty(r), sense: r.sense, detection: r.detection, terms: r.terms, degree: getDegree(score - penalty(r), r.detection) }))
  const finding = tests.find((t) => isFound(t.degree))
  if (finding) return { found: true, test: finding }
  const closest = tests.reduce<DetectionTest | null>((best, t) => (best && best.detection + best.penalty >= t.detection + t.penalty ? best : t), null)
  return { found: false, test: closest }
}

// combat.tex "Active senses in combat": outside the target's own turn, an
// unimpaired active sense detects them; a partly impaired one tests. A
// character with no stealth score this round (one who joined after it began)
// is not hiding.
function detectOffTurn(state: SceneState, observerId: string, targetId: string): Detected {
  const score = getStealthScore(state, targetId)
  if (score === null) return SENSED
  const active = getSenseReaches(state, observerId, targetId).filter((r) => r.active)
  if (active.some((r) => r.impairment === 'none')) return SENSED
  return testScore(score, active, () => 0)
}

// combat.tex "Actions in stealth": in their own turn the holder is noticed by
// anyone they did not begin it undetected by, and by anyone else whose best
// reactive sense ("Detection uses the best sense available at the time of the
// reaction") finds their score less what the turn has spent and what
// `pending`, their action not yet landed, will: every AP counted, and to an
// ear the noise again.
function detectInTurn(state: SceneState, turn: StealthTurn, observerId: string, pending: Noise): Detected {
  const score = getStealthScore(state, turn.id)
  if (score === null || !turn.hiddenFrom.includes(observerId)) return SENSED
  const penalty = (r: SenseReach) => turn.AP + pending.AP + (r.sense === 'hearing' ? turn.heardAP + pending.heardAP : 0)
  return testScore(score, getSenseReaches(state, observerId, turn.id).filter((r) => r.reactive), penalty)
}

// The fight with a move's mover standing at step `at` of its path, where a
// reaction to it fires; null for no step.
function atStep(state: SceneState, move: Action | null, at: number | null): SceneState | null {
  if (move?.kind !== 'move' || !state.board || !at) return null
  const there = getMoveDestination(state, move, move.path.slice(0, at))
  return there && { ...state, board: { ...state.board, placements: { ...state.board.placements, [move.actorId]: there } } }
}

// Whether the observer has the target: to aim at them, or to answer
// `pending`, an action of theirs not yet landed — a move as it stands at
// step `at`, where the reaction fires.
export function notices(state: SceneState, observerId: string, targetId: string, pending: Action | null = null, at: number | null = null): boolean {
  return detect(state, observerId, targetId, pending, at).found
}

// What `notices` answers, with the detection test that decided it.
export function detect(state: SceneState, observerId: string, targetId: string, pending: Action | null = null, at: number | null = null): Detected {
  if (observerId === targetId) return SENSED
  const turn = getStealthTurn(state)
  if (turn?.id !== targetId) return detectOffTurn(state, observerId, targetId)
  const live = pending && pending.step !== 'done' ? pending : null
  return detectInTurn(atStep(state, live, at) ?? state, turn, observerId, live?.noise ?? { AP: 0, heardAP: 0 })
}

// combat.tex "Actions in stealth": "A character can only use the stealth
// value during its turn if it started undetected to the active senses of
// their reactors" — everyone living who does not detect them as it begins.
export function getHiddenFrom(state: SceneState, id: string): string[] {
  return Object.entries(state.characters).filter(([other, c]) => other !== id && !isDead(c) && !detectOffTurn(state, other, id).found).map(([other]) => other)
}
