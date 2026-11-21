import type { CampaignCharacter } from '../types'
import type { Placement, SceneState } from '../scene/types'
import { getEyesToward, seesAcross } from '../scene/rules/board/board'
import { getBelief } from './belief'
import { getSides } from './table'

// What a seat remembers of the foes its members noticed (the user's ruling,
// 2026-11-21: a player remembers what their characters saw): each foe as it
// was last noticed by any member, where it stood and in which round. It is the
// seat's, kept by whoever runs the seat beside it (bot/seat.ts `run`, the
// screen's bots), never the fight's.
//
// A foe noticed again is noted afresh. One the seat no longer notices is
// forgotten once `FORGET_AFTER` rounds have passed since it was noticed (the
// user's ruling), once a member sees the cell it stood on and it is not there,
// once someone the seat notices stands there, and once it has left the fight.
export const FORGET_AFTER = 2

export type Sighting = { sheet: CampaignCharacter; placement: Placement; party: string | undefined; round: number }
export type SeatMemory = Readonly<Record<string, Sighting>>
export type SeatMemories = Readonly<Record<string, SeatMemory>>

// The seat's memory once it has looked at the fight as it stands.
export function remember(memory: SeatMemory | undefined, state: SceneState, members: readonly string[]): SeatMemory {
  const present = members.filter((id) => state.characters[id])
  if (present.length === 0 || state.round === 0) return {}
  const view = getBelief(state, present, present[0])
  const { foes } = getSides(view, present)
  const noticed: Record<string, Sighting> = {}
  for (const foe of foes) {
    const placement = view.board?.placements[foe]
    if (placement) noticed[foe] = { sheet: view.characters[foe], placement, party: view.partyOf[foe], round: state.round }
  }
  const kept = Object.entries(memory ?? {}).filter(([id, s]) => !(id in noticed) && isKept(view, state, present, s))
  return { ...Object.fromEntries(kept), ...noticed }
}

function isKept(view: SceneState, state: SceneState, members: readonly string[], s: Sighting): boolean {
  const board = view.board
  if (!board || !state.characters[s.sheet.id] || s.round > state.round || state.round - s.round > FORGET_AFTER) return false
  const at = s.placement.cell
  const standing = Object.values(board.placements).some((p) => p.cell.q === at.q && p.cell.r === at.r)
  if (standing) return false
  return !members.some((m) => {
    const from = board.placements[m]?.cell
    return from !== undefined && seesAcross(board, [from], [at], getEyesToward(view, m, s.placement.elevation))
  })
}

// How many rounds ago each remembered foe put back in a view was noticed, by
// its sheet there, which every fight made from that view keeps while nothing
// lands on it.
const ages = new WeakMap<CampaignCharacter, number>()

// The fight as the seat takes it to stand with what it remembers: every
// remembered foe it does not notice now stands where it was last noticed, as it
// was then. None of its members notices it (`notices` reads the fight itself),
// so none aims at it.
export function withRemembered(view: SceneState, memory: SeatMemory | undefined): SceneState {
  const missing = Object.entries(memory ?? {}).filter(([id]) => !view.characters[id])
  if (missing.length === 0 || !view.board) return view
  for (const [, s] of missing) ages.set(s.sheet, view.round - s.round)
  return {
    ...view,
    characters: { ...view.characters, ...Object.fromEntries(missing.map(([id, s]) => [id, s.sheet])) },
    partyOf: { ...view.partyOf, ...Object.fromEntries(missing.flatMap(([id, s]) => (s.party ? [[id, s.party]] : []))) },
    board: { ...view.board, placements: { ...view.board.placements, ...Object.fromEntries(missing.map(([id, s]) => [id, s.placement])) } },
  }
}

// How many rounds ago the seat last noticed `id`, standing in `state` from
// memory; null for one it notices.
export function getRememberedAge(state: SceneState, id: string): number | null {
  const c = state.characters[id]
  return c ? (ages.get(c) ?? null) : null
}
