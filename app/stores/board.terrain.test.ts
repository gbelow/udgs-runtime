import { describe, expect, it } from 'vitest'
import { openHarness, type Harness } from './boardHarness'
import { fighter } from '../domain/bot/fixtures'
import { getActionPanel } from '../domain/scene/projections/actionPanel'
import { addLevel, paintTerrain } from '../domain/scene/commands/board'
import { hasAffliction } from '../domain/character/rules/afflictions'

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

// A tree drawn as raised ground TREE metres high at (1, 0) with branches on
// the trunk as storeys at BRANCHES, painted with the brushes the battle map's
// editor holds, Ann beside it on the ground; `beside` puts lattice branches
// with something to hold in her own cell at those heights. Broke as: a climb always ended on
// the lowest branch, and nothing went on up from there.
const TRUNK = { q: 1, r: 0 }
const TREE = 9
const BRANCHES = [3, 6]

function tree(beside: number[] = []): Harness {
  const h = openHarness()
  h.bring(strong('Ann'))
  h.createBoard(6)
  h.select('Ann')
  h.cell(0, 0)
  h.paint('raise', [[TRUNK.q, TRUNK.r]], TREE)
  h.paint('grip', [[TRUNK.q, TRUNK.r]])
  BRANCHES.forEach((floor, level) => {
    h.press(addLevel(floor, BRANCHES[level + 1] === undefined ? TREE - floor : BRANCHES[level + 1] - floor))
    h.press(paintTerrain(TRUNK, 'floor', 0, level))
    h.press(paintTerrain(TRUNK, 'grip', 0, level))
    if (beside.includes(floor)) {
      h.press(paintTerrain({ q: 0, r: 0 }, 'lattice', 0, level))
      h.press(paintTerrain({ q: 0, r: 0 }, 'grip', 0, level))
    }
  })
  return h
}

// Declares a climb onto the face at `to`, stopping where the panel offers
// `floor` in `cell` (the end of the face when none is given), and plays it out.
function climb(h: Harness, to: [number, number], stop?: { floor: number; cell: [number, number] }) {
  h.startTurn()
  h.declare({ kind: 'move' })
  h.amend({ movement: 'climb' })
  h.cell(...to)
  if (stop) {
    const offer = getActionPanel(h.state()).open?.climbStops?.find((s) => s.floor === stop.floor && s.key === `${stop.cell[0]},${stop.cell[1]}`)
    expect(offer, `a stop at ${stop.floor} m in ${stop.cell}`).toBeDefined()
    h.amend({ ledge: { cell: offer!.cell, floor: offer!.floor } })
  }
  h.commit()
  for (const kind of ['roll', 'pay', 'resolve', 'skip'] as const) h.send({ kind, args: [] })
}

describe('climbing a tree with branches', () => {
  it('goes up the trunk to its top when no stop is picked', () => {
    const h = tree()
    climb(h, [1, 0])
    expect(placement(h, 'Ann')).toMatchObject({ cell: TRUNK, elevation: TREE, climb: null })
  })

  for (const floor of BRANCHES) {
    it(`stops on the trunk's branch at ${floor} m`, () => {
      const h = tree()
      climb(h, [1, 0], { floor, cell: [1, 0] })
      expect(placement(h, 'Ann')).toMatchObject({ cell: TRUNK, elevation: floor, climb: null })
    })
  }

  it('goes on up the trunk from a branch on it', () => {
    const h = tree()
    climb(h, [1, 0], { floor: BRANCHES[0], cell: [1, 0] })
    climb(h, [1, 0])
    expect(placement(h, 'Ann')).toMatchObject({ cell: TRUNK, elevation: TREE, climb: null })
  })

  it('stops on a branch beside the trunk, and goes on up the trunk from it', () => {
    const h = tree([BRANCHES[0]])
    climb(h, [1, 0], { floor: BRANCHES[0], cell: [0, 0] })
    expect(placement(h, 'Ann')).toMatchObject({ cell: { q: 0, r: 0 }, elevation: BRANCHES[0], climb: null })
    climb(h, [1, 0])
    expect(placement(h, 'Ann')).toMatchObject({ cell: TRUNK, elevation: TREE, climb: null })
  })
})

describe('climbing down a tree', () => {
  // Broke as: a climb down ended prone where the table rules it ends standing.
  it('climbs down from a branch of the trunk to the ground beside it, standing', () => {
    const h = tree()
    climb(h, [1, 0], { floor: BRANCHES[0], cell: [1, 0] })
    climb(h, [0, 0])
    expect(placement(h, 'Ann')).toMatchObject({ cell: { q: 0, r: 0 }, elevation: 0, climb: null })
    expect(hasAffliction(h.state().characters[h.idOf('Ann')], 'prone')).toBe(false)
  })
})

describe('jumping off a face', () => {
  // Broke as: a climber hanging on a face could only climb.
  it('lands where the jump was clicked, hanging no more', () => {
    const h = openHarness()
    h.bring(strong('Ann'))
    h.createBoard(6)
    h.select('Ann')
    h.cell(0, 0)
    h.paint('raise', [[1, 0]], 6)
    h.paint('grip', [[1, 0]])
    h.startTurn()
    h.declare({ kind: 'move' })
    h.amend({ movement: 'climb' })
    h.cell(1, 0)
    h.amend({ metres: 1 })
    h.commit()
    for (const kind of ['roll', 'pay', 'resolve', 'skip'] as const) h.send({ kind, args: [] })
    expect(placement(h, 'Ann').climb).not.toBeNull()
    h.declare({ kind: 'move' })
    h.amend({ movement: 'jump' })
    const landing = h.view().cells.find((c) => c.reachable !== null)
    expect(landing, 'a cell to jump to').toBeDefined()
    h.cell(landing!.cell.q, landing!.cell.r)
    h.commit()
    for (const kind of ['roll', 'pay', 'resolve', 'skip'] as const) h.send({ kind, args: [] })
    expect(placement(h, 'Ann')).toMatchObject({ cell: landing!.cell, climb: null })
  })
})

// Broke as: two storeys at one height in a cell (pieces laid over each other)
// offered the same stop twice, which the panel cannot draw.
it('offers each floor on the way as one stop, however many storeys lie at its height', () => {
  const h = tree()
  h.press(addLevel(BRANCHES[0], BRANCHES[1] - BRANCHES[0]))
  h.press(paintTerrain(TRUNK, 'floor', 0, BRANCHES.length))
  h.press(paintTerrain(TRUNK, 'grip', 0, BRANCHES.length))
  h.startTurn()
  h.declare({ kind: 'move' })
  h.amend({ movement: 'climb' })
  h.cell(TRUNK.q, TRUNK.r)
  const stops = (getActionPanel(h.state()).open?.climbStops ?? []).map((s) => `${s.key}@${s.floor}`)
  expect(stops).toContain(`${TRUNK.q},${TRUNK.r}@${BRANCHES[0]}`)
  expect(new Set(stops).size).toBe(stops.length)
})
