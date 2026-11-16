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
import { isClearWalk } from '../reach'
import { distance, extentCells, sameCell } from '../../scene/rules/board/geometry'
import { firesAcross, getEyes, getEyesToward, seesAcross } from '../../scene/rules/board/board'
import { declare, type Intent, type Pick } from '../declare'
import { getApproachCost, getStandingCost } from '../approach'
import { getSides } from '../table'
import { getPair, type PairAttack, type PairDefence } from '../pairs'
import { withSheet, cellOf, getTargetDanger, getDanger, getDefendedHarm, getHarmAgainst, getMeans, getPotentialThreat, getSpendPrice, getThreatened, getThreatening, threatValue } from '../threat'
import { carryOn, endTurn, finding, settleWait, type Find, type Press } from './nearest'
import { REST_TUNING, type RestTuning } from '../rest'
import { getStressDue, getStressSocial, getStressTurn } from '../../scene/rules/stress'
import type { Box, Decision, SeatInput } from '../decision'
import { getSwitches } from '../arms'
import { getPayBar } from '../../item/rules/moves'
import { ROUND_AP } from '../../tables'

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
//   worst single foe's potential threat on it there, and the AP of the walk
//   in it saves on the foe it most gains on, each worth a baseline for any
//   enemy and more the more that foe threatens the team (the user's ruling:
//   a harmless foe is still gone after, and so is one it cannot yet hurt),
//   less the walk at the same price and the worst single foe's immediate
//   threat on it at the cell, with what it has left to defend once it has
//   walked there; it walks when that beats standing by a margin;
// - with no foe in sight, it searches (`planSearch`): it walks where it would
//   see most of what its side does not, drawn towards the board's middle;
// - a walk, to attack or not, costs the opportunity attacks it draws from the
//   foes it closes on within their reach, read step by step along the cells
//   it is walked through, and a shot those of the foes whose melee weapons
//   reach where it is fired from (bot/approach.ts);
// - at the turn's start, it changes arms (bot/arms.ts) where that raises the
//   most it threatens any foe and lowers the most any foe threatens it by more
//   than the switch costs, with the opportunity attacks its priced moves draw;
// - an attack or a walk may be paid for after a combat or a movement surge;
//   every AP spent is priced, a surge's included (the user's ruling);
// - attacked, it answers with the defence (or none) that leaves the least
//   harm and price together, after the opportunity attack a shot at it draws
//   where that is worth making;
// - drawn an opportunity attack, it makes the one that scores best as an
//   attack on its turn would, if that is above nothing.
//
// The rest (morale, concentration, landing what it rolled, a surge it is held
// to) it plays as the nearest box does.

export type ThreatWeights = RestTuning & {
  harm: number
  threatened: number
  threatening: number
  // what an attack is worth less for the danger it leaves the character in, at the cell it is made from
  exposure: number
  // a walk's worth: the potential harm the character could do from the cell, the potential danger there
  offence: number
  peril: number
  // what a walk gains for every AP of the walk in it saves on a foe: for any
  // enemy, and for every point of the foe's threat on the team, a round's AP over
  aggression: number
  chase: number
  // what a walk is worth less for the danger it leaves the character in this
  // round at the cell it walks to, with what it has left to defend
  arrival: number
  // what a walk gains, with no foe in sight, for every cell of the board it
  // shows that nobody of the side sees
  search: number
  // what a walk must beat standing still by
  margin: number
}

export const THREAT_WEIGHTS: ThreatWeights = { ...REST_TUNING, harm: 1, threatened: 0.6, threatening: 0.2, exposure: 0.6, offence: 1, peril: 1, aggression: 4, chase: 1, arrival: 1, search: 1, margin: 1 }

const TRIAL: CommandContext = { thrower: () => 0, newId: () => 'trial' }
const trial = (state: SceneState, command: SceneCommand) => toUpdater(command, TRIAL)(state)
const argOf = (command: SceneCommand): unknown => (command.args as readonly unknown[])[0]

type Walk = { movement: MovementKind; cells: { cell: Coord; AP: number; STA: number; path: Coord[] }[] }

// The cells the character can walk to this turn at its fastest movement, with
// no surge, through nobody standing (`isClearWalk`), what the walk costs, and
// the cells it is walked through.
function getWalk(state: SceneState, id: string): Walk | null {
  const c = state.characters[id]
  if (!c) return null
  const open = getMovementOptions(state, c).filter((o): o is typeof o & { kind: MovementKind } => o.available && o.speed > 0)
  const movement = open.reduce<(typeof open)[number] | null>((best, o) => (!best || o.speed > best.speed ? o : best), null)?.kind
  if (!movement) return null
  const moving = trial(trial(state, { kind: 'declare', args: [id, { kind: 'move' }] }), { kind: 'amend', args: [{ movement }] })
  const action = getOpenAction(moving)
  if (action?.kind !== 'move' || action.actorId !== id) return null
  return { movement, cells: getReachableCells(moving, action as MoveAction).filter((r) => isClearWalk(moving, action as MoveAction, r.path)).map((r) => ({ cell: r.cell, AP: r.cost.AP, STA: r.cost.STA, path: r.path })) }
}

// whether the walk runs or jumps, which a braced attack answers (combat.tex "Braced Attack")
const runs = (walk: Walk | null): boolean => walk?.movement === 'run' || walk?.movement === 'jump'

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
// presses it. What the surge costs besides the AP spent from it is its STA and
// the STA the recovery surge would have given back. The focus surge is made
// only for a shot that needs it.
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

// Whether a walk of `move` AP and an attack of `attack` AP can be paid for,
// the surge's AP paying first for what it may.
function canPay(b: Budget, move: number, attack: number): boolean {
  if (move + attack > b.AP) return false
  if (!b.movementOnly) return true
  return Math.max(0, move - b.surgeAP) + attack <= b.AP - b.surgeAP
}

// The walks worth weighing (the user's ruling): towards each foe, the cells
// that come nearest it, and for every block of the walk the cell of that
// block that comes nearest it, so that a walk may stop short; away from the
// foe whose threat is worst, the cells that get furthest from it. `TOWARDS`
// and `AWAY` of each.
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
    const closing = walk.cells.filter((c) => distance(c.cell, at) < now).sort((a, b) => distance(a.cell, at) - distance(b.cell, at) || cheaper(a, b))
    add(closing.slice(0, TOWARDS))
    const byBlock = new Map<number, WalkCell>()
    closing.forEach((c) => byBlock.has(c.AP) || byBlock.set(c.AP, c))
    add([...byBlock.values()])
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
// where the danger on the character is least (`dangerAt`); of those, only
// the ones `clear` keeps (a shot's: a line of fire to the target).
const ATTACK_CELLS = 2

function getAttackCells(here: Coord | null, walk: Walk | null, at: Coord | null, reach: number, dangerAt: (cell: Coord) => number, clear: (cell: Coord) => boolean = () => true): { cell: Coord | null; AP: number; STA: number; path: Coord[] }[] {
  const stay = !here || !at || (distance(here, at) <= reach && clear(here)) ? [{ cell: here, AP: 0, STA: 0, path: [] }] : []
  if (!walk || !at) return stay
  const reaching = walk.cells.filter((c) => (!here || !sameCell(c.cell, here)) && distance(c.cell, at) <= reach && clear(c.cell))
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
  // every AP spent at `AP` plus `danger` times the danger left (the user's
  // ruling: any AP spent costs, more the more threatened the character is);
  // STA dearer the less is left
  price: (AP: number, STA: number, at: Coord | null) => number
  score: (worth: number, foe: string, AP: number, STA: number, at: Coord | null) => number
}

function getAttackMeasures(view: SceneState, members: readonly string[], id: string, w: ThreatWeights): AttackMeasures {
  const me = view.characters[id]
  const left = { AP: me.resources.AP, STA: me.resources.STA }
  const dangerLeft = (AP: number, STA: number, at: Coord | null) => getDanger(view, members, id, 'immediate', at, { AP: Math.max(0, left.AP - AP), STA: Math.max(0, left.STA - STA) }, w)
  const price = (AP: number, STA: number, at: Coord | null) => {
    return getSpendPrice({ AP, STA }, left.STA, me.injuries.bleed, AP > 0 ? dangerLeft(AP, STA, at) : 0, w)
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

// With no foe in sight, the search widens (the user's ruling): a walk to where
// the character sees the most of the board its side sees none of now, and the
// nearer the board's middle the better, `search` for every such cell and
// `aggression` for every cell nearer the middle, less the walk at its price.
// The cells weighed are `SEARCH_CELLS` of the walk's, spread from the
// furthest in, and the board is read at most `SEARCH_SPREAD` cells of it.
const SEARCH_CELLS = 12
const SEARCH_SPREAD = 240

function planSearch(view: SceneState, members: readonly string[], id: string, w: ThreatWeights): Plan | null {
  const board = view.board
  const me = view.characters[id]
  const here = cellOf(view, id)
  if (!board || !me || !here) return null
  const eyes = getEyesToward(view, id, 0)
  const sees = (from: Coord, cell: Coord) => seesAcross(board, [from], [cell], eyes)
  const team = members.flatMap((m) => cellOf(view, m) ?? [])
  const dark = extentCells(board.origin, board.extent).filter((c) => !team.some((t) => sees(t, c)))
  if (dark.length === 0) return null
  const every = Math.ceil(dark.length / SEARCH_SPREAD)
  const read = dark.filter((_, i) => i % every === 0)
  let best: { cell: Coord; score: number; found: number; budget: Budget; movement: MovementKind } | null = null
  for (const b of getBudgets(view, id)) {
    const walk = getWalk(b.view, id)
    if (!walk) continue
    const far = walk.cells.filter((c) => !sameCell(c.cell, here)).sort((x, y) => distance(y.cell, here) - distance(x.cell, here))
    const step = Math.max(1, Math.floor(far.length / SEARCH_CELLS))
    for (let i = 0; i < far.length; i += step) {
      const { cell, AP, STA } = far[i]
      if (!canPay(b, AP, 0)) continue
      const found = read.filter((c) => sees(cell, c)).length * every
      const score = w.search * found + w.aggression * (distance(here, board.origin) - distance(cell, board.origin)) - getSpendPrice({ AP, STA: STA + b.surgeSTA }, me.resources.STA, me.injuries.bleed, 0, w)
      if (!best || score > best.score) best = { cell, score, found, budget: b, movement: walk.movement }
    }
  }
  if (!best || best.score <= w.margin) return null
  const why = `searches: walks where it sees about ${best.found} cells nobody of its side sees (${best.score.toFixed(1)})`
  if (best.budget.surge) return { kind: 'surge', surge: best.budget.surge, score: best.score, why: `makes the ${best.budget.surge} surge: ${why}` }
  const intent = moveIntent(id, best.movement, best.cell)
  return declare(view, intent, TRIAL).ok ? { kind: 'walk', intent, score: best.score, why } : null
}

// What the character would do with the turn it holds in `view`, or null to end it.
function planTurn(view: SceneState, members: readonly string[], id: string, w: ThreatWeights, compelled = false): Plan | null {
  const me = view.characters[id]
  const here = cellOf(view, id)
  if (!me) return null
  const { foes } = getSides(view, members)
  if (foes.length === 0) return planSearch(view, members, id, w)
  const left = { AP: me.resources.AP, STA: me.resources.STA }
  const { dangerLeft, price, score: attackScore } = getAttackMeasures(view, members, id, w)
  // what walking from where the character stands to `to` costs it in the
  // opportunity attacks of the foes whose reach it walks in on (bot/approach.ts)
  const drawn = (to: Coord | null, AP: number, STA: number, running: boolean, path: readonly Coord[]) => (here && to && !sameCell(here, to) ? w.opportunity * getApproachCost(view, id, here, to, running, foes, (f) => getMeans(view.characters[f], false, w), { AP: Math.max(0, left.AP - AP), STA: left.STA - STA }, w, path) : 0)
  // what a shot fired from `at` costs it in the opportunity attacks of the
  // foes whose melee weapons reach there (bot/approach.ts)
  const fired = (at: Coord | null, AP: number, STA: number) => w.opportunity * getStandingCost(view, id, at ?? here, foes, (f) => getMeans(view.characters[f], false, w), { AP: Math.max(0, left.AP - AP), STA: left.STA - STA }, w)
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
        const board = view.board
        const clear = attack.kind === 'shoot' && board && at ? (c: Coord) => firesAcross(board, [c], [at], getEyes(view, id, foe)) : undefined
        for (const { cell, AP, STA, path } of getAttackCells(here, walk, at, attack.reach, (c) => dangerLeft(0, 0, c), clear)) {
          const gap = cell && at ? distance(cell, at) : 0
          const needsFocus = attack.needsFocus && me.usedSurge !== 'focus'
          if (needsFocus && (me.usedSurge !== null || b.surge !== null)) continue
          const spent = AP + attack.cost.AP
          const STAspent = STA + attack.cost.STA
          if (!canPay(b, AP, attack.cost.AP) || STAspent > b.STA) continue
          const met = getDefendedHarm(attack, gap, guard, 'now', target.injuries.bleed, w, getTargetDanger(view, foe, at, guard, w))
          if (!met || met.undefended <= 0) continue
          const score = attackScore(met.worth, foe, spent, STAspent + b.surgeSTA, cell) - drawn(cell, AP, STA, runs(walk), path) - (attack.kind === 'shoot' ? fired(cell, AP, STA) : 0)
          if (best && score <= best.score) continue
          const why = `${attack.kind}s ${target.name} (${attackName(attack)}, worth ${met.worth.toFixed(1)}: harm ${met.harm.toFixed(1)} against ${met.defence.draft?.kind ?? 'no defence'}, score ${score.toFixed(1)})`
          // the attack from here, or the walk to where it is made from, only where the table
          // takes it, after the surge that pays for it: a foe seen may still be out of the line
          // of fire, and a surge made for a move refused is wasted
          const fromHere = !here || !cell || sameCell(cell, here)
          const next = fromHere ? attackIntent(id, attack, foe) : walk ? moveIntent(id, walk.movement, cell) : null
          const surge = needsFocus ? 'focus' : b.surge
          if (!next || !declare(needsFocus ? trial(view, { kind: 'surge', args: [id, 'focus'] }) : b.view, next, TRIAL).ok) continue
          if (surge) best = { kind: 'surge', surge, score, why: surge === 'focus' ? `focuses to shoot: ${why}` : `makes the ${surge} surge: ${why}` }
          else best = fromHere ? { kind: 'attack', intent: next, score, why } : { kind: 'walk', intent: next, score, why: `walks to attack: ${why}` }
        }
      }
    }
  }
  if (best && (best.score > 0 || compelled) && (best.kind === 'surge' || declare(view, best.intent, TRIAL).ok)) return best

  // no attack worth making: a walk, by where the character threatens more and
  // is threatened less, and how far it closes on the foe the team threatens most
  if (!here) return null
  // the AP of the walk in on each foe from a cell, and what each AP saved on it is worth
  const walkIn = (foe: string, cell: Coord): number | null => getPotentialThreat(view, members, id, foe, cellOf(view, foe), cell, w)?.moveAP ?? null
  const chased = foes.map((foe) => ({ foe, from: walkIn(foe, here), perAP: w.aggression + (w.chase * getThreatening(view, members, foe, w)) / ROUND_AP }))
  const pursuit = (cell: Coord): number => chased.reduce((most, { foe, from, perAP }) => {
    const to = from === null ? null : walkIn(foe, cell)
    return to === null || from === null ? most : Math.max(most, perAP * Math.max(0, from - to))
  }, 0)
  const standing = (cell: Coord): number => {
    const offence = foes.reduce((most, foe) => Math.max(most, threatValue(getPotentialThreat(view, members, id, foe, cellOf(view, foe), cell, w), w)), 0)
    return w.offence * offence - w.peril * getDanger(view, members, id, 'potential', cell, undefined, w)
  }
  const stay = standing(here)
  let move: { cell: Coord; score: number; budget: Budget; movement: MovementKind } | null = null
  const worst = foes.reduce<{ id: string; danger: number } | null>((q, f) => {
    const danger = threatValue(getPotentialThreat(view, members, f, id, here, cellOf(view, f), w), w)
    return !q || danger > q.danger ? { id: f, danger } : q
  }, null)
  for (const b of budgets) {
    const walk = getWalk(b.view, id)
    if (!walk) continue
    for (const { cell, AP, STA, path } of getDirectedCells(view, here, walk, foes, worst && worst.danger > 0 ? worst.id : null)) {
      if (sameCell(cell, here)) continue
      if (!canPay(b, AP, 0)) continue
      const spent = AP
      // a surge's AP is dropped at the turn's end, so only the AP of its own is left to defend with
      const guard = { AP: Math.max(0, b.AP - b.surgeAP - Math.max(0, AP - b.surgeAP)), STA: Math.max(0, b.STA - STA) }
      const arrival = w.arrival * getDanger(view, members, id, 'immediate', cell, guard, w)
      const score = standing(cell) + pursuit(cell) - price(spent, STA + b.surgeSTA, cell) - drawn(cell, AP, STA, runs(walk), path) - arrival
      if (!move || score > move.score) move = { cell, score, budget: b, movement: walk.movement }
    }
  }
  if (!move || move.score <= stay + w.margin) return null
  const why = `walks where it threatens more, is threatened less and goes after its foes (${move.score.toFixed(1)} over ${stay.toFixed(1)})`
  if (move.budget.surge) return { kind: 'surge', surge: move.budget.surge, score: move.score, why: `makes the ${move.budget.surge} surge: ${why}` }
  const intent = moveIntent(id, move.movement, move.cell)
  return declare(view, intent, TRIAL).ok ? { kind: 'walk', intent, score: move.score, why } : null
}

// The answer to an attack on `id`: the opportunity attack a shot draws from
// it, if one is worth making, then the defence offered that leaves the least
// harm and price together, or none.
function answer(input: SeatInput, id: string, w: ThreatWeights, find: Find, press: Press): Decision | null {
  const view = input.view()
  const open = getOpenAction(view)
  const me = view.characters[id]
  if (!open || !me) return press(find('pass', id), 'lets it come')
  if (open.targetId !== id || (open.kind !== 'strike' && open.kind !== 'shoot')) return opportunity(input, id, w) ?? press(find('pass', id), 'lets it come')
  // shot at from within its reach: the opportunity attack the shot draws, then the defence
  const struck = open.kind === 'shoot' ? opportunity(input, id, w) : null
  if (struck) return struck
  const attacker = view.characters[open.actorId]
  const from = cellOf(view, open.actorId)
  const at = cellOf(view, id)
  const gap = from && at ? distance(from, at) : 0
  // the attack as the defender knows the attacker: a foe's quiver is guessed
  // and its abilities known only once seen (bot/belief.ts), so where the
  // arrows it shoots or the variant it makes are not among what it is
  // believed to have, the attack is read as the worst of the same row's that
  // are (the user's ruling: an unknown arrow is assumed the worst)
  const rows = attacker ? getPair(attacker, me).filter((a) => a.kind === open.kind && a.row.weaponKey === open.weaponKey && a.row.attack === open.attack && (open.kind !== 'strike' || a.heavy === getHeavyDegree(attacker, open))) : []
  const undefended = (a: PairAttack) => {
    const none = a.defences.find((d) => d.draft === null)
    return none ? getHarmAgainst(a, none, gap) : 0
  }
  const worst = (list: PairAttack[]) => list.reduce<PairAttack | undefined>((most, a) => (!most || undefended(a) > undefended(most) ? a : most), undefined)
  const variant = rows.filter((a) => a.row.variant === open.variant)
  const known = (list: PairAttack[]) => list.find((a) => open.kind !== 'shoot' || a.ammoId === '' || a.ammoId === open.ammoId)
  const attack = known(variant) ?? worst(variant) ?? worst(rows)
  if (!attack) return press(find('pass', id), 'lets it come: does not know the attack')
  const means = getMeans(me, true, w)
  const offered = getAvailableActions(view, id).filter((o) => o.available && o.reactionTo === open.id)
  const worth = (d: PairDefence) => getHarmAgainst(attack, d, gap)
  const none = attack.defences.find((d) => d.draft === null)
  let best: { draft: ActionDraft | null; score: number } = { draft: null, score: none ? worth(none) : 0 }
  for (const o of offered) {
    const d = attack.defences.find((x) => x.draft && sameDraft(x.draft, o.draft))
    if (!d) continue
    const priced = getSpendPrice(d.cost, means.STA, me.injuries.bleed, getDanger(view, input.members, id, 'immediate', at, { AP: Math.max(0, means.AP - d.cost.AP), STA: Math.max(0, means.STA - d.cost.STA) }, w), w)
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
      const met = getDefendedHarm(attack, attack.reach, guard, 'now', target.injuries.bleed, w, getTargetDanger(view, target.id, cellOf(view, target.id), guard, w))
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

// A change of arms (bot/arms.ts) where what it does to the most the
// character threatens any foe from where it stands, and to the worst any foe
// threatens it there (both potential threats, which weigh how far each foe is
// and what a shield blocks), is worth more than the switch costs at the price
// of an attack or a walk, with the opportunity attacks its priced moves draw
// (bot/approach.ts), and by `margin`: the first of its moves, declared.
function planSwitch(view: SceneState, members: readonly string[], id: string, w: ThreatWeights): { intent: Intent; why: string } | null {
  const me = view.characters[id]
  const here = cellOf(view, id)
  const { foes } = getSides(view, members)
  if (!me || foes.length === 0) return null
  const offence = (state: SceneState) => foes.reduce((most, foe) => Math.max(most, threatValue(getPotentialThreat(state, members, id, foe, cellOf(state, foe), here, w), w)), 0)
  const peril = (state: SceneState) => getDanger(state, members, id, 'potential', here, undefined, w)
  const now = { offence: offence(view), peril: peril(view) }
  const { price } = getAttackMeasures(view, members, id, w)
  const drawn = w.opportunity * getStandingCost(view, id, here, foes, (f) => getMeans(view.characters[f], false, w), { AP: me.resources.AP, STA: me.resources.STA }, w)
  let best: { intent: Intent; why: string; gain: number } | null = null
  for (const sw of getSwitches(me)) {
    if ((sw.cost.AP > 0 || sw.cost.STA > 0) && getPayBar(me, sw.cost, true)) continue
    const after = withSheet(view, id, sw.after)
    const paid = price(sw.cost.AP, sw.cost.STA, here)
    const thenOffence = offence(after)
    const beaten = (gain: number) => gain <= w.margin || (best !== null && gain <= best.gain)
    // danger is never below none, so the most the switch could gain is with
    // none left: a switch that loses even so is not worth reading the danger for
    if (w.peril >= 0 && beaten(w.offence * (thenOffence - now.offence) - w.peril * (0 - now.peril) - paid - sw.paid * drawn)) continue
    const then = { offence: thenOffence, peril: peril(after) }
    const gain = w.offence * (then.offence - now.offence) - w.peril * (then.peril - now.peril) - paid - sw.paid * drawn
    if (beaten(gain)) continue
    const intent: Intent = { actorId: id, option: { kind: 'gear', move: sw.moves[0] }, picks: [] }
    const why = `changes arms (${sw.moves.map((m) => m.kind).join(', ')}): threat ${now.offence.toFixed(1)} to ${then.offence.toFixed(1)}, danger ${now.peril.toFixed(1)} to ${then.peril.toFixed(1)}, for ${sw.cost.AP} AP, gain ${gain.toFixed(1)}`
    if (declare(view, intent, TRIAL).ok) best = { intent, why, gain }
  }
  return best && { intent: best.intent, why: best.why }
}

function takeTurn(input: SeatInput, id: string, w: ThreatWeights, find: Find, press: Press): Decision | null {
  const stress = takeStressTurn(input, id, w, find, press)
  if (stress !== 'none') return stress
  const arms = planSwitch(input.view(), input.members, id, w)
  if (arms) return { kind: 'declare', intent: arms.intent, why: arms.why }
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
      if (!start) continue
      const begun = trial(view, start.command)
      if (planTurn(begun, members, id, w) || planSwitch(begun, members, id, w)) return { kind: 'press', pick: start, why: 'has something worth doing' }
    }
    return carryOn(input, find)
  }
}

