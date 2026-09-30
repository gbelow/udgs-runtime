import type { Visibility } from '../../types'
import type { Action, BlastAction, Board, CombatState, Coord, Hazard, HazardLayer, MoveAction, Placement } from '../types'
import { SPELLS, isSpellKey } from '../../spells'
import { isSpellActive } from '../../character/rules/effects'
import { coordKey } from '../geometry'
import { getFootprint, getPlacedFootprint } from './board'
import { getMoveOrigin, getMoveWaypoint, touchesGround } from './waypoint'
import { getTurnHolder } from './turn'
import { findOpenRoot } from './log'

// combat.tex "Environmental Hazards": what the ground does to whoever stands
// on it — the fire and the gas actions left on each cell, and the gas the
// map was drawn with. A creature over several cells takes the worst of them
// (combat.tex "Fire": "Creatures that take multiple spaces take the worst
// space they touched").

const VISIBILITY_ORDER: Visibility[] = ['good', 'bad', 'zero']

function worseVisibility(a: Visibility | null, b: Visibility | null): Visibility | null {
  if (a === null) return b
  if (b === null) return a
  return VISIBILITY_ORDER.indexOf(a) >= VISIBILITY_ORDER.indexOf(b) ? a : b
}

const NO_HAZARD: Hazard = { fire: 0, suffocating: false, visibility: null }

function combineHazards(a: Hazard, b: Hazard): Hazard {
  return { fire: Math.max(a.fire, b.fire), suffocating: a.suffocating || b.suffocating, visibility: worseVisibility(a.visibility, b.visibility) }
}

// Whether a layer is still there: one a sustained spell keeps lasts while
// its caster holds the spell (spells.tex "Sustained Spells").
export function isLayerLive(state: CombatState, layer: HazardLayer): boolean {
  if (!layer.heldBy) return true
  const { id, key } = layer.heldBy
  const caster = state.characters[id]
  return !!caster && isSpellKey(key) && isSpellActive(caster, key)
}

// Whether what a blast leaves is kept by its caster: a sustained spell cast
// (spells.tex "Sustained Spells"), as opposed to a charge or a thrown row.
export function getHolderOf(blast: BlastAction, opener: Action | null): HazardLayer['heldBy'] {
  const cast = opener?.kind === 'explosion' && opener.source === 'cast'
  return cast && isSpellKey(blast.key) && SPELLS[blast.key].type === 'sustained' ? { id: blast.actorId, key: blast.key, explosionId: opener.id } : null
}

// Whether a layer was left by an earlier cast of the same held spell than
// `heldBy`'s: a caster holds one of each spell, so a new cast replaces
// what the last one left, and a spell let go and cast again does not bring
// the old one back.
export function isSupersededBy(layer: HazardLayer, heldBy: NonNullable<HazardLayer['heldBy']>): boolean {
  return !!layer.heldBy && layer.heldBy.id === heldBy.id && layer.heldBy.key === heldBy.key && layer.heldBy.explosionId !== heldBy.explosionId
}

// The terrain with only the layers `keep` says stay; a cell that loses none
// is the same cell.
export function filterLayers(terrain: Board['terrain'], keep: (layer: HazardLayer) => boolean): Board['terrain'] {
  return Object.fromEntries(Object.entries(terrain).map(([key, cell]) => [key, cell.layers.every(keep) ? cell : { ...cell, layers: cell.layers.filter(keep) }]))
}

// The board with only the layers still there, for whatever reads it without
// the fight to tell which are: a VTT, a clipboard.
export function getLiveBoard(state: CombatState): Board | null {
  return state.board ? { ...state.board, terrain: filterLayers(state.board.terrain, (l) => isLayerLive(state, l)) } : null
}

// What one cell does to whoever stands in it.
export function getCellHazard(state: CombatState, cell: Coord): Hazard {
  const terrain = state.board?.terrain[coordKey(cell)]
  if (!terrain) return NO_HAZARD
  const drawn: Hazard = { fire: 0, suffocating: terrain.suffocating, visibility: terrain.visibility === 'good' ? null : terrain.visibility }
  return terrain.layers.filter((l) => isLayerLive(state, l)).reduce<Hazard>(combineHazards, drawn)
}

// The worst of the cells a footprint covers.
export function getHazardAt(state: CombatState, cells: Coord[]): Hazard {
  return cells.map((cell) => getCellHazard(state, cell)).reduce(combineHazards, NO_HAZARD)
}

// What the character's footprint stands in; nothing off the board.
export function getHazardOf(state: CombatState, id: string): Hazard {
  const footprint = getPlacedFootprint(state, id)
  return footprint ? getHazardAt(state, footprint) : NO_HAZARD
}

// The footprints a move `touchesGround` on, from where it set out to where
// it landed.
export function getWalkedFootprints(state: CombatState, action: MoveAction): Coord[][] {
  const c = state.characters[action.actorId]
  const from = getMoveOrigin(state, action)
  if (!c || !from || !action.facts) return []
  const { path } = action.facts
  return [from, ...path.map((_, i) => getMoveWaypoint(state, action, i + 1))]
    .filter((p, i): p is Placement => p !== null && touchesGround(action.movement, i === path.length))
    .map((p) => getFootprint(c, p))
}

// combat.tex "Fire": "The fire damage taken at the end of the turn is the
// worst environmental fire the character has touched during their turn" —
// only in their own turn, so what moves them outside it touches nothing.
// Read off the fight with the action's board landed: the holder of the turn
// has touched what they stand in now — unless a move of their own is still
// being played out, which has them only part of the way — and, for a move
// of their own, every cell it walked through. A jump opening the turn so
// clears the fire they started in (combat.tex "Fire": "they can jump once to
// attempt to avoid its effects"), even when an opportunity attack lands
// before it. Null when there is no fire to touch.
export type FireTouched = { id: string; fire: number }

export function getFireTouched(state: CombatState, action: Action): FireTouched | null {
  const holder = getTurnHolder(state)
  if (!holder || !state.characters[holder]) return null
  const moving = findOpenRoot(state, 'move', (m) => m.actorId === holder) !== null
  const walked = action.kind === 'move' && action.actorId === holder ? getWalkedFootprints(state, action) : []
  const fire = Math.max(moving ? 0 : getHazardOf(state, holder).fire, ...walked.map((f) => getHazardAt(state, f).fire))
  return fire > 0 ? { id: holder, fire } : null
}
