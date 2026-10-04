import { describe, expect, it } from 'vitest'
import { rollD10, seededRng } from '../domain/combat/dice'
import { CombatStateSchema, type ActionDraft, type CombatState } from '../domain/combat/types'
import { getActionPanel } from '../domain/combat/projections/actionPanel'
import { getFootprint } from '../domain/combat/rules/board'
import { getAvailableActions } from '../domain/combat/rules/options'
import { isReaction } from '../domain/combat/rules/actionCatalog'
import { coordKey } from '../domain/combat/geometry'
import { cancelAction, declareReaction, payAction, resolveAction, rollAction, withdrawSpawnedAction } from '../domain/combat/commands/action'
import { dropToFloor } from '../domain/combat/commands/floor'
import { endTurn, surge } from '../domain/combat/commands/turn'
import { nextRound } from '../domain/combat/commands/nextRound'
import { TERRAIN_BRUSHES } from '../domain/lists'
import { SurgeKindSchema } from '../domain/types'
import { archer, spearman } from '../domain/bot/fixtures'
import { openHarness, type Harness } from './boardHarness'

// A player who presses whatever there is to press, in no order: every click
// the board takes and every button the panels dispatch, thrown at a fight of
// several characters on ground painted by the same brushes a player holds.
// What is asserted is what the architecture promises of any such session —
// nothing throws, the state is always one the schema accepts and the storage
// round-trips, the board is never drawn inconsistent with the characters on
// it, and a click the view calls closed changes nothing.

const SEEDS = Array.from({ length: 16 }, (_, i) => i + 1)
const STEPS = 200
const STORAGE_EVERY = 8

type Play = { name: string, weight?: number, run: (h: Harness, pick: Picker) => void }
type Picker = <T>(from: readonly T[]) => T

function plays(): Play[] {
  const progress = (name: string, command: (h: Harness) => Parameters<Harness['press']>[0]): Play => ({ name, run: (h) => h.press(command(h)) })
  const names = (h: Harness) => Object.values(h.state().characters).map((c) => c.name)
  return [
    {
      name: 'click a cell',
      weight: 3,
      run: (h, pick) => {
        const cells = h.view().cells
        if (!cells.length) return
        const closed = h.view().mode === 'locked'
        const before = h.state()
        h.click({ on: 'cell', cell: pick(cells).cell })
        if (closed) expect(h.state(), 'a click on a board the view calls locked changes nothing').toBe(before)
      },
    },
    {
      name: 'click a highlighted cell',
      weight: 3,
      run: (h, pick) => {
        const offered = h.view().cells.filter((c) => c.reachable !== null || c.jump || c.step || c.center)
        if (offered.length) h.click({ on: 'cell', cell: pick(offered).cell })
      },
    },
    {
      name: 'aim at a targetable token',
      weight: 2,
      run: (h, pick) => {
        const targets = h.view().tokens.filter((t) => t.targetable)
        if (targets.length) h.click({ on: 'token', id: pick(targets).id })
      },
    },
    {
      name: 'click a pickable floor item',
      run: (h, pick) => {
        const items = h.view().floor.filter((f) => f.pickable)
        if (items.length) h.floor(pick(items).itemId)
      },
    },
    { name: 'paint a cell', run: (h, pick) => { const cells = h.view().cells; if (!cells.length) return; h.holdBrush(pick(TERRAIN_BRUSHES)); h.click({ on: 'cell', cell: pick(cells).cell }); h.holdBrush(null) } },
    { name: 'click a token', run: (h, pick) => h.token(pick(names(h))) },
    { name: 'click a floor item', run: (h, pick) => { const floor = h.view().floor; if (floor.length) h.floor(pick(floor).itemId) } },
    { name: 'click turn', run: (h) => h.turn() },
    { name: 'select a character', weight: 2, run: (h, pick) => h.select(pick(names(h))) },
    { name: 'surge', run: (h, pick) => h.press(surge(h.active()!, pick(SurgeKindSchema.options))) },
    { name: 'start turn', weight: 2, run: (h) => h.startTurn() },
    {
      name: 'declare',
      weight: 3,
      run: (h, pick) => {
        const id = h.active()
        const open = id ? getAvailableActions(h.state(), id).filter((o) => o.available && !isReaction(o.draft.kind) && o.reactionTo === null) : []
        const kinds = [...new Set(open.map((o) => o.draft.kind))]
        if (!kinds.length) return
        const kind = pick(kinds)
        h.declare(pick(open.filter((o) => o.draft.kind === kind)).draft as ActionDraft)
      },
    },
    {
      name: 'react',
      run: (h, pick) => {
        const options = Object.keys(h.state().characters).flatMap((id) => getAvailableActions(h.state(), id).filter((o) => o.available && o.reactionTo !== null).map((o) => ({ id, draft: o.draft })))
        if (options.length) { const o = pick(options); h.press(declareReaction(o.id, o.draft, h.newId)) }
      },
    },
    { name: 'drop a held item', run: (h, pick) => { const c = h.active() ? h.state().characters[h.active()!] : undefined; if (c?.held.length) h.press(dropToFloor(c.id, pick(c.held).id)) } },
    { name: 'commit', weight: 3, run: (h) => h.commit() },
    progress('roll', (h) => rollAction(h.dice, h.newId)),
    progress('pay', (h) => payAction(h.newId)),
    { ...progress('resolve', (h) => resolveAction(h.newId)), weight: 2 },
    progress('skip', (h) => withdrawSpawnedAction(h.newId)),
    progress('cancel', () => cancelAction()),
    progress('end turn', () => endTurn),
    progress('next round', (h) => nextRound(h.dice, h.newId)),
  ]
}

// The state as the schema holds it: the store's own actions left out.
const dataOf = (s: CombatState): CombatState => CombatStateSchema.parse(s)

function assertSound(h: Harness, storage: boolean) {
  const s = h.state()
  if (storage) {
    const data = dataOf(s)
    expect(JSON.stringify(CombatStateSchema.parse(JSON.parse(JSON.stringify(data)))), 'the state survives storage').toBe(JSON.stringify(data))
  }

  const view = h.view()
  getActionPanel(s)
  if (s.activeCharacterId !== null) expect(s.characters[s.activeCharacterId], 'the active character is in the fight').toBeDefined()
  if (s.inTurnCharacter !== '') expect(s.characters[s.inTurnCharacter], 'the character in turn is in the fight').toBeDefined()

  const placements = s.board?.placements ?? {}
  const held = new Map<string, string>()
  for (const [id, placement] of Object.entries(placements)) {
    expect(s.characters[id], `${id} is placed but not in the fight`).toBeDefined()
    for (const cell of getFootprint(s.characters[id], placement)) {
      const key = coordKey(cell)
      expect(held.get(key), `${id} and ${held.get(key)} both stand on ${key}`).toBeUndefined()
      held.set(key, id)
    }
  }
  expect(view.tokens.map((t) => t.id).sort(), 'the board draws every placed character').toEqual(Object.keys(placements).filter((id) => s.characters[id]).sort())
}

describe('pressing everything on the board, in any order', () => {
  it.each(SEEDS)('keeps the fight sound (seed %i)', (seed) => {
    const rng = seededRng(seed)
    const pick: Picker = (from) => from[Math.floor(rng() * from.length)]
    const h = openHarness((explodes) => rollD10(explodes, rng))
    h.bring(spearman('Ann'), spearman('Bob'), archer('Cy'))
    h.createBoard(5)
    for (const [name, q, r] of [['Ann', 0, 0], ['Bob', 2, 0], ['Cy', -2, 1]] as const) {
      h.select(name)
      h.cell(q, r)
    }
    h.select('Ann')

    const menu = plays().flatMap((p) => Array<Play>(p.weight ?? 1).fill(p))
    const trail: string[] = []
    for (let step = 0; step < STEPS; step++) {
      const play = pick(menu)
      trail.push(play.name)
      try {
        play.run(h, pick)
        assertSound(h, step % STORAGE_EVERY === 0 || step === STEPS - 1)
      } catch (e) {
        throw new Error(`seed ${seed}, step ${step}: ${(e as Error).message}\nlast plays: ${trail.slice(-12).join(' → ')}`, { cause: e })
      }
    }
  })
})
