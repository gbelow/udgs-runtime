import { mkdirSync, writeFileSync } from 'node:fs'
import { afterAll, describe, expect, it } from 'vitest'
import { rollD10, seededRng } from '../domain/combat/dice'
import { CombatStateSchema, type ActionDraft, type CombatState } from '../domain/combat/types'
import { getActionPanel } from '../domain/combat/projections/actionPanel'
import { getFootprint } from '../domain/combat/rules/board'
import { getAvailableActions } from '../domain/combat/rules/options'
import { ACTIONS, isReaction } from '../domain/combat/rules/actionCatalog'
import { getOpenAction } from '../domain/combat/rules/log'
import { coordKey } from '../domain/combat/geometry'
import { acceptSpellTest, amendAction, declareAction, amendReaction, boostPush, cancelAction, chooseSpell, declareReaction, payAction, resolveAction, rollAction, stepExtend, withdrawLastReaction, withdrawSpawnedAction } from '../domain/combat/commands/action'
import { chooseManeuver, improveSpell, moveWhileResting, refundHOP, refundImprovement, saveGraze, spendHOP } from '../domain/combat/commands/choices'
import { dropToFloor } from '../domain/combat/commands/floor'
import { endTurn, surge } from '../domain/combat/commands/turn'
import { nextRound } from '../domain/combat/commands/nextRound'
import { GRAPPLE_MANEUVERS, TERRAIN_BRUSHES } from '../domain/lists'
import { SurgeKindSchema } from '../domain/types'
import { archer, bomber, brawler, mage, netter, spearman, trained, warden } from '../domain/bot/fixtures'
import { openHarness, type Harness } from './boardHarness'
import { useCombatStore } from './useCombatStore'

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
  const castable = panel().spells.filter((s) => s.castable)
  const favoured = castable.filter((s) => s.key === 'flamethrower' || s.key === 'telepathic-link')
  const spell = first(favoured.length && pick([true, true, false]) ? favoured : castable)
  if (spell && !panel().open?.spell) h.press(chooseSpell(spell.key, false))
  const thrown = first(panel().open?.floor.filter((f) => f.available) ?? [])
  if (thrown && getOpenAction(h.state())?.kind === 'throw' && !panel().open?.item) h.press(amendAction({ itemId: thrown.itemId }))
  const gear = first(panel().gear)
  if (gear && getOpenAction(h.state())?.kind === 'cast') h.press(amendAction({ itemId: gear.itemId }))
  const target = first(h.view().tokens.filter((t) => t.targetable))
  if (target) h.click({ on: 'token', id: target.id })
  const there = first(h.view().cells.filter((c) => c.reachable !== null || c.jump || c.step || c.center))
  if (there) h.click({ on: 'cell', cell: there.cell })
  h.commit()
}

// What an answer that strikes for itself (a counterattack, an opportunity
// attack) is still asked for, from the reactor's own offers in the panel.
function answerWithAStrike(h: Harness, id: string, pick: Picker) {
  const strike = getActionPanel(h.state()).reactors.find((r) => r.id === id)?.strike
  if (!strike) return
  if (strike.options.length) { const { weaponKey, attack, variant } = pick(strike.options); h.press(amendReaction(id, { weaponKey, attack, variant })) }
  const refreshed = getActionPanel(h.state()).reactors.find((r) => r.id === id)?.strike
  if (refreshed?.locations.length) { const { location, part } = pick(refreshed.locations); h.press(amendReaction(id, { location, part })) }
  if (refreshed?.maneuvers.length && pick([true, false])) h.press(amendReaction(id, { mode: 'grapple', maneuver: pick(refreshed.maneuvers) }))
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
    { name: 'answer with a strike', weight: 2, run: (h, pick) => { const ids = getActionPanel(h.state()).reactors.filter((r) => r.strike).map((r) => r.id); if (ids.length) answerWithAStrike(h, pick(ids), pick) } },
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
}

// With FUZZ_REPORT set, what the sessions did is written to
// reports/fuzz-coverage.md: for every action in the catalogue, how many
// actions stood at each of its steps. Seen after each command, so an
// action that opens and closes inside one is not counted.
type Step = 'define' | 'react' | 'post' | 'done'
let sessions = 0
const reached = new Map<string, { sessions: Set<string>, steps: Record<Step, number> }>()

function record(session: string) {
  const counted = new Set<string>()
  return useCombatStore.subscribe((state) => {
    for (const a of Object.values(state.actions)) {
      const key = `${a.kind}${a.reactionTo ? ' (reaction)' : ''}${'maneuver' in a && a.kind === 'grapple' ? ` ${a.maneuver}` : ''}`
      const seen = reached.get(key) ?? { sessions: new Set<string>(), steps: { define: 0, react: 0, post: 0, done: 0 } }
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
    return `| ${key} | ${kind in ACTIONS ? ACTIONS[kind as keyof typeof ACTIONS].type : ''} | ${r?.sessions.size ?? 0} | ${r?.steps.define ?? 0} | ${r?.steps.react ?? 0} | ${r?.steps.post ?? 0} | ${r?.steps.done ?? 0} |`
  }
  const never = rows.filter((k) => !reached.has(k))
  const body = [
    '# Fuzz coverage',
    '',
    `${total} sessions. Each count is the actions that stood at that step after some command (define: being declared, react: committed and open to answers, post: rolled, done: finished); an action that jumps a step skips its count, as a reaction does from define to done. "sessions" is how many sessions saw the action at all.`,
    '',
    '| action | type | sessions | define | react | post | done |',
    '|---|---|---|---|---|---|---|',
    ...rows.map(line),
    '',
    `Never seen: ${never.length ? never.join(', ') : 'none'}`,
    '',
  ].join('\n')
  mkdirSync('reports', { recursive: true })
  writeFileSync('reports/fuzz-coverage.md', body)
})

function session(h: Harness, seed: number, steps: number, menu: Play[], pick: Picker) {
  const bag = menu.flatMap((p) => Array<Play>(p.weight ?? 1).fill(p))
  const trail: string[] = []
  const stop = record(String(++sessions))
  for (let step = 0; step < steps; step++) {
    const play = pick(bag)
    trail.push(play.name)
    try {
      play.run(h, pick)
      assertSound(h, step % STORAGE_EVERY === 0 || step === steps - 1)
      assertOffersHold(h)
    } catch (e) {
      stop()
      throw new Error(`seed ${seed}, step ${step}: ${(e as Error).message}\nlast plays: ${trail.slice(-12).join(' → ')}`, { cause: e })
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
// likelier to be a grapple, a push, a shot, a throw or a spell than a walk,
// the others answer with whatever defences are offered, and the roll runs on
// to its end, taking up whatever it opens.
const LEANING = ['grapple', 'push', 'drag', 'shoot', 'strike', 'cast', 'fireAgain', 'throw', 'cut', 'slip', 'release', 'holdBack', 'fall', 'pickUp']

// Answers the committed action with up to `tries` of the defences offered to
// anyone, a kind at a time so the rarer ones are not drowned by the many
// variants of the common ones.
function answerOpen(h: Harness, pick: Picker, tries: number) {
  const answers = () => Object.keys(h.state().characters).flatMap((id) => getAvailableActions(h.state(), id).filter((o) => o.available && o.reactionTo !== null).map((o) => ({ id, draft: o.draft })))
  for (let left = tries; left > 0 && answers().length; left--) {
    const offered = answers()
    const kind = pick([...new Set(offered.map((o) => o.draft.kind))])
    const answer = pick(offered.filter((o) => o.draft.kind === kind))
    h.press(declareReaction(answer.id, answer.draft, h.newId))
    const there = h.view().cells.filter((c) => c.reachable !== null || c.jump || c.step || c.center)
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
      const aimed = h.view().cells.filter((c) => open.kind === 'blast' || c.center)
      if (aimed.length) h.click({ on: 'cell', cell: pick(aimed).cell })
    }
    for (const step of [rollAction(h.dice, h.newId), acceptSpellTest(h.newId), payAction(h.newId), resolveAction(h.newId), withdrawSpawnedAction(h.newId)]) h.press(step)
    const panel = getActionPanel(h.state()).open
    if (panel && pick([true, false, false])) h.press(chooseManeuver(panel.disarm.length ? { item: pick(panel.disarm).itemId } : { along: pick([true, false]) }))
    if (pick([true, false, false, false])) h.press(boostPush(pick([true, false])))
  }
}

// Closure: once the roll, the payment, the resolution and every answer have
// been pressed for as long as they do anything, no action is left committed
// and waiting. An answer still being declared holds the action back, and
// taking it back always frees it.
function assertSettled(h: Harness) {
  const stuck = () => { const open = getOpenAction(h.state()); return open && open.step !== 'define' ? open : null }
  if (stuck()) {
    for (let i = 0; i < 8; i++) h.press(withdrawLastReaction())
    for (let i = 0; i < 10; i++) {
      const aiming = getOpenAction(h.state())
      if (aiming?.kind === 'blast' || aiming?.kind === 'explosion') {
        for (const c of h.view().cells.filter((c) => aiming.kind === 'blast' || c.center)) {
          h.click({ on: 'cell', cell: c.cell })
          const now = getOpenAction(h.state())
          if (now?.kind === 'blast' && now.center !== null) break
          if (now?.kind === 'explosion' && now.center !== null) break
        }
      }
      for (const step of [rollAction(h.dice, h.newId), payAction(h.newId), resolveAction(h.newId), withdrawSpawnedAction(h.newId)]) h.press(step)
    }
  }
  const open = stuck()
  expect(open ? `${open.kind} stuck at ${open.step}` : null).toBeNull()
}

function startTurnOf(h: Harness, pick: Picker) {
  if (getOpenAction(h.state())?.step === 'define') h.press(cancelAction())
  playOut(h, pick)
  assertSettled(h)
  if (pick([true, false])) h.press(nextRound(h.dice, h.newId))
  const { characters, binds } = h.state()
  const bound = binds.flatMap((b) => b.members).filter((id) => characters[id])
  h.select(characters[pick(bound.length && pick([true, true, false]) ? bound : Object.keys(characters))].name)
  h.startTurn()
  if (pick([true, true, false])) h.press(surge(h.active()!, pick(['focus', 'focus', ...SurgeKindSchema.options])))
}

const OWN = (h: Harness) => getAvailableActions(h.state(), h.active()!).filter((o) => o.available && !isReaction(o.draft.kind) && o.reactionTo === null)

function exchange(h: Harness, pick: Picker) {
  startTurnOf(h, pick)
  const every = OWN(h)
  const open = every.some((o) => o.draft.kind !== 'move') ? every.filter((o) => o.draft.kind !== 'move') : every
  if (!open.length) return
  const leaning = open.filter((o) => LEANING.includes(o.draft.kind))
  const grabs = open.filter((o) => o.draft.kind === 'strike' && 'grab' in o.draft && o.draft.grab)
  h.declare(pick(grabs.length && pick([true, false]) ? grabs : leaning.length && pick([true, true, true, false]) ? leaning : open).draft as ActionDraft)
  finishDeclaration(h, pick)
  answerOpen(h, pick, pick([0, 1, 2, 3, 4]))
  playOut(h, pick)
  if (pick([true, false])) h.press(endTurn)
}

// A walk, a swim, a climb, a jump or a run, as far as the board lets it go,
// with a dive added when it swims.
function travel(h: Harness, pick: Picker) {
  startTurnOf(h, pick)
  if (!OWN(h).some((o) => o.draft.kind === 'move')) return
  h.declare({ kind: 'move' })
  const moves = getActionPanel(h.state()).moves.filter((m) => m.available)
  const special = moves.filter((m) => ['swim', 'climb', 'jump', 'run', 'crawl'].includes(m.kind))
  if (moves.length) h.press(amendAction({ movement: pick(special.length && pick([true, true, false]) ? special : moves).kind }))
  for (let i = pick([1, 2, 3, 4]); i > 0; i--) {
    const cells = h.view().cells.filter((c) => c.reachable !== null)
    if (cells.length) h.click({ on: 'cell', cell: pick(cells).cell })
  }
  if (pick([true, false])) h.press(amendAction({ dive: pick([-1, 1, 2]) }))
  const climb = getActionPanel(h.state()).open?.climbSteps
  if (climb && pick([true, false])) h.press(amendAction({ metres: 1 + Math.floor(pick([0, 1, 2]) % climb.metres) }))
  const modes = getActionPanel(h.state()).open?.climbModes ?? []
  if (modes.length) h.press(amendAction({ mode: pick(modes) }))
  h.commit()
  answerOpen(h, pick, pick([0, 1, 2]))
  playOut(h, pick)
}

const DUELS = [
  { name: 'two brawlers', a: brawler, b: brawler, apart: 1 },
  { name: 'two archers', a: archer, b: archer, apart: 3 },
  { name: 'a brawler and an archer', a: brawler, b: archer, apart: 2 },
  { name: 'a spearman and an archer', a: spearman, b: archer, apart: 1 },
  { name: 'a warden and a trained archer', a: warden, b: (id: string) => trained(archer(id)), apart: 3 },
  { name: 'a warden and a trained brawler', a: warden, b: (id: string) => trained(brawler(id)), apart: 1 },
  { name: 'two wardens', a: warden, b: warden, apart: 1 },
  { name: 'a mage and a warden', a: mage, b: warden, apart: 2 },
  { name: 'a bomber and a warden', a: bomber, b: warden, apart: 2 },
  { name: 'a netter and a warden', a: netter, b: warden, apart: 2 },
]

const duelPlays = () => plays().filter((p) => !['paint a cell', 'drop a held item', 'take a whole action'].includes(p.name))

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
      session(h, seed, 120, [...duelPlays(), { name: 'exchange', weight: 12, run: exchange }, { name: 'travel', weight: 4, run: travel }], pick)
    })
  }
})

describe('an opportunity attack the attacker cannot pay for', () => {
  it.fails('does not leave the root waiting (two brawlers, seed 10)', () => {
    const rng = seededRng(10)
    const pick: Picker = (from) => from[Math.floor(rng() * from.length)]
    const h = openHarness((explodes) => rollD10(explodes, rng))
    h.bring(brawler('Ann'), brawler('Bob'))
    h.createBoard(4)
    h.select('Ann')
    h.cell(0, 0)
    h.select('Bob')
    h.cell(1, 0)
    h.select('Ann')
    session(h, 10, 120, [...duelPlays(), { name: 'exchange', weight: 12, run: exchange }, { name: 'travel', weight: 4, run: travel }], pick)
  })
})

// Seven of them crowded onto ground with a pond and a cliff painted on it,
// so that a throw has someone to hit, a net someone to catch, a shot someone
// to join, and a walk may end in the water or on the rock.
describe('a crowd on rough ground', () => {
  it.each(CROWD_SEEDS)('keeps the crowd sound (seed %i)', (seed) => {
    const rng = seededRng(seed)
    const pick: Picker = (from) => from[Math.floor(rng() * from.length)]
    const h = openHarness((explodes) => rollD10(explodes, rng))
    h.bring(warden('Ann'), bomber('Bob'), netter('Cy'), mage('Dee'), archer('Eve'), archer('Fay'), brawler('Gus'))
    h.createBoard(5)
    const paint = (brush: (typeof TERRAIN_BRUSHES)[number], cells: [number, number][], times = 1) => {
      h.holdBrush(brush)
      for (const [q, r] of cells) for (let i = 0; i < times; i++) h.cell(q, r)
      h.holdBrush(null)
    }
    paint('water', [[3, -1], [3, 0], [4, -2], [4, -1]])
    paint('deepen', [[3, -1], [3, 0], [4, -2], [4, -1]], 2)
    paint('raise', [[-3, 1], [-3, 2]], 2)
    paint('grip', [[-3, 1], [-3, 2]])
    for (const [name, q, r] of [['Ann', 0, 0], ['Bob', 1, 0], ['Cy', 0, 1], ['Dee', -1, 1], ['Eve', 0, -1], ['Fay', 2, -1], ['Gus', -2, 1]] as const) {
      h.select(name)
      h.cell(q, r)
    }
    h.select('Ann')
    session(h, seed, 160, [...duelPlays(), { name: 'exchange', weight: 12, run: exchange }, { name: 'travel', weight: 6, run: travel }], pick)
  })
})
