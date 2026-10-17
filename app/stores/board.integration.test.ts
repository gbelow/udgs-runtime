import { beforeEach, describe, expect, it } from 'vitest'
import { openHarness, type Harness } from './boardHarness'
import { fighter } from '../domain/bot/fixtures'
import { payAction, resolveAction, rollAction, withdrawSpawnedAction } from '../domain/scene/commands/action'
import { getAvailableActions } from '../domain/scene/rules/options'

// Click to effect, over the real combat store: what a player does on the
// board and the panels, and what stands afterwards. Expected values are what
// the clicks asked for, never a rule's output.

const standsAt = (h: Harness, name: string) => h.view().cells.filter((c) => c.occupants.includes(h.idOf(name))).map((c) => c.key)

describe('placing characters by hand', () => {
  let h: Harness
  beforeEach(() => {
    h = openHarness()
    h.bring('Ann', 'Bob', 'Cy')
    h.createBoard(6)
  })

  it('starts with everyone unplaced', () => {
    expect(h.view().unplaced.map((u) => u.name).sort()).toEqual(['Ann', 'Bob', 'Cy'])
    expect(h.view().tokens).toEqual([])
  })

  it('puts the active character where the cell is clicked, and nobody else moves', () => {
    h.select('Ann')
    h.cell(0, 0)
    h.select('Bob')
    h.cell(3, -1)
    h.select('Cy')
    h.cell(-2, 2)
    expect(standsAt(h, 'Ann')).toEqual(['0,0'])
    expect(standsAt(h, 'Bob')).toEqual(['3,-1'])
    expect(standsAt(h, 'Cy')).toEqual(['-2,2'])
  })

  it('makes a clicked token the active character', () => {
    h.select('Ann')
    h.cell(0, 0)
    h.select('Bob')
    h.cell(3, -1)
    h.token('Ann')
    expect(h.active()).toBe(h.idOf('Ann'))
  })
})

// Ann, Bob and Cy on a board of radius 8, a wall painted by brush on each of
// `walls` before anyone acts, Ann declaring a move.
function scene(walls: [number, number][] = []): Harness {
  const h = openHarness()
  h.bring('Ann', 'Bob', 'Cy')
  h.createBoard(8)
  h.select('Ann')
  h.cell(0, 0)
  h.select('Bob')
  h.cell(0, 3)
  h.select('Cy')
  h.cell(-3, 0)
  h.holdBrush('wall')
  walls.forEach(([q, r]) => h.cell(q, r))
  h.holdBrush(null)
  h.send({ kind: 'nextRound', args: [] })
  h.send({ kind: 'continueRound', args: [] })
  h.select('Ann')
  h.startTurn()
  h.declare({ kind: 'move' })
  return h
}

const pathOf = (h: Harness) => h.view().cells.filter((c) => c.pathStep !== null).sort((a, b) => a.pathStep! - b.pathStep!).map((c) => c.key)

describe('walking a move across the board', () => {
  it('opens the board to path edits', () => {
    expect(scene().view().mode).toBe('path')
  })

  it('draws the path click by click and takes the last cell back when it is clicked again', () => {
    const h = scene()
    h.cell(1, 0)
    h.cell(2, 0)
    expect(pathOf(h)).toEqual(['1,0', '2,0'])
    h.cell(2, 0)
    expect(pathOf(h)).toEqual(['1,0'])
  })

  it('does not walk into a wall', () => {
    const h = scene([[2, 0]])
    h.cell(1, 0)
    h.cell(2, 0)
    expect(pathOf(h)).toEqual(['1,0'])
  })

  it('does not place anyone by hand while the move is open', () => {
    const h = scene()
    h.cell(1, 0)
    h.select('Bob')
    h.cell(5, 5)
    expect(standsAt(h, 'Bob')).toEqual(['0,3'])
  })

  it('leaves the walker standing on the last cell of the path once the move is committed', () => {
    const h = scene()
    h.cell(1, 0)
    h.cell(2, 0)
    h.commit()
    expect(standsAt(h, 'Ann')).toEqual(['2,0'])
    expect(standsAt(h, 'Bob')).toEqual(['0,3'])
    expect(standsAt(h, 'Cy')).toEqual(['-3,0'])
  })

  // The view says which cells a move can reach; a click on one of them takes
  // the path there, and a click on any other leaves it empty.
  it('ends the path on every cell the view offers and nowhere else', () => {
    const walls: [number, number][] = [[1, 0], [1, -1], [-1, 2]]
    const keys = scene(walls).view().cells.map((c) => c.key)
    for (const key of keys) {
      const [q, r] = key.split(',').map(Number)
      const h = scene(walls)
      const offered = h.view().cells.find((c) => c.key === key)!.reachable !== null
      h.cell(q, r)
      expect(pathOf(h).at(-1) ?? null, `clicking ${key}`).toBe(offered ? key : null)
    }
  })
})

// The fuzzer found a mover who passed an evader and was then blocked: they were
// stopped a space short of the blocker, which was the evader's own space, and
// two characters stood on one.
describe('a move blocked after passing someone who evaded', () => {
  it('leaves the mover on a space nobody else stands on', () => {
    const h = openHarness()
    h.bring(fighter('Cy'), fighter('Bob'), fighter('Fay'))
    h.createBoard(4)
    for (const [name, q, r] of [['Cy', 0, 1], ['Bob', 1, 0], ['Fay', 2, -1]] as const) {
      h.select(name)
      h.cell(q, r)
    }
    h.select('Cy')
    h.startTurn()
    h.declare({ kind: 'move' })
    h.cell(1, 0)
    h.cell(2, -1)
    h.cell(2, -2)
    h.commit()
    const evade = getAvailableActions(h.state(), h.idOf('Bob')).find((o) => o.draft.kind === 'evade' && o.available)!
    h.send({ kind: 'react', args: [h.idOf('Bob'), evade.draft] })
    for (let i = 0; i < 3; i++) for (const step of [rollAction(h.dice, h.newId), payAction(h.newId, h.dice), resolveAction(h.newId, h.dice), withdrawSpawnedAction(h.dice, h.newId)]) h.press(step)
    const stands = Object.entries(h.state().board!.placements).map(([id, p]) => `${p.cell.q},${p.cell.r}:${id}`)
    const cells = stands.map((s) => s.split(':')[0])
    expect(new Set(cells).size).toBe(cells.length)
    expect(h.view().tokens).toHaveLength(3)
  })
})
