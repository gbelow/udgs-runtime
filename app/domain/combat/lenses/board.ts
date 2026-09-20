import type { Character, MeleeRange, Weapon } from '../../types'
import type { Board, Coord, Placement } from '../types'
import { FOOTPRINTS, FOOTPRINT_CELLS, REACH, RMArr } from '../../tables'
import { getSize } from '../../character/lenses/misc'
import { add, coordKey, rotate } from '../geometry'

// The board lenses read the spatial facts of a fight off `state.board`. Each
// takes the board rather than the state so that a caller with no board (a
// fight played without a grid) has nothing to hand them, and decides for
// itself that every positional gate passes.

// creating.tex "Size and Space Occupation": the cells a character covers
// around its anchor, before it is placed: its shape at its size's cell count,
// in orientation 0.
export function getShapeCells(c: Character): readonly Coord[] {
  return FOOTPRINTS[c.shape][FOOTPRINT_CELLS[getSize(c) - 1]]
}

// The cells a placed character covers on the board: its shape turned to the
// placement's orientation and moved to its anchor.
export function getFootprint(c: Character, placement: Placement): Coord[] {
  return getShapeCells(c).map((offset) => add(placement.cell, rotate(offset, placement.orientation)))
}

// Who stands on each cell, keyed like the terrain. A cell shared by two
// characters (creating.tex allows it mid-turn) lists both.
export function getOccupancy(board: Board, characters: Record<string, Character>): Record<string, string[]> {
  const occupancy: Record<string, string[]> = {}
  for (const [id, placement] of Object.entries(board.placements)) {
    const c = characters[id]
    if (!c) continue
    for (const cell of getFootprint(c, placement)) {
      const key = coordKey(cell)
      occupancy[key] = [...(occupancy[key] ?? []), id]
    }
  }
  return occupancy
}

// gear.tex "Short, Long I/II" and "Scaling weapons" ("multiply ... reach by
// the RM"): a melee attack's reach in metres, which is cells, at the
// weapon's own size.
export function getReach(weapon: Weapon, range: MeleeRange): number {
  return REACH[range] * RMArr[weapon.scale - 1]
}
