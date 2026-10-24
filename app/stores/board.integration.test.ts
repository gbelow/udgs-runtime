import { beforeEach, describe, expect, it } from 'vitest'
import { openHarness, type Harness } from './boardHarness'
import { brawler, fighter, spearman, warden } from '../domain/bot/fixtures'
import { payAction, resolveAction, rollAction, withdrawSpawnedAction } from '../domain/scene/commands/action'
import { getAvailableActions } from '../domain/scene/rules/options'
import { getOpenAction } from '../domain/scene/rules/log'
import { coordKey, directionTo, sidesBetween } from '../domain/scene/rules/board/geometry'
import { getReachableCells } from '../domain/scene/rules/board/reach'
import { isPathLegal } from '../domain/scene/rules/move'

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

const pathOf = (h: Harness) => { const open = getOpenAction(h.state()); return open?.kind === 'move' ? open.path.map(coordKey) : [] }

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

describe('drawing a move in segments', () => {
  it('keeps the path drawn and walks on from its end to a cell further off', () => {
    const h = scene()
    h.cell(2, 0)
    h.cell(2, 2)
    const path = pathOf(h)
    expect(path.slice(0, 2)).toEqual(['1,0', '2,0'])
    expect(path.at(-1)).toBe('2,2')
  })

  it('takes the whole last segment back when the end is clicked, and again from the segment before', () => {
    const h = scene()
    h.cell(2, 0)
    h.cell(2, 2)
    h.cell(2, 2)
    expect(pathOf(h)).toEqual(['1,0', '2,0'])
    h.cell(2, 0)
    expect(pathOf(h)).toEqual([])
  })

  it('takes the last segment back from the panel', () => {
    const h = scene()
    h.cell(2, 0)
    h.cell(2, 2)
    h.send({ kind: 'backSegment', args: [] })
    expect(pathOf(h)).toEqual(['1,0', '2,0'])
  })

  it('cuts the path back to a cell on it that is clicked', () => {
    const h = scene()
    h.cell(2, 0)
    h.cell(2, 2)
    h.cell(1, 0)
    expect(pathOf(h)).toEqual(['1,0'])
  })

  // From a segment already drawn, a click on a cell the view offers ends the
  // path there with the segment kept, and a click on any other off the path
  // leaves the path as it was.
  it('walks on to every cell the view offers from the end of the path, and nowhere else', () => {
    const walls: [number, number][] = [[1, 1], [2, -1]]
    const h = scene(walls)
    h.cell(2, 0)
    const before = pathOf(h)
    for (const { key, reachable } of h.view().cells) {
      const [q, r] = key.split(',').map(Number)
      h.amend({ path: [] })
      h.cell(2, 0)
      h.cell(q, r)
      const path = pathOf(h)
      if (reachable !== null) {
        expect(path.slice(0, before.length), `clicking ${key}`).toEqual(before)
        expect(path.at(-1), `clicking ${key}`).toBe(key)
      } else if (key !== '0,0' && !before.includes(key)) {
        expect(path, `clicking ${key}`).toEqual(before)
      }
    }
  })

  // combat.tex "Movement": "The maximum turn rate during running is 60
  // degrees", one side of a hex a step; and every way offered is one the
  // move accepts.
  it('never offers a run that turns more than a side a step', () => {
    const h = scene()
    h.amend({ movement: 'run' })
    h.cell(2, 0)
    const move = getOpenAction(h.state())
    if (move?.kind !== 'move') throw new Error('no move open')
    const offered = getReachableCells(h.state(), move)
    expect(offered.length).toBeGreaterThan(0)
    for (const { cell, path } of offered) {
      const cells = [{ q: 0, r: 0 }, ...path]
      const ways = path.map((p, i) => directionTo(cells[i], p))
      ways.slice(1).forEach((way, i) => expect(sidesBetween(ways[i], way), `running to ${cell.q},${cell.r}`).toBeLessThanOrEqual(1))
      expect(isPathLegal(h.state(), { ...move, path }), `running to ${cell.q},${cell.r}`).toBe(true)
    }
  })
})

// The fuzzer found a runner who passed through someone's space and was hooked
// by them there: while the attack was fought the runner stood in the hooker's
// space, and two characters stood on one.
describe('a run hooked in the space of the one who hooked it', () => {
  it('never leaves the runner on a space someone else stands on', () => {
    const h = openHarness(() => 9)
    h.bring(brawler('Ann'), warden('Bob'))
    h.createBoard(4)
    h.select('Ann')
    h.cell(0, 0)
    h.select('Bob')
    h.cell(4, -1)
    h.startTurn()
    h.declare({ kind: 'move' })
    h.amend({ movement: 'run', path: [{ q: 4, r: -2 }, { q: 4, r: -3 }, { q: 3, r: -3 }, { q: 2, r: -2 }, { q: 1, r: -1 }, { q: 0, r: 0 }, { q: 0, r: 1 }, { q: 0, r: 2 }, { q: 0, r: 3 }] })
    h.commit()
    const ann = h.idOf('Ann')
    const gauntlet = h.state().characters[ann].body.find((part) => part.itemId !== '')?.itemId ?? ''
    h.send({ kind: 'react', args: [ann, { kind: 'opportunityAttack', at: 7 }] })
    h.send({ kind: 'amendReaction', args: [ann, { weaponKey: gauntlet, attack: 'grapple', variant: 'hook', catch: true }] })
    const stands: string[][] = []
    for (let i = 0; i < 3; i++) for (const step of [rollAction(h.dice, h.newId), payAction(h.newId, h.dice), resolveAction(h.newId, h.dice), withdrawSpawnedAction(h.dice, h.newId)]) {
      h.press(step)
      stands.push(Object.values(h.state().board!.placements).map((p) => coordKey(p.cell)))
    }
    for (const cells of stands) {
      expect(cells).toHaveLength(2)
      expect(new Set(cells).size).toBe(2)
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

// Answering with nothing was dropped for anyone with no answer open to them (a
// caster on the focus surge, say), so their button never lit and looked broken.
describe('answering a move with nothing', () => {
  it('is recorded for everyone who may answer, whether or not they had an answer open', () => {
    const h = openHarness()
    h.bring(fighter('Cy'), fighter('Bob'), fighter('Fay'), fighter('Dee'))
    h.createBoard(4)
    for (const [name, q, r] of [['Cy', 0, 1], ['Bob', 1, 0], ['Fay', 2, -1], ['Dee', -3, 3]] as const) {
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
    const others = ['Bob', 'Fay', 'Dee'].map((n) => h.idOf(n))
    expect(getAvailableActions(h.state(), h.idOf('Dee')).some((o) => o.available)).toBe(false)
    for (const id of others) h.send({ kind: 'pass', args: [id] })
    expect(getOpenAction(h.state())?.passed.sort()).toEqual(others.sort())
  })
})

// An opportunity attack was offered whenever any attack the reactor holds
// reaches the mover's space, and only once declared did it turn out that the
// attack they could actually pick did not: the table waited on a reaction that
// could not be made, with no reason given. A spear's reach is cut by a metre
// for whoever stands below the mover.
describe('a move past someone whose attacks cannot reach it', () => {
  const stillWaiting = (lowered: [number, number][]) => {
    const h = openHarness()
    h.bring(fighter('Cy'), spearman('Bob'))
    h.createBoard(7)
    h.paint('lower', lowered)
    for (const [name, q, r] of [['Cy', 0, 0], ['Bob', 3, 1]] as const) {
      h.select(name)
      h.cell(q, r)
    }
    h.select('Cy')
    h.startTurn()
    h.declare({ kind: 'move' })
    for (const [q, r] of [[1, 0], [2, 0], [3, 0]] as const) h.cell(q, r)
    h.commit()
    return getOpenAction(h.state()) !== null
  }

  it('waits on the reaction when it can be made', () => {
    expect(stillWaiting([])).toBe(true)
  })

  it('does not wait on one that cannot', () => {
    expect(stillWaiting([[3, 1]])).toBe(false)
  })
})
