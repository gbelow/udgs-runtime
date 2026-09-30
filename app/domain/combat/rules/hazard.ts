import type { Visibility } from '../../types'
import type { CombatState, Coord, Hazard, HazardLayer, MoveAction } from '../types'
import { SPELLS, isSpellKey } from '../../spells'
import { isSpellActive } from '../../character/rules/effects'
import { coordKey } from '../geometry'
import { getFootprint, getPlacedFootprint } from './board'
import { getMoveOrigin, getMoveWaypoint } from './waypoint'

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
export function getHolderOf(key: string, cast: boolean, casterId: string): HazardLayer['heldBy'] {
  return cast && isSpellKey(key) && SPELLS[key].type === 'sustained' ? { id: casterId, key } : null
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

// The footprints a move touches on its way, besides where it ends: where it
// set out and every cell walked through. combat.tex "Movement" — a jump
// touches nothing but where it lands (the table's ruling: a jump skips the
// cells in between).
export function getWalkedFootprints(state: CombatState, action: MoveAction): Coord[][] {
  const c = state.characters[action.actorId]
  const from = getMoveOrigin(state, action)
  if (!c || !from || action.movement === 'jump' || !action.facts) return []
  const steps = action.facts.path.map((_, i) => getMoveWaypoint(state, action, i + 1)).filter((p) => p !== null)
  return [from, ...steps].map((p) => getFootprint(c, p))
}
