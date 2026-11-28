import { describe, expect, it } from 'vitest'
import { openHarness, type Harness } from './boardHarness'
import { archer, fighter, mage, meleeTrained, rangedTrained, spearman } from '../domain/scene/fixtures'
import { readClick } from '../domain/scene/commands/click'
import { isAimed, type MenuEntry } from '../domain/scene/commands/clickMenu'
import { getGivenSteps, walkKey, type OpenWalk, type WalkStep } from '../domain/scene/projections/openWalk'
import { getOpenChoices } from '../domain/scene/projections/choices'
import { getAncestry, getReactionsTo } from '../domain/scene/rules/log'
import type { SceneCommand } from '../domain/scene/commands/registry'
import { useClickMenuStore } from './useClickMenuStore'
import { getOpenAction } from '../domain/scene/rules/log'
import { getBoardView } from '../domain/scene/projections/boardView'
import type { CampaignCharacter } from '../domain/types'

// The menu a click opens, over the real combat store. Expected values are what
// was clicked: a pressed entry stands the open action on the clicked token or
// cell, and a click that opens a menu changes nothing until one is pressed.

function scene(actor: (name: string) => CampaignCharacter = spearman): Harness {
  const h = openHarness()
  h.bring(actor('Ann'), fighter('Bob'), fighter('Cy'))
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

// combat.tex "Follow": the menu on a token marks whom the selected character
// follows, and takes the mark back. Expected values are what was clicked.
describe('the follow entry of the menu a token opens', () => {
  const followOf = (h: Harness, name: string) => h.menu({ on: 'token', id: h.idOf(name) })?.entries.find((e) => e.press.kind === 'follow')
  // the mark is made in the fight, once it has begun
  const started = (): Harness => {
    const h = scene()
    h.send({ kind: 'nextRound', args: [] })
    for (let i = 0; i < 8 && h.state().roundStep !== null; i++) h.send({ kind: 'continueRound', args: [] })
    h.select('Ann')
    h.startTurn()
    return h
  }
  it('marks the clicked one followed, and pressed again takes the mark back', () => {
    const h = started()
    const entry = followOf(h, 'Bob')
    expect(entry?.bar).toBeNull()
    h.pressMenu(entry!)
    expect(h.state().following[h.idOf('Ann')]).toBe(h.idOf('Bob'))
    h.pressMenu(followOf(h, 'Bob')!)
    expect(h.state().following[h.idOf('Ann')] ?? null).toBeNull()
  })

  it('is closed on one out of melee range, and pressing it marks nobody', () => {
    const h = started()
    const entry = followOf(h, 'Cy')
    expect(entry?.bar).not.toBeNull()
    h.pressMenu(entry!)
    expect(h.state().following[h.idOf('Ann')] ?? null).toBeNull()
  })
})

// The popover goes on from a pressed entry to walk the action it opened, a
// step at a time, through its commit and the answers to it, on the popover's
// own store. Expected values are what was clicked and pressed: an action
// walked from a token's menu is committed at that token, whichever values the
// steps were given, and the answer walked is the one given.
describe('the walk of an action declared from the menu', () => {
  const store = () => useClickMenuStore.getState()
  const aimedAt = (h: Harness, name: string): MenuEntry[] =>
    (h.menu({ on: 'token', id: h.idOf(name) })?.entries ?? []).filter((e) => e.bar === null && e.press.kind === 'declare' && e.press.aim?.on === 'token')
  // the walk as the popover reads it, bound to what it walks once that is open
  const read = (h: Harness): OpenWalk | null => {
    const walk = store().walk
    const view = walk ? h.walk(walk) : null
    if (walk && walk.actionId === null && view) store().bindWalk(view.actionId)
    return store().walk ? h.walk(store().walk!) : null
  }
  // each step left as it is, where it may be, or given another value
  const through = (h: Harness, get: () => { walk: string, step: WalkStep | null } | null, change: boolean) => {
    for (let i = 0; i < 40; i++) {
      const at = get()
      if (!at?.step) return
      const { step } = at
      // the user's ruling (2026-11-28): the heavy degree is a pick with the normal attack picked while none is declared
      if (step.key === 'heavy') expect(step.buttons.filter((b) => b.selected), 'one heavy degree is picked at a time').toHaveLength(1)
      const other = step.buttons.find((b) => b.command !== null && !b.selected && !b.bar)
      if ((change || !step.keep) && other) h.send(other.command!)
      store().stepWalk(at.walk, step.key)
    }
  }
  const declared = (h: Harness, name: string, nth: number, change: boolean) => {
    const menu = h.menu({ on: 'token', id: h.idOf(name) })!
    const entry = aimedAt(h, name)[nth]
    h.pressMenu(entry)
    store().startWalk({ from: menu, category: null, actorId: h.active()!, actionId: null, given: getGivenSteps(entry.press), passed: {}, pick: null, collapsed: null })
    expect(read(h), `${entry.label} opens a walk`).not.toBeNull()
    through(h, () => { const v = read(h); return v?.kind === 'declare' ? v : null }, change)
    return entry
  }
  const committed = (h: Harness, name: string, nth: number, change: boolean) => {
    const entry = declared(h, name, nth, change)
    const view = read(h)
    expect(view?.kind === 'declare' ? view.step : null, `${entry.label} walks to its commit`).toBeNull()
    if (view?.kind !== 'declare') throw new Error(`${entry.label} is not walked`)
    expect(view.commit.bar, `${entry.label} may be committed`).toBeNull()
    h.send(view.commit.command)
    const action = h.state().actions[view.actionId]
    expect(action.step, `${entry.label} is committed`).not.toBe('define')
    expect('targetId' in action ? action.targetId : null, `${entry.label} is aimed at ${name}`).toBe(h.idOf(name))
    return { entry, id: view.actionId }
  }

  for (const actor of [spearman, archer, mage]) for (const change of [false, true]) {
    it(`commits every entry ${actor.name} aims at the clicked token at that token, and lands it where nobody reacts, ${change ? 'giving each step another value' : 'keeping every value'}`, () => {
      const count = aimedAt(scene(actor), 'Bob').length
      expect(count).toBeGreaterThan(0)
      for (let nth = 0; nth < count; nth++) {
        const h = scene(actor)
        const { id } = committed(h, 'Bob', nth, change)
        const view = read(h)
        expect(view === null || view.kind !== 'declare' || view.actionId !== id, 'after the commit the walk goes on to what it committed or what comes of it, or is done').toBe(true)
        if (view) expect(view.actionId === id || getAncestry(h.state(), getOpenAction(h.state())!).some((a) => a.id === id), 'what the walk goes on with comes of the action').toBe(true)
        if (view?.kind === 'land') landed(h, id, change)
      }
    })
  }

  // what the thrown action lands with walked to its landing: it lands, and the
  // walk goes on only with what comes of it
  const landed = (h: Harness, id: string, change: boolean) => {
    const at = read(h)
    if (at?.kind !== 'land') {
      expect(at === null || getAncestry(h.state(), getOpenAction(h.state())!).some((a) => a.id === id), 'past its reactions the walk is the action landing, or what comes of it').toBe(true)
      return
    }
    through(h, () => { const v = read(h); return v?.kind === 'land' && v.actionId === id ? v : null }, change)
    const view = read(h)
    if (view?.kind !== 'land' || view.actionId !== id) return
    expect(view.step, 'the landing walks to its end').toBeNull()
    expect(view.land.bar, 'walked to its end, the action may land').toBeNull()
    h.send(view.land.command)
    expect(h.state().stack.includes(id), 'the action lands').toBe(false)
    const next = read(h)
    const open = getOpenAction(h.state())
    expect(next === null || (open !== null && getAncestry(h.state(), open).some((a) => a.id === id)), 'what the walk goes on with comes of the action').toBe(true)
  }

  for (const actor of [spearman, archer]) for (const change of [false, true]) {
    it(`gives the answer walked for the target of ${actor.name}'s attack, then goes and lands, ${change ? 'giving each step another value' : 'keeping every value'}`, () => {
      const answersOf = (h: Harness) => {
        const view = read(h)
        const bob = view?.kind === 'exchange' ? view.answerers.find((a) => a.id === h.idOf('Bob')) : undefined
        return bob?.step?.key === 'answer' ? bob.step.buttons.filter((b) => b.command !== null && !b.bar) : []
      }
      const first = scene(actor)
      committed(first, 'Bob', 0, false)
      const count = answersOf(first).length
      expect(count, 'the target has answers to walk').toBeGreaterThan(0)
      for (let nth = 0; nth < count; nth++) {
        const h = scene(actor)
        const { id } = committed(h, 'Bob', 0, false)
        const bob = h.idOf('Bob')
        const picked = answersOf(h)[nth]
        const walk = walkKey(id, bob)
        const answerer = () => { const v = read(h); return v?.kind === 'exchange' ? v.answerers.find((a) => a.id === bob) ?? null : null }
        h.send(picked.command!)
        store().stepWalk(walk, 'answer')
        through(h, answerer, change)
        const jumping = read(h)
        if (jumping?.kind === 'exchange' && jumping.hint) for (const cell of getOpenChoices(h.state()).filter((c) => c.part === 'cell' && c.actorId === bob).slice(0, 1)) h.send(cell.command)
        const done = answerer()?.done
        if (done?.state === 'open') h.send(done.command)
        const view = read(h)
        if (view?.kind !== 'exchange') throw new Error(`answering ${picked.label} leaves no exchange`)
        for (const other of view.answerers.filter((a) => a.id !== bob)) {
          const pass = other.step?.buttons.find((b) => b.command?.kind === 'pass')
          if (pass?.command) h.send(pass.command)
        }
        const after = read(h)
        if (after?.kind !== 'exchange') throw new Error(`answering ${picked.label} leaves no exchange`)
        expect(after.go.bar, `${picked.label} walked, the action may go on`).toBeNull()
        const given = getReactionsTo(h.state(), id).find((r) => r.actorId === bob)
        if (picked.command!.kind === 'pass') expect(given, 'passing gives no answer').toBeUndefined()
        else expect(given?.kind, `${picked.label} is given`).toBe((picked.command as Extract<SceneCommand, { kind: 'react' }>).args[1].kind)
        h.send(after.go.command)
        expect(h.state().actions[id].step, 'the action goes on past the answers').not.toBe('react')
        landed(h, id, change)
      }
    })
  }
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
