import type { Coord, SceneState, SeenScene } from '../types'
import { FORGET_AFTER } from '../../tables'
import { getCellSenser, getSenseReaches } from '../rules/detection'
import { getSightOf } from '../rules/seen'
import { notices } from '../rules/stealth'
import { getFightName } from '../rules/fighters'
import { getPlacedFootprint } from '../rules/board/board'
import { getBoardView, getBoardViewFrom, type BoardTokenView, type BoardView } from './boardView'
import type { RosterParty } from './roster'

// What a player at the table knows of who is in the fight, from what their
// characters sense and have sensed (the table's rulings). A face once noticed
// by any of them through an active sense is theirs for the rest of the fight;
// where someone stands is known to each character on their own, for as long as
// they sense them, and remembered for `FORGET_AFTER` rounds after. Kept by the
// screen, never by the fight.

// Where someone was last noticed, as they were drawn there.
type Sighting = { token: BoardTokenView; cells: Coord[]; round: number }

export type SightMemory = { faces: Record<string, string>; places: Record<string, Record<string, Sighting>> }

export const NO_SIGHTS: SightMemory = { faces: {}, places: {} }

// Those of them who can sense anything: on a board, whoever stands on it.
const sensing = (state: SceneState, own: readonly string[]): string[] => own.filter((id) => state.characters[id] && (!state.board || state.board.placements[id] !== undefined))

// The memory of `own` once they have looked at the fight as it stands. A
// screen shown only part of the fight (`whole` false) cannot tell one it does
// not see from one who has left it. Own characters gone from the fight take
// with them what they saw: with none left, it is another fight.
export function noteSights(memory: SightMemory, state: SeenScene, own: readonly string[], whole: boolean): SightMemory {
  const present = own.filter((id) => state.characters[id])
  if (present.length === 0) return NO_SIGHTS
  const before = present.some((id) => memory.places[id]) ? memory : NO_SIGHTS
  const stays = (id: string) => !whole || state.characters[id] !== undefined
  const faces = Object.fromEntries(Object.entries(before.faces).filter(([id]) => stays(id)))
  const looking = sensing(state, present)
  for (const id of Object.keys(state.characters)) {
    if (!own.includes(id) && looking.some((m) => getSightOf(state, m).has(id) && getSenseReaches(state, m, id).some((r) => r.active))) faces[id] = getFightName(state, id)
  }
  const tokens = new Map(getBoardView(state).tokens.map((t) => [t.id, t]))
  const places = Object.fromEntries(present.map((m) => {
    const sight = looking.includes(m) ? getSightOf(state, m) : new Set<string>()
    const kept = Object.entries(before.places[m] ?? {}).filter(([id, s]) => !sight.has(id) && stays(id) && isRemembered(state, m, s))
    const seen = [...sight].flatMap((id) => {
      const token = tokens.get(id)
      return token && !own.includes(id) ? [[id, { token, cells: getPlacedFootprint(state, id) ?? [], round: state.round }] as const] : []
    })
    return [m, Object.fromEntries([...kept, ...seen])]
  }))
  return { faces, places }
}

// A place is forgotten once the rounds are up, and once whoever remembers it
// takes in any of it and finds nobody there.
function isRemembered(state: SceneState, observerId: string, s: Sighting): boolean {
  if (s.round > state.round || state.round - s.round > FORGET_AFTER) return false
  const senses = getCellSenser(state, observerId)
  return !s.cells.some((cell) => senses(cell, s.token.elevation))
}

// Who a player knows to be in the fight now: their own and their parties',
// the faces they know, and whoever any of theirs takes in now through a sense
// that answers (combat.tex "Senses").
export function getKnown(state: SceneState, own: readonly string[], memory: SightMemory): string[] {
  const parties = new Set(own.map((id) => state.partyOf[id]).filter((p) => p !== undefined))
  const looking = sensing(state, own)
  const senses = (id: string) => looking.some((m) => getSenseReaches(state, m, id).some((r) => r.active || r.reactive) && notices(state, m, id))
  return Object.keys(state.characters).filter((id) => own.includes(id) || parties.has(state.partyOf[id]) || id in memory.faces || senses(id))
}

// The roster as a player knows it: those they know, and the faces they know of
// whoever their screen is not shown now, by name alone.
export function getKnownRoster(parties: RosterParty[], known: readonly string[], memory: SightMemory, shown: SceneState['characters']): { parties: RosterParty[]; away: { id: string; name: string }[] } {
  return {
    parties: parties.map((p) => ({ ...p, entries: p.entries.filter((e) => known.includes(e.id)) })).filter((p) => p.entries.length > 0),
    away: Object.entries(memory.faces).flatMap(([id, name]) => (shown[id] ? [] : [{ id, name }])),
  }
}

// The fight with `eye` the one looking, one for each state and eye, so that
// what is read off it is read once.
const looked = new WeakMap<SceneState, Map<string | null, SeenScene>>()

export function lookingFrom(state: SeenScene, eye: string | null): SeenScene {
  if (state.activeCharacterId === eye) return state
  const byEye = looked.get(state) ?? new Map<string | null, SeenScene>()
  looked.set(state, byEye)
  let seen = byEye.get(eye)
  if (!seen) byEye.set(eye, (seen = { ...state, activeCharacterId: eye }))
  return seen
}

// The board through the eyes of one character, with whoever they remember and
// do not sense now drawn faded where they last did. Through the eyes of nobody
// placed, the ground and who the player knows by party.
export function getEyesBoard(seen: SeenScene, own: readonly string[], memory: SightMemory): BoardView {
  const eye = seen.activeCharacterId
  if (!eye || !seen.board?.placements[eye]) {
    const view = getBoardView(seen)
    const parties = new Set(own.map((id) => seen.partyOf[id]))
    return { ...view, tokens: view.tokens.filter((t) => own.includes(t.id) || (seen.partyOf[t.id] !== undefined && parties.has(seen.partyOf[t.id]))) }
  }
  const view = getBoardViewFrom(seen)
  const drawn = new Set(view.tokens.map((t) => t.id))
  const standing = view.tokens.flatMap((t) => t.cells.map((c) => c.key))
  const remembered = Object.entries(memory.places[eye] ?? {}).flatMap(([id, s]) =>
    (drawn.has(id) || s.token.cells.some((c) => standing.includes(c.key)) ? [] : [{ ...s.token, heard: true, isActive: false, isInTurn: false, role: null, targetable: false, awaited: false, hanging: null, shieldAngle: null }]))
  return remembered.length > 0 ? { ...view, tokens: [...view.tokens, ...remembered] } : view
}

// Whose eyes a player looks through with none of theirs picked yet.
export function getFirstOwn(state: SceneState, own: readonly string[]): string | null {
  return own.find((id) => state.board?.placements[id] !== undefined) ?? own.find((id) => state.characters[id]) ?? null
}
