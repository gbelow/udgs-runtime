import type { CampaignCharacter } from '../types'
import type { Placement, SceneState } from '../scene/types'
import { getEyesToward, seesAcross } from '../scene/rules/board/board'
import { FORGET_AFTER, ROUND_AP } from '../tables'
import { getSightOf } from '../scene/rules/seen'
import { getBelief } from './belief'
import { getSides } from './table'

// What a seat remembers of the foes its members noticed (the user's rulings,
// 2026-11-21 and 2026-11-25: a player remembers what their characters saw):
// each foe's face as it was last noticed by any member and in which round, for
// as long as it is in the fight, and where it stood (`placement`). It is the
// seat's, kept by whoever runs the seat beside it (bot/seat.ts `run`, the
// screen's bots), never the fight's.
//
// A foe noticed again is noted afresh. Where one the seat no longer notices
// stood is forgotten (null) once `FORGET_AFTER` rounds have passed since it was
// noticed, once a member sees the cell it stood on and it is not there, and
// once someone the seat notices stands there. One only met in an exchange,
// which no member detects, is not noticed by it.
export type Sighting = { sheet: CampaignCharacter; placement: Placement | null; party: string | undefined; round: number }
export type SeatMemory = Readonly<Record<string, Sighting>>

// What a box notes for itself, from one look at the fight to the next
// (decision.ts `Box`'s `notes`) and with a move it makes (`Decision`'s
// `noted`), under keys of its own: plain data only the box reads.
export type Notes = Readonly<Record<string, unknown>>

// Each seat's, by seat id: the foes it remembers and its box's notes.
export type SeatMemories = Readonly<Record<string, { foes: SeatMemory; notes: Notes }>>

// The seat's memory once it has looked at the fight as it stands.
export function remember(memory: SeatMemory | undefined, state: SceneState, members: readonly string[]): SeatMemory {
  const present = members.filter((id) => state.characters[id])
  if (present.length === 0 || state.round === 0) return {}
  const view = getBelief(state, present, present[0])
  const { foes } = getSides(view, present)
  const noticed: Record<string, Sighting> = {}
  for (const foe of foes) {
    const placement = view.board?.placements[foe]
    if (placement && present.some((m) => getSightOf(state, m).has(foe))) noticed[foe] = { sheet: view.characters[foe], placement, party: view.partyOf[foe], round: state.round }
  }
  const kept = Object.entries(memory ?? {}).flatMap(([id, s]): [string, Sighting][] => {
    if (id in noticed || !state.characters[id] || s.round > state.round) return []
    return [[id, s.placement && !isPlaceKept(view, state, present, s.placement, s.round) ? { ...s, placement: null } : s]]
  })
  return { ...Object.fromEntries(kept), ...noticed }
}

function isPlaceKept(view: SceneState, state: SceneState, members: readonly string[], placement: Placement, round: number): boolean {
  const board = view.board
  if (!board || state.round - round > FORGET_AFTER) return false
  const at = placement.cell
  const standing = Object.values(board.placements).some((p) => p.cell.q === at.q && p.cell.r === at.r)
  if (standing) return false
  return !members.some((m) => {
    const from = board.placements[m]?.cell
    return from !== undefined && seesAcross(board, [from], [at], getEyesToward(view, m, placement.elevation))
  })
}

// A remembered face in a later round: its AP come in and its surge is its own
// again, whatever it had left when it was noticed.
const rested = new WeakMap<CampaignCharacter, CampaignCharacter>()

function faceIn(round: number, s: Sighting): CampaignCharacter {
  if (round <= s.round) return s.sheet
  let face = rested.get(s.sheet)
  if (!face) rested.set(s.sheet, (face = { ...s.sheet, usedSurge: null, surgeFloor: null, runsFree: false, resources: { ...s.sheet.resources, AP: ROUND_AP }, shown: s.sheet.shown && { ...s.sheet.shown, AP: 2 } }))
  return face
}

// How many rounds ago each remembered foe put back in a view was noticed, by
// its sheet there, which every fight made from that view keeps while nothing
// lands on it.
const ages = new WeakMap<CampaignCharacter, number>()

// The fight as the seat takes it to stand with what it remembers: every
// remembered foe it does not see now stands where it was last noticed, with the
// face it had then. None of its members notices it (`notices` reads the fight
// itself), so none aims at it. One whose place is forgotten stands nowhere in
// it, and counts only where `getAbsentFoes` is asked.
export function withRemembered(view: SceneState, memory: SeatMemory | undefined): SceneState {
  const missing = Object.entries(memory ?? {}).filter(([id]) => !view.characters[id])
  if (missing.length === 0 || !view.board) return view
  const placed = missing.flatMap(([id, s]) => (s.placement ? [{ id, s, face: faceIn(view.round, s), placement: s.placement }] : []))
  for (const { s, face } of placed) ages.set(face, view.round - s.round)
  // a fight made from this one keeps its faces, so whoever it knows to be about is found by them
  const faces = { ...view.faces }
  absent.set(faces, missing.flatMap(([id, s]) => (s.placement ? [] : [{ id, face: faceIn(view.round, s) }])))
  return {
    ...view,
    faces,
    characters: { ...view.characters, ...Object.fromEntries(placed.map(({ id, face }) => [id, face])) },
    partyOf: { ...view.partyOf, ...Object.fromEntries(placed.flatMap(({ id, s }) => (s.party ? [[id, s.party]] : []))) },
    board: { ...view.board, placements: { ...view.board.placements, ...Object.fromEntries(placed.map(({ id, placement }) => [id, placement])) } },
  }
}

// The foes the seat knows to be in the fight with no idea where, by face: they
// threaten nothing anywhere, but may still act (the user's ruling, 2026-11-25).
const absent = new WeakMap<SceneState['faces'], { id: string; face: CampaignCharacter }[]>()

export const getAbsentFoes = (view: SceneState): { id: string; face: CampaignCharacter }[] => absent.get(view.faces) ?? []

// How many rounds ago the seat last noticed `id`, standing in `state` from
// memory; null for one it notices.
export function getRememberedAge(state: SceneState, id: string): number | null {
  const c = state.characters[id]
  return c ? (ages.get(c) ?? null) : null
}
