import type { ScenePreset } from '../../campaign/types'
import type { BoardMap, Coord } from '../types'
import { BRUSH_RADIUS_MOST } from '../../lists'
import { coordKey, disk, inExtent } from '../rules/board/geometry'

// A prepared scene's spawn areas, painted over its battle map in the catalog:
// the cells around `cell` on the map put in party `party`'s area and taken out
// of every other party's, or with no party, out of every area.
export function paintPresetSpawn(map: BoardMap, party: number | null, cell: Coord, radius = 0): (preset: ScenePreset) => ScenePreset {
  return (preset) => {
    if (party !== null && !preset.parties[party]) return preset
    const reach = Number.isInteger(radius) ? Math.max(0, Math.min(BRUSH_RADIUS_MOST, radius)) : 0
    const keys = disk(cell, reach).filter((c) => inExtent(map.origin, map.extent, c)).map(coordKey)
    return {
      ...preset,
      parties: preset.parties.map((p, i) => {
        const kept = p.spawn.filter((key) => !keys.includes(key))
        return { ...p, spawn: i === party ? [...kept, ...keys] : kept }
      }),
    }
  }
}
