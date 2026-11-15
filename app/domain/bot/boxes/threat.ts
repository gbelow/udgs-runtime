import type { Coord, MovementKind, SurgeKind } from '../../types'
import { getSurgeAPLeft, getSurgeRecovery } from '../../character/rules/surge'
import { getRecoveredSTA } from '../../character/rules/characteristics'
import type { ActionDraft, MoveAction, SceneState } from '../../scene/types'
import { toUpdater, type CommandContext, type SceneCommand } from '../../scene/commands/registry'
import { getOpenAction } from '../../scene/rules/log'
import { getHeavyDegree } from '../../scene/rules/heavy'
import { getHeavyName } from '../../character/rules/gear'
import { getAvailableActions, getUnfinishedAnswers } from '../../scene/rules/options'
import { getOpenChoices } from '../../scene/projections/choices'
import { getMovementOptions } from '../../scene/rules/move'
import { getReachableCells } from '../../scene/rules/board/reach'
import { distance, sameCell } from '../../scene/rules/board/geometry'
import { declare, type Intent, type Pick } from '../declare'
import { getApproachCost } from '../approach'
import { getSides } from '../table'
import { getPair, type PairAttack, type PairDefence } from '../pairs'
import { cellOf, getDanger, getDefendedHarm, getHarmAgainst, getMeans, getPotentialThreat, getSTAPrice, getThreatened, getThreatening, threatValue } from '../threat'
import { carryOn, endTurn, finding, settleWait, type Find, type Press } from './nearest'
import { REST_TUNING, type RestTuning } from '../rest'
import { getStressDue, getStressSocial, getStressTurn } from '../../scene/rules/stress'
import type { Box, Decision, SeatInput } from '../decision'

// Moves by potential threat and attacks by immediate threat (bot/threat.ts),
// every term weighed by a tweakable:
//
// - an attack, from where the character stands or from a cell it can walk to
//   this turn, is worth what it costs the target answering as it is believed
//   to (`getDefendedHarm`: the harm taken, the defence paid for, and more the
//   more the defence takes off), less the danger it leaves the character in
//   at the cell (weighing the cheapest cells that reach and the safest), how
//   threatened the target is by
//   the whole team, and how threatening it is to anyone in the team, less
//   what it costs (the walk and the attack, AP + STA) at a price that rises
//   with the danger the character is left in: the worst single foe's
//   immediate threat on it, at the cell, with the AP it has left to defend;
// - with no attack worth making, a walk is worth the potential harm the
//   character could do from the cell to the foe it threatens most, less the
//   worst single foe's potential threat on it there, and what it closes on
//   the foe the team threatens most, less the walk at the same price; it
//   walks when that beats standing by a margin;
// - a walk, to attack or not, costs the opportunity attacks it draws from the
//   foes whose reach it walks in on (bot/approach.ts);
// - an attack or a walk may be paid for after a combat or a movement surge;
//   AP is free while no foe can attack this round, and a surge's always;
// - attacked, it answers with the defence (or none) that leaves the least
//   harm and price together;
// - drawn an opportunity attack, it makes the one that scores best as an
//   attack on its turn would, if that is above nothing.
//
// The rest (morale, concentration, landing what it rolled, a surge it is held
// to) it plays as the nearest box does.

export type ThreatWeights = RestTuning & {
  harm: number
  threatened: number
  threatening: number
  // the price of an AP while some foe can still attack this round: `AP` plus
  // `danger` times the danger the character is left in; of an STA, `STA` as
  // `getSTAPrice` prices it
  AP: number
  STA: number
  danger: number
  // what an attack is worth less for the danger it leaves the character in, at the cell it is made from
  exposure: number
  // a walk's worth: the potential harm the character could do from the cell, the potential danger there
  offence: number
  peril: number
  // what a walk gains for every AP it closes on the foe the team threatens most
  aggression: number
  // what a walk must beat standing still by
  margin: number
}

export const THREAT_WEIGHTS: ThreatWeights = { ...REST_TUNING, harm: 1, threatened: 0.6, threatening: 0.2, AP: 1, STA: 1, danger: 0.1, exposure: 0.25, offence: 1, peril: 1, aggression: 2, margin: 1 }

const TRIAL: CommandContext = { thrower: () => 0, newId: () => 'trial' }
const trial = (state: SceneState, command: SceneCommand) => toUpdater(command, TRIAL)(state)
const argOf = (command: SceneCommand): unknown => (command.args as readonly unknown[])[0]

type Walk = { movement: MovementKind; cells: { cell: Coord; AP: number; STA: number }[] }

// The cells the character can walk to this turn at its fastest movement, with
// no surge, and what the walk costs.
function getWalk(state: SceneState, id: string): Walk | null {
  const c = state.characters[id]
  if (!c) return null
  const open = getMovementOptions(state, c).filter((o): o is typeof o & { kind: MovementKind } => o.available && o.speed > 0)
  const movement = open.reduce<(typeof open)[number] | null>((best, o) => (!best || o.speed > best.speed ? o : best), null)?.kind
  if (!movement) return null
  const moving = trial(trial(state, { kind: 'declare', args: [id, { kind: 'move' }] }), { kind: 'amend', args: [{ movement }] })
  const action = getOpenAction(moving)
  if (action?.kind !== 'move' || action.actorId !== id) return null
  return { movement, cells: getReachableCells(moving, action as MoveAction).map((r) => ({ cell: r.cell, AP: r.cost.AP, STA: r.cost.STA })) }
}

const moveIntent = (id: string, movement: MovementKind, cell: Coord): Intent => ({ actorId: id, option: { kind: 'move' }, picks: [{ part: 'movement', value: movement }, { part: 'cell', value: cell }] })

const attackIntent = (id: string, attack: PairAttack, target: string): Intent => ({
  actorId: id,
  option: { kind: attack.kind },
  picks: [
    { part: 'row', value: attack.row },
    // the degree as the strike's modifiers offer it (scene/rules/modifiers.ts)
    ...(attack.declaresHeavy ? [{ part: 'modifier' as const, value: { key: `heavy${attack.heavy}`, on: true } }] : []),
    ...(attack.ammoId ? [{ part: 'ammo' as const, value: attack.ammoId }] : []),
    { part: 'target', value: target },
  ],
})

const attackName = (attack: PairAttack) => `${attack.row.attack}${attack.heavy ? `, ${getHeavyName(attack.heavy)}` : ''}`

type Plan =
  | { kind: 'attack'; intent: Intent; score: number; why: string }
  | { kind: 'walk'; intent: Intent; score: number; why: string }
  | { kind: 'surge'; surge: SurgeKind; score: number; why: string }

// The ways the turn may be paid for: with no surge, or after the combat or the
// movement surge (combat.tex "Action surge"), tried on the fight as a person
// presses it. A surge's AP is lost when the turn ends, so it costs nothing;
// what the surge costs is its STA and the STA the recovery surge would have
// given back. The focus surge is made only for a shot that needs it.
type Budget = {
  surge: SurgeKind | null
  view: SceneState
  // AP and STA the character holds, a surge's included
  AP: number
  STA: number
  // the surge's AP, and whether it pays only for movement
  surgeAP: number
  movementOnly: boolean
  // the STA the surge takes, and what the recovery surge it gives up would have given back
  surgeSTA: number
}

function getBudgets(view: SceneState, id: string): Budget[] {
  const me = view.characters[id]
  // a surge made already: its AP still held is paid as the surge's, at no STA more
  const none: Budget = { surge: null, view, AP: me.resources.AP, STA: me.resources.STA, surgeAP: getSurgeAPLeft(me), movementOnly: me.usedSurge === 'movement', surgeSTA: 0 }
  if (me.usedSurge !== null) return [none]
  const recovered = getRecoveredSTA(me, me.resources.STA, getSurgeRecovery('recovery')(me)) - me.resources.STA
  const surged = (['combat', 'movement'] as const).flatMap((kind): Budget[] => {
    const after = trial(view, { kind: 'surge', args: [id, kind] })
    const made = after.characters[id]
    if (after === view || !made || made.usedSurge !== kind) return []
    return [{ surge: kind, view: after, AP: made.resources.AP, STA: made.resources.STA, surgeAP: getSurgeAPLeft(made), movementOnly: kind === 'movement', surgeSTA: me.resources.STA - made.resources.STA + recovered }]
  })
  return [none, ...surged]
}

// What a walk of `move` AP and an attack of `attack` AP come to on the round's
// own AP, the surge's paying first for what it may; null when they cannot be
// paid for.
function roundAPSpent(b: Budget, move: number, attack: number): number | null {
  if (move + attack > b.AP) return null
  if (!b.movementOnly) return Math.max(0, move + attack - b.surgeAP)
  const fromRound = Math.max(0, move - b.surgeAP) + attack
  return fromRound <= b.AP - b.surgeAP ? fromRound : null
}

// The walks worth weighing (the user's ruling): towards each foe, the cells
// that come nearest it; away from the foe whose threat is worst, the cells
// that get furthest from it. `TOWARDS` and `AWAY` of each.
const TOWARDS = 3
const AWAY = 3

type WalkCell = Walk['cells'][number]

function getDirectedCells(view: SceneState, here: Coord, walk: Walk, foes: readonly string[], worst: string | null): WalkCell[] {
  const picked = new Map<string, WalkCell>()
  const add = (cells: WalkCell[]) => cells.forEach((c) => picked.set(`${c.cell.q},${c.cell.r}`, c))
  const cheaper = (a: WalkCell, b: WalkCell) => a.AP + a.STA - (b.AP + b.STA)
  for (const foe of foes) {
    const at = cellOf(view, foe)
    if (!at) continue
    const now = distance(here, at)
    add(walk.cells.filter((c) => distance(c.cell, at) < now).sort((a, b) => distance(a.cell, at) - distance(b.cell, at) || cheaper(a, b)).slice(0, TOWARDS))
  }
  const from = worst ? cellOf(view, worst) : null
  if (from) {
    const now = distance(here, from)
    add(walk.cells.filter((c) => distance(c.cell, from) > now).sort((a, b) => distance(b.cell, from) - distance(a.cell, from) || cheaper(a, b)).slice(0, AWAY))
  }
  return [...picked.values()]
}

// Where an attack with `reach` on a target standing at `at` may be made from:
// where the character stands, if it reaches from there, and of the cells of
// the walk that reach, the cheapest `ATTACK_CELLS` and the `ATTACK_CELLS`
// where the danger on the character is least (`dangerAt`).
const ATTACK_CELLS = 2

function getAttackCells(here: Coord | null, walk: Walk | null, at: Coord | null, reach: number, dangerAt: (cell: Coord) => number): { cell: Coord | null; AP: number; STA: number }[] {
  const stay = !here || !at || distance(here, at) <= reach ? [{ cell: here, AP: 0, STA: 0 }] : []
  if (!walk || !at) return stay
  const reaching = walk.cells.filter((c) => (!here || !sameCell(c.cell, here)) && distance(c.cell, at) <= reach)
  const cheapest = [...reaching].sort((a, b) => a.AP + a.STA - (b.AP + b.STA)).slice(0, ATTACK_CELLS)
  const safest = reaching.map((c) => ({ c, danger: dangerAt(c.cell) })).sort((a, b) => a.danger - b.danger).slice(0, ATTACK_CELLS).map(({ c }) => c)
  return [...stay, ...new Set([...cheapest, ...safest])]
}

// The measures every attack the character could make in `view` is weighed
// by, on its turn or as an opportunity attack: what it is worth (`w.harm`
// times its worth against the defence, and what the target is to the team),
// less the AP and STA it spends and the danger it leaves the character in at
// `at`.
type AttackMeasures = {
  // the worst foe's threat this round on the character at `at`, with what it
  // has left to defend
  dangerLeft: (AP: number, STA: number, at: Coord | null) => number
  // AP is priced only while some foe can still attack this round, at a price
  // rising with the danger left; STA always, dearer the less is left
  price: (AP: number, STA: number, at: Coord | null) => number
  score: (worth: number, foe: string, AP: number, STA: number, at: Coord | null) => number
}

function getAttackMeasures(view: SceneState, members: readonly string[], id: string, w: ThreatWeights): AttackMeasures {
  const me = view.characters[id]
  const left = { AP: me.resources.AP, STA: me.resources.STA }
  const dangerLeft = (AP: number, STA: number, at: Coord | null) => getDanger(view, members, id, 'immediate', at, { AP: left.AP - AP, STA: left.STA - STA }, w)
  const price = (AP: number, STA: number, at: Coord | null) => {
    const exposed = AP > 0 && getDanger(view, members, id, 'immediate', at, { AP: 0, STA: 0 }, w) > 0
    const perAP = exposed ? w.AP + w.danger * dangerLeft(AP, STA, at) : 0
    return AP * perAP + getSTAPrice(STA, left.STA, me.injuries.bleed, w.STA, w)
  }
  // how threatened the target is by the whole team, and how threatening to anyone in it
  const worths = new Map<string, number>()
  const targetWorth = (foe: string) => {
    let worth = worths.get(foe)
    if (worth === undefined) worths.set(foe, (worth = w.threatened * getThreatened(view, members, foe, w) + w.threatening * getThreatening(view, members, foe, w)))
    return worth
  }
  const score = (worth: number, foe: string, AP: number, STA: number, at: Coord | null) => w.harm * worth + targetWorth(foe) - price(AP, STA, at) - w.exposure * dangerLeft(AP, STA, at)
  return { dangerLeft, price, score }
}

// What the character would do with the turn it holds in `view`, or null to end it.
function planTurn(view: SceneState, members: readonly string[], id: string, w: ThreatWeights, compelled = false): Plan | null {
  const me = view.characters[id]
  const here = cellOf(view, id)
  if (!me) return null
  const { foes } = getSides(view, members)
  if (foes.length === 0) return null
  const left = { AP: me.resources.AP, STA: me.resources.STA }
  const { dangerLeft, price, score: attackScore } = getAttackMeasures(view, members, id, w)
  // what walking from where the character stands to `to` costs it in the
  // opportunity attacks of the foes whose reach it walks in on (bot/approach.ts)
  const drawn = (to: Coord | null, AP: number, STA: number) => (here && to && !sameCell(here, to) ? w.opportunity * getApproachCost(view, id, here, to, foes, (f) => getMeans(view.characters[f], false, w), { AP: Math.max(0, left.AP - AP), STA: left.STA - STA }, w) : 0)
  const budgets = getBudgets(view, id)

  let best: Plan | null = null
  for (const b of budgets) {
    const walk = getWalk(b.view, id)
    for (const foe of foes) {
      const target = view.characters[foe]
      const at = cellOf(view, foe)
      if (!target) continue
      const guard = getMeans(target, false, w)
      for (const attack of getPair(me, target)) {
        if (!attack.opens.action) continue
        for (const { cell, AP, STA } of getAttackCells(here, walk, at, attack.reach, (c) => dangerLeft(0, 0, c))) {
          const gap = cell && at ? distance(cell, at) : 0
          const needsFocus = attack.needsFocus && me.usedSurge !== 'focus'
          if (needsFocus && (me.usedSurge !== null || b.surge !== null)) continue
          const spent = roundAPSpent(b, AP, attack.cost.AP)
          const STAspent = STA + attack.cost.STA
          if (spent === null || STAspent > b.STA) continue
          const met = getDefendedHarm(attack, gap, guard, 'now', target.injuries.bleed, w)
          if (!met || met.undefended <= 0) continue
          const score = attackScore(met.worth, foe, spent, STAspent + b.surgeSTA, cell) - drawn(cell, AP, STA)
          if (best && score <= best.score) continue
          const why = `${attack.kind}s ${target.name} (${attackName(attack)}, worth ${met.worth.toFixed(1)}: harm ${met.harm.toFixed(1)} against ${met.defence.draft?.kind ?? 'no defence'}, score ${score.toFixed(1)})`
          if (needsFocus) best = { kind: 'surge', surge: 'focus', score, why: `focuses to shoot: ${why}` }
          else if (b.surge) best = { kind: 'surge', surge: b.surge, score, why: `makes the ${b.surge} surge: ${why}` }
          else if (!here || !cell || sameCell(cell, here)) best = { kind: 'attack', intent: attackIntent(id, attack, foe), score, why }
          else if (walk) best = { kind: 'walk', intent: moveIntent(id, walk.movement, cell), score, why: `walks to attack: ${why}` }
        }
      }
    }
  }
  if (best && (best.score > 0 || compelled) && (best.kind === 'surge' || declare(view, best.intent, TRIAL).ok)) return best

  // no attack worth making: a walk, by where the character threatens more and
  // is threatened less, and how far it closes on the foe the team threatens most
  if (!here) return null
  const quarry = foes.reduce<{ id: string; worth: number } | null>((q, f) => {
    const worth = getThreatened(view, members, f, w)
    return !q || worth > q.worth ? { id: f, worth } : q
  }, null)?.id
  const closing = (cell: Coord): number => (quarry ? getPotentialThreat(view, members, id, quarry, cellOf(view, quarry), cell, w)?.moveAP ?? Infinity : Infinity)
  const standing = (cell: Coord): number => {
    const offence = foes.reduce((most, foe) => Math.max(most, threatValue(getPotentialThreat(view, members, id, foe, cellOf(view, foe), cell, w), w)), 0)
    return w.offence * offence - w.peril * getDanger(view, members, id, 'potential', cell, undefined, w)
  }
  const fromHere = closing(here)
  const stay = standing(here)
  let move: { cell: Coord; score: number; budget: Budget; movement: MovementKind } | null = null
  const worst = foes.reduce<{ id: string; danger: number } | null>((q, f) => {
    const danger = threatValue(getPotentialThreat(view, members, f, id, here, cellOf(view, f), w), w)
    return !q || danger > q.danger ? { id: f, danger } : q
  }, null)
  for (const b of budgets) {
    const walk = getWalk(b.view, id)
    if (!walk) continue
    for (const { cell, AP, STA } of getDirectedCells(view, here, walk, foes, worst && worst.danger > 0 ? worst.id : null)) {
      if (sameCell(cell, here)) continue
      const spent = roundAPSpent(b, AP, 0)
      if (spent === null) continue
      const closer = Number.isFinite(fromHere) ? fromHere - Math.min(fromHere, closing(cell)) : 0
      const score = standing(cell) + w.aggression * closer - price(spent, STA + b.surgeSTA, cell) - drawn(cell, AP, STA)
      if (!move || score > move.score) move = { cell, score, budget: b, movement: walk.movement }
    }
  }
  if (!move || move.score <= stay + w.margin) return null
  const why = `walks where it threatens more, is threatened less and closes in (${move.score.toFixed(1)} over ${stay.toFixed(1)})`
  if (move.budget.surge) return { kind: 'surge', surge: move.budget.surge, score: move.score, why: `makes the ${move.budget.surge} surge: ${why}` }
  const intent = moveIntent(id, move.movement, move.cell)
  return declare(view, intent, TRIAL).ok ? { kind: 'walk', intent, score: move.score, why } : null
}

// The answer to an attack on `id`: the defence offered that leaves the least
// harm and price together, or none.
function answer(input: SeatInput, id: string, w: ThreatWeights, find: Find, press: Press): Decision | null {
  const view = input.view()
  const open = getOpenAction(view)
  const me = view.characters[id]
  if (!open || !me) return press(find('pass', id), 'lets it come')
  if (open.targetId !== id || (open.kind !== 'strike' && open.kind !== 'shoot')) return opportunity(input, id, w) ?? press(find('pass', id), 'lets it come')
  const attacker = view.characters[open.actorId]
  const attack = attacker ? getPair(attacker, me).find((a) => a.kind === open.kind && a.row.weaponKey === open.weaponKey && a.row.attack === open.attack && a.row.variant === open.variant && (open.kind !== 'shoot' || a.ammoId === '' || a.ammoId === open.ammoId) && (open.kind !== 'strike' || a.heavy === getHeavyDegree(attacker, open))) : undefined
  if (!attack) return press(find('pass', id), 'lets it come: does not know the attack')
  const from = cellOf(view, open.actorId)
  const at = cellOf(view, id)
  const gap = from && at ? distance(from, at) : 0
  const means = getMeans(me, true, w)
  const offered = getAvailableActions(view, id).filter((o) => o.available && o.reactionTo === open.id)
  const worth = (d: PairDefence) => getHarmAgainst(attack, d, gap)
  const none = attack.defences.find((d) => d.draft === null)
  let best: { draft: ActionDraft | null; score: number } = { draft: null, score: none ? worth(none) : 0 }
  for (const o of offered) {
    const d = attack.defences.find((x) => x.draft && sameDraft(x.draft, o.draft))
    if (!d) continue
    const priced = d.cost.AP * (w.AP + w.danger * getDanger(view, input.members, id, 'immediate', at, { AP: means.AP - d.cost.AP, STA: means.STA - d.cost.STA }, w)) + getSTAPrice(d.cost.STA, means.STA, me.injuries.bleed, w.STA, w)
    const score = worth(d) + priced
    if (score < best.score) best = { draft: o.draft, score }
  }
  if (best.draft === null) return press(find('pass', id), `lets it come (harm ${best.score.toFixed(1)})`)
  const picks = fillAnswer(view, input.members, id, best.draft, { AP: means.AP, STA: means.STA })
  if (!picks) return press(find('pass', id), `lets it come: ${best.draft.kind} cannot be finished`)
  return { kind: 'declare', intent: { actorId: id, option: best.draft, picks }, why: `answers with ${best.draft.kind} (harm and price ${best.score.toFixed(1)})` }
}

// An opportunity attack on whoever drew it (combat.tex "Opportunity
// Attack"), weighed as an attack on the character's turn is
// (`getAttackMeasures`): of the rows the draw opens (a braced attack on a step
// towards the weapon, a hook attack on a runner moving away), at each heavy
// degree, the one that scores best, made only where it scores above nothing.
function opportunity(input: SeatInput, id: string, w: ThreatWeights): Decision | null {
  const view = input.view()
  const open = getOpenAction(view)
  const me = view.characters[id]
  if (!open || !me) return null
  const at = cellOf(view, id)
  const measures = getAttackMeasures(view, input.members, id, w)
  const offers = getAvailableActions(view, id).filter((o) => o.available && o.reactionTo === open.id && o.draft.kind === 'opportunityAttack')
  let best: { draft: ActionDraft; picks: Pick[]; score: number; why: string } | null = null
  for (const o of offers) {
    // declared on a copy, as pressed, for the rows the draw opens
    const declared = trial(view, { kind: 'react', args: [id, o.draft] })
    const drawn = getUnfinishedAnswers(declared, open).find((r) => r.actorId === id)
    const target = drawn?.targetId ? view.characters[drawn.targetId] : undefined
    if (!drawn || !target) continue
    const rows = getOpenChoices(declared).filter((c) => c.actorId === id && c.part === 'row').map((c) => c.value as PairAttack['row'])
    const guard = getMeans(target, false, w)
    for (const attack of getPair(me, target)) {
      if (attack.kind !== 'strike' || !rows.some((r) => r.weaponKey === attack.row.weaponKey && r.attack === attack.row.attack && r.variant === attack.row.variant)) continue
      const { AP, STA } = attack.cost
      if (AP > me.resources.AP || STA > me.resources.STA) continue
      const met = getDefendedHarm(attack, attack.reach, guard, 'now', target.injuries.bleed, w)
      if (!met || met.undefended <= 0) continue
      const score = measures.score(met.worth, target.id, AP, STA, at)
      if (score <= 0 || (best && score <= best.score)) continue
      const picks: Pick[] = [{ part: 'row', value: attack.row }, ...(attack.declaresHeavy ? [{ part: 'modifier' as const, value: { key: `heavy${attack.heavy}`, on: true } }] : [])]
      best = { draft: o.draft, picks, score, why: `opportunity attack on ${target.name} (${attackName(attack)}, worth ${met.worth.toFixed(1)} against ${met.defence.draft?.kind ?? 'no defence'}, score ${score.toFixed(1)})` }
    }
  }
  if (!best) return null
  const picks = fillAnswer(view, input.members, id, best.draft, { AP: me.resources.AP, STA: me.resources.STA }, best.picks)
  return picks ? { kind: 'declare', intent: { actorId: id, option: best.draft, picks }, why: best.why } : null
}

// What the answer still asks for once declared (where an evasive jump lands),
// picked: a cell where the danger on the character is least, anything else as
// first offered, after the `start` picks. Null when it asks for something
// nothing offers.
function fillAnswer(view: SceneState, members: readonly string[], id: string, draft: ActionDraft, guard: { AP: number; STA: number }, start: readonly Pick[] = []): Pick[] | null {
  const open = getOpenAction(view)
  if (!open) return null
  const picks: Pick[] = [...start]
  for (let i = 0; i < 4 + start.length; i++) {
    const made = declare(view, { actorId: id, option: draft, picks }, TRIAL)
    if (!made.ok) return null
    if (!getUnfinishedAnswers(made.ready, open).some((r) => r.actorId === id)) return picks
    const fills = getOpenChoices(made.ready).filter((c) => c.actorId === id && !c.chosen)
    const cells = fills.filter((c) => c.part === 'cell')
    const pick = cells.length
      ? cells.reduce((b, c) => (getDanger(view, members, id, 'immediate', c.value as Coord, guard) < getDanger(view, members, id, 'immediate', b.value as Coord, guard) ? c : b))
      : fills[0]
    if (!pick) return null
    picks.push({ part: pick.part, value: pick.value })
  }
  return null
}

function sameDraft(a: ActionDraft, b: ActionDraft): boolean {
  const ka = Object.keys(a).sort()
  const kb = Object.keys(b).sort()
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && JSON.stringify((a as Record<string, unknown>)[k]) === JSON.stringify((b as Record<string, unknown>)[k]))
}

// The limit stress action the character's turn is owed for (the user's
// ruling, 2026-11-15): a violent character makes its combat surge and
// attacks, whatever the attack is worth; a coward makes its movement surge and
// runs, as far as the surge carries it; every other one defaults to coward.
// Where only a rest makes the surge payable, it rests first (rules/stress.ts
// `getStressDue`). Tanatosis takes no turn. 'none' when the turn is no limit
// stress action.
function takeStressTurn(input: SeatInput, id: string, w: ThreatWeights, find: Find, press: Press): Decision | null | 'none' {
  const view = input.view()
  const turn = getStressTurn(view)
  const me = view.characters[id]
  if (!turn || turn.id !== id || !me) return 'none'
  if (getStressSocial(view, id)) return press(find('defaultToCoward', id), `will not ${turn.action === 'abusive' ? 'insult' : 'negotiate'}: defaults to coward`)
  const due = getStressDue(view)
  if (due?.kind === 'surge') {
    if (due.restFirst) {
      const rest = getAvailableActions(view, id).find((o) => o.available && o.draft.kind === 'rest')
      return rest ? { kind: 'declare', intent: { actorId: id, option: rest.draft, picks: [] }, why: `rests to make the ${due.surge} surge it owes` } : null
    }
    const surge = input.buttons.find((b) => b.command.kind === 'surge' && argOf(b.command) === id && b.command.args[1] === due.surge)
    return press(surge, `makes the ${due.surge} surge its limit stress action owes`)
  }
  if (turn.action === 'violent') {
    const plan = planTurn(view, input.members, id, w, true)
    if (plan?.kind === 'attack' || plan?.kind === 'walk') return { kind: 'declare', intent: plan.intent, why: `violent: ${plan.why}` }
  }
  if (turn.action === 'coward' && getSurgeAPLeft(me) > 0) {
    const run = getAway(view, input.members, id)
    if (run) return { ...run, why: `coward: ${run.why}` }
  }
  return endTurn(input, id, find, press)
}

function takeTurn(input: SeatInput, id: string, w: ThreatWeights, find: Find, press: Press): Decision | null {
  const stress = takeStressTurn(input, id, w, find, press)
  if (stress !== 'none') return stress
  const plan = planTurn(input.view(), input.members, id, w)
  if (plan?.kind === 'attack' || plan?.kind === 'walk') return { kind: 'declare', intent: plan.intent, why: plan.why }
  if (plan?.kind === 'surge') {
    const surge = input.buttons.find((b) => b.command.kind === 'surge' && argOf(b.command) === id && b.command.args[1] === plan.surge)
    const made = press(surge, plan.why)
    if (made) return made
  }
  return endTurn(input, id, find, press) ?? getAway(input.view(), input.members, id)
}

// A walk the turn cannot end without (a coward's run): to the cell where the
// worst foe's potential threat is least.
function getAway(view: SceneState, members: readonly string[], id: string): Decision | null {
  const walk = getWalk(view, id)
  if (!walk) return null
  const safest = walk.cells
    .map((c) => ({ cell: c.cell, danger: getDanger(view, members, id, 'potential', c.cell) }))
    .sort((a, b) => a.danger - b.danger)
    .find((c) => declare(view, moveIntent(id, walk.movement, c.cell), TRIAL).ok)
  return safest ? { kind: 'declare', intent: moveIntent(id, walk.movement, safest.cell), why: `gets away (danger ${safest.danger.toFixed(1)})` } : null
}

export function threatBox(w: ThreatWeights = THREAT_WEIGHTS): Box {
  return (input) => {
    const { members, waits, buttons } = input
    const { find, press } = finding(buttons)
    for (const wait of waits) {
      const made = wait.for === 'answer' ? answer(input, wait.id, w, find, press)
        : wait.for === 'turn' ? takeTurn(input, wait.id, w, find, press)
        : settleWait(input, wait, find, press, w)
      if (made) return made
    }
    const view = input.view()
    for (const id of members) {
      const start = find('startTurn', id)
      if (start && planTurn(trial(view, start.command), members, id, w)) return { kind: 'press', pick: start, why: 'has something worth doing' }
    }
    return carryOn(input, find)
  }
}

