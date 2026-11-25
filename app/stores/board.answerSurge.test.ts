import { describe, expect, it } from 'vitest'
import { openHarness, type Harness } from './boardHarness'
import { archer, spearman, swordsman } from '../domain/scene/fixtures'
import { getAvailableActions } from '../domain/scene/rules/options'
import { getActionOffers } from '../domain/scene/projections/actionPanel'
import { getBoardView } from '../domain/scene/projections/boardView'

// Answers made on a surge, over the real combat store.

// Cy strikes Bob, who has no AP of their own left to answer with.
function struck(): Harness {
  const h = openHarness()
  h.bring(swordsman('Bob'), spearman('Cy'))
  h.createBoard(6)
  h.select('Bob')
  h.cell(1, 0)
  h.select('Cy')
  h.cell(0, 0)
  h.send({ kind: 'nextRound', args: [] })
  for (let i = 0; i < 8 && h.state().roundStep !== null; i++) h.send({ kind: 'continueRound', args: [] })
  const id = h.idOf('Bob')
  h.press((s) => ({ ...s, characters: { ...s.characters, [id]: { ...s.characters[id], resources: { ...s.characters[id].resources, AP: 0 } } } }))
  h.startTurn()
  h.pressMenu(h.menu({ on: 'token', id })!.entries.find((e) => e.category === 'attack' && e.bar === null)!)
  h.commit()
  return h
}

const onSurge = (h: Harness) => getAvailableActions(h.state(), h.idOf('Bob')).filter((o) => o.available && o.surge !== null)

describe('an answer made on a surge', () => {
  // Taking an answer back left the surge it was made with spent.
  it('gives the surge back when it is taken back', () => {
    for (const i of onSurge(struck()).keys()) {
      const h = struck()
      const o = onSurge(h)[i]
      const id = h.idOf('Bob')
      const before = h.state()
      h.send({ kind: 'react', args: [id, o.draft, o.surge] })
      expect(h.state().characters[id].usedSurge).toBe(o.surge)
      h.send({ kind: 'back', args: [] })
      expect(h.state().characters[id]).toEqual(before.characters[id])
      expect(h.state().edits).toEqual(before.edits)
    }
  })

  // An answer changed for another was stuck with the surge of the first.
  it('is changed for one on another surge', () => {
    const h = struck()
    const first = onSurge(h)[0]
    const other = onSurge(h).find((o) => o.surge !== first.surge)!
    const id = h.idOf('Bob')
    h.send({ kind: 'react', args: [id, first.draft, first.surge] })
    h.send({ kind: 'react', args: [id, other.draft, other.surge] })
    const once = struck()
    once.send({ kind: 'react', args: [id, other.draft, other.surge] })
    expect(h.state().characters[id]).toEqual(once.state().characters[id])
  })

  // A landing clicked on the board in the jumper's own turn made the movement
  // surge, whichever they had picked.
  it('keeps the surge picked when an evasive jump is landed on the board', () => {
    for (const surge of onSurge(struck()).filter((o) => o.draft.kind === 'evasiveJump').map((o) => o.surge)) {
      const h = struck()
      const id = h.idOf('Bob')
      h.press((s) => ({ ...s, inTurnCharacter: id }))
      const jump = onSurge(h).find((o) => o.draft.kind === 'evasiveJump' && o.surge === surge)!
      h.send({ kind: 'react', args: [id, jump.draft, jump.surge] })
      const landing = getBoardView(h.state()).cells.find((c) => c.jump)!
      h.cell(landing.cell.q, landing.cell.r)
      expect(h.state().characters[id].usedSurge).toBe(surge)
    }
  })

  it('is the reaction surge when a landing is clicked with none picked, in the own turn too', () => {
    const h = struck()
    const id = h.idOf('Bob')
    h.press((s) => ({ ...s, inTurnCharacter: id }))
    const landing = getBoardView(h.state()).cells.find((c) => c.jump)!
    h.cell(landing.cell.q, landing.cell.r)
    expect(h.state().characters[id].usedSurge).toBe('reaction')
  })

  // A reflex is better with the movement surge (combat.tex "Reflex"), which was
  // only offered to one who could not pay for it without.
  it('is offered on a surge that betters it to one who can pay without', () => {
    const h = openHarness()
    h.bring(swordsman('Bob'), archer('Cy'))
    h.createBoard(8)
    h.select('Bob')
    h.cell(6, 0)
    h.select('Cy')
    h.cell(0, 0)
    h.send({ kind: 'nextRound', args: [] })
    for (let i = 0; i < 8 && h.state().roundStep !== null; i++) h.send({ kind: 'continueRound', args: [] })
    h.startTurn()
    const id = h.idOf('Bob')
    h.send({ kind: 'surge', args: [h.idOf('Cy'), 'focus'] })
    h.pressMenu(h.menu({ on: 'token', id })!.entries.find((e) => e.category === 'attack' && e.bar === null && e.press.kind === 'declare' && e.press.aim !== null)!)
    const ammo = getActionOffers(h.state()).ammo[0]
    if (ammo) h.amend({ ammoId: ammo.itemId })
    h.commit()
    const evasions = getAvailableActions(h.state(), id).filter((o) => o.draft.kind === 'evasion' && o.available)
    expect(evasions.map((o) => o.surge)).toEqual([null, 'movement'])
    h.send({ kind: 'react', args: [id, evasions[1].draft, evasions[1].surge] })
    expect(h.state().characters[id].usedSurge).toBe('movement')
  })
})
