import type { Board, Coord, Level, LevelCell, Piece, Structure, TerrainCell } from '../../types'
import { ROTATIONS, add, coordKey, inExtent, parseCoordKey, rotate, subtract, turnCorner } from './geometry'
import { FALL } from '../../../tables'

// A structure is laid as one piece: its cells are written onto the board
// marked with the piece's id, the board's own ground under them kept on the
// piece, and lifting it takes those cells away and gives the ground back.
// Pieces never share a cell of ground, nor a cell of storey within a cliff of
// each other's floor, unless both are lattice (two canopies grown together).

// The cells moved to where `move` puts them, each turned `steps` times about
// its own centre, so that the corners its thin walls cut and the sides they
// stand on turn with the piece, a side as the neighbour it faces does.
function rekey<T extends TerrainCell>(cells: Record<string, T>, move: (cell: Coord) => Coord, steps: number): [string, T][] {
  return Object.entries(cells).flatMap(([key, cell]) => {
    const at = parseCoordKey(key)
    return at ? [[coordKey(move(at)), { ...cell, chords: cell.chords.map((c) => turnCorner(c, steps)), sides: cell.sides.map((d) => ROTATIONS[(((d + steps) % 6) + 6) % 6]) }] as [string, T]] : []
  })
}

// Every cell the piece covers, on the ground or a storey, by key.
export function getPieceCells(board: Board, id: string): string[] {
  return [...new Set([
    ...Object.keys(board.terrain).filter((key) => board.terrain[key].piece === id),
    ...board.levels.filter((level) => level.piece === id).flatMap((level) => Object.keys(level.terrain)),
  ])]
}

// The board's own ground in the cell, under whatever piece covers it.
function getGroundUnder(board: Board, key: string): TerrainCell | undefined {
  const cell = board.terrain[key]
  const piece = cell?.piece ? board.pieces[cell.piece] : undefined
  return piece ? piece.under[key] : cell
}

// The board with the structure laid as the piece `id`, its anchor on `anchor`,
// turned `rotation` times, its heights raised by the ground under the anchor;
// null where a cell of it would fall beyond the board's edge or on another
// piece, or the id is taken.
export function layPiece(board: Board, id: string, structure: Structure, anchor: Coord, rotation: number): Board | null {
  if (board.pieces[id]) return null
  const elevation = getGroundUnder(board, coordKey(anchor))?.elevation ?? 0
  const place = (cell: Coord) => add(anchor, rotate(cell, rotation))
  const onBoard = (key: string) => inExtent(board.origin, board.extent, parseCoordKey(key)!)
  const others = board.levels.filter((level) => level.piece !== null)
  const clashes = (key: string, floor: number, cell: LevelCell) => others.some((level) => {
    const there = level.terrain[key]
    return there && Math.abs(level.floor + there.elevation - (floor + cell.elevation)) < FALL.minHeight && !(there.lattice && cell.lattice)
  })
  const ground = rekey(structure.terrain, place, rotation)
  const levels = structure.levels.map((level) => ({ level, cells: rekey(level.terrain, place, rotation) }))
  if (!ground.every(([key]) => onBoard(key) && !board.terrain[key]?.piece)) return null
  if (!levels.every(({ level, cells }) => cells.every(([key, cell]) => onBoard(key) && !clashes(key, level.floor + elevation, cell)))) return null
  const under = Object.fromEntries(ground.flatMap(([key]) => (board.terrain[key] ? [[key, board.terrain[key]]] : [])))
  const laid = ground.map(([key, cell]): [string, TerrainCell] => [key, { ...cell, elevation: cell.elevation + elevation, piece: id }])
  return {
    ...board,
    terrain: { ...board.terrain, ...Object.fromEntries(laid) },
    levels: [...board.levels, ...levels.map(({ level, cells }): Level => ({ ...level, floor: level.floor + elevation, piece: id, terrain: Object.fromEntries(cells) }))],
    pieces: { ...board.pieces, [id]: { name: structure.name, cell: anchor, rotation, elevation, under, art: structure.art } },
  }
}

// The board with the piece taken away and the ground under it given back.
export function liftPiece(board: Board, id: string): Board {
  const piece = board.pieces[id]
  if (!piece) return board
  const { [id]: _lifted, ...pieces } = board.pieces
  return {
    ...board,
    terrain: { ...Object.fromEntries(Object.entries(board.terrain).filter(([, cell]) => cell.piece !== id)), ...piece.under },
    levels: board.levels.filter((level) => level.piece !== id),
    pieces,
  }
}

// The piece as a structure again, as it now stands on the board: around its
// anchor, unturned, its heights from the ground it was laid on, with nothing
// an action left on it.
export function getPieceStructure(board: Pick<Board, 'terrain' | 'levels' | 'pieces'>, id: string): Structure | null {
  const piece = board.pieces[id]
  if (!piece) return null
  const own = Object.fromEntries(Object.entries(board.terrain).filter(([, cell]) => cell.piece === id).map(([key, cell]) => [key, { ...cell, elevation: cell.elevation - piece.elevation }]))
  return getStructureAt(piece, own, board.levels.filter((level) => level.piece === id).map((level) => ({ ...level, floor: level.floor - piece.elevation })))
}

// The structure whose ground and storeys stand on the board as these, already
// measured from the ground the piece was laid on, around the piece's anchor
// and turned back.
export function getStructureAt(piece: Piece, terrain: Record<string, TerrainCell>, levels: Level[]): Structure {
  const unplace = (cell: Coord) => rotate(subtract(cell, piece.cell), 6 - piece.rotation)
  return {
    name: piece.name,
    art: piece.art,
    extent: null,
    terrain: Object.fromEntries(rekey(terrain, unplace, 6 - piece.rotation).map(([key, cell]): [string, TerrainCell] => [key, { ...cell, piece: null, layers: [] }])),
    levels: levels.map((level) => ({
      ...level,
      piece: null,
      terrain: Object.fromEntries(rekey(level.terrain, unplace, 6 - piece.rotation).map(([key, cell]): [string, LevelCell] => [key, { ...cell, layers: [] }])),
    })),
  }
}

// The piece that covers the cell, on the ground or on any storey; null for
// none.
export function getPieceAt(board: Pick<Board, 'terrain' | 'levels'>, key: string): string | null {
  return board.terrain[key]?.piece ?? board.levels.find((level) => level.piece !== null && level.terrain[key])?.piece ?? null
}

// The place among the piece's own storeys of the board's storey `level`; null
// for the ground or a storey not the piece's.
export function getPieceLevel(board: Pick<Board, 'levels'>, id: string, level: number | null): number | null {
  if (level === null || board.levels[level]?.piece !== id) return null
  return board.levels.slice(0, level).filter((l) => l.piece === id).length
}
