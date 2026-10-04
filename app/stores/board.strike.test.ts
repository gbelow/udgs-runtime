import { describe, expect, it } from 'vitest'
import { openHarness, type Harness } from './boardHarness'
import { fighter, spearman } from '../domain/bot/fixtures'
import { amendAction, cancelAction, declareReaction, withdrawReaction } from '../domain/combat/commands/action'
import { getActionPanel } from '../domain/combat/projections/actionPanel'
import { getOpenAction } from '../domain/combat/rules/log'
import { getAvailableActions } from '../domain/combat/rules/options'

// A strike from declaration to the answers it draws, over the real combat
// store. Expected values are what was clicked and pressed: who stands as the
// target, who answered with what, and what taking it back leaves.

// Ann, spear in hand, beside Bob; Cy and Dee stand off.
function scene(): Harness {
  const h = openHarness()
  h.bring(spearman('Ann'), fighter('Bob'), fighter('Cy'), fighter('Dee'))
  h.createBoard(6)
  h.select('Ann')
  h.cell(0, 0)
  h.select('Bob')
  h.cell(1, 0)
  h.select('Cy')
  h.cell(-1, 1)
  h.select('Dee')
  h.cell(5, -3)
  h.select('Ann')
  h.startTurn()
  h.declare({ kind: 'strike' })
  const row = getActionPanel(h.state()).attacks[0]
  h.press(amendAction({ weaponKey: row.weaponKey, attack: row.attack, variant: row.variant }))
  return h
}

const open = (h: Harness) => getOpenAction(h.state())
const answers = (h: Harness) => Object.values(h.state().actions).filter((a) => a.reactionTo !== null && a.reactionTo === open(h)?.id)

describe('declaring a strike', () => {
  it('takes the clicked token as the target', () => {
    const h = scene()
    h.token('Bob')
    expect(open(h)).toMatchObject({ kind: 'strike', step: 'define', targetId: h.idOf('Bob') })
  })

  // The view says which tokens a strike can be aimed at: a click on one of
  // them targets it, and a click on any other only picks that character.
  it('targets every token the view offers and merely selects every other', () => {
    const names = ['Ann', 'Bob', 'Cy', 'Dee']
    for (const name of names) {
      const h = scene()
      const offered = h.view().tokens.find((t) => t.id === h.idOf(name))!.targetable
      h.token(name)
      expect(open(h)?.targetId ?? null, `clicking ${name}`).toBe(offered ? h.idOf(name) : null)
      if (!offered) expect(h.active(), `clicking ${name}`).toBe(h.idOf(name))
    }
  })

  it('does not lock a strike that has no target', () => {
    const h = scene()
    h.commit()
    expect(open(h)?.step).toBe('define')
  })

  it('takes the declaration back before it is committed', () => {
    const h = scene()
    h.token('Bob')
    h.press(cancelAction())
    expect(open(h)).toBeNull()
    expect(h.active()).toBe(h.idOf('Ann'))
  })

  it('does not let a hand place anyone once the strike is committed', () => {
    const h = scene()
    h.token('Bob')
    h.commit()
    const before = h.state().board!.placements
    h.select('Cy')
    h.cell(4, 4)
    expect(h.state().board!.placements).toEqual(before)
  })
})

describe('answering a committed strike', () => {
  function committed(): Harness {
    const h = scene()
    h.token('Bob')
    h.commit()
    return h
  }

  it('is open to answers once committed', () => {
    expect(open(committed())?.step).toBe('react')
  })

  // Everything a character is offered as an answer is recorded as theirs, to
  // this strike, when declared, and taking it back leaves the fight as it was;
  // everything not offered is refused untouched.
  it('records each offered answer under its reactor and takes it back whole', () => {
    let tried = 0
    for (const name of ['Ann', 'Bob', 'Cy', 'Dee']) {
      const probe = committed()
      const id = probe.idOf(name)
      for (const option of getAvailableActions(probe.state(), id).filter((o) => o.reactionTo !== null)) {
        tried++
        const h = committed()
        const before = JSON.stringify(h.state().actions)
        const state = h.state()
        h.press(declareReaction(id, option.draft, h.newId))
        if (option.available) {
          expect(answers(h).map((a) => [a.actorId, a.kind]), `${name} ${option.draft.kind}`).toContainEqual([id, option.draft.kind])
          h.press(withdrawReaction(id))
          expect(JSON.stringify(h.state().actions), `${name} ${option.draft.kind} taken back`).toBe(before)
        } else {
          expect(h.state(), `${name} ${option.draft.kind}`).toBe(state)
        }
      }
    }
    expect(tried).toBeGreaterThan(0)
  })
})
