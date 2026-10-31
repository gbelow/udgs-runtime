import type { CampaignCharacter } from '../../../types'
import type { SceneState, Coord, LightLevel } from '../../types'
import { SPELL_LIGHT, WINDOW_LIGHT } from '../../../tables'
import { LIGHT_LEVELS } from '../../../lists'
import { coordKey, disk, distance, inExtent, sameCell } from './geometry'
import { getPlacedFootprint, getRoofs, getTerrainAt, isFloorBetween, seesAcross, type Footing } from './board'
import { getHeight } from '../../../character/rules/size'
import { perState } from '../../../perState'
import { isSuppressed } from '../../../character/rules/effects'

// combat.tex "Darkness and light": "In a situation of darkness, the field of
// vision is determined by the light source ... Anyone in the light radius is
// visible and anyone out is not. Dim light means partial impairment". The
// board has a light everywhere, and darkness painted on some ground; a light
// source makes its radius bright, and walls cast shadow. Light comes from
// what is held in hand or lies on the floor: an item that gives light of its
// own, or one a spell was cast into. A floor under a roof has no light of its
// own (the table's ruling): it takes the light outside through a window or a
// doorway (`WINDOW_LIGHT`), and a source's.

// A source, the floor it is on and how high it shines from.
type Light = { cells: Coord[]; radius: number; floor: number; height: number }

// The radius each item a spell lit shines with, by item id.
function getCastLights(state: SceneState): Map<string, number> {
  const lit = new Map<string, number>()
  for (const c of Object.values(state.characters)) {
    for (const entry of c.active) {
      const radius = entry.kind === 'light' && entry.itemId ? SPELL_LIGHT[entry.key] : undefined
      if (radius !== undefined && entry.itemId) lit.set(entry.itemId, Math.max(radius, lit.get(entry.itemId) ?? 0))
    }
  }
  return lit
}

// Computed once per state: a view asks for the light on every cell.
const getLights = perState((state: SceneState): Light[] => {
  const cast = getCastLights(state)
  const radiusOf = (item: { id: string; light: number | null }) => {
    const radii = [item.light, cast.get(item.id)].filter((r): r is number => r !== null && r !== undefined)
    return radii.length === 0 ? null : Math.max(...radii)
  }
  const board = state.board
  const held = Object.values(state.characters).flatMap((c) => {
    const radii = c.held.map(radiusOf).filter((r): r is number => r !== null)
    const cells = radii.length === 0 ? null : getPlacedFootprint(state, c.id)
    const placement = board?.placements[c.id]
    if (!cells || !board || !placement) return []
    return [{ cells, radius: Math.max(...radii), floor: getTerrainAt(board, placement.cell, placement.elevation).floor, height: placement.elevation + getHeight(c) }]
  })
  const lying = state.floor.flatMap(({ item, cell }) => {
    const radius = radiusOf(item)
    const floor = cell ? board?.terrain[coordKey(cell)]?.elevation ?? 0 : 0
    return radius !== null && cell ? [{ cells: [cell], radius, floor, height: floor }] : []
  })
  return [...held, ...lying]
})

const darker = (light: LightLevel): LightLevel => LIGHT_LEVELS[Math.min(LIGHT_LEVELS.indexOf(light) + 1, LIGHT_LEVELS.length - 1)]
const brighter = (a: LightLevel, b: LightLevel): LightLevel => (LIGHT_LEVELS.indexOf(a) <= LIGHT_LEVELS.indexOf(b) ? a : b)

// The light a floor has with no source: dark where darkness is painted on it,
// the board's under the sky, and under a roof the best that comes in from an
// open floor outside it sees, by how far that is.
function getAmbient(state: SceneState, cell: Coord, at: Footing): LightLevel {
  const board = state.board!
  if (at.terrain?.dark) return 'dark'
  if (getRoofs(board, cell, at.floor).length === 0) return board.light
  const eyes = { from: at.floor + WINDOW_LIGHT.height, to: at.floor + WINDOW_LIGHT.height }
  let best: LightLevel = 'dark'
  for (const out of disk(cell, WINDOW_LIGHT.fading)) {
    if (sameCell(out, cell) || !inExtent(board.origin, board.extent, out)) continue
    const there = getTerrainAt(board, out, at.floor)
    if (there.terrain?.blocking || getRoofs(board, out, there.floor).length > 0) continue
    const outside = there.terrain?.dark ? 'dark' : board.light
    const light = distance(out, cell) <= WINDOW_LIGHT.full ? outside : darker(outside)
    if (light !== brighter(light, best) || light === best) continue
    if (seesAcross(board, [out], [cell], eyes)) best = light
    if (best === board.light) break
  }
  return best
}

// Computed once per state and floor: a view asks for the light on every cell.
const getAmbients = perState((_: SceneState) => new Map<string, LightLevel>())
function getAmbientOnce(state: SceneState, cell: Coord, at: Footing): LightLevel {
  const known = getAmbients(state)
  const key = `${coordKey(cell)}@${at.floor}`
  const light = known.get(key) ?? getAmbient(state, cell, at)
  known.set(key, light)
  return light
}

// Whether a source reaches the floor: within its radius, no solid floor
// between the two in either cell, and a line from where it shines to over
// the floor.
function reaches(state: SceneState, light: Light, cell: Coord, at: Footing): boolean {
  const board = state.board!
  if (!light.cells.some((c) => distance(c, cell) <= light.radius)) return false
  if (isFloorBetween(board, cell, light.floor, at.floor) || light.cells.every((c) => isFloorBetween(board, c, light.floor, at.floor))) return false
  return seesAcross(board, light.cells, [cell], { from: light.height, to: at.floor + WINDOW_LIGHT.height })
}

// The light on a floor of a cell, the one whose feet are at `feet` stand on
// (the ground when not given): bright where a source reaches it, otherwise
// its own; `lit` where a source made it brighter.
export function getCellLighting(state: SceneState, cell: Coord, feet?: number): { light: LightLevel; lit: boolean } {
  const board = state.board
  if (!board) return { light: 'bright', lit: false }
  const ground = board.terrain[coordKey(cell)]
  const at = feet === undefined ? { terrain: ground, floor: ground?.elevation ?? 0, level: null } : getTerrainAt(board, cell, feet)
  const own = getAmbientOnce(state, cell, at)
  if (own === 'bright') return { light: own, lit: false }
  const lit = getLights(state).some((l) => reaches(state, l, cell, at))
  return { light: lit ? 'bright' : own, lit }
}

export function getCellLight(state: SceneState, cell: Coord, feet?: number): LightLevel {
  return getCellLighting(state, cell, feet).light
}

// Whether no light reaches the cell.
export function isUnlit(state: SceneState, cell: Coord): boolean {
  return getCellLight(state, cell) === 'dark'
}

// The light whoever stands on the cells, feet at `feet`, is in: the
// brightest of them.
export function getLightAt(state: SceneState, cells: readonly Coord[], feet?: number): LightLevel {
  return cells.length === 0 ? 'bright' : LIGHT_LEVELS[Math.min(...cells.map((cell) => LIGHT_LEVELS.indexOf(getCellLight(state, cell, feet))))]
}

// The light a character stands in; bright off the board.
export function getLightOf(state: SceneState, id: string): LightLevel {
  return getLightAt(state, getPlacedFootprint(state, id) ?? [], state.board?.placements[id]?.elevation)
}

// gear.tex "Darkseeing": "Allows seeing in dim light at high quality" — dim
// light is no impairment to whoever has it in them.
export function seesInDimLight(c: CampaignCharacter): boolean {
  return isSuppressed(c, 'light:dim')
}
