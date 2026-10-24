import { mkdirSync, writeFileSync } from 'node:fs'
import { afterAll, describe, expect, it } from 'vitest'
import { rollD10, seededRng } from '../domain/play/dice'
import { SceneStateSchema, type ActionDraft, type SceneState } from '../domain/scene/types'
import { getActionPanel } from '../domain/scene/projections/actionPanel'
import { getFootprint } from '../domain/scene/rules/board/board'
import { defRows } from '../domain/scene/rules/attack'
import { getAvailableActions, getAwaited } from '../domain/scene/rules/options'
import { ACTIONS, isReaction } from '../domain/scene/rules/actionCatalog'
import { getOpenAction } from '../domain/scene/rules/log'
import { getSeenBy } from '../domain/scene/rules/seen'
import { getBoardViewFrom } from '../domain/scene/projections/boardView'
import { getSceneSeenBy } from '../domain/scene/projections/seen'
import { coordKey, distance } from '../domain/scene/rules/board/geometry'
import { declareAction, declareReaction, payAnswered, rollAnswered } from '../domain/scene/commands/action'
import { getConcentrationOwed, getContinueBar, getHoldOnBar, getLetGoBar, getRoundPhase } from '../domain/scene/rules/roundChange'
import { DIE_SOURCES, ROLL_MODES } from '../domain/play/dice'
import { getChasePanel } from '../domain/scene/projections/chase'
import { getChaseStartBar, getDeclareBar, getDeclareOrder } from '../domain/scene/rules/chase'
import { getNextRoundBar } from '../domain/scene/rules/turn'
import { getHeldRows } from '../domain/scene/projections/heldTests'
import { type ChaseTier, CHASE_COVERS, CHASE_TIERS, CROSSING_SKILLS, GRAPPLE_MANEUVERS, LIGHT_LEVELS, TERRAIN_BRUSHES } from '../domain/lists'
import { CampaignCharacterSchema, SurgeKindSchema, type Character } from '../domain/types'
import { archer, bomber, crossbowman, brawler, mage, medic, netter, serpent, spearman, torchbearer, towerWarden, trained, warden } from '../domain/bot/fixtures'
import { openHarness, type Harness } from './boardHarness'
import { getOpenCalls, toThrower } from '../domain/play/calls'
import { useCombatStore } from './useCombatStore'
import { apply, diff } from '../net/diff'
import { sharedSceneOf } from '../net/protocol'
import { getImposed, IMPOSE_AFFLICTIONS, IMPOSE_DAMAGE_KINDS, IMPOSE_DRAFT, IMPOSE_EFFECTS, IMPOSE_SKILLS } from '../domain/scene/rules/impose'

// A player who presses whatever there is to press, in no order: every click
// the board takes and every button the panels dispatch, thrown at a fight of
// several characters on ground painted by the same brushes a player holds.
// What is asserted is what the architecture promises of any such session —
// nothing throws, the state is always one the schema accepts and the storage
// round-trips, the board is never drawn inconsistent with the characters on
// it, and a click the view calls closed changes nothing.

// FUZZ_SEEDS=n runs n seeds of every session instead of the few that keep the
// suite quick.
const seeds = (n: number) => Array.from({ length: Number(process.env.FUZZ_SEEDS) || n }, (_, i) => i + 1)
const SEEDS = seeds(16)
const DUEL_SEEDS = seeds(3)
const CROWD_SEEDS = seeds(4)
const CHASE_SEEDS = seeds(6)
const TABLE_SEEDS = seeds(1)
const STEPS = 200
const STORAGE_EVERY = 8

type Play = { name: string, weight?: number, run: (h: Harness, pick: Picker) => void }
type Picker = <T>(from: readonly T[]) => T

const highlighted = (h: Harness) => h.view().cells.filter((c) => c.reachable !== null || c.jump || c.step || c.center)

// What the character may declare of their own now.
const ownOptions = (h: Harness, id: string) => getAvailableActions(h.state(), id).filter((o) => o.available && !isReaction(o.draft.kind) && o.reactionTo === null)

// The defences open to anyone against the committed action.
const answersOffered = (h: Harness) => Object.keys(h.state().characters).flatMap((id) => getAvailableActions(h.state(), id).filter((o) => o.available && o.reactionTo !== null).map((o) => ({ id, draft: o.draft })))

// The cells a blast or an explosion may be aimed at.
const aimable = (h: Harness, open: { kind: string }) => h.view().cells.filter((c) => open.kind === 'blast' || c.center)

// The table throws a die the scene called for — typed in or rolled — and a die called for
// a target's test or a climb's is one the landing then reads (the table's
// ruling: nobody is asked for a die that will not be used).
function throwCalled(h: Harness, pick: Picker) {
  const open = getOpenCalls(h.state().calls)
  if (!open.length) return
  const call = pick(open)
  const read = Object.values(h.state().calls).filter((c) => c.id.startsWith('target:') || c.id.startsWith('redo:'))
  h.send({ kind: 'answer', args: [call.id, toThrower(h.roll).answer(call)!, pick(DIE_SOURCES)] })
  const s = h.state()
  if (Object.keys(s.calls).length > 0) return
  for (const c of read) {
    const [kind, actionId, of] = c.id.split(':')
    const action = s.actions[actionId]
    if (kind === 'target' && action?.step === 'done') expect(action.tested.map((t) => t.targetId), `${c.roller} threw a die for the ${action.kind} that was never read`).toContain(of)
    if (kind === 'redo' && action?.kind === 'move' && action.step === 'done') expect(action.redos[of], `${c.roller} threw a climb die that was never read`).toBeDefined()
  }
}

// Every die still called for, thrown.
function throwAllCalled(h: Harness, pick: Picker) {
  for (let i = 0; i < 40 && getOpenCalls(h.state().calls).length; i++) throwCalled(h, pick)
}

// The presses that carry a committed action to its end: everyone it still
// waits on answers with nothing, and the die, the price and the landing follow.
function carryOn(h: Harness, accept = false) {
  for (const id of getAwaited(h.state())) h.send({ kind: 'pass', args: [id] })
  h.send({ kind: 'roll', args: [] })
  if (accept) h.send({ kind: 'accept', args: [] })
  h.send({ kind: 'pay', args: [] })
  h.send({ kind: 'resolve', args: [] })
  h.send({ kind: 'skip', args: [] })
}

// Fills in whatever the open declaration is still asked for from the panel's
// own offers, aims it by clicking, and locks it.
function finishDeclaration(h: Harness, pick: Picker) {
  const panel = () => getActionPanel(h.state())
  if (getOpenAction(h.state())?.step !== 'define') return
  if (getOpenAction(h.state())?.kind === 'prepare') fillPreparation(h, pick)
  const first = <T>(from: readonly T[]) => (from.length ? pick(from) : null)
  const row = first(panel().attacks)
  if (row && !panel().open?.weapon) h.send({ kind: 'amend', args: [{ weaponKey: row.weaponKey, attack: row.attack, variant: row.variant }] })
  for (const m of panel().open?.modifiers ?? []) if (pick([true, false])) h.send({ kind: 'amend', args: [m.press] })
  const ammo = first(panel().ammo)
  if (ammo) h.send({ kind: 'amend', args: [{ ammoId: ammo.itemId }] })
  const castable = panel().spells.filter((s) => s.castable)
  const favoured = castable.filter((s) => s.key === 'flamethrower' || s.key === 'telepathic-link')
  const spell = first(favoured.length && pick([true, true, false]) ? favoured : castable)
  if (spell && !panel().open?.spell) h.send({ kind: 'cast', args: [spell.key, false] })
  const thrown = first(panel().open?.floor.filter((f) => f.available) ?? [])
  if (thrown && getOpenAction(h.state())?.kind === 'throw' && !panel().open?.item) h.send({ kind: 'amend', args: [{ itemId: thrown.itemId }] })
  const potion = first(panel().open?.potions ?? [])
  if (potion && !panel().open?.item) h.send({ kind: 'amend', args: [{ itemId: potion.itemId }] })
  const gear = first(panel().gear)
  if (gear && getOpenAction(h.state())?.kind === 'cast') h.send({ kind: 'amend', args: [{ itemId: gear.itemId }] })
  const target = first(h.view().tokens.filter((t) => t.targetable))
  if (target) h.click({ on: 'token', id: target.id })
  const named = h.state().board ? null : first(panel().targets)
  if (named) h.send({ kind: 'target', args: [named.id] })
  const suggested = first(panel().open?.suggestion?.options ?? [])
  if (suggested) h.send({ kind: 'amend', args: [{ suggested }] })
  const there = first(highlighted(h))
  if (there) h.click({ on: 'cell', cell: there.cell })
  h.commit()
}

// What a preparation is still asked for: what is prepared and with what, whether
// it carries movement, and what it waits for, all from the panel's own offers.
function fillPreparation(h: Harness, pick: Picker, anyoneEntering = false, only: readonly string[] | null = null) {
  const view = () => getActionPanel(h.state()).prepare
  const mains = view()?.mains.filter((m) => m.available && (only === null || only.includes(m.kind))) ?? []
  if (!mains.length) return
  h.send({ kind: 'amend', args: [{ main: pick(mains).kind, weaponKey: '', attack: '', variant: '', ammoId: '', key: '', quicken: false, extend: 0, movement: 'basic' }] })
  const made = view()!
  if (made.attacks.length) { const { weaponKey, attack, variant } = pick(made.attacks); h.send({ kind: 'amend', args: [{ weaponKey, attack, variant }] }) }
  for (const m of view()!.modifiers) if (pick([true, false])) h.send({ kind: 'amend', args: [m.press] })
  if (made.defenses.length) { const { weaponKey, attack } = pick(made.defenses); h.send({ kind: 'amend', args: [{ weaponKey, attack }] }) }
  if (made.ammo.length) h.send({ kind: 'amend', args: [{ ammoId: pick(made.ammo).itemId }] })
  const castable = made.spells.filter((s) => s.castable)
  if (castable.length) h.send({ kind: 'cast', args: [pick(castable).key, false] })
  const moves = made.movements.filter((m) => m.available)
  if (moves.length) h.send({ kind: 'amend', args: [{ movement: pick(moves).kind }] })
  const waits = view()!
  const event = anyoneEntering ? waits.events.find((e) => e.event !== 'sighted') ?? waits.events[0] : pick(waits.events)
  h.send({ kind: 'amend', args: [{ trigger: { event: event.event, who: anyoneEntering ? null : pick(waits.who).id } }] })
}

// What an answer that strikes for itself (a counterattack, an opportunity
// attack) is still asked for, from the reactor's own offers in the panel.
function answerWithAStrike(h: Harness, id: string, pick: Picker) {
  const strike = getActionPanel(h.state()).reactors.find((r) => r.id === id)?.strike
  if (!strike) return
  if (strike.options.length) { const { weaponKey, attack, variant } = pick(strike.options); h.send({ kind: 'amendReaction', args: [id, { weaponKey, attack, variant }] }) }
  const refreshed = getActionPanel(h.state()).reactors.find((r) => r.id === id)?.strike
  if (refreshed?.locations.length) { const { location, part } = pick(refreshed.locations); h.send({ kind: 'amendReaction', args: [id, { location, part }] }) }
  for (const m of refreshed?.modifiers ?? []) if (pick([true, false])) h.send({ kind: 'amendReaction', args: [id, m.press] })
  if (refreshed?.maneuvers.length && pick([true, false])) h.send({ kind: 'amendReaction', args: [id, { mode: 'grapple', maneuver: pick(refreshed.maneuvers) }] })
}

function plays(): Play[] {
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
        const placed = h.view().mode === 'idle' && before.round > 0 && before.activeCharacterId !== null && before.board?.placements[before.activeCharacterId] !== undefined
        h.click({ on: 'cell', cell: pick(cells).cell })
        if (closed) expect(h.state(), 'a click on a board the view calls locked changes nothing').toBe(before)
        if (placed) expect(h.state(), 'once the fight has started, a character placed is moved again only by a move or the GM').toBe(before)
      },
    },
    {
      name: 'click a highlighted cell',
      weight: 3,
      run: (h, pick) => {
        const offered = highlighted(h)
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
    { name: 'set the light', run: (h, pick) => h.light(pick(LIGHT_LEVELS)) },
    {
      name: 'ask for a test',
      run: (h, pick) => {
        const draft = { ...IMPOSE_DRAFT, effect: pick(IMPOSE_EFFECTS), skill: pick(IMPOSE_SKILLS), damageKind: pick(IMPOSE_DAMAGE_KINDS), affliction: pick(IMPOSE_AFFLICTIONS), amount: pick([1, 6, 20]), AP: pick([0, 2]), STA: pick([0, 3]), height: pick([1, 4, 12]) }
        h.send({ kind: 'impose', args: [Object.keys(h.state().characters), getImposed(draft)] })
      },
    },
    {
      name: 'roll an owed test',
      run: (h, pick) => {
        const owing = Object.values(h.state().characters).filter((c) => c.pending.length > 0)
        if (owing.length) h.send({ kind: 'edit', args: [pick(owing).id, { kind: 'resolvePending', args: [0] }, true] })
      },
    },
    { name: 'click a token', run: (h, pick) => h.token(pick(names(h))) },
    { name: 'click a floor item', run: (h, pick) => { const floor = h.view().floor; if (floor.length) h.floor(pick(floor).itemId) } },
    { name: 'click turn', run: (h) => h.turn() },
    { name: 'reposition as the GM', run: (h, pick) => { const cells = h.view().cells; if (cells.length) h.repositioning(() => h.click({ on: 'cell', cell: pick(cells).cell })) } },
    { name: 'turn as the GM', run: (h) => h.repositioning(() => h.turn()) },
    { name: 'select a character', weight: 2, run: (h, pick) => h.select(pick(names(h))) },
    { name: 'surge', run: (h, pick) => h.send({ kind: 'surge', args: [h.active()!, pick(SurgeKindSchema.options)] }) },
    { name: 'start turn', weight: 2, run: (h) => h.startTurn() },
    {
      name: 'declare',
      weight: 3,
      run: (h, pick) => {
        const id = h.active()
        const open = id ? ownOptions(h, id) : []
        const kinds = [...new Set(open.map((o) => o.draft.kind))]
        if (!kinds.length) return
        const kind = pick(kinds)
        h.declare(pick(open.filter((o) => o.draft.kind === kind)).draft as ActionDraft)
      },
    },
    {
      name: 'react',
      run: (h, pick) => {
        const options = answersOffered(h)
        if (options.length) { const o = pick(options); h.send({ kind: 'react', args: [o.id, o.draft] }) }
      },
    },
    { name: 'drop a held item', run: (h, pick) => { const c = h.active() ? h.state().characters[h.active()!] : undefined; if (c?.held.length) h.send({ kind: 'dropToFloor', args: [c.id, pick(c.held).id, false] }) } },
    { name: 'finish the declaration', weight: 4, run: (h, pick) => finishDeclaration(h, pick) },
    {
      name: 'take a whole action',
      weight: 4,
      run: (h, pick) => {
        h.select(pick(names(h)))
        h.startTurn()
        const open = ownOptions(h, h.active()!)
        if (!open.length) return
        h.declare(pick(open).draft as ActionDraft)
        finishDeclaration(h, pick)
        for (let i = 0; i < 6; i++) carryOn(h)
      },
    },
    { name: 'commit', weight: 3, run: (h) => h.commit() },
    // what the open declaration is still asked for, answered from the panel's own offers
    { name: 'pick an attack row', weight: 2, run: (h, pick) => { const rows = getActionPanel(h.state()).attacks; if (rows.length) { const { weaponKey, attack, variant } = pick(rows); h.send({ kind: 'amend', args: [{ weaponKey, attack, variant }] }) } } },
    { name: 'load a shot', run: (h, pick) => { const ammo = getActionPanel(h.state()).ammo; if (ammo.length) h.send({ kind: 'amend', args: [{ ammoId: pick(ammo).itemId }] }) } },
    { name: 'aim at a place', run: (h, pick) => { const places = getActionPanel(h.state()).locations; if (places.length) { const { location, part } = pick(places); h.send({ kind: 'amend', args: [{ location, part }] }) } } },
    { name: 'pick a movement', run: (h, pick) => { const moves = getActionPanel(h.state()).moves.filter((m) => m.available); if (moves.length) h.send({ kind: 'amend', args: [{ movement: pick(moves).kind }] }) } },
    { name: 'pick a maneuver', run: (h, pick) => h.send({ kind: 'amend', args: [{ maneuver: pick(GRAPPLE_MANEUVERS) }] }) },
    { name: 'choose a spell', weight: 3, run: (h, pick) => { const spells = getActionPanel(h.state()).spells.filter((s) => s.castable || s.quickenable); if (spells.length) { const s = pick(spells); h.send({ kind: 'cast', args: [s.key, !s.castable || (s.quickenable && pick([true, false]))] }) } } },
    { name: 'pick a potion', run: (h, pick) => { const potions = getActionPanel(h.state()).open?.potions ?? []; if (potions.length) h.send({ kind: 'amend', args: [{ itemId: pick(potions).itemId }] }) } },
    { name: 'suggest a limit stress action', run: (h, pick) => { const options = getActionPanel(h.state()).open?.suggestion?.options ?? []; if (options.length) h.send({ kind: 'amend', args: [{ suggested: pick(options) }] }) } },
    { name: 'pick the gear to cast with', run: (h, pick) => { const gear = getActionPanel(h.state()).gear; if (gear.length) h.send({ kind: 'amend', args: [{ itemId: pick(gear).itemId }] }) } },
    { name: 'extend a spell', run: (h, pick) => h.send({ kind: 'extend', args: [pick([1, -1] as const)] }) },
    { name: 'accept a spell test', run: (h) => h.send({ kind: 'accept', args: [] }) },
    { name: 'answer with nothing', weight: 2, run: (h, pick) => { const reactors = getActionPanel(h.state()).reactors; if (reactors.length) h.send({ kind: 'pass', args: [pick(reactors).id] }) } },
    { name: 'buy with the overflow', weight: 2, run: (h, pick) => { const options = getActionPanel(h.state()).hop.options.filter((o) => o.available); if (options.length) h.send({ kind: 'spend', args: [pick(options).purchase] }) } },
    { name: 'take back an overflow purchase', run: (h, pick) => { const options = getActionPanel(h.state()).hop.options; if (options.length) h.send({ kind: 'refund', args: [pick(options).purchase] }) } },
    { name: 'grapple on the hit', weight: 2, run: (h, pick) => { if (getActionPanel(h.state()).open?.grapples != null) h.send({ kind: 'grapple', args: [pick([true, false])] }) } },
    { name: 'improve a spell', run: (h, pick) => { const options = getActionPanel(h.state()).castHOP.options.filter((o) => o.available); if (options.length) h.send({ kind: 'improve', args: [pick(options).name] }) } },
    { name: 'take back an improvement', run: (h, pick) => { const options = getActionPanel(h.state()).castHOP.options; if (options.length) h.send({ kind: 'unimprove', args: [pick(options).name] }) } },
    { name: 'save a graze', run: (h) => h.send({ kind: 'grazeSave', args: [] }) },
    { name: 'move while resting', run: (h) => h.send({ kind: 'restMove', args: [] }) },
    { name: 'boost a push', run: (h, pick) => h.send({ kind: 'boostPush', args: [pick([true, false])] }) },
    { name: 'choose along or an item', run: (h, pick) => { const open = getActionPanel(h.state()).open; h.send({ kind: 'choose', args: [open?.disarm.length ? { item: pick(open.disarm).itemId } : { along: pick([true, false]) }] }) } },
    { name: 'answer with a strike', weight: 2, run: (h, pick) => { const ids = getActionPanel(h.state()).reactors.filter((r) => r.strike).map((r) => r.id); if (ids.length) answerWithAStrike(h, pick(ids), pick) } },
    { name: 'take back the last reaction', run: (h) => h.send({ kind: 'back', args: [] }) },
    { name: 'roll a held test', run: (h, pick) => { const owed = getHeldRows(h.state()).filter((r) => !r.result); if (owed.length) { const r = pick(owed); h.send({ kind: 'rollHeld', args: [r.id, r.kind, pick([...r.modes])] }) } } },
    { name: 'roll', run: (h) => h.send({ kind: 'roll', args: [] }) },
    { name: 'pay', run: (h) => h.send({ kind: 'pay', args: [] }) },
    { name: 'resolve', weight: 2, run: (h) => h.send({ kind: 'resolve', args: [] }) },
    { name: 'skip', run: (h) => h.send({ kind: 'skip', args: [] }) },
    { name: 'cancel', run: (h) => h.send({ kind: 'cancel', args: [] }) },
    { name: 'end turn', run: (h) => h.send({ kind: 'endTurn', args: [] }) },
    { name: 'next round', run: (h) => h.send({ kind: 'nextRound', args: [] }) },
    ...roundChangePlays(),
  ]
}

// The state as the schema holds it: the store's own actions left out.
const dataOf = (s: SceneState): SceneState => SceneStateSchema.parse(s)

// The first path in a value at which a string holds `needle`, or null.
function whereIs(value: unknown, needle: string, path = ''): string | null {
  if (typeof value === 'string') return value.includes(needle) ? path : null
  if (value && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) {
      const found = whereIs(inner, needle, `${path}.${key}`) ?? (key.includes(needle) ? `${path}.${key} (key)` : null)
      if (found) return found
    }
  }
  return null
}

// What each player is shown, whoever of the fight's characters they play
// alone or a pair of them: a fight the schema accepts, its log linked, and
// none of the characters left out named anywhere; the GM is shown it all.
function assertSeen(s: SceneState) {
  const ids = Object.keys(s.characters)
  expect(getSceneSeenBy(s, new Set(), true), 'the GM sees the fight whole').toBe(s)
  const viewers = [...ids.map((id) => [id]), ...(ids.length > 2 ? [[ids[0], ids[1]]] : [])]
  for (const controlled of viewers) {
    const seen = getSceneSeenBy(s, new Set(controlled))
    const view = SceneStateSchema.parse(JSON.parse(JSON.stringify(seen)))
    const shown = getSeenBy(s, new Set(controlled))
    const left = ids.filter((id) => !shown.has(id))
    const text = JSON.stringify(view)
    for (const id of left) {
      expect(text.includes(id), `${controlled.join('+')} is shown ${id}, whom they do not see, at ${whereIs(view, id)}`).toBe(false)
      const name = s.characters[id].name
      expect(text.includes(JSON.stringify(name)), `${controlled.join('+')} is shown the name ${name}, whom they do not see, at ${whereIs(view, name)}`).toBe(false)
    }
    for (const id of controlled) expect(view.characters[id], `${id} sees themselves`).toBeDefined()
    const blank = CampaignCharacterSchema.parse({})
    for (const id of shown) {
      if (controlled.includes(id) || !view.characters[id]) continue
      const { trainables, containers, injuries, resources, abilities, spells, notes } = view.characters[id]
      expect({ trainables, containers, injuries, resources, abilities, spells, notes }, `${controlled.join('+')} is shown the sheet of ${id}, whom they do not play`)
        .toEqual({ trainables: blank.trainables, containers: blank.containers, injuries: blank.injuries, resources: blank.resources, abilities: blank.abilities, spells: blank.spells, notes: blank.notes })
    }
    const known = new Set([...Object.keys(view.actions), ...view.journal.map((e) => e.action.id)])
    for (const a of Object.values(view.actions)) {
      for (const link of [a.reactionTo, a.spawnedBy, a.followUpOf]) {
        if (link !== null) expect(known.has(link), `${controlled.join('+')} is shown ${a.kind} ${a.id} linked to ${link}, which they are not`).toBe(true)
      }
    }
    for (const id of [...view.live, ...view.stack, ...view.landed]) expect(view.actions[id], `${controlled.join('+')} is shown ${id} on a list but not in the log`).toBeDefined()
  }
}

function assertSound(h: Harness, storage: boolean) {
  const s = h.state()
  if (storage) {
    assertSeen(s)
    const data = dataOf(s)
    expect(JSON.stringify(SceneStateSchema.parse(JSON.parse(JSON.stringify(data)))), 'the state survives storage').toBe(JSON.stringify(data))
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

  // the board from the active character's eyes draws them, and anyone it
  // draws whose sight the cells and the detection agree on
  const eye = s.activeCharacterId
  if (eye !== null && placements[eye]) {
    const from = getBoardViewFrom(s)
    const unseen = new Set(from.cells.filter((c) => c.unseen).map((c) => c.key))
    const seenToken = from.tokens.find((t) => t.id === eye)
    expect(seenToken, 'the active character is drawn from their own eyes').toBeDefined()
    expect(seenToken!.cells.some((c) => unseen.has(c.key)), 'the active character stands out of their own sight').toBe(false)
    for (const t of from.tokens) {
      expect(t.cells.some((c) => !unseen.has(c.key)), `${t.id} is drawn from the eyes of ${eye} though every cell of them is out of sight`).toBe(true)
    }
  }

  const known = new Set([...Object.values(s.actions), ...s.journal.map((e) => e.action)].map((a) => a.id))
  for (const a of Object.values(s.actions)) {
    for (const link of [a.reactionTo, a.spawnedBy, a.followUpOf]) {
      if (link !== null) expect(known.has(link), `${a.kind} ${a.id} links to ${link}, which is in neither the log nor the journal`).toBe(true)
    }
  }

  for (const a of Object.values(s.actions)) {
    const named = [a.actorId, a.targetId, ...a.results.map((r) => r.targetId), ...a.tested.map((t) => t.targetId), ...a.passed].filter((id): id is string => !!id && !!s.characters[id])
    for (const id of named) expect(a.participants, `${a.kind} ${a.id} names ${id} but does not list them as a participant`).toContain(id)
  }

  const holders = Object.values(s.actions).filter((a) => a.step === 'held').map((a) => a.actorId)
  expect(new Set(holders).size, 'a character holds one action at a time').toBe(holders.length)
  for (const id of holders) expect(s.characters[id], `${id} holds an action but is not in the fight`).toBeDefined()
  for (const id of s.stack) expect(s.actions[id].step, `${id} is held but on the stack`).not.toBe('held')
}

// The offers are the panel's promise: what getAvailableActions shows open can
// be pressed and does something, and what it shows closed is refused with the
// state left as it was. An own action can only be declared while none is open.
function assertOffersHold(h: Harness) {
  const s = h.state()
  let n = 0
  const newId = () => `probe-${n++}`
  const free = getOpenAction(s) === null
  for (const id of Object.keys(s.characters)) {
    for (const o of getAvailableActions(s, id)) {
      const own = o.reactionTo === null && !isReaction(o.draft.kind)
      const label = `${id}'s ${o.draft.kind}${o.reason ? ` (${o.reason})` : ''}`
      const after = own ? declareAction(id, o.draft, newId)(s) : declareReaction(id, o.draft, newId)(s)
      if (!o.available) {
        expect(after, `${label} is closed but was accepted`).toBe(s)
        continue
      }
      if (own && !free) continue
      const before = new Set(Object.keys(s.actions))
      const made = Object.values(after.actions).filter((a) => !before.has(a.id) && a.actorId === id && a.kind === o.draft.kind)
      expect(made.length, `${label} is offered but pressing it does nothing`).toBeGreaterThan(0)
    }
  }
  const awaited = getAwaited(s)
  if (awaited.length) {
    expect(rollAnswered(() => 5, newId)(s), `the die is thrown while ${awaited.join(', ')} may still answer`).toBe(s)
    expect(payAnswered(newId, () => 5)(s), `the price is paid while ${awaited.join(', ')} may still answer`).toBe(s)
  }
}

// With FUZZ_REPORT set, what the sessions did is written to
// reports/fuzz-coverage.md: for every action in the catalogue, how many
// actions stood at each of its steps. Seen after each command, so an
// action that opens and closes inside one is not counted.
type Step = 'define' | 'react' | 'post' | 'done' | 'held'
let sessions = 0
const reached = new Map<string, { sessions: Set<string>, steps: Record<Step, number> }>()

function record(session: string) {
  const counted = new Set<string>()
  return useCombatStore.subscribe((state) => {
    for (const a of Object.values(state.actions)) {
      const key = `${a.kind}${a.reactionTo ? ' (reaction)' : ''}${'maneuver' in a && a.kind === 'grapple' ? ` ${a.maneuver}` : ''}`
      const seen = reached.get(key) ?? { sessions: new Set<string>(), steps: { define: 0, react: 0, post: 0, done: 0, held: 0 } }
      seen.sessions.add(session)
      if (!counted.has(`${a.id}/${a.step}`)) { seen.steps[a.step]++; counted.add(`${a.id}/${a.step}`) }
      reached.set(key, seen)
    }
  })
}

afterAll(() => {
  if (!process.env.FUZZ_REPORT) return
  const total = new Set([...reached.values()].flatMap((r) => [...r.sessions])).size
  const rows = Object.keys(ACTIONS).flatMap((kind) => {
    const keys = [...reached.keys()].filter((k) => k === kind || k.startsWith(`${kind} `))
    return keys.length ? keys : [kind]
  }).sort()
  const line = (key: string) => {
    const r = reached.get(key)
    const kind = key.split(' ')[0]
    return `| ${key} | ${kind in ACTIONS ? ACTIONS[kind as keyof typeof ACTIONS].type : ''} | ${r?.sessions.size ?? 0} | ${r?.steps.define ?? 0} | ${r?.steps.react ?? 0} | ${r?.steps.post ?? 0} | ${r?.steps.done ?? 0} | ${r?.steps.held ?? 0} |`
  }
  const never = rows.filter((k) => !reached.has(k))
  const body = [
    '# Fuzz coverage',
    '',
    `${total} sessions. Each count is the actions that stood at that step after some command (define: being declared, react: committed and open to answers, post: rolled, done: finished, held: held over to the next round); an action that jumps a step skips its count, as a reaction does from define to done. "sessions" is how many sessions saw the action at all.`,
    '',
    '| action | type | sessions | define | react | post | done | held |',
    '|---|---|---|---|---|---|---|---|',
    ...rows.map(line),
    '',
    `Never seen: ${never.length ? never.join(', ') : 'none'}`,
    '',
  ].join('\n')
  mkdirSync('reports', { recursive: true })
  writeFileSync('reports/fuzz-coverage.md', body)
})

// What a failing session sent, written to reports/ for `replay` to play
// again from the record alone.
function writeReplay(h: Harness, seed: number): string {
  const file = `reports/fuzz-replay-${sessions}-seed-${seed}.json`
  mkdirSync('reports', { recursive: true })
  writeFileSync(file, JSON.stringify(h.record()))
  return file
}

// A table's guest holds what its host holds: what changed since the last
// change sent, carried as JSON and applied to the guest's copy, leaves that
// copy the host's state.
const onWire = <T,>(value: T): T => JSON.parse(JSON.stringify(value))
function wireOf(h: Harness) {
  let sent = sharedSceneOf(h.state())
  let guest = onWire(sent) as Record<string, unknown>
  return () => {
    const now = sharedSceneOf(h.state())
    const patch = diff(sent, now)
    if (patch) guest = apply(guest, onWire(patch))
    sent = now
    expect(onWire(guest), "a guest's copy is the host's state").toEqual(onWire(now))
  }
}

function session(h: Harness, seed: number, steps: number, menu: Play[], pick: Picker) {
  const dice: Play[] = h.table ? [{ name: 'throw a die called for', weight: 12, run: throwCalled }] : []
  const bag = [...menu, ...dice].flatMap((p) => Array<Play>(p.weight ?? 1).fill(p))
  const trail: string[] = []
  const stop = record(String(++sessions))
  const assertWire = wireOf(h)
  for (let step = 0; step < steps; step++) {
    const play = pick(bag)
    trail.push(play.name)
    try {
      play.run(h, pick)
      const storage = step % STORAGE_EVERY === 0 || step === steps - 1
      assertSound(h, storage)
      if (storage) assertWire()
      assertOffersHold(h)
    } catch (e) {
      stop()
      const file = writeReplay(h, seed)
      throw new Error(`seed ${seed}, step ${step}: ${(e as Error).message}\nlast plays: ${trail.slice(-12).join(' → ')}\ncommands sent: ${file}`, { cause: e })
    }
  }
  stop()
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

// Fights where each turn is an exchange: one character declares something
// likelier to be a grapple, a push, a shot or its reload, a throw or a spell than a walk,
// the others answer with whatever defences are offered, and the roll runs on
// to its end, taking up whatever it opens.
const LEANING = ['grapple', 'push', 'drag', 'shoot', 'reload', 'strike', 'cast', 'fireAgain', 'throw', 'cut', 'slip', 'release', 'holdBack', 'fall', 'pickUp']

// Answers the committed action with up to `tries` of the defences offered to
// anyone, a kind at a time so the rarer ones are not drowned by the many
// variants of the common ones.
function answerOpen(h: Harness, pick: Picker, tries: number) {
  for (let left = tries; left > 0 && answersOffered(h).length; left--) {
    const offered = answersOffered(h)
    const kind = pick([...new Set(offered.map((o) => o.draft.kind))])
    const answer = pick(offered.filter((o) => o.draft.kind === kind))
    h.send({ kind: 'react', args: [answer.id, answer.draft] })
    const there = highlighted(h)
    if (there.length && pick([true, false])) h.click({ on: 'cell', cell: pick(there).cell })
    answerWithAStrike(h, answer.id, pick)
  }
}

// Plays the open action out: declares what a resolution asks of its actor,
// answers it, then the die, the payment, the resolution and what it opens.
function playOut(h: Harness, pick: Picker) {
  for (let i = 0; i < 10; i++) {
    const open = getOpenAction(h.state())
    if (open?.step === 'define') finishDeclaration(h, pick)
    if (open?.step === 'react' && pick([true, true, false])) answerOpen(h, pick, pick([1, 2, 3]))
    if (open?.kind === 'blast' || open?.kind === 'explosion') {
      const aimed = aimable(h, open)
      if (aimed.length) h.click({ on: 'cell', cell: pick(aimed).cell })
    }
    carryOn(h, true)
    const panel = getActionPanel(h.state()).open
    if (panel && pick([true, false, false])) h.send({ kind: 'choose', args: [panel.disarm.length ? { item: pick(panel.disarm).itemId } : { along: pick([true, false]) }] })
    if (pick([true, false, false, false])) h.send({ kind: 'boostPush', args: [pick([true, false])] })
  }
}

// Closure: once the roll, the payment, the resolution and every answer have
// been pressed for as long as they do anything, no action is left committed
// and waiting. An answer still being declared holds the action back, and
// taking it back always frees it.
function assertSettled(h: Harness, pick: Picker) {
  const stuck = () => { const open = getOpenAction(h.state()); return open && open.step !== 'define' ? open : null }
  throwAllCalled(h, pick)
  if (stuck()) {
    for (let i = 0; i < 8; i++) h.send({ kind: 'back', args: [] })
    for (let i = 0; i < 10; i++) {
      const aiming = getOpenAction(h.state())
      if (aiming?.kind === 'blast' || aiming?.kind === 'explosion') {
        for (const c of aimable(h, aiming)) {
          h.click({ on: 'cell', cell: c.cell })
          const now = getOpenAction(h.state())
          if (now && 'center' in now && now.center !== null) break
        }
      }
      throwAllCalled(h, pick)
      carryOn(h)
    }
  }
  const open = stuck()
  expect(open ? `${open.kind} stuck at ${open.step}` : null).toBeNull()
}

// The round change's own buttons: each closed one must be refused with the
// state left as it was.
function roundChangePlays(): Play[] {
  const refused = (h: Harness, bar: string | null, press: () => void, label: string) => {
    const before = h.state()
    press()
    if (bar !== null) expect(h.state(), `${label} is closed (${bar}) but was accepted`).toBe(before)
  }
  return [
    { name: 'move the round change on', weight: 3, run: (h) => refused(h, getContinueBar(h.state()), () => h.send({ kind: 'continueRound', args: [] }), 'moving the round change on') },
    {
      name: 'hold on or let go',
      weight: 2,
      run: (h, pick) => {
        const id = pick(Object.keys(h.state().characters))
        if (pick([true, false])) refused(h, getHoldOnBar(h.state(), id), () => h.send({ kind: 'holdOn', args: [id] }), 'holding on')
        else refused(h, getLetGoBar(h.state(), id), () => h.send({ kind: 'letGo', args: [id] }), 'letting go')
      },
    },
    {
      name: 'test morale',
      run: (h, pick) => {
        const owed = h.state().morale.filter((m) => m.roll === null && h.state().characters[m.id])
        if (owed.length) h.send({ kind: 'rollMorale', args: [pick(owed).id, pick(ROLL_MODES), pick([true, false])] })
      },
    },
  ]
}

// The round passes, and its change is played as far as it goes before
// someone's turn or an action under way: everyone holding something picks
// whether to hold on, the morale tests are made, and the change moves on.
function passRoundChange(h: Harness, pick: Picker) {
  h.send({ kind: 'nextRound', args: [] })
  for (let i = 0; i < 40 && getRoundPhase(h.state()); i++) {
    const s = h.state()
    const owed = getConcentrationOwed(s)
    const untested = s.morale.find((m) => m.roll === null && s.characters[m.id])
    if (owed.length) {
      const id = pick(owed)
      h.send({ kind: getHoldOnBar(s, id) || pick([true, false]) ? 'letGo' : 'holdOn', args: [id] })
    } else if (untested) h.send({ kind: 'rollMorale', args: [untested.id, pick(ROLL_MODES), pick([true, false])] })
    else if (!getContinueBar(s)) h.send({ kind: 'continueRound', args: [] })
    else return
  }
}

function startTurnOf(h: Harness, pick: Picker, only: readonly string[] | null = null) {
  if (getOpenAction(h.state())?.step === 'define') h.send({ kind: 'cancel', args: [] })
  playOut(h, pick)
  // at a table rolling its own, the play goes on between the dice it waits on
  for (let i = 0; h.table && i < 4; i++) {
    throwAllCalled(h, pick)
    playOut(h, pick)
  }
  assertSettled(h, pick)
  if (pick([true, false])) passRoundChange(h, pick)
  const { characters, binds } = h.state()
  const bound = binds.flatMap((b) => b.members).filter((id) => characters[id])
  h.select(characters[pick(only ?? (bound.length && pick([true, true, false]) ? bound : Object.keys(characters)))].name)
  h.startTurn()
  if (pick([true, true, false])) h.send({ kind: 'surge', args: [h.active()!, pick(['focus', 'focus', ...SurgeKindSchema.options])] })
}

function exchange(h: Harness, pick: Picker) {
  startTurnOf(h, pick)
  const every = ownOptions(h, h.active()!)
  const open = every.some((o) => o.draft.kind !== 'move') ? every.filter((o) => o.draft.kind !== 'move') : every
  if (!open.length) return
  const leaning = open.filter((o) => LEANING.includes(o.draft.kind))
  h.declare(pick(leaning.length && pick([true, true, true, false]) ? leaning : open).draft as ActionDraft)
  finishDeclaration(h, pick)
  answerOpen(h, pick, pick([0, 1, 2, 3, 4]))
  playOut(h, pick)
  if (pick([true, false])) h.send({ kind: 'endTurn', args: [] })
}

// A walk, a swim, a climb, a jump or a run, as far as the board lets it go,
// with a dive added when it swims.
function travel(h: Harness, pick: Picker) {
  startTurnOf(h, pick)
  if (!ownOptions(h, h.active()!).some((o) => o.draft.kind === 'move')) return
  h.declare({ kind: 'move' })
  const moves = getActionPanel(h.state()).moves.filter((m) => m.available)
  const special = moves.filter((m) => ['swim', 'climb', 'jump', 'run', 'crawl'].includes(m.kind))
  if (moves.length) h.send({ kind: 'amend', args: [{ movement: pick(special.length && pick([true, true, false]) ? special : moves).kind }] })
  for (let i = pick([1, 2, 3, 4]); i > 0; i--) {
    const cells = h.view().cells.filter((c) => c.reachable !== null)
    if (cells.length) h.click({ on: 'cell', cell: pick(cells).cell })
  }
  if (pick([true, false])) h.send({ kind: 'amend', args: [{ dive: pick([-1, 1, 2]) }] })
  const climb = getActionPanel(h.state()).open?.climbSteps
  if (climb && pick([true, false])) h.send({ kind: 'amend', args: [{ metres: 1 + Math.floor(pick([0, 1, 2]) % climb.metres) }] })
  const modes = getActionPanel(h.state()).open?.climbModes ?? []
  if (modes.length) h.send({ kind: 'amend', args: [{ mode: pick(modes) }] })
  h.commit()
  answerOpen(h, pick, pick([0, 1, 2]))
  playOut(h, pick)
}

// Someone prepares an action, and then someone else walks as close to them as
// the board lets them, in the round it was prepared in: what it waits for may
// come, and be answered with it.
function ambush(h: Harness, pick: Picker) {
  startTurnOf(h, pick)
  const preparer = h.active()!
  if (!ownOptions(h, preparer).some((o) => o.draft.kind === 'prepare')) return
  h.declare({ kind: 'prepare' })
  fillPreparation(h, pick, true)
  h.commit()
  if (getOpenAction(h.state())?.step === 'define') { h.send({ kind: 'cancel', args: [] }); return }
  const at = h.state().board?.placements[preparer]?.cell
  const mover = pick(Object.values(h.state().characters).filter((c) => c.id !== preparer))
  if (!at || !mover) return
  h.select(mover.name)
  const [farthest] = h.view().cells.slice().sort((a, b) => distance(b.cell, at) - distance(a.cell, at))
  if (farthest) h.click({ on: 'cell', cell: farthest.cell })
  h.startTurn()
  if (!ownOptions(h, mover.id).some((o) => o.draft.kind === 'move')) return
  h.declare({ kind: 'move' })
  const [nearest] = h.view().cells.filter((c) => c.reachable !== null).sort((a, b) => distance(a.cell, at) - distance(b.cell, at))
  if (nearest) h.click({ on: 'cell', cell: nearest.cell })
  h.commit()
  const prepared = answersOffered(h).filter((o) => o.draft.kind === 'prepared')
  if (prepared.length) { const o = pick(prepared); h.send({ kind: 'react', args: [o.id, o.draft] }) }
  playOut(h, pick)
}

// Someone prepares a defense of whoever is attacked, and someone else attacks:
// the preparer is offered the defense, walks to the line before the die and
// makes it from there.
function rescue(h: Harness, pick: Picker) {
  const shielded = Object.values(h.state().characters).filter((c) => defRows(c).some((row) => row.weapon.shield !== undefined)).map((c) => c.id)
  if (!shielded.length) return
  startTurnOf(h, pick, shielded)
  const preparer = h.active()!
  if (!ownOptions(h, preparer).some((o) => o.draft.kind === 'prepare')) return
  h.declare({ kind: 'prepare' })
  fillPreparation(h, pick, true, ['block', 'intercept', 'guard'])
  h.commit()
  if (getOpenAction(h.state())?.step === 'define') { h.send({ kind: 'cancel', args: [] }); return }
  h.send({ kind: 'endTurn', args: [] })
  const attacker = pick(Object.values(h.state().characters).filter((c) => c.id !== preparer))
  if (!attacker) return
  h.select(attacker.name)
  h.startTurn()
  const attacks = ownOptions(h, attacker.id).filter((o) => o.draft.kind === 'strike' || o.draft.kind === 'shoot')
  if (!attacks.length) return
  h.declare(pick(attacks).draft as ActionDraft)
  finishDeclaration(h, pick)
  const defenses = answersOffered(h).filter((o) => o.id === preparer && 'preparedId' in o.draft && o.draft.preparedId)
  if (defenses.length) h.send({ kind: 'react', args: [preparer, pick(defenses).draft] })
  playOut(h, pick)
}

// Someone shoots at whoever holds a body shield, who guards and takes cover
// behind it when they may; then the exchanges go on around them.
const holdsBodyShield = (c: Character) => defRows(c).some((row) => row.weapon.shield?.body)

function shelter(h: Harness, pick: Picker) {
  const characters = Object.values(h.state().characters)
  const bearers = characters.filter(holdsBodyShield).map((c) => c.id)
  const shooters = characters.filter((c) => !bearers.includes(c.id)).map((c) => c.id)
  if (!bearers.length || !shooters.length) return
  startTurnOf(h, pick, shooters)
  if (!ownOptions(h, h.active()!).some((o) => o.draft.kind === 'shoot')) return
  h.declare({ kind: 'shoot' })
  const panel = getActionPanel(h.state())
  if (panel.attacks.length) { const row = pick(panel.attacks); h.send({ kind: 'amend', args: [{ weaponKey: row.weaponKey, attack: row.attack, variant: row.variant }] }) }
  const ammo = getActionPanel(h.state()).ammo
  if (ammo.length) h.send({ kind: 'amend', args: [{ ammoId: pick(ammo).itemId }] })
  const bearer = h.view().tokens.find((t) => t.targetable && bearers.includes(t.id))
  if (bearer) h.click({ on: 'token', id: bearer.id })
  h.commit()
  if (getOpenAction(h.state())?.step === 'define') { h.send({ kind: 'cancel', args: [] }); return }
  const covers = answersOffered(h).filter((o) => o.draft.kind === 'guard' && o.draft.cover)
  if (covers.length) { const o = pick(covers); h.send({ kind: 'react', args: [o.id, o.draft] }) }
  playOut(h, pick)
}

// The shelter is played only where someone holds a body shield, so that the
// sessions without one, and the seeds pinned from them, play as they did.
function shelterPlay(h: Harness): Play[] {
  return Object.values(h.state().characters).some(holdsBodyShield) ? [{ name: 'shelter', weight: 4, run: shelter }] : []
}

const DUELS = [
  { name: 'two brawlers', a: brawler, b: brawler, apart: 1 },
  { name: 'two archers', a: archer, b: archer, apart: 3 },
  { name: 'two archers across a pane that breaks', a: archer, b: archer, apart: 3, pane: [2, 0] as [number, number] },
  { name: 'a brawler and an archer', a: brawler, b: archer, apart: 2 },
  { name: 'a spearman and an archer', a: spearman, b: archer, apart: 1 },
  { name: 'a spearman and a crossbowman', a: spearman, b: crossbowman, apart: 3 },
  { name: 'a warden and a trained archer', a: warden, b: (id: string) => trained(archer(id)), apart: 3 },
  { name: 'a tower warden and a trained archer', a: towerWarden, b: (id: string) => trained(archer(id)), apart: 3 },
  { name: 'a warden and a trained brawler', a: warden, b: (id: string) => trained(brawler(id)), apart: 1 },
  { name: 'two wardens', a: warden, b: warden, apart: 1 },
  { name: 'a mage and a warden', a: mage, b: warden, apart: 2 },
  { name: 'a bomber and a warden', a: bomber, b: warden, apart: 2 },
  { name: 'a netter and a warden', a: netter, b: warden, apart: 2 },
  { name: 'a bent serpent and a brawler', a: serpent, b: brawler, apart: 2 },
  { name: 'a bleeding medic and a spearman', a: medic, b: spearman, apart: 1 },
  { name: 'a brawler and a warden', a: brawler, b: warden, apart: 2 },
  { name: 'a brawler and a spearman', a: brawler, b: spearman, apart: 2 },
]

const duelPlays = () => plays().filter((p) => !['paint a cell', 'set the light', 'drop a held item', 'take a whole action'].includes(p.name))

function playDuel(duel: (typeof DUELS)[number], seed: number, table = false) {
  const rng = seededRng(seed)
  const pick: Picker = (from) => from[Math.floor(rng() * from.length)]
  const h = openHarness((explodes) => rollD10(explodes, rng), { table })
  h.bring(duel.a('Ann'), duel.b('Bob'))
  h.createBoard(4)
  if (duel.pane) {
    h.paint('glass', [duel.pane])
    h.paint('flimsier', [duel.pane])
  }
  h.select('Ann')
  h.cell(0, 0)
  h.select('Bob')
  h.cell(duel.apart, 0)
  h.select('Ann')
  session(h, seed, 120, [...duelPlays(), { name: 'exchange', weight: 12, run: exchange }, { name: 'travel', weight: 4, run: travel }, { name: 'ambush', weight: 4, run: ambush }, ...shelterPlay(h)], pick)
}

describe('two characters grappling, pushing, shooting and defending', () => {
  for (const duel of DUELS) {
    it.each(DUEL_SEEDS)(`keeps ${duel.name} sound (seed %i)`, (seed) => playDuel(duel, seed))
  }

  // A brawler was offered an opportunity attack as a maneuver it had not the
  // stamina to pay for, and the root waited on it for good.
  it('never opens an opportunity attack its attacker cannot pay for (two brawlers, seed 10)', () => playDuel(DUELS[0], 10))

  // A prepared run stepped onto the last space of the move it answered, and the
  // mover, let through by the crash, walked on and ended on it too.
  it('never ends a move on a space a reaction took during it (a tower warden and a trained archer, seed 29)', () => playDuel(DUELS[7], 29))
})

// Seven of them crowded onto ground with a pond and a cliff painted on it,
// so that a throw has someone to hit, a net someone to catch, a shot someone
// to join, and a walk may end in the water or on the rock. With `walls`,
// those cells are painted as walls too, with fog, dim and dark ground beside
// them and a torch in one hand, so that some begin out of the others' sight
// and stealth has someone to hide; with panes of glass, and the warden's
// shield a body shield to take cover behind.
function playCrowd(seed: number, walls: [number, number][] = [], table = false) {
  const rng = seededRng(seed)
  const pick: Picker = (from) => from[Math.floor(rng() * from.length)]
  const h = openHarness((explodes) => rollD10(explodes, rng), { table })
  h.bring(walls.length ? towerWarden('Ann') : warden('Ann'), bomber('Bob'), netter('Cy'), mage('Dee'), archer('Eve'), archer('Fay'), walls.length ? torchbearer('Gus') : brawler('Gus'))
  h.createBoard(5)
  h.paint('water', [[3, -1], [3, 0], [4, -2], [4, -1]])
  h.paint('deepen', [[3, -1], [3, 0], [4, -2], [4, -1]], 2)
  h.paint('raise', [[-3, 1], [-3, 2]], 2)
  h.paint('grip', [[-3, 1], [-3, 2]])
  if (walls.length) {
    h.paint('wall', walls)
    h.paint('fog', [[-2, -1], [-3, 0]])
    h.paint('dim', [[1, 1], [2, 1]])
    h.paint('dark', [[0, 2], [1, 2], [2, 2], [-1, 2], [-4, 2], [-4, 3]])
    h.paint('glass', [[1, -2], [-1, -2]])
  }
  for (const [name, q, r] of [['Ann', 0, 0], ['Bob', 1, 0], ['Cy', 0, 1], ['Dee', -1, 1], ['Eve', 0, -1], ['Fay', 2, -1], ['Gus', -2, 1]] as const) {
    h.select(name)
    h.cell(q, r)
  }
  h.select('Ann')
  session(h, seed, 160, [...duelPlays(), { name: 'exchange', weight: 12, run: exchange }, { name: 'travel', weight: 6, run: travel }, { name: 'ambush', weight: 4, run: ambush }, { name: 'rescue', weight: 4, run: rescue }, ...shelterPlay(h)], pick)
}

describe('a crowd on rough ground', () => {
  it.each(CROWD_SEEDS)('keeps the crowd sound (seed %i)', (seed) => playCrowd(seed))

  // A reaction took the AP a committed opportunity attack still had to pay
  // its follow-up with, and the throw waited on that follow-up for good.
  it('keeps the AP of a committed opportunity attack from other answers (seed 6)', () => playCrowd(6))

  // A pusher with no AP committed a drag that cost nothing while the force
  // comparison forbade moving the block; a helper's assist turned it into one
  // costing 4, and the drag waited for good.
  it('never lets a help leave the push unpayable (seed 24)', () => playCrowd(24))
})

const COVER: [number, number][] = [[-1, 0], [-1, -1], [1, -1], [2, 0]]

describe('a crowd behind cover', () => {
  it.each(CROWD_SEEDS)('keeps the crowd sound (seed %i)', (seed) => playCrowd(seed, COVER))
})

// The chase panel's buttons, each pressed as its hook dispatches it. Every
// option the panel shows closed is refused, the state left as it was.
function chasePlays(): Play[] {
  const panel = (h: Harness) => getChasePanel(h.state())
  const rows = (h: Harness) => panel(h).rows
  const refused = (h: Harness, bar: string | null, press: () => void, label: string) => {
    const before = h.state()
    press()
    if (bar !== null) expect(h.state(), `${label} is closed (${bar}) but was accepted`).toBe(before)
  }
  const option = (h: Harness, pick: Picker, of: (r: ReturnType<typeof rows>[number]) => { id: string; name: string; bar: string | null }[]) => {
    const offered = rows(h).flatMap((row) => of(row).map((o) => ({ row, o })))
    return offered.length ? pick(offered) : null
  }
  return [
    {
      name: 'start a chase',
      run: (h, pick) => {
        const quarry = Object.keys(h.state().parties).filter(() => pick([true, false]))
        const tier = pick(CHASE_TIERS)
        refused(h, getChaseStartBar(h.state(), quarry, tier), () => h.send({ kind: 'startChase', args: [quarry, tier] }), 'starting the chase')
      },
    },
    {
      name: 'declare a chase move',
      weight: 10,
      run: (h, pick) => {
        const declaring = rows(h).filter((r) => r.declares)
        if (!declaring.length) return
        const row = pick(declaring)
        const { move, bar } = pick(row.moves)
        const scout = move === 'run' && bar === null && row.scoutBar === null && pick([true, false, false]) ? { what: 'a ditch', DL: pick([0, 3, 6]), obstacle: pick([true, false]) } : null
        refused(h, bar, () => h.send({ kind: 'declareChase', args: [row.id, { move, scout, hideModifier: pick([0, 2]) }] }), `${row.name}'s ${move}`)
        if (bar === null) expect(h.state().chase?.declarations[row.id]?.move, `${row.name}'s ${move} is open but was not declared`).toBe(move)
      },
    },
    { name: 'resolve the chase round', weight: 5, run: (h) => refused(h, panel(h).resolveBar, () => h.send({ kind: 'resolveChase', args: [] }), 'resolving the round') },
    { name: 'next round', weight: 3, run: (h) => h.send({ kind: 'nextRound', args: [] }) },
    { name: 'split someone off', weight: 2, run: (h, pick) => h.send({ kind: 'splitOff', args: [pick(Object.keys(h.state().characters))] }) },
    { name: 'create a party', run: (h) => h.send({ kind: 'createParty', args: [''] }) },
    { name: 'delete a party', run: (h, pick) => { const ids = Object.keys(h.state().parties); if (ids.length) h.send({ kind: 'deleteParty', args: [pick(ids)] }) } },
    { name: 'move someone to another party', run: (h, pick) => h.send({ kind: 'moveToParty', args: [pick(Object.keys(h.state().characters)), pick(Object.keys(h.state().parties))] }) },
    {
      name: 'chase another party',
      run: (h, pick) => { const c = option(h, pick, (r) => r.followOptions); if (c) refused(h, c.o.bar, () => h.send({ kind: 'followParty', args: [c.row.id, c.o.id] }), `${c.row.name} chasing ${c.o.name}`) },
    },
    {
      name: 'put a party back',
      run: (h, pick) => { const c = option(h, pick, (r) => r.putBackOptions); if (c) refused(h, c.o.bar, () => h.send({ kind: 'putBack', args: [c.row.id, c.o.id, pick(CHASE_TIERS)] }), `${c.row.name} put back after ${c.o.name}`) },
    },
    {
      name: 'join a fight',
      run: (h, pick) => { const c = option(h, pick, (r) => r.joinOptions); if (c) refused(h, c.o.bar, () => h.send({ kind: 'joinChaseFight', args: [c.row.id, c.o.id] }), `${c.row.name} joining ${c.o.name}`) },
    },
    {
      name: 'give up, merge back or fight',
      run: (h, pick) => {
        if (!rows(h).length) return
        const row = pick(rows(h))
        pick([
          () => refused(h, row.giveUpBar, () => h.send({ kind: 'giveUp', args: [row.id] }), `${row.name} giving up`),
          () => refused(h, row.mergeBar, () => h.send({ kind: 'mergeBack', args: [row.id] }), `${row.name} merging back`),
          () => refused(h, row.fightBar, () => h.send({ kind: 'setPartyFighting', args: [row.id, !row.fighting] }), `${row.name} ${row.fighting ? 'running again' : 'fighting'}`),
        ])()
      },
    },
    { name: 'turn around', run: (h, pick) => { const members = rows(h).filter((r) => r.turnable).flatMap((r) => r.members); if (members.length) h.send({ kind: 'turnAround', args: [pick(members).id] }) } },
    { name: 'take cover', run: (h, pick) => { const runners = panel(h).runners; if (runners.length) h.send({ kind: 'setChaseCover', args: [pick(runners).id, pick([null, ...CHASE_COVERS])] }) } },
    {
      name: 'cross an obstacle',
      run: (h, pick) => {
        const crossing = rows(h).filter((r) => r.feature?.obstacle)
        if (!crossing.length) return
        const row = pick(crossing)
        refused(h, row.crossBar, () => h.send({ kind: 'crossObstacle', args: [row.id, pick(CROSSING_SKILLS), pick([0, 3, 6])] }), `${row.name} crossing`)
      },
    },
    { name: 'end the chase', run: (h) => refused(h, panel(h).endBar, () => h.send({ kind: 'endChase', args: [] }), 'ending the chase') },
    {
      name: 'scout a hiding place, run to it and hide',
      weight: 2,
      run: (h, pick) => {
        for (let round = 0; round < 6 && h.state().chase; round++) {
          let hid = false
          for (const p of getDeclareOrder(h.state())) {
            const row = rows(h).find((r) => r.id === p)
            const open = row?.moves.filter((m) => m.bar === null).map((m) => m.move) ?? []
            if (!row || !open.length) continue
            const scouting = !row.feature && row.scoutBar === null && open.includes('run')
            const move = open.includes('hide') ? 'hide' : scouting ? 'run' : pick(open)
            const scout = scouting ? { what: 'a hollow', DL: -20, obstacle: false } : null
            hid ||= move === 'hide'
            h.send({ kind: 'declareChase', args: [p, { move, scout, hideModifier: 0 }] })
          }
          refused(h, panel(h).resolveBar, () => h.send({ kind: 'resolveChase', args: [] }), 'resolving the round')
          if (hid || getNextRoundBar(h.state())) return
          passRoundChange(h, pick)
        }
      },
    },
  ]
}

// A chase over no board: three running from three, the panel's buttons
// pressed in any order between exchanges — a shot, a strike, a spell — played
// out by the same reactions as on the board, with nothing to read distance,
// reach or cover from but the chase.
function playChase(seed: number, table = false) {
  const { h, pick } = openChase(seed, undefined, table)
  session(h, seed, 160, [...duelPlays(), ...chasePlays(), { name: 'exchange', weight: 10, run: exchange }, ...shelterPlay(h)], pick)
}

function openChase(seed: number, tier?: ChaseTier, table = false) {
  const rng = seededRng(seed)
  const pick: Picker = (from) => from[Math.floor(rng() * from.length)]
  const h = openHarness((explodes) => rollD10(explodes, rng), { table })
  h.bring(warden('Ann'), trained(archer('Bob')), brawler('Cy'), towerWarden('Dee'), crossbowman('Eve'), mage('Fay'))
  h.send({ kind: 'splitOff', args: [h.idOf('Dee')] })
  const theirs = h.state().partyOf[h.idOf('Dee')]
  for (const name of ['Eve', 'Fay']) h.send({ kind: 'moveToParty', args: [h.idOf(name), theirs] })
  h.send({ kind: 'startChase', args: [[h.state().partyOf[h.idOf('Ann')]], tier ?? pick(['combat', 'shooting', 'far'] as const)] })
  passRoundChange(h, pick)
  h.select('Ann')
  return { h, pick }
}

// The same sessions at a table that rolls its own dice: every die a command
// calls for waits, and is thrown or typed in as a press of its own, in any order with everything else — which, while a die waits,
// the offers and the board must show closed.
describe('with the dice left to the table', () => {
  for (const duel of DUELS) {
    it.each(TABLE_SEEDS)(`keeps ${duel.name} sound (seed %i)`, (seed) => playDuel(duel, seed, true))
  }
  it.each(TABLE_SEEDS)('keeps the crowd sound (seed %i)', (seed) => playCrowd(seed, [], true))
  it.each(TABLE_SEEDS)('keeps the crowd behind cover sound (seed %i)', (seed) => playCrowd(seed, COVER, true))
  it.each(TABLE_SEEDS)('keeps the chase sound (seed %i)', (seed) => playChase(seed, true))
})

describe('a chase with no board', () => {
  it.each(CHASE_SEEDS)('keeps the chase sound (seed %i)', (seed) => playChase(seed))

  // A flamethrower cast with no board opened a spray that waited for good on
  // a direction only a click on a board cell could give it.
  it('never leaves a spray waiting on a board that is not there (seed 9)', () => playChase(9))

  // A runner could start a turn before the round's moves were declared and
  // run, and the turn taken then barred declaring and resolving for good.
  it('starts no turn before the chase round is resolved', () => {
    const { h } = openChase(1)
    const before = h.state()
    h.startTurn()
    expect(h.state()).toEqual(before)
  })

  // A round where everyone only ran waited on every runner to agree to end
  // it, and let them start turns with nothing to do in them.
  it('ends a round of running without anyone agreeing, and starts no turn in it', () => {
    const { h } = openChase(1, 'shooting')
    for (const p of getDeclareOrder(h.state())) h.send({ kind: 'declareChase', args: [p, { move: 'run', scout: null, hideModifier: 0 }] })
    h.send({ kind: 'resolveChase', args: [] })
    const before = h.state()
    h.startTurn()
    expect(h.state()).toEqual(before)
    expect(getNextRoundBar(h.state())).toBeNull()
  })

  // A rest at the round change was counted as a turn of the round, and a
  // chase started from the fight at that round change could then never be
  // declared or resolved.
  it('declares and resolves a chase started at the round change after a rest in it', () => {
    const h = openHarness(() => 5)
    h.bring(warden('Ann'), brawler('Cy'), towerWarden('Dee'))
    h.send({ kind: 'splitOff', args: [h.idOf('Dee')] })
    h.send({ kind: 'nextRound', args: [] })
    for (let i = 0; i < 10 && getRoundPhase(h.state()); i++) h.send({ kind: 'continueRound', args: [] })
    for (const name of ['Ann', 'Cy', 'Dee']) h.send({ kind: 'toggleAgreeToEnd', args: [h.idOf(name)] })
    h.send({ kind: 'nextRound', args: [] })
    h.select('Ann')
    h.declare({ kind: 'rest' } as ActionDraft)
    h.commit()
    for (let i = 0; i < 10 && getRoundPhase(h.state()) !== 'chase'; i++) h.send({ kind: 'continueRound', args: [] })
    h.send({ kind: 'startChase', args: [[h.state().partyOf[h.idOf('Ann')]], 'shooting'] })
    h.send({ kind: 'continueRound', args: [] })
    for (const p of getDeclareOrder(h.state())) h.send({ kind: 'declareChase', args: [p, { move: 'run', scout: null, hideModifier: 0 }] })
    h.send({ kind: 'resolveChase', args: [] })
    expect(h.state().chase?.resolved).toBe(true)
  })

  // A party whose members had all died stayed in the chain, and whoever
  // chased it waited on it to declare for good. The table's ruling: it is out
  // of the chase and its pursuers take over its link.
  it('hands the link of a party that dies out to its pursuers', () => {
    const h = openHarness(() => 5)
    h.bring(warden('Ann'), brawler('Cy'), towerWarden('Dee'))
    h.send({ kind: 'splitOff', args: [h.idOf('Cy')] })
    h.send({ kind: 'splitOff', args: [h.idOf('Dee')] })
    const [ann, cy, dee] = ['Ann', 'Cy', 'Dee'].map((name) => h.state().partyOf[h.idOf(name)])
    h.send({ kind: 'startChase', args: [[ann, cy], 'shooting'] })
    for (let i = 0; i < 10 && getRoundPhase(h.state()); i++) h.send({ kind: 'continueRound', args: [] })
    expect(h.state().chase?.links[dee]?.chases).toBe(ann)
    for (const p of getDeclareOrder(h.state())) h.send({ kind: 'declareChase', args: [p, { move: 'run', scout: null, hideModifier: 0 }] })
    h.send({ kind: 'resolveChase', args: [] })
    h.send({ kind: 'edit', args: [h.idOf('Ann'), { kind: 'setInjury', args: ['injuryLevel', 999] }, true] })
    h.send({ kind: 'nextRound', args: [] })
    for (let i = 0; i < 10 && getRoundPhase(h.state()); i++) h.send({ kind: 'continueRound', args: [] })
    expect(h.state().chase?.out).toContain(ann)
    expect(h.state().chase?.links[dee]?.chases).toBe(cy)
    expect(getDeclareBar(h.state(), dee, { move: 'run', scout: null, hideModifier: 0 })).toBe(`${h.state().parties[cy].name} declares first`)
  })
})
