import type { Coord, SceneState } from '../types'
import type { SceneCommand } from '../commands/registry'
import { perState } from '../../perState'
import { findOpenRoot, getOpenAction } from '../rules/log'
import { getNextStep } from '../rules/action'
import { getReachableCells } from '../rules/board/reach'
import { getAim } from '../rules/aim'
import { getSteadyPath, isSteadyShot } from '../rules/steadyArms'
import { getDragReach } from '../rules/drag'
import { getEvasiveJumper } from '../rules/board/boardMode'
import { getEvasiveJumpPlacements } from '../rules/move'
import { isAimable } from '../rules/explosion'
import { ring } from '../rules/board/geometry'
import { getActionOffers, type ActionOffers, type ReactorOptions } from './actionPanel'
import type { PrepareView } from './prepare'
import type { ModifierView } from './modifiers'

// What the open action, and every answer to it still being declared, asks to
// be filled in, as the panel and the board offer it: each fill is the command
// its button or its click sends, named by the part of the declaration it
// decides and the value it gives that part. What declares an action, answers
// it, commits, rolls or lands it is a button (`getOpenButtons`), not a fill.
//
// `chosen` marks the value the part has now: pressing it again may take it
// back (a row, a toggle), so only the others are offers. A part stepped one at
// a time (how many times a spell is extended, how far a climb goes, how deep a
// swim dives) gives each step's value and, in `from`, the value it has now.
// `actorId` is whose choice it is.
//
// The offers are the action panel's own (`getActionOffers`), so they are the
// panel's, and its cells off the rules the board view reads: the reach of a
// move, a steady shot's careful path and a push's way, the landings of an
// evasive jump, and where an aimed action may be pointed.

type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

export type ChoicePart =
  | 'row' | 'ammo' | 'item' | 'container' | 'spell' | 'gear' | 'chargeInto' | 'charge' | 'suggested' | 'modifier'
  | 'movement' | 'mode' | 'ledge' | 'metres' | 'leap' | 'dive' | 'target' | 'location' | 'object' | 'sweep' | 'firedAt'
  | 'flee' | 'pushMovement' | 'boost' | 'extend' | 'for' | 'main' | 'defense' | 'trigger' | 'opportunityMode' | 'maneuver'
  | 'cell' | 'overflow' | 'grapple' | 'theft' | 'improve' | 'grazeSave' | 'along' | 'grappling' | 'disarm' | 'testMode' | 'restMove'

export type OpenChoice = { actorId: string; part: ChoicePart; value: Json; chosen: boolean; from?: number; command: SceneCommand; label: string }

// Parts given a step at a time: a pick names the value they end at.
export const STEPPED_PARTS: readonly ChoicePart[] = ['extend', 'metres', 'dive']

export const getOpenChoices = perState((state: SceneState): OpenChoice[] => {
  const open = getOpenAction(state)
  if (!open) return []
  const offers = getActionOffers(state)
  return [
    ...(open.step === 'define' ? declarationChoices(state, offers, open.actorId) : []),
    ...(offers.prepare ? prepareChoices(offers.prepare, open.actorId) : []),
    ...offers.reactors.flatMap(answerChoices),
    ...cellChoices(state),
    ...afterRollChoices(state, offers),
  ]
})

const amend = (fields: Record<string, unknown>): SceneCommand => ({ kind: 'amend', args: [fields] } as SceneCommand)
const amendReaction = (id: string, fields: Record<string, unknown>): SceneCommand => ({ kind: 'amendReaction', args: [id, fields] } as SceneCommand)

function choice(actorId: string, part: ChoicePart, value: Json, chosen: boolean, command: SceneCommand, label: string, from?: number): OpenChoice {
  return from === undefined ? { actorId, part, value, chosen, command, label } : { actorId, part, value, chosen, command, label, from }
}

// a toggle: the value it has, and the one a press gives it
function toggle(actorId: string, part: ChoicePart, now: boolean, command: SceneCommand, label: string): OpenChoice[] {
  return [choice(actorId, part, now, true, command, `${label}: ${now ? 'on' : 'off'}`), choice(actorId, part, !now, false, command, `${label}: ${now ? 'off' : 'on'}`)]
}

function modifierChoices(actorId: string, modifiers: ModifierView[], send: (press: ModifierView['press']) => SceneCommand): OpenChoice[] {
  return modifiers.filter((m) => m.allowed || m.on).flatMap((m) => [
    choice(actorId, 'modifier', { key: m.key, on: m.on }, true, send(m.press), `${m.label}: ${m.on ? 'on' : 'off'}`),
    ...(m.allowed ? [choice(actorId, 'modifier', { key: m.key, on: !m.on }, false, send(m.press), `${m.label}: ${m.on ? 'off' : 'on'}`)] : []),
  ])
}

function declarationChoices(state: SceneState, offers: ActionOffers, actorId: string): OpenChoice[] {
  const open = offers.open
  const raw = getOpenAction(state)
  if (!open || !raw) return []
  const out: OpenChoice[] = []
  const add = (part: ChoicePart, value: Json, chosen: boolean, command: SceneCommand, label: string, from?: number) => out.push(choice(actorId, part, value, chosen, command, label, from))

  if (open.flee !== null) for (const flee of [true, false]) add('flee', flee, open.flee === flee, amend({ flee }), flee ? 'flee' : 'end')
  for (const s of offers.attacks) add('row', { weaponKey: s.weaponKey, attack: s.attack, variant: s.variant }, s.selected, amend({ weaponKey: s.weaponKey, attack: s.attack, variant: s.variant }), `${s.weapon} ${s.attack} ${s.variant}`.trim())
  if (open.sweep?.turnable) for (const d of ['clockwise', 'counterclockwise'] as const) add('sweep', d, open.sweep.direction === d, amend({ sweepDirection: d }), `sweep ${d}`)
  out.push(...modifierChoices(actorId, open.modifiers, amend))
  for (const s of open.steady?.steps ?? []) add('firedAt', s.at, s.selected, amend({ firedAt: s.at }), `fire from ${s.at}`)
  for (const a of offers.ammo) add('ammo', a.itemId, a.itemId === open.ammoId, amend({ ammoId: a.itemId }), a.name)
  for (const f of open.floor.filter((f) => f.available)) add('item', f.itemId, f.itemId === open.item, amend(f.from ? { itemId: f.itemId, from: f.from } : { itemId: f.itemId }), f.name)
  for (const o of open.openables) add('container', o.key, o.selected, amend({ key: o.key }), o.name)
  for (const p of open.potions) add('item', p.itemId, p.itemId === open.item, amend({ itemId: p.itemId }), p.name)
  for (const m of open.push?.movements.filter((m) => m.available) ?? []) add('pushMovement', m.kind, m.kind === open.push?.movement, amend({ movement: m.kind, path: [] }), `push ${m.kind}`)
  if (open.push?.canBoost) out.push(...toggle(actorId, 'boost', open.push.boost, { kind: 'boostPush', args: [!open.push.boost] }, '+5 force'))
  const cast = raw.kind === 'cast' ? raw : null
  for (const s of offers.spells) {
    if (s.castable) add('spell', { key: s.key, quicken: false }, cast?.key === s.key && !cast.quicken, { kind: 'cast', args: [s.key, false] }, s.name)
    if (s.quickenable) add('spell', { key: s.key, quicken: true }, cast?.key === s.key && cast.quicken, { kind: 'cast', args: [s.key, true] }, `${s.name}, quickened`)
  }
  for (const g of offers.gear) add('gear', g.itemId, g.itemId === open.castItemId, amend({ itemId: g.itemId }), g.name)
  for (const g of offers.chargeInto) add('chargeInto', g.itemId, g.itemId === open.chargeItemId, amend({ chargeItemId: g.itemId }), g.name)
  for (const a of open.suggestion?.options ?? []) add('suggested', a, a === open.suggestion?.picked, amend({ suggested: a }), a)
  if (open.spell && open.extend) {
    const times = open.extend.times
    add('extend', times + 1, false, { kind: 'extend', args: [1] }, 'extend more', times)
    if (times > 0) add('extend', times - 1, false, { kind: 'extend', args: [-1] }, 'extend less', times)
  }
  for (const c of offers.charges) add('charge', c.itemId, c.itemId === open.itemId, amend({ itemId: c.itemId, key: c.key, center: c.cell }), `${c.name} in ${c.item}`)
  for (const m of offers.moves.filter((m) => m.available)) add('movement', m.kind, m.kind === open.movement, amend({ movement: m.kind, path: [], dive: 0, mode: 'normal', leap: false, recipe: null, metres: null, ledge: null }), m.kind)
  if (open.testModes?.by === 'mover' && open.testModes.modes.length > 1) for (const mode of open.testModes.modes) add('mode', mode, mode === open.mode, amend({ mode }), `${open.testModes.test} ${mode}`)
  for (const s of open.climbStops ?? []) add('ledge', { cell: { q: s.cell.q, r: s.cell.r }, floor: s.floor }, s.chosen, amend({ ledge: { cell: s.cell, floor: s.floor }, metres: null }), `climb to ${s.floor} m`)
  const climb = open.climbSteps
  if (climb?.less != null) add('metres', climb.less, false, amend({ metres: climb.less }), 'climb less', climb.metres)
  if (climb?.more != null) add('metres', climb.more, false, amend({ metres: climb.more }), 'climb more', climb.metres)
  if (open.canLeap) out.push(...toggle(actorId, 'leap', open.leap, amend({ leap: !open.leap }), 'start with a jump'))
  if (open.diveSteps?.up != null) add('dive', open.diveSteps.up, false, amend({ dive: open.diveSteps.up }), 'swim up', open.dive)
  if (open.diveSteps?.down != null) add('dive', open.diveSteps.down, false, amend({ dive: open.diveSteps.down }), 'swim down', open.dive)
  for (const t of offers.targets) add('target', t.id, t.selected, { kind: 'target', args: [t.id] }, t.name)
  for (const l of offers.locations) add('location', { location: l.location, part: l.part }, l.selected, amend({ location: l.location, part: l.part, object: '' }), l.name)
  for (const i of offers.items) add('object', i.id, i.selected, amend({ object: i.id }), i.name)
  return out
}

function prepareChoices(view: PrepareView, actorId: string): OpenChoice[] {
  const NO_MAIN = { weaponKey: '', attack: '', variant: '', ammoId: '', modifiers: { catch: false, martialSpirit: false, tackle: false }, key: '', quicken: false, extend: 0, movement: 'basic' }
  const out: OpenChoice[] = []
  const add = (part: ChoicePart, value: Json, chosen: boolean, command: SceneCommand, label: string) => out.push(choice(actorId, part, value, chosen, command, label))
  for (const c of view.commands) add('for', c.id, c.selected, amend({ forId: c.id, main: null, ...NO_MAIN, trigger: null }), `for ${c.name}`)
  for (const m of view.mains.filter((m) => m.available)) add('main', m.kind, m.selected, amend({ main: m.kind, ...NO_MAIN, trigger: null }), `prepare ${m.kind}`)
  for (const s of view.attacks) add('row', { weaponKey: s.weaponKey, attack: s.attack, variant: s.variant }, s.selected, amend({ weaponKey: s.weaponKey, attack: s.attack, variant: s.variant }), `${s.weapon} ${s.attack} ${s.variant}`.trim())
  out.push(...modifierChoices(actorId, view.modifiers, amend))
  for (const d of view.defenses) add('defense', { weaponKey: d.weaponKey, attack: d.attack }, d.selected, amend({ weaponKey: d.weaponKey, attack: d.attack }), `${d.weapon} ${d.attack}`)
  for (const a of view.ammo) add('ammo', a.itemId, false, amend({ ammoId: a.itemId }), a.name)
  for (const s of view.spells) {
    if (s.castable) add('spell', { key: s.key, quicken: false }, false, { kind: 'cast', args: [s.key, false] }, s.name)
    if (s.quickenable) add('spell', { key: s.key, quicken: true }, false, { kind: 'cast', args: [s.key, true] }, `${s.name}, quickened`)
  }
  for (const m of view.movements.filter((m) => m.available)) add('movement', m.kind, false, amend({ movement: m.kind }), m.kind)
  if (view.zone !== null) {
    for (const e of view.events) for (const w of view.who) {
      add('trigger', { event: e.event, who: w.id }, e.selected && w.selected, amend({ trigger: { event: e.event, who: w.id } }), `when ${e.label}, ${w.name}`)
    }
  }
  return out
}

// What an answerer still declares of the answer they chose: the strike an
// opportunity attack opens (what it is made as, its row, whom it is at, what
// it is loaded with, where it aims), and what any answer is declared as besides.
function answerChoices(r: ReactorOptions): OpenChoice[] {
  const out: OpenChoice[] = []
  const add = (part: ChoicePart, value: Json, chosen: boolean, fields: Record<string, unknown>, label: string) => out.push(choice(r.id, part, value, chosen, amendReaction(r.id, fields), label))
  const s = r.strike
  if (s) {
    if (s.modes.length > 1) for (const m of s.modes) add('opportunityMode', m.mode, m.mode === s.mode, m.press, m.mode)
    if (s.mode === 'grapple') for (const m of s.maneuvers) add('maneuver', m, m === s.maneuver, { maneuver: m }, m)
    if (s.mode !== 'grapple') {
      for (const o of s.options) add('row', { weaponKey: o.weaponKey, attack: o.attack, variant: o.variant }, o.attack === s.attack && o.variant === s.variant, { weaponKey: o.weaponKey, attack: o.attack, variant: o.variant }, `${o.weapon} ${o.attack} ${o.variant}`.trim())
      if (s.sweepDirection) for (const d of ['clockwise', 'counterclockwise'] as const) add('sweep', d, s.sweepDirection === d, { sweepDirection: d }, `sweep ${d}`)
      if (s.targets.length > 1) for (const t of s.targets) add('target', t.id, t.id === s.targetId, { targetId: t.id }, t.name)
      for (const a of s.ammo) add('ammo', a.itemId, a.itemId === s.ammoId, { ammoId: a.itemId }, a.name)
      for (const l of s.locations) add('location', { location: l.location, part: l.part }, l.selected, { location: l.location, part: l.part }, l.name)
    }
  }
  out.push(...modifierChoices(r.id, r.modifiers, (press) => amendReaction(r.id, press)))
  return out
}

// The cells a click picks: where a move or a steady shot's careful path goes,
// where a push takes its block, where an aimed action is pointed, which way a
// spray goes, and where an evasive jump lands. Who clicks is whose choice it is.
function cellChoices(state: SceneState): OpenChoice[] {
  const open = getOpenAction(state)
  if (!open || !state.board) return []
  const cells = (actorId: string, list: readonly Coord[], label: string): OpenChoice[] =>
    list.map((cell) => choice(actorId, 'cell', { q: cell.q, r: cell.r }, false, { kind: 'click', args: [{ on: 'cell', cell }, null, false, actorId] }, `${label} ${cell.q},${cell.r}`))
  const jumper = getEvasiveJumper(state)
  if (jumper) return cells(jumper, getEvasiveJumpPlacements(state, jumper, open.actorId).map((p) => p.cell), 'land at')
  if (open.kind === 'move' && open.step === 'define') return cells(open.actorId, getReachableCells(state, open).map((r) => r.cell), 'go to')
  if (open.kind === 'shoot' && open.step === 'define' && isSteadyShot(state, open)) return cells(open.actorId, getReachableCells(state, getSteadyPath(state, open)).map((r) => r.cell), 'walk to')
  if (open.kind === 'drag' && open.step === 'define') return cells(open.actorId, getDragReach(state, open).map((r) => r.cell), 'push to')
  const aim = getAim(state, open)
  if (aim) return cells(open.actorId, aim.cells, 'aim at')
  const blast = findOpenRoot(state, 'blast')
  const from = blast ? state.board.placements[blast.actorId] : undefined
  if (blast && blast.step === 'post' && from && isAimable(state, blast)) return cells(blast.actorId, ring(from.cell, 1), 'spray towards')
  return []
}

// Once the die is thrown: what the overflow buys, a grapple or a theft on the
// hit, a spell's improvements, a graze saved, what a won grapple maneuver does,
// the careful move a rest allows; and while the die waits, how a spell's
// target throws its test.
function afterRollChoices(state: SceneState, offers: ActionOffers): OpenChoice[] {
  const open = offers.open
  if (!open) return []
  const step = getNextStep(state)
  const out: OpenChoice[] = []
  const actor = open.actorId
  const add = (part: ChoicePart, value: Json, chosen: boolean, command: SceneCommand, label: string, by = actor) => out.push(choice(by, part, value, chosen, command, label))
  if (step === 'react' && open.testModes?.by === 'target' && open.targetId && open.testModes.modes.length > 1) {
    for (const mode of open.testModes.modes) add('testMode', mode, mode === open.mode, { kind: 'spellTestMode', args: [mode] }, `${open.testModes.test} ${mode}`, open.targetId)
  }
  if (step === 'spend') {
    for (const o of offers.hopOptions.filter((o) => o.available)) add('overflow', o.purchase, false, { kind: 'spend', args: [o.purchase] }, o.label)
    if (open.grapples !== null) out.push(...toggle(actor, 'grapple', open.grapples, { kind: 'grapple', args: [!open.grapples] }, 'grapple on the hit'))
    if (open.theft !== null) for (const take of [true, false]) add('theft', take, open.theft === take, { kind: 'theft', args: [take] }, take ? 'take it' : 'let it be')
    for (const o of offers.castHOP.options.filter((o) => o.available)) add('improve', o.name, false, { kind: 'improve', args: [o.name] }, o.name)
  }
  if (step === 'spend' || step === 'choose' || step === 'confirm') {
    if (offers.grazeSave) add('grazeSave', true, false, { kind: 'grazeSave', args: [] }, 'save the graze')
    if (open.along !== null) out.push(...toggle(actor, 'along', open.along, { kind: 'choose', args: [{ along: !open.along }] }, 'commit yourself along'))
    for (const { effect, limbs } of open.grappling?.effects ?? []) {
      for (const limb of limbs.length ? limbs.map((l) => l.id) : ['']) {
        const picked = open.grappling?.effect === effect && open.grappling.limb === limb
        add('grappling', { effect, limb }, picked, { kind: 'choose', args: [{ effect, limb }] }, limb ? `${effect}: ${limb}` : effect)
      }
    }
    for (const d of open.disarm) add('disarm', d.itemId, d.itemId === open.item, { kind: 'choose', args: [{ item: d.itemId }] }, d.name)
    if (offers.restMove) add('restMove', true, false, { kind: 'restMove', args: [] }, 'careful move')
  }
  return out
}
