import { describe, expect, it } from 'vitest'
import { openHarness, type Harness } from './boardHarness'
import { archer, fighter, mage, meleeTrained, rangedTrained, spearman } from '../domain/scene/fixtures'
import { readClick } from '../domain/scene/commands/click'
import { isAimed } from '../domain/scene/commands/clickMenu'
import { getOpenAction } from '../domain/scene/rules/log'
import { getBoardView } from '../domain/scene/projections/boardView'
import type { CampaignCharacter } from '../domain/types'

// The menu a click opens, over the real combat store. Expected values are what
// was clicked: a pressed entry stands the open action on the clicked token or
// cell, and a click that opens a menu changes nothing until one is pressed.

function scene(): Harness {
  const h = openHarness()
  h.bring(spearman('Ann'), fighter('Bob'), fighter('Cy'))
  h.createBoard(6)
  h.select('Ann')
  h.cell(0, 0)
  h.select('Bob')
  h.cell(1, 0)
  h.select('Cy')
  h.cell(5, -3)
  h.select('Ann')
  h.startTurn()
  return h
}

describe('the menu a click on the board opens', () => {
  it('declares, for every open entry a token offers to aim at it, an action aimed at that token', () => {
    for (const name of ['Bob', 'Cy']) {
      const h = scene()
      const at = { on: 'token', id: h.idOf(name) } as const
      const entries = (h.menu(at)?.entries ?? []).filter((e) => e.bar === null && e.press.kind === 'declare' && e.press.aim)
      for (const entry of entries) {
        const played = scene()
        played.pressMenu(entry)
        expect(isAimed(played.state(), { on: 'token', id: played.idOf(name) })).toBe(true)
      }
    }
  })

  it('is what a click on a token with something to do reads as, and picks nobody', () => {
    const h = scene()
    const read = readClick(h.state(), { on: 'token', id: h.idOf('Bob') }, { brush: null, reposition: false, selected: h.active(), newId: () => '' })
    expect(read).toHaveProperty('menu')
    expect(read).not.toHaveProperty('select')
  })

  it('draws a move to the clicked cell and leaves it to be committed', () => {
    const h = scene()
    const cell = { q: -2, r: 1 }
    const entry = h.menu({ on: 'cell', cell })?.entries.find((e) => e.category === 'move' && e.bar === null)
    expect(entry).toBeDefined()
    h.pressMenu(entry!)
    const open = getOpenAction(h.state())
    expect(open).toMatchObject({ kind: 'move', step: 'define' })
    expect(isAimed(h.state(), { on: 'cell', cell })).toBe(true)
  })
})

// What only an ability or an extension reaches was shown out of reach, with no
// way to declare it from the board.
describe('the menu on someone out of reach', () => {
  const at = (actor: CampaignCharacter, metres: number): Harness => {
    const h = openHarness()
    h.bring(actor, fighter('Cy'))
    h.createBoard(40)
    h.select(actor.name)
    h.cell(-38, 0)
    h.select('Cy')
    h.cell(-38 + metres, 0)
    h.select(actor.name)
    h.startTurn()
    return h
  }
  const entries = (h: Harness) => h.menu({ on: 'token', id: h.idOf('Cy') })?.entries ?? []
  const METRES = Array.from({ length: 76 }, (_, i) => i + 1)

  // abilities.tex "Lunge"
  it('offers a strike with the jump that reaches them', () => {
    const found = METRES.slice(0, 10).flatMap((m) => {
      const h = at(meleeTrained(spearman('Ann')), m)
      const strikes = entries(h).filter((e) => e.press.kind === 'declare' && e.press.draft.kind === 'strike')
      const open = strikes.filter((e) => e.bar === null)
      return open.length > 0 && open.every((e) => e.press.kind === 'declare' && e.press.fields.recipe) ? [{ m, label: open[0].label }] : []
    })
    expect(found.length).toBeGreaterThan(0)
    const h = at(meleeTrained(spearman('Ann')), found[0].m)
    h.pressMenu(entries(h).find((e) => e.label === found[0].label)!)
    expect(isAimed(h.state(), { on: 'token', id: h.idOf('Cy') })).toBe(true)
    expect(getBoardView(h.state()).cells.some((c) => c.jump)).toBe(true)
  })

  // abilities.tex "Steady Arms"
  it('offers a shot with the tread that reaches them', () => {
    const h = at(rangedTrained(archer('Ann')), 4)
    h.paint('wall', [[-37, 0], [-36, 0], [-35, 0]])
    const offered = entries(h).find((e) => e.bar === null && e.press.kind === 'declare' && e.press.fields.recipe && e.press.draft.kind === 'shoot')
    expect(offered).toBeDefined()
    h.pressMenu(offered!)
    expect(getBoardView(h.state()).cells.some((c) => c.reachable !== null)).toBe(true)
  })

  // spells.tex "Extend Spell"
  it('offers a cast extended as far as reaches them', () => {
    const offered = METRES.flatMap((m) => {
      const h = at(mage('Ann'), m)
      const entry = entries(h).find((e) => e.bar === null && e.press.kind === 'declare' && (('extend' in e.press.fields && e.press.fields.extend) || 0) > 0)
      if (!entry) return []
      h.pressMenu(entry)
      return [isAimed(h.state(), { on: 'token', id: h.idOf('Cy') })]
    })
    expect(offered.length).toBeGreaterThan(0)
    expect(offered.every((aimed) => aimed)).toBe(true)
  })
})
