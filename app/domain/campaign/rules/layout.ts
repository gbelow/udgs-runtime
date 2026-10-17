import type { CrawlMap } from '../types'

// Where a map's nodes sit on the page it is drawn on: the node's own place
// when it has one, else a place on a ring around the middle.

export const MAP_WIDTH = 1000
export const MAP_HEIGHT = 600
const MARGIN = 40
const SPACING = 130
const RING = 200

export type Point = { x: number; y: number }

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)

// The nearest place on the page to this one.
export function clampToMap({ x, y }: Point): Point {
  return { x: Math.round(clamp(x, MARGIN, MAP_WIDTH - MARGIN)), y: Math.round(clamp(y, MARGIN, MAP_HEIGHT - MARGIN)) }
}

export function getNodePositions(map: CrawlMap): Record<string, Point> {
  const entries = Object.entries(map.nodes)
  const unplaced = entries.filter(([, n]) => n.x === null || n.y === null).map(([id]) => id)
  return Object.fromEntries(entries.map(([id, n]) => {
    if (n.x !== null && n.y !== null) return [id, { x: n.x, y: n.y }]
    const angle = (2 * Math.PI * unplaced.indexOf(id)) / unplaced.length - Math.PI / 2
    return [id, clampToMap({ x: MAP_WIDTH / 2 + RING * Math.cos(angle), y: MAP_HEIGHT / 2 + RING * Math.sin(angle) })]
  }))
}

// The first place on a grid with no node close to it, for a node added
// without being put anywhere.
export function getFreeSpot(map: CrawlMap): Point {
  const taken = Object.values(getNodePositions(map))
  for (let y = 100; y <= MAP_HEIGHT - MARGIN; y += SPACING) {
    for (let x = 100; x <= MAP_WIDTH - MARGIN; x += SPACING) {
      if (taken.every((p) => Math.hypot(p.x - x, p.y - y) >= SPACING * 0.9)) return { x, y }
    }
  }
  return { x: MAP_WIDTH / 2, y: MAP_HEIGHT / 2 }
}

// The map with every node put where it is drawn, so that placing one does
// not move the nodes that had no place of their own.
export function getPlacedMap(map: CrawlMap): CrawlMap {
  const at = getNodePositions(map)
  return { ...map, nodes: Object.fromEntries(Object.entries(map.nodes).map(([id, n]) => [id, { ...n, ...at[id] }])) }
}
