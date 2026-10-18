import type { CampaignCharacter } from '../../../types'
import type { SceneState, Coord, LightLevel } from '../../types'
import { SPELL_LIGHT } from '../../../tables'
import { LIGHT_LEVELS } from '../../../lists'
import { coordKey, distance } from './geometry'
import { getPlacedFootprint, seesAcross } from './board'
import { perState } from '../../../perState'
import { isSuppressed } from '../../../character/rules/effects'

// combat.tex "Darkness and light": "In a situation of darkness, the field of
// vision is determined by the light source ... Anyone in the light radius is
// visible and anyone out is not. Dim light means partial impairment". The
// board has a light everywhere, and darkness painted on some ground; a light
// source makes its radius bright, and walls cast shadow. Light comes from
// what is held in hand or lies on the floor: an item that gives light of its
// own, or one a spell was cast into.

type Light = { cells: Coord[]; radius: number }

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
  const held = Object.values(state.characters).flatMap((c) => {
    const radii = c.held.map(radiusOf).filter((r): r is number => r !== null)
    const cells = radii.length === 0 ? null : getPlacedFootprint(state, c.id)
    return cells ? [{ cells, radius: Math.max(...radii) }] : []
  })
  const lying = state.floor.flatMap(({ item, cell }) => {
    const radius = radiusOf(item)
    return radius !== null && cell ? [{ cells: [cell], radius }] : []
  })
  return [...held, ...lying]
})

// The light on a cell: bright where a light source reaches it, otherwise
// the board's, dark where darkness is painted.
export function getCellLight(state: SceneState, cell: Coord): LightLevel {
  const board = state.board
  if (!board) return 'bright'
  const unlit = board.terrain[coordKey(cell)]?.dark ? 'dark' : board.light
  if (unlit === 'bright') return 'bright'
  const reached = getLights(state).some((l) => l.cells.some((at) => distance(at, cell) <= l.radius) && seesAcross(board, l.cells, [cell]))
  return reached ? 'bright' : unlit
}

// Whether no light reaches the cell.
export function isUnlit(state: SceneState, cell: Coord): boolean {
  return getCellLight(state, cell) === 'dark'
}

// The light whoever stands on the cells is in: the brightest of them.
export function getLightAt(state: SceneState, cells: readonly Coord[]): LightLevel {
  return cells.length === 0 ? 'bright' : LIGHT_LEVELS[Math.min(...cells.map((cell) => LIGHT_LEVELS.indexOf(getCellLight(state, cell))))]
}

// The light a character stands in; bright off the board.
export function getLightOf(state: SceneState, id: string): LightLevel {
  return getLightAt(state, getPlacedFootprint(state, id) ?? [])
}

// gear.tex "Darkseeing": "Allows seeing in dim light at high quality" — dim
// light is no impairment to whoever has it in them.
export function seesInDimLight(c: CampaignCharacter): boolean {
  return isSuppressed(c, 'light:dim')
}
