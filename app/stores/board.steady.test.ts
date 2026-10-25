import { describe, expect, it } from 'vitest'
import { openHarness, type Harness } from './boardHarness'
import { archer, fighter, rangedTrained } from '../domain/bot/fixtures'
import { getActionPanel } from '../domain/scene/projections/actionPanel'
import { getOpenAction } from '../domain/scene/rules/log'
import { sameCell } from '../domain/scene/rules/board/geometry'
import type { Coord } from '../domain/scene/types'

// A shot made on a careful path, from declaration to the steps walked after
// it, over the real combat store. Expected values are what was clicked and
// pressed: the path drawn, the step it is fired from, where the shooter stands.

// Ann with a bow and Steady Arms, a shot declared with the grant's toggle on,
// and Bob in range.
function scene(): Harness {
  const h = openHarness()
  h.bring(rangedTrained(archer('Ann')), fighter('Bob'))
  h.createBoard(8)
  h.select('Ann')
  h.cell(0, 0)
  h.select('Bob')
  h.cell(6, 0)
  h.select('Ann')
  h.startTurn()
  h.declare({ kind: 'shoot' })
  const panel = () => getActionPanel(h.state())
  const quick = panel().attacks.find((a) => a.variant === 'quick') ?? panel().attacks[0]
  h.amend({ weaponKey: quick.weaponKey, attack: quick.attack, variant: quick.variant })
  h.amend({ ammoId: panel().ammo[0].itemId })
  h.amend({ modifiers: { steadyArms: true } })
  return h
}

const open = (h: Harness) => getOpenAction(h.state())
const path = (h: Harness): Coord[] => {
  const o = open(h)
  return o?.kind === 'shoot' ? o.path : []
}
const stands = (h: Harness, name: string): Coord => h.state().board!.placements[h.idOf(name)].cell

// A click on the farthest cell the view offers, which draws the longest path
// there is to draw.
function drawLongPath(h: Harness) {
  const far = h.view().cells.filter((c) => c.reachable !== null).sort((a, b) => (b.reachable?.steps ?? 0) - (a.reachable?.steps ?? 0))[0]
  h.cell(far.cell.q, far.cell.r)
}

// Every step of the drawn path the panel offers to fire from.
function stepsOffered(): number[] {
  const h = scene()
  drawLongPath(h)
  return getActionPanel(h.state()).open!.steady!.steps.map((s) => s.at)
}

describe('declaring a shot on a careful path', () => {
  // The view says which cells a click would add to the path: a click on one
  // of them ends the path there, and a click on any other leaves it alone.
  it('draws the path to every cell the view offers and ignores every other', () => {
    const cells = scene().view().cells
    expect(cells.some((c) => c.reachable !== null)).toBe(true)
    for (const cell of cells) {
      const h = scene()
      h.cell(cell.cell.q, cell.cell.r)
      const drawn = path(h)
      if (cell.reachable !== null) expect(sameCell(drawn.at(-1)!, cell.cell), `clicking ${cell.cell.q},${cell.cell.r}`).toBe(true)
      else expect(drawn, `clicking ${cell.cell.q},${cell.cell.r}`).toEqual([])
    }
  })

  it('walks the steps before the one it is fired from, then fires', () => {
    for (const at of stepsOffered()) {
      const h = scene()
      drawLongPath(h)
      const drawn = path(h)
      h.amend({ firedAt: at })
      h.token('Bob')
      h.commit()
      expect(open(h), `fired from step ${at}`).toMatchObject({ kind: 'shoot', step: 'react' })
      expect(stands(h, 'Ann'), `fired from step ${at}`).toEqual(at === 0 ? { q: 0, r: 0 } : drawn[at - 1])
    }
  })

  it('offers the steps after the shot once it has landed, and ends where the path does', () => {
    for (const at of stepsOffered()) {
      const h = scene()
      drawLongPath(h)
      const drawn = path(h)
      h.amend({ firedAt: at })
      h.token('Bob')
      h.commit()
      h.send({ kind: 'rollOrPay', args: [] })
      h.send({ kind: 'resolve', args: [] })
      if (at < drawn.length) {
        expect(open(h), `fired from step ${at}`).toMatchObject({ kind: 'move', step: 'define' })
        h.commit()
      } else {
        expect(open(h), `fired from step ${at}`).toBeNull()
      }
      expect(stands(h, 'Ann'), `fired from step ${at}`).toEqual(drawn.at(-1))
    }
  })
})
