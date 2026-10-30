import type { Board, Coord, Level, LevelCell, Structure, TerrainCell } from '../../types'
import { add, coordKey, inExtent, parseCoordKey, rotate, subtract } from './geometry'

// A structure is laid as one piece: its cells are written onto the board
// marked with the piece's id, the board's own ground under them kept on the
// piece, and lifting it takes those cells away and gives the ground back.
// Pieces never share a cell, on the ground or on a storey.

function rekey<T>(cells: Record<string, T>, move: (cell: Coord) => Coord): [string, T][] {
  return Object.entries(cells).flatMap(([key, cell]) => {
    const at = parseCoordKey(key)
    return at ? [[coordKey(move(at)), cell] as [string, T]] : []
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
  const taken = new Set(Object.keys(board.pieces).flatMap((other) => getPieceCells(board, other)))
  const fits = (key: string) => inExtent(board.origin, board.extent, parseCoordKey(key)!) && !taken.has(key)
  const ground = rekey(structure.terrain, place)
  const levels = structure.levels.map((level) => ({ level, cells: rekey(level.terrain, place) }))
  if (![...ground, ...levels.flatMap((l) => l.cells)].every(([key]) => fits(key))) return null
  const under = Object.fromEntries(ground.flatMap(([key]) => (board.terrain[key] ? [[key, board.terrain[key]]] : [])))
  const laid = ground.map(([key, cell]): [string, TerrainCell] => [key, { ...cell, elevation: cell.elevation + elevation, piece: id }])
  return {
    ...board,
    terrain: { ...board.terrain, ...Object.fromEntries(laid) },
    levels: [...board.levels, ...levels.map(({ level, cells }): Level => ({ ...level, floor: level.floor + elevation, piece: id, terrain: Object.fromEntries(cells) }))],
    pieces: { ...board.pieces, [id]: { name: structure.name, cell: anchor, rotation, elevation, under } },
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
export function getPieceStructure(board: Board, id: string): Structure | null {
  const piece = board.pieces[id]
  if (!piece) return null
  const unplace = (cell: Coord) => rotate(subtract(cell, piece.cell), 6 - piece.rotation)
  const own = Object.fromEntries(Object.entries(board.terrain).filter(([, cell]) => cell.piece === id))
  return {
    name: piece.name,
    terrain: Object.fromEntries(rekey(own, unplace).map(([key, cell]): [string, TerrainCell] => [key, { ...cell, elevation: cell.elevation - piece.elevation, piece: null, layers: [] }])),
    levels: board.levels.filter((level) => level.piece === id).map((level) => ({
      ...level,
      floor: level.floor - piece.elevation,
      piece: null,
      terrain: Object.fromEntries(rekey(level.terrain, unplace).map(([key, cell]): [string, LevelCell] => [key, { ...cell, layers: [] }])),
    })),
  }
}
