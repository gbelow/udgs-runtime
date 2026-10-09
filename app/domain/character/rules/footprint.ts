import type { BodyPart, Character, Coord } from '../../types'
import type { FootprintPreset } from '../../lists'
import { FOOTPRINT_CELLS, PRESET_CELLS } from '../../tables'
import { DIRECTIONS, add, coordKey, sameCell } from '../../scene/rules/board/geometry'
import { getSize } from './size'

// creating.tex "Size and Space Occupation": the cells a creature covers, as
// offsets from the cell it is placed by. "Other creatures may have different
// shapes": the book leaves the layout open, so a footprint is drawn freely,
// and what holds of every one is only that it is a single piece around that
// cell.

export const ANCHOR: Coord = { q: 0, r: 0 }

export const isAnchor = (cell: Coord): boolean => sameCell(cell, ANCHOR)

export function inFootprint(footprint: readonly Coord[], cell: Coord): boolean {
  return footprint.some((c) => sameCell(c, cell))
}

// A part spread over the whole body is held by any footprint; one pinned to a
// cell only by a footprint covering it.
export function holdsPart(footprint: readonly Coord[], part: BodyPart): boolean {
  return part.cell === null || inFootprint(footprint, part.cell)
}

// The body on a new footprint: a part pinned to a cell it no longer covers
// sits on the anchor.
export function settleParts(footprint: readonly Coord[], body: BodyPart[]): BodyPart[] {
  return body.map((part) => (holdsPart(footprint, part) ? part : { ...part, cell: ANCHOR }))
}

// The preset's cells at the count the creature's size gives.
export function getPresetFootprint(c: Character, preset: FootprintPreset): Coord[] {
  return PRESET_CELLS[preset][FOOTPRINT_CELLS[getSize(c) - 1]].map((cell) => ({ ...cell }))
}

// Whole cells, none twice, the anchor among them, every one reached from the
// anchor through the others.
export function isSoundFootprint(footprint: readonly Coord[]): boolean {
  if (!footprint.every((c) => Number.isInteger(c.q) && Number.isInteger(c.r))) return false
  const keys = new Set(footprint.map(coordKey))
  if (keys.size !== footprint.length || !keys.has(coordKey(ANCHOR))) return false
  const reached = new Set([coordKey(ANCHOR)])
  const frontier = [ANCHOR]
  while (frontier.length > 0) {
    const cell = frontier.pop()!
    for (const d of DIRECTIONS) {
      const key = coordKey(add(cell, d))
      if (keys.has(key) && !reached.has(key)) {
        reached.add(key)
        frontier.push(add(cell, d))
      }
    }
  }
  return reached.size === keys.size
}
