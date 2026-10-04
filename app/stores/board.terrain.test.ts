import { describe, expect, it } from 'vitest'
import { openHarness, type Harness } from './boardHarness'
import { fighter } from '../domain/bot/fixtures'

// Water and cliffs, painted with the brushes a player holds. Expected values
// are what the painting and the clicks asked for: where the walker ends, how
// deep they were sent, how high the ground they climbed to.

// A walker with the points to spend on a long swim or climb.
const strong = (name: string) => {
  const f = fighter(name)
  return { ...f, resources: { ...f.resources, AP: 30, STA: 30 } }
}

const placement = (h: Harness, name: string) => h.state().board!.placements[h.idOf(name)]
const pathOf = (h: Harness) => h.view().cells.filter((c) => c.pathStep !== null).sort((a, b) => a.pathStep! - b.pathStep!).map((c) => c.key)

const POND: [number, number][] = [[1, 0], [2, 0], [3, 0]]
const DEPTH = 3

// Ann at the origin by a pond DEPTH metres deep, declaring a swim.
function pond(): Harness {
  const h = openHarness()
  h.bring(strong('Ann'))
  h.createBoard(6)
  h.select('Ann')
  h.cell(0, 0)
  h.paint('water', POND)
  h.paint('deepen', POND, DEPTH)
  h.startTurn()
  h.declare({ kind: 'move' })
  h.amend({ movement: 'swim' })
  return h
}

describe('swimming', () => {
  it('draws the pond as water', () => {
    const h = pond()
    expect(h.view().cells.filter((c) => c.terrain === 'water').map((c) => c.key).sort()).toEqual(['1,0', '2,0', '3,0'])
  })

  it('leaves the swimmer where the path ends, at the surface', () => {
    const h = pond()
    h.cell(1, 0)
    h.cell(2, 0)
    h.commit()
    expect(placement(h, 'Ann').cell).toEqual({ q: 2, r: 0 })
    expect(placement(h, 'Ann').depth).toBe(0)
  })

  it('sends the swimmer down as far as the dive asks', () => {
    const h = pond()
    h.cell(1, 0)
    h.amend({ dive: 2 })
    h.commit()
    expect(placement(h, 'Ann').depth).toBe(2)
  })

  it('refuses a dive below the floor of the pond and leaves the swimmer where they were', () => {
    const h = pond()
    h.cell(1, 0)
    h.amend({ dive: DEPTH + 2 })
    const before = placement(h, 'Ann')
    h.commit()
    expect(placement(h, 'Ann')).toEqual(before)
    expect(placement(h, 'Ann').cell).toEqual({ q: 0, r: 0 })
  })

  it('shows the swimmer at the depth they were sent to', () => {
    const h = pond()
    h.cell(1, 0)
    h.amend({ dive: DEPTH })
    h.commit()
    expect(h.view().tokens.find((t) => t.id === h.idOf('Ann'))!.depth).toBe(DEPTH)
  })

  // The view says which cells a swim can reach; a click on one takes the path
  // there and a click on any other leaves it empty.
  it('ends the path on every cell the view offers and nowhere else', () => {
    const keys = pond().view().cells.map((c) => c.key)
    for (const key of keys) {
      const [q, r] = key.split(',').map(Number)
      const h = pond()
      const offered = h.view().cells.find((c) => c.key === key)!.reachable !== null
      h.cell(q, r)
      expect(pathOf(h).at(-1) ?? null, `clicking ${key}`).toBe(offered ? key : null)
    }
  })
})

const CLIFF: [number, number][] = [[1, 0]]
const HEIGHT = 2

// Ann at the origin below a cliff HEIGHT metres high, declaring a climb.
function cliff(gripped = true): Harness {
  const h = openHarness()
  h.bring(strong('Ann'))
  h.createBoard(6)
  h.select('Ann')
  h.cell(0, 0)
  h.paint('raise', CLIFF, HEIGHT)
  if (gripped) h.paint('grip', CLIFF)
  h.startTurn()
  h.declare({ kind: 'move' })
  h.amend({ movement: 'climb' })
  return h
}

describe('climbing', () => {
  it('stands the climber on the ground of the cell they climbed to', () => {
    const h = cliff()
    h.cell(1, 0)
    h.commit()
    expect(placement(h, 'Ann').cell).toEqual({ q: 1, r: 0 })
    expect(placement(h, 'Ann').elevation).toBe(HEIGHT)
  })

  it('ends the path on every cell the view offers and nowhere else', () => {
    const keys = cliff().view().cells.map((c) => c.key)
    for (const key of keys) {
      const [q, r] = key.split(',').map(Number)
      const h = cliff()
      const offered = h.view().cells.find((c) => c.key === key)!.reachable !== null
      h.cell(q, r)
      expect(pathOf(h).at(-1) ?? null, `clicking ${key}`).toBe(offered ? key : null)
    }
  })
})
