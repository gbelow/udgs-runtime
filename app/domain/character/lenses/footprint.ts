import type { Character, Coord } from '../../types'
import { FOOTPRINT_CELLS } from '../../tables'
import { DIRECTIONS, HEX_POINTS, add, coordKey, frameHexes, sameCell, toPlane } from '../../scene/rules/board/geometry'
import { getSize } from '../rules/size'
import { inFootprint, isAnchor, isSoundFootprint } from '../rules/footprint'

export type FootprintEditorCell = {
  key: string
  cell: Coord
  x: number
  y: number
  covered: boolean
  anchor: boolean
  // whether clicking it adds it to the footprint or takes it off
  toggles: boolean
  parts: { id: string; name: string }[]
}

// creating.tex "Size and Space Occupation", as the creature editor draws it:
// the cells the footprint covers and the ones beside them it could grow
// into, each with the parts that sit in it, and the cell count the size
// gives beside the count drawn. A part spread over the whole body sits in
// no one cell and is listed apart.
export type FootprintEditorView = {
  viewBox: string
  hex: string
  cells: FootprintEditorCell[]
  suggested: number
  count: number
  parts: { id: string; name: string; cell: string | null }[]
  spread: { id: string; name: string }[]
}

export function getFootprintEditor(c: Character): FootprintEditorView {
  const footprint = c.footprint
  const around = footprint.flatMap((cell) => DIRECTIONS.map((d) => add(cell, d))).filter((cell) => !inFootprint(footprint, cell))
  const seen = new Set<string>()
  const cells = [...footprint, ...around].filter((cell) => !seen.has(coordKey(cell)) && !!seen.add(coordKey(cell))).map((cell): FootprintEditorCell => {
    const covered = inFootprint(footprint, cell)
    const toggled = covered ? footprint.filter((f) => !sameCell(f, cell)) : [...footprint, cell]
    return {
      key: coordKey(cell),
      cell,
      ...toPlane(cell),
      covered,
      anchor: isAnchor(cell),
      toggles: !isAnchor(cell) && isSoundFootprint(toggled),
      parts: c.body.filter((part) => part.cell !== null && sameCell(part.cell, cell)).map((part) => ({ id: part.id, name: part.name })),
    }
  })
  return {
    viewBox: frameHexes(cells),
    hex: HEX_POINTS,
    cells,
    suggested: FOOTPRINT_CELLS[getSize(c) - 1],
    count: footprint.length,
    parts: c.body.map((part) => ({ id: part.id, name: part.name, cell: part.cell && coordKey(part.cell) })),
    spread: c.body.filter((part) => part.cell === null).map((part) => ({ id: part.id, name: part.name })),
  }
}
