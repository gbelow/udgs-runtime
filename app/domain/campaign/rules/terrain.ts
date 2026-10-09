import { z } from 'zod'
import terrainCatalog from '../../../assets/terrains.json'
import { TerrainSchema, type CrawlNode, type Terrain } from '../types'

// survival.tex "Terrain": "The same terrain can be reused for many nodes" —
// the presets, kept outside any map.
const TERRAINS: Record<string, Terrain> = z.record(z.string(), TerrainSchema).parse(terrainCatalog)

export function getTerrainPresets(): string[] {
  return Object.keys(TERRAINS)
}

// What a node is made of: its preset with what the node changes of it on
// top, read afresh so that a change to the preset reaches every node that
// keeps its value. A preset gone from the catalog leaves only the changes.
// Null for a node with neither.
export function getNodeTerrain(node: CrawlNode): Terrain | null {
  if (!node.terrain && Object.keys(node.custom).length === 0) return null
  const preset = node.terrain ? TERRAINS[node.terrain] : undefined
  return { ...TerrainSchema.parse({ name: node.terrain ?? '' }), ...preset, ...node.custom }
}
