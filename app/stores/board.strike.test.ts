import { describe, expect, it } from 'vitest'
import { openHarness, type Harness } from './boardHarness'
import { fighter, spearman } from '../domain/bot/fixtures'
import { holdItem } from '../domain/item/commands/hands'
import { ItemSchema } from '../domain/types'
import { withdrawReaction } from '../domain/scene/commands/action'
import { getActionPanel } from '../domain/scene/projections/actionPanel'
import { getOpenAction } from '../domain/scene/rules/log'
import { getAvailableActions } from '../domain/scene/rules/options'

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
  h.send({ kind: 'amend', args: [{ weaponKey: row.weaponKey, attack: row.attack, variant: row.variant }] })
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
    h.send({ kind: 'cancel', args: [] })
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
        h.send({ kind: 'react', args: [id, option.draft] })
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

// combat.tex "Protect": a defender within one space of the line between
// attacker and target may block for the ally; the table's ruling adds that they
// stand nearer the attacker than the target does, so beside or behind is out.
describe('protecting an ally from a strike', () => {
  const blockOpenFor = (guardAt: [number, number]) => {
    const h = openHarness()
    h.bring(spearman('Gus'), fighter('Dee'), holdItem(ItemSchema.parse({ name: 'Wooden Shield', type: 'weapon', refId: 'Wooden Shield', bulk: 2 }))(fighter('Ann')))
    h.createBoard(5)
    for (const [name, q, r] of [['Gus', 3, 0], ['Dee', 2, 2], ['Ann', guardAt[0], guardAt[1]]] as const) {
      h.select(name)
      h.cell(q, r)
    }
    h.select('Gus')
    h.startTurn()
    h.declare({ kind: 'strike' })
    const row = getActionPanel(h.state()).attacks[0]
    h.send({ kind: 'amend', args: [{ weaponKey: row.weaponKey, attack: row.attack, variant: row.variant }] })
    h.token('Dee')
    h.commit()
    return getAvailableActions(h.state(), h.idOf('Ann')).some((o) => o.draft.kind === 'block' && o.available)
  }

  it('is open to someone between them', () => {
    expect(blockOpenFor([2, 1])).toBe(true)
  })

  it('is closed to someone beside the target, though a space from the line', () => {
    expect(blockOpenFor([1, 2])).toBe(false)
  })

  it('is closed to someone behind the target', () => {
    expect(blockOpenFor([2, 3])).toBe(false)
  })
})

// combat.tex "Protect": "The defender can block or intercept an attack
// directed at an ally"; "Intercept": "It requires the defender to be in short
// range". The table's ruling: an intercept for an ally asks for nothing but
// that range, where a block must also be nearer the attacker than the target.
describe('intercepting for an ally', () => {
  const answersFor = (guardAt: [number, number]) => {
    const h = openHarness()
    h.bring(spearman('Gus'), fighter('Dee'), holdItem(ItemSchema.parse({ name: 'Wooden Shield', type: 'weapon', refId: 'Wooden Shield', bulk: 2 }))(fighter('Ann')))
    h.createBoard(5)
    for (const [name, q, r] of [['Gus', 3, 0], ['Dee', 3, 1], ['Ann', guardAt[0], guardAt[1]]] as const) {
      h.select(name)
      h.cell(q, r)
    }
    h.select('Gus')
    h.startTurn()
    h.declare({ kind: 'strike' })
    const row = getActionPanel(h.state()).attacks[0]
    h.send({ kind: 'amend', args: [{ weaponKey: row.weaponKey, attack: row.attack, variant: row.variant }] })
    h.token('Dee')
    h.commit()
    const open = (kind: string) => getAvailableActions(h.state(), h.idOf('Ann')).some((o) => o.draft.kind === kind && o.available)
    return { block: open('block'), intercept: open('intercept') }
  }

  it('is open beside the attacker, where no block can be nearer than the target', () => {
    expect(answersFor([4, 0])).toEqual({ block: false, intercept: true })
  })

  it('is closed out of short range of the attacker', () => {
    expect(answersFor([5, 1]).intercept).toBe(false)
  })
})
