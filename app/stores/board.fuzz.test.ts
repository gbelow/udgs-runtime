import { describe, expect, it } from 'vitest'
import { rollD10, seededRng } from '../domain/combat/dice'
import { CombatStateSchema, type ActionDraft, type CombatState } from '../domain/combat/types'
import { getActionPanel } from '../domain/combat/projections/actionPanel'
import { getFootprint } from '../domain/combat/rules/board'
import { getAvailableActions } from '../domain/combat/rules/options'
import { isReaction } from '../domain/combat/rules/actionCatalog'
import { getOpenAction } from '../domain/combat/rules/log'
import { coordKey } from '../domain/combat/geometry'
import { acceptSpellTest, amendAction, amendReaction, boostPush, cancelAction, chooseSpell, declareReaction, payAction, resolveAction, rollAction, stepExtend, withdrawLastReaction, withdrawSpawnedAction } from '../domain/combat/commands/action'
import { chooseManeuver, improveSpell, moveWhileResting, refundHOP, refundImprovement, saveGraze, spendHOP } from '../domain/combat/commands/choices'
import { dropToFloor } from '../domain/combat/commands/floor'
import { endTurn, surge } from '../domain/combat/commands/turn'
import { nextRound } from '../domain/combat/commands/nextRound'
import { GRAPPLE_MANEUVERS, TERRAIN_BRUSHES } from '../domain/lists'
import { SurgeKindSchema } from '../domain/types'
import { archer, brawler, mage, spearman, trained, warden } from '../domain/bot/fixtures'
import { openHarness, type Harness } from './boardHarness'

// A player who presses whatever there is to press, in no order: every click
// the board takes and every button the panels dispatch, thrown at a fight of
// several characters on ground painted by the same brushes a player holds.
// What is asserted is what the architecture promises of any such session —
// nothing throws, the state is always one the schema accepts and the storage
// round-trips, the board is never drawn inconsistent with the characters on
// it, and a click the view calls closed changes nothing.

const SEEDS = Array.from({ length: 16 }, (_, i) => i + 1)
const DUEL_SEEDS = SEEDS.slice(0, 8)
const STEPS = 200
const STORAGE_EVERY = 8

type Play = { name: string, weight?: number, run: (h: Harness, pick: Picker) => void }
type Picker = <T>(from: readonly T[]) => T

// Fills in whatever the open declaration is still asked for from the panel's
// own offers, aims it by clicking, and locks it.
function finishDeclaration(h: Harness, pick: Picker) {
  const panel = () => getActionPanel(h.state())
  if (getOpenAction(h.state())?.step !== 'define') return
  const first = <T>(from: readonly T[]) => (from.length ? pick(from) : null)
  const row = first(panel().attacks)
  if (row && !panel().open?.weapon) h.press(amendAction({ weaponKey: row.weaponKey, attack: row.attack, variant: row.variant }))
  const ammo = first(panel().ammo)
  if (ammo) h.press(amendAction({ ammoId: ammo.itemId }))
  const spell = first(panel().spells.filter((s) => s.castable))
  if (spell && !panel().open?.spell) h.press(chooseSpell(spell.key, false))
  const target = first(h.view().tokens.filter((t) => t.targetable))
  if (target) h.click({ on: 'token', id: target.id })
  const there = first(h.view().cells.filter((c) => c.reachable !== null || c.jump || c.step || c.center))
  if (there) h.click({ on: 'cell', cell: there.cell })
  h.commit()
}

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
    { name: 'finish the declaration', weight: 4, run: (h, pick) => finishDeclaration(h, pick) },
    {
      name: 'take a whole action',
      weight: 4,
      run: (h, pick) => {
        h.select(pick(names(h)))
        h.startTurn()
        const open = getAvailableActions(h.state(), h.active()!).filter((o) => o.available && !isReaction(o.draft.kind) && o.reactionTo === null)
        if (!open.length) return
        h.declare(pick(open).draft as ActionDraft)
        finishDeclaration(h, pick)
        for (let i = 0; i < 6; i++) for (const step of [rollAction(h.dice, h.newId), payAction(h.newId), resolveAction(h.newId), withdrawSpawnedAction(h.newId)]) h.press(step)
      },
    },
    { name: 'commit', weight: 3, run: (h) => h.commit() },
    // what the open declaration is still asked for, answered from the panel's own offers
    { name: 'pick an attack row', weight: 2, run: (h, pick) => { const rows = getActionPanel(h.state()).attacks; if (rows.length) { const { weaponKey, attack, variant } = pick(rows); h.press(amendAction({ weaponKey, attack, variant })) } } },
    { name: 'load a shot', run: (h, pick) => { const ammo = getActionPanel(h.state()).ammo; if (ammo.length) h.press(amendAction({ ammoId: pick(ammo).itemId })) } },
    { name: 'aim at a place', run: (h, pick) => { const places = getActionPanel(h.state()).locations; if (places.length) { const { location, part } = pick(places); h.press(amendAction({ location, part })) } } },
    { name: 'pick a movement', run: (h, pick) => { const moves = getActionPanel(h.state()).moves.filter((m) => m.available); if (moves.length) h.press(amendAction({ movement: pick(moves).kind })) } },
    { name: 'pick a maneuver', run: (h, pick) => h.press(amendAction({ maneuver: pick(GRAPPLE_MANEUVERS) })) },
    { name: 'choose a spell', weight: 3, run: (h, pick) => { const spells = getActionPanel(h.state()).spells.filter((s) => s.castable || s.quickenable); if (spells.length) { const s = pick(spells); h.press(chooseSpell(s.key, !s.castable || (s.quickenable && pick([true, false])))) } } },
    { name: 'pick the gear to cast with', run: (h, pick) => { const gear = getActionPanel(h.state()).gear; if (gear.length) h.press(amendAction({ itemId: pick(gear).itemId })) } },
    { name: 'extend a spell', run: (h, pick) => h.press(stepExtend(pick([1, -1] as const))) },
    { name: 'accept a spell test', run: (h) => h.press(acceptSpellTest(h.newId)) },
    { name: 'buy with the overflow', weight: 2, run: (h, pick) => { const options = getActionPanel(h.state()).hop.options.filter((o) => o.available); if (options.length) h.press(spendHOP(pick(options).purchase)) } },
    { name: 'take back an overflow purchase', run: (h, pick) => { const options = getActionPanel(h.state()).hop.options; if (options.length) h.press(refundHOP(pick(options).purchase)) } },
    { name: 'improve a spell', run: (h, pick) => { const options = getActionPanel(h.state()).castHOP.options.filter((o) => o.available); if (options.length) h.press(improveSpell(pick(options).name)) } },
    { name: 'take back an improvement', run: (h, pick) => { const options = getActionPanel(h.state()).castHOP.options; if (options.length) h.press(refundImprovement(pick(options).name)) } },
    { name: 'save a graze', run: (h) => h.press(saveGraze()) },
    { name: 'move while resting', run: (h) => h.press(moveWhileResting(h.newId)) },
    { name: 'boost a push', run: (h, pick) => h.press(boostPush(pick([true, false]))) },
    { name: 'choose along or an item', run: (h, pick) => { const open = getActionPanel(h.state()).open; h.press(chooseManeuver(open?.disarm.length ? { item: pick(open.disarm).itemId } : { along: pick([true, false]) })) } },
    { name: 'take back the last reaction', run: (h) => h.press(withdrawLastReaction()) },
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

function session(h: Harness, seed: number, steps: number, menu: Play[], pick: Picker) {
  const bag = menu.flatMap((p) => Array<Play>(p.weight ?? 1).fill(p))
  const trail: string[] = []
  for (let step = 0; step < steps; step++) {
    const play = pick(bag)
    trail.push(play.name)
    try {
      play.run(h, pick)
      assertSound(h, step % STORAGE_EVERY === 0 || step === steps - 1)
    } catch (e) {
      throw new Error(`seed ${seed}, step ${step}: ${(e as Error).message}\nlast plays: ${trail.slice(-12).join(' → ')}`, { cause: e })
    }
  }
}

describe('pressing everything on the board, in any order', () => {
  it.each(SEEDS)('keeps the fight sound (seed %i)', (seed) => {
    const rng = seededRng(seed)
    const pick: Picker = (from) => from[Math.floor(rng() * from.length)]
    const h = openHarness((explodes) => rollD10(explodes, rng))
    h.bring(spearman('Ann'), brawler('Bob'), archer('Cy'), mage('Dee'))
    h.createBoard(5)
    for (const [name, q, r] of [['Ann', 0, 0], ['Bob', 2, 0], ['Cy', -2, 1], ['Dee', 0, -2]] as const) {
      h.select(name)
      h.cell(q, r)
    }
    h.select('Ann')
    session(h, seed, STEPS, plays(), pick)
  })
})

// Two characters and nothing else on the board, each turn an exchange: one
// declares something likelier to be a grapple, a push, a shot, a strike or a
// move, the others answer with whatever defences are offered, and the roll
// runs on to its end.
const LEANING = ['grapple', 'push', 'drag', 'shoot', 'strike', 'move']

// Plays the open action out: the die, the payment, the resolution, and what a
// resolution opens in turn.
function playOut(h: Harness, pick: Picker) {
  for (let i = 0; i < 8; i++) {
    for (const step of [rollAction(h.dice, h.newId), payAction(h.newId), resolveAction(h.newId), withdrawSpawnedAction(h.newId)]) h.press(step)
    const open = getActionPanel(h.state()).open
    if (open && pick([true, false, false])) h.press(chooseManeuver(open.disarm.length ? { item: pick(open.disarm).itemId } : { along: pick([true, false]) }))
    if (pick([true, false, false, false])) h.press(boostPush(pick([true, false])))
  }
}

function exchange(h: Harness, pick: Picker) {
  if (getOpenAction(h.state())?.step === 'define') h.press(cancelAction())
  playOut(h, pick)
  if (pick([true, false])) h.press(nextRound(h.dice, h.newId))
  const names = Object.values(h.state().characters).map((c) => c.name)
  h.select(pick(names))
  h.startTurn()
  if (pick([true, true, false])) h.press(surge(h.active()!, pick(['focus', 'focus', ...SurgeKindSchema.options])))
  const open = getAvailableActions(h.state(), h.active()!).filter((o) => o.available && !isReaction(o.draft.kind) && o.reactionTo === null)
  if (!open.length) return
  const leaning = open.filter((o) => LEANING.includes(o.draft.kind))
  h.declare(pick(leaning.length && pick([true, true, true, false]) ? leaning : open).draft as ActionDraft)
  finishDeclaration(h, pick)
  const answers = () => Object.keys(h.state().characters).flatMap((id) => getAvailableActions(h.state(), id).filter((o) => o.available && o.reactionTo !== null).map((o) => ({ id, draft: o.draft })))
  for (let tries = pick([0, 1, 2, 3, 4]); tries > 0 && answers().length; tries--) {
    const answer = pick(answers())
    h.press(declareReaction(answer.id, answer.draft, h.newId))
    const there = h.view().cells.filter((c) => c.reachable !== null || c.jump || c.step || c.center)
    if (there.length && pick([true, false])) h.click({ on: 'cell', cell: pick(there).cell })
    if (pick([true, false])) h.press(amendReaction(answer.id, {}))
  }
  playOut(h, pick)
  if (pick([true, false])) h.press(endTurn)
}

const DUELS = [
  { name: 'two brawlers', a: brawler, b: brawler, apart: 1 },
  { name: 'two archers', a: archer, b: archer, apart: 3 },
  { name: 'a brawler and an archer', a: brawler, b: archer, apart: 2 },
  { name: 'a spearman and an archer', a: spearman, b: archer, apart: 1 },
  { name: 'a warden and a trained archer', a: warden, b: (id: string) => trained(archer(id)), apart: 3 },
  { name: 'a warden and a trained brawler', a: warden, b: (id: string) => trained(brawler(id)), apart: 1 },
  { name: 'two wardens', a: warden, b: warden, apart: 2 },
]

describe('two characters grappling, pushing, shooting and defending', () => {
  for (const duel of DUELS) {
    it.each(DUEL_SEEDS)(`keeps ${duel.name} sound (seed %i)`, (seed) => {
      const rng = seededRng(seed)
      const pick: Picker = (from) => from[Math.floor(rng() * from.length)]
      const h = openHarness((explodes) => rollD10(explodes, rng))
      h.bring(duel.a('Ann'), duel.b('Bob'))
      h.createBoard(4)
      h.select('Ann')
      h.cell(0, 0)
      h.select('Bob')
      h.cell(duel.apart, 0)
      h.select('Ann')
      const duelPlays = plays().filter((p) => !['paint a cell', 'drop a held item', 'take a whole action'].includes(p.name))
      session(h, seed, 120, [...duelPlays, { name: 'exchange', weight: 12, run: exchange }], pick)
    })
  }
})
