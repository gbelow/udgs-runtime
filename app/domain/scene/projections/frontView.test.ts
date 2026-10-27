import { describe, it, expect } from 'vitest'
import { SceneStateSchema, type SceneState } from '../types'
import { paintTerrain } from '../commands/board'
import { getBoardView } from './boardView'
import { getFrontView } from './frontView'

function raised(): SceneState {
  let s: SceneState = SceneStateSchema.parse({ board: {} })
  const heights: [number, number, number][] = [[0, 0, 3], [1, 0, 1], [0, 1, 2], [-1, 1, 1]]
  for (const [q, r, metres] of heights) {
    for (let i = 0; i < metres; i++) s = paintTerrain({ q, r }, 'raise')(s)
  }
  return s
}

// The front view is a way of drawing the one board: it moves what is drawn and
// changes nothing the board says.
describe('the board seen from the front', () => {
  const view = getBoardView({ ...raised(), activeCharacterId: null })

  it('draws every cell the board has, saying the same of each', () => {
    const front = getFrontView(view, 0.3)
    expect(front.cells.map((c) => c.key)).toEqual(view.cells.map((c) => c.key))
    front.cells.forEach((c, i) => {
      const { x, y, band, ...same } = c
      const { x: x0, y: y0, band: band0, ...was } = view.cells[i]
      expect(same).toEqual(was)
    })
  })

  it('moves nothing when a metre lifts nothing', () => {
    const front = getFrontView(view, 0)
    expect(front.cells.map((c) => [c.x, c.y])).toEqual(view.cells.map((c) => [c.x, c.y]))
  })

  it('draws a wall only for a drop that exists', () => {
    const front = getFrontView(view, 0.3)
    const keys = new Set(front.cells.map((c) => c.key))
    for (const r of front.ridges) expect(keys.has(r.cell)).toBe(true)
    expect(front.ridges.length).toBeLessThanOrEqual(view.ridges.length)
  })
})
