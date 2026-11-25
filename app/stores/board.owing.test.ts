import { expect, it } from 'vitest'
import { openHarness } from './boardHarness'
import { spearman, swordsman } from '../domain/scene/fixtures'
import { getOwingPick } from '../domain/scene/projections/turn'

// A player looking at a foe when one of theirs was attacked was shown no
// answers, and the fight waited on them.
it('picks whoever of theirs is attacked while a foe is picked', () => {
  const h = openHarness()
  h.bring(swordsman('Bob'), spearman('Cy'))
  h.createBoard(6)
  h.select('Bob')
  h.cell(1, 0)
  h.select('Cy')
  h.cell(0, 0)
  h.send({ kind: 'nextRound', args: [] })
  for (let i = 0; i < 8 && h.state().roundStep !== null; i++) h.send({ kind: 'continueRound', args: [] })
  h.startTurn()
  const bob = h.idOf('Bob')
  const cy = h.idOf('Cy')
  h.pressMenu(h.menu({ on: 'token', id: bob })!.entries.find((e) => e.category === 'attack' && e.bar === null)!)
  h.commit()
  expect(getOwingPick(h.state(), [bob], cy)).toBe(bob)
  expect(getOwingPick(h.state(), [bob], null)).toBe(bob)
  // with every answer given, the roll was waited for and its actor was not picked
  h.send({ kind: 'pass', args: [bob] })
  expect(getOwingPick(h.state(), [cy], null)).toBe(cy)
})
