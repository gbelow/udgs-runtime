import { describe, expect, it } from 'vitest'
import { openHarness, type Harness } from './boardHarness'
import { fighter, spearman } from '../domain/bot/fixtures'
import { readClick } from '../domain/scene/commands/click'
import { isAimed } from '../domain/scene/commands/clickMenu'
import { getOpenAction } from '../domain/scene/rules/log'

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
  it('declares, for every entry a token offers, an action aimed at that token', () => {
    for (const name of ['Bob', 'Cy']) {
      const h = scene()
      const at = { on: 'token', id: h.idOf(name) } as const
      const entries = h.menu(at)?.entries ?? []
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
    const entry = h.menu({ on: 'cell', cell })?.entries[0]
    expect(entry).toBeDefined()
    h.pressMenu(entry!)
    const open = getOpenAction(h.state())
    expect(open).toMatchObject({ kind: 'move', step: 'define' })
    expect(isAimed(h.state(), { on: 'cell', cell })).toBe(true)
  })
})
