import type { Coord, SurgeKind } from '../../types'
import type { ActionDraft, SceneState } from '../../scene/types'
import { getSurgeAPLeft, getSurgeRecovery, getSurgeSTA } from '../../character/rules/surge'
import { getRecoveredSTA } from '../../character/rules/characteristics'
import { getOpenAction } from '../../scene/rules/log'
import { getAvailableActions, getUnfinishedAnswers } from '../../scene/rules/options'
import { getOpenChoices } from '../../scene/projections/choices'
import { coordKey, disk, distance, extentCells, sameCell } from '../../scene/rules/board/geometry'
import { firesAcross, getEyes, getEyesToward, seesAcross } from '../../scene/rules/board/board'
import { getStressDue, getStressSocial, getStressTurn } from '../../scene/rules/stress'
import { getTurnHolder, hasAgreedToEnd, keepsSurgeAP } from '../../scene/rules/turn'
import { isCollapsed } from '../../scene/rules/situational'
import { ROUND_AP } from '../../tables'
import { declare, type Intent, type Pick } from '../declare'
import { getApproachDrawn, getStandingCost, type Drawn } from '../approach'
import { getSides } from '../table'
import { getPair, type PairAttack } from '../pairs'
import { cellOf, getHarmAgainst, getMeans, getRoutes, getStrikeCells, getTeam, type SpendCost } from '../threat'
import { REST_TUNING } from '../rest'
import { getDefensiveCost, getOffensiveCost, getSTAHarm, type SpecWeights } from '../cost'
import { freshGuard, getLayer, getPickedHarm, getThreatBy, getThreatOn, isRuinous, SHOT_GAP, type Guard } from '../threatMap'
import { argOf, arrivedAt, attackIntent, attackName, canPay, getAttackCells, getBudgets, getCollapsedCare, getKnownAttack, getRunBlock, getWalkBudgets, getWalks, heldAP, isWalkPaid, moveIntent, opensAfter, ownAP, RUN_BLOCKS, runs, sameDraft, takesWalk, trial, TRIAL, wonBy, type Budget, type Walk, type WalkCell } from '../moves'
import { carryOn, endTurn, finding, settleWait, type Find, type Press } from './nearest'
import type { Box, Decision, Pass, SeatInput } from '../decision'

// The box instructions/bot-spec.md describes, read section by section:
//
// - a turn is asked for (or anyone else's contested) for what the character
//   would do now: an attack, or an escape from the danger where it stands,
//   whichever scores more, above nothing; once the turn is its own it asks
//   that again after every action, then how to better its position
//   (Tactical and Aggro, in the order `aggro` says; Search with no foe the
//   side knows of), and with nothing worth doing once no foe can still act
//   this round, Tactical once more with the AP left out of its cost, before
//   it ends the turn and agrees to end the round;
// - an attack scores the harm it leaves against the defence the target is
//   believed to pick, and the threat the target is left more open to by what
//   that defence spends, less its Offensive Cost and the opportunity attacks
//   it draws (spec "Attacking");
// - attacked, it picks the defence with the most it saves less its Defensive
//   Cost, taking the hit at 0 (spec "Defend"); drawn an opportunity attack, it
//   makes it where it scores above nothing as an attack does;
// - no option it takes is believed to leave it collapsed or dead this round
//   (spec "Guard", threatMap.ts `isRuinous`).
//
// The rest (morale, concentration, landing what it rolled with a hit's
// overflow spent as `getBestSpend` spends it, the round's rest step) it plays
// as the nearest box does.

export const SPEC_WEIGHTS: SpecWeights = { ...REST_TUNING, AP: 2, STA: 2, caution: 1, IL: 2, bleed: 5, search: 4, solitude: 10, retarget: 2, courage: 1, teamwork: 1, baseAPcost: 1, aggro: 0 }

// spec "Escape": the party members within this many metres of where the character sets out
const ESCAPE_COMPANY = 5

type Plan =
  | { kind: 'attack' | 'walk' | 'care'; intent: Intent; score: number; why: string }
  | { kind: 'surge'; surge: SurgeKind; score: number; why: string }

const NOTHING_DRAWN: Drawn = { worth: 0, harm: 0, AP: 0, STA: 0 }

// What every plan of the turn reads of the fight as the character holds it.
type Ctx = {
  view: SceneState
  members: readonly string[]
  id: string
  w: SpecWeights
  me: SceneState['characters'][string]
  here: Coord | null
  // the foes the side knows to stand somewhere, and of those the ones the character notices
  foes: string[]
  targets: string[]
  team: string[]
  left: Guard
  budgets: Budget[]
  // the foes' immediate threat on the character at `cell` holding `guard`, and where it stands now
  onMe: (cell: Coord | null, guard: Guard) => number
  now: number
  picks: Map<string, TargetPick>
}

function getCtx(view: SceneState, members: readonly string[], id: string, w: SpecWeights, unnoticed: ReadonlySet<string>): Ctx | null {
  const me = view.characters[id]
  if (!me) return null
  const here = cellOf(view, id)
  const foes = getSides(view, members).foes.filter((f) => cellOf(view, f) !== null)
  const left = { AP: me.resources.AP, STA: me.resources.STA }
  const onMe = (cell: Coord | null, guard: Guard) => getThreatOn(view, members, id, cell, guard, 'immediate', w)
  return { view, members, id, w, me, here, foes, targets: foes.filter((f) => !unnoticed.has(f)), team: getTeam(view, members), left, budgets: getBudgets(view, id), onMe, now: onMe(here, left), picks: new Map() }
}

const held = (b: Budget, AP: number, STA: number): Guard => ({ AP: heldAP(b, AP), STA: Math.max(0, b.STA - STA) })

// What answering an opportunity attack costs the character, as a defence does.
const spendingOf = (ctx: Ctx): SpendCost => (s) => ctx.w.caution * (ctx.w.AP * s.AP + getSTAHarm(s.STA, ctx.me.injuries.bleed, ctx.w))

// The opportunity attacks a walk from where the character stands to `to` draws (bot/approach.ts).
function drawnOn(ctx: Ctx, to: Coord | null, AP: number, STA: number, running: boolean, path: readonly Coord[], b: Budget): Drawn {
  const { view, id, here, foes, w } = ctx
  if (!here || !to || sameCell(here, to)) return NOTHING_DRAWN
  const guard = { AP: Math.max(0, b.AP - AP), STA: b.STA - STA }
  return getApproachDrawn(view, id, here, to, running, foes, (f) => getMeans(view.characters[f], false, w), guard, w, path, spendingOf(ctx))
}

// The harm a shot fired from `at` takes from the opportunity attacks of the foes whose melee weapons reach there.
function firedFrom(ctx: Ctx, at: Coord | null, AP: number, STA: number): number {
  const { view, id, here, foes, w, left } = ctx
  const guard = { AP: Math.max(0, left.AP - AP), STA: left.STA - STA }
  return getStandingCost(view, id, at ?? here, foes, (f) => getMeans(view.characters[f], false, w), guard, w, 'harm', spendingOf(ctx))
}

// How many of the character's party stand within ESCAPE_COMPANY metres of `cell`.
function companyAt(ctx: Ctx, cell: Coord): number {
  return ctx.team.filter((t) => {
    const at = t !== ctx.id ? cellOf(ctx.view, t) : null
    return at !== null && distance(cell, at) <= ESCAPE_COMPANY
  }).length
}

// The defence the target of `attack`, `gap` metres away, is believed to pick
// (spec "Defend", read for it): the most harm it saves less its Defensive
// Cost, the cost's threat being the team's on it, which the AP it spends
// leaves it more open to; taking the hit at 0. `delta`: how much more open.
type TargetPick = { harm: number; delta: number; defence: string }

function pickOf(ctx: Ctx, attack: PairAttack, index: number, gap: number, foe: string): TargetPick {
  const key = `${foe}|${index}|${gap}`
  const known = ctx.picks.get(key)
  if (known) return known
  const { view, members, w, team } = ctx
  const target = view.characters[foe]
  const at = cellOf(view, foe)
  const guard = getMeans(target, false, w)
  const threatAt = (g: Guard) => getThreatBy(view, members, team, foe, at, g, 'immediate', w)
  const before = threatAt(guard)
  const none = attack.defences.find((d) => d.draft === null)
  const undefended = none ? getHarmAgainst(attack, none, gap) : 0
  let best: TargetPick & { score: number } = { score: 0, harm: undefended, delta: 0, defence: 'no defence' }
  for (const d of attack.defences) {
    if (d.draft === null || d.cost.AP > guard.AP || d.cost.STA > guard.STA) continue
    const harm = getHarmAgainst(attack, d, gap)
    const delta = threatAt({ AP: guard.AP - d.cost.AP, STA: guard.STA - d.cost.STA }) - before
    const score = undefended - harm - getDefensiveCost(d.cost.STA, delta, target.injuries.bleed, w)
    if (score > best.score) best = { score, harm, delta, defence: d.draft.kind }
  }
  ctx.picks.set(key, best)
  return best
}

// spec "Attacking": of every attack on every foe the character notices, from
// where it stands or the cheapest cell of a walk that reaches
// (`getAttackCells`), the one scoring most, if above nothing (or whatever it
// scores, when `compelled`). The surges that may pay for it (the user's
// rulings, 2026-11-20): the movement surge only for a run of at least
// RUN_BLOCKS blocks, the combat surge only for an attack the character's own
// AP cannot pay for, the focus surge only for the shot it opens.
function planAttack(ctx: Ctx, compelled = false, on: readonly string[] = ctx.targets): Plan | null {
  const { view, members, id, w, me, here, budgets } = ctx
  const runBlock = getRunBlock(view, id)
  const focusSTA = getSurgeSTA('focus')(me) + getRecoveredSTA(me, me.resources.STA, getSurgeRecovery('recovery')(me)) - me.resources.STA
  const rank = (b: Budget) => (b.surge === null ? 0 : b.surge === 'movement' ? 1 : 2)
  const order = [...budgets].sort((a, b) => rank(a) - rank(b))
  // the attacks (by foe and row) paid for without the combat surge
  const paid = new Set<string>()
  const weighed: { score: number; settle: () => Plan | null }[] = []
  for (const b of order) {
    if (b.surge !== null && me.resources.STA <= 0) continue
    const walks = b.surge === 'movement' ? getWalks(b.view, id, 'run') : getWalks(b.view, id)
    for (const walk of walks.length ? walks : [null]) for (const foe of on) {
      const target = view.characters[foe]
      const at = cellOf(view, foe)
      if (!target) continue
      const pair = getPair(me, target)
      for (let i = 0; i < pair.length; i++) {
        const attack = pair[i]
        const key = `${foe}|${i}`
        if (!attack.opens.action || (b.surge === 'combat' && paid.has(key))) continue
        const board = view.board
        const clear = attack.kind === 'shoot' && board && at ? (c: Coord) => firesAcross(board, [c], [at], getEyes(view, id, foe)) : getStrikeCells(view, id, foe, at, attack.reach)
        const draws = (c: { cell: Coord | null; AP: number; STA: number; path: Coord[] }) => drawnOn(ctx, c.cell, c.AP, c.STA, runs(walk), c.path, b).harm
        for (const { cell, AP, STA, path, elevation } of getAttackCells(here, walk, at, attack.reach, draws, clear)) {
          if (b.surge === 'movement' && (runBlock === null || AP < RUN_BLOCKS * runBlock)) continue
          const gap = cell && at ? distance(cell, at) : 0
          const needsFocus = attack.needsFocus && me.usedSurge !== 'focus'
          if (needsFocus && (me.usedSurge !== null || b.surge !== null)) continue
          const answering = drawnOn(ctx, cell, AP, STA, runs(walk), path, b)
          const spent = AP + attack.cost.AP + answering.AP
          const STAspent = STA + attack.cost.STA + answering.STA
          if (!canPay(b, AP, attack.cost.AP + answering.AP) || STAspent > b.STA) continue
          if (b.surge !== 'combat') paid.add(key)
          const none = attack.defences.find((d) => d.draft === null)
          if (!none || getHarmAgainst(attack, none, gap) <= 0) continue
          const guard = held(b, spent, STAspent)
          if (isRuinous(view, members, id, cell, me.resources.STA - guard.STA, guard, w)) continue
          const pick = pickOf(ctx, attack, i, gap, foe)
          const delta = ctx.onMe(cell, guard) - ctx.now
          const cost = getOffensiveCost(ownAP(view, id, b, AP, spent), STAspent + b.surgeSTA + (needsFocus ? focusSTA : 0), delta, me.injuries.bleed, w)
          const drew = answering.harm + (attack.kind === 'shoot' ? firedFrom(ctx, cell, AP, STA) : 0)
          const score = pick.harm + pick.delta - cost - drew
          const why = `${attack.kind}s ${target.name} (${attackName(attack)}: harm ${pick.harm.toFixed(1)} against ${pick.defence} + threat on it ${pick.delta.toFixed(1)} - cost ${cost.toFixed(1)} - drawn ${drew.toFixed(1)} = ${score.toFixed(1)})`
          const fromHere = !here || !cell || sameCell(cell, here)
          const movement = walk?.movement
          weighed.push({
            score,
            settle: () => {
              const next = fromHere ? attackIntent(id, attack, foe) : movement && elevation !== undefined && cell ? moveIntent(id, movement, cell, elevation) : null
              const surge = needsFocus ? 'focus' : b.surge
              const paidView = needsFocus ? trial(view, { kind: 'surge', args: [id, 'focus'] }) : b.view
              if (!next || (!fromHere && !takesWalk(paidView, id, next, AP, STA))) return null
              const opens = opensAfter(arrivedAt(paidView, id, cell, AP, STA), id, attackIntent(id, attack, foe))
              if (!opens || (opens === 'givingUp' && attack.cost.AP > heldAP(b, AP))) return null
              if (surge) return { kind: 'surge', surge, score, why: surge === 'focus' ? `focuses to shoot: ${why}` : `makes the ${surge} surge: ${why}` }
              if (!fromHere) return { kind: 'walk', intent: next, score, why: `walks to attack: ${why}` }
              return opensAfter(view, id, next) ? { kind: 'attack', intent: next, score, why } : null
            },
          })
        }
      }
    }
  }
  for (const { score, settle } of weighed.sort((x, y) => y.score - x.score)) {
    if (score <= 0 && !compelled) break
    const plan = settle()
    if (plan) return plan
  }
  return null
}

// A walk weighed: the cell, the walk and the budget paying for it, and what it leaves the character holding.
type Step = { b: Budget; walk: Walk; c: WalkCell; guard: Guard; threat: number }

// Every walk the character could make this turn (`getWalkBudgets`), each with
// the foes' immediate threat on it where it ends, holding what the walk leaves.
function getSteps(ctx: Ctx): Step[] {
  const { view, id, here } = ctx
  const steps: Step[] = []
  if (!here) return steps
  for (const { b, walks } of getWalkBudgets(view, id, ctx.budgets)) for (const walk of walks) for (const c of walk.cells) {
    if (sameCell(c.cell, here) || !isWalkPaid(view, id, b, c.AP)) continue
    const guard = held(b, c.AP, c.STA)
    steps.push({ b, walk, c, guard, threat: ctx.onMe(c.cell, guard) })
  }
  return steps
}

const kept = new WeakMap<Ctx, Step[]>()
const stepsOf = (ctx: Ctx): Step[] => kept.get(ctx) ?? (kept.set(ctx, getSteps(ctx)), kept.get(ctx)!)

// A step as a plan: the surge that pays for it first, if any; null where the
// table does not take the walk at the price it was weighed at.
function stepPlan(ctx: Ctx, s: Step, score: number, why: string): Plan | null {
  if (s.b.surge) return { kind: 'surge', surge: s.b.surge, score, why: `makes the ${s.b.surge} surge: ${why}` }
  const intent = moveIntent(ctx.id, s.walk.movement, s.c.cell, s.c.elevation)
  return takesWalk(ctx.view, ctx.id, intent, s.c.AP, s.c.STA) ? { kind: 'walk', intent, score, why } : null
}

const allowed = (ctx: Ctx, s: Step): boolean => s.walk.clear(s.c) && !isRuinous(ctx.view, ctx.members, ctx.id, s.c.cell, ctx.me.resources.STA - s.guard.STA, s.guard, ctx.w)

// spec "Escape": to the cell of the least immediate threat on the character,
// read with what the walk leaves it, scored by the danger it sheds over
// `courage`, less `teamwork` for every party member within ESCAPE_COMPANY
// metres of where it sets out, the walk's STA and the opportunity attacks it draws.
function planEscape(ctx: Ctx): Plan | null {
  const { here, now, w, me } = ctx
  if (!here || now <= 0) return null
  const company = companyAt(ctx, here)
  for (const s of [...stepsOf(ctx)].sort((x, y) => x.threat - y.threat || x.c.AP + x.c.STA - (y.c.AP + y.c.STA))) {
    if (!allowed(ctx, s)) continue
    const drew = drawnOn(ctx, s.c.cell, s.c.AP, s.c.STA, runs(s.walk), s.c.path, s.b).harm
    const score = (now - s.threat) / w.courage - company * w.teamwork - getSTAHarm(s.c.STA + s.b.surgeSTA, me.injuries.bleed, w) - drew
    if (score <= 0) return null
    const plan = stepPlan(ctx, s, score, `escapes (${s.walk.movement}, threat ${now.toFixed(1)} to ${s.threat.toFixed(1)}, ${company} near, drawn ${drew.toFixed(1)}: ${score.toFixed(1)})`)
    if (plan) return plan
  }
  return null
}

// The character's potential threat on every foe from `cell`, less theirs on it there holding `STA`.
function standing(ctx: Ctx, cell: Coord, STA: number): number {
  const { view, members, id, w, foes } = ctx
  const mine = foes.reduce((sum, f) => sum + getLayer(view, members, id, cell, f, cellOf(view, f), 'potential', freshGuard(getMeans(view.characters[f], false, w).STA), w), 0)
  return mine - getThreatOn(view, members, id, cell, freshGuard(STA), 'potential', w)
}

// spec "Tactical": the cell where the team's potential threat on the foes
// less theirs on the team is most, which only the character's own share of
// changes, where that gain less the walk's Offensive Cost and the
// opportunity attacks it draws is above nothing; `free` leaves the AP out of
// the cost (spec "Decide take turn"). Of the walks scored best before what
// they draw, TACTICAL_SCAN are read for it.
const TACTICAL_SCAN = 8

function planTactical(ctx: Ctx, free: boolean): Plan | null {
  const { view, id, w, me, here } = ctx
  if (!here || !ctx.foes.length) return null
  const stay = standing(ctx, here, me.resources.STA)
  const scored = stepsOf(ctx).flatMap((s) => {
    const gain = standing(ctx, s.c.cell, s.guard.STA) - stay
    if (gain <= 0) return []
    const cost = getOffensiveCost(ownAP(view, id, s.b, s.c.AP, s.c.AP), s.c.STA + s.b.surgeSTA, s.threat - ctx.now, me.injuries.bleed, w, free)
    return gain - cost > 0 ? [{ s, gain, cost, score: gain - cost }] : []
  }).sort((x, y) => y.score - x.score)
  const read: { s: Step; score: number; why: string }[] = []
  for (const k of scored) {
    if (read.length >= TACTICAL_SCAN) break
    if (!allowed(ctx, k.s)) continue
    const drew = drawnOn(ctx, k.s.c.cell, k.s.c.AP, k.s.c.STA, runs(k.s.walk), k.s.c.path, k.s.b).harm
    const score = k.score - drew
    if (score > 0) read.push({ s: k.s, score, why: `repositions${free ? ' before the round ends' : ''} (${k.s.walk.movement}, standing ${k.gain.toFixed(1)} better - cost ${k.cost.toFixed(1)} - drawn ${drew.toFixed(1)}: ${score.toFixed(1)})` })
  }
  for (const r of read.sort((x, y) => y.score - x.score)) {
    const plan = stepPlan(ctx, r.s, r.score, r.why)
    if (plan) return plan
  }
  return null
}

// The cells a walk from `foe` standing at `at` takes to each cell (`getRoutes`),
// read for a cell it does not come to (one somebody stands in) as one more than
// the fewest of the cells around it, and straight past where it walks.
const fields = new WeakMap<SceneState, Map<string, (cell: Coord) => number>>()

function fieldOf(view: SceneState, foe: string, at: Coord, around: Coord): (cell: Coord) => number {
  const byFoe = fields.get(view) ?? new Map<string, (cell: Coord) => number>()
  fields.set(view, byFoe)
  const known = byFoe.get(foe)
  if (known) return known
  const steps = new Map<string, number>()
  for (const r of getRoutes(view, foe, at, distance(at, around) + 2 * ROUND_AP)?.routes ?? []) {
    const k = coordKey(r.cell)
    if (!steps.has(k) || r.steps < steps.get(k)!) steps.set(k, r.steps)
  }
  const field = (cell: Coord): number => {
    const own = steps.get(coordKey(cell))
    if (own !== undefined) return own
    const near = disk(cell, 1).reduce<number | null>((least, c) => {
      const s = steps.get(coordKey(c))
      return s !== undefined && (least === null || s < least) ? s : least
    }, null)
    return near !== null ? near + 1 : distance(cell, at)
  }
  byFoe.set(foe, field)
  return field
}

// The most harm the character's attacks are believed to leave `foe`, where
// they stand playing no part (a shot read from SHOT_GAP metres).
function getMostHarm(ctx: Ctx, foe: string): number {
  const { view, me, w } = ctx
  const target = view.characters[foe]
  if (!target) return 0
  const guard = getMeans(target, false, w)
  return getPair(me, target).reduce((most, a) => (a.opens.action ? Math.max(most, getPickedHarm(a, a.kind === 'shoot' ? SHOT_GAP : a.reach, target, guard, w)) : most), 0)
}

// spec "Aggro": after the foe the character is believed to harm most, where
// that is more than `retarget` times the harm it would do every foe it has a
// potential threat on; to a cell nearer it where an escape would not be
// called for (the danger there, over the least danger of any cell the
// character walks to, over `courage`, less `teamwork` for every party member
// near, comes to nothing), the nearest of each movement, by the movement
// whose Defensive Cost is least.
function planAggro(ctx: Ctx): Plan | null {
  const { view, members, id, w, me, here, foes } = ctx
  if (!here || !foes.length) return null
  const harm = new Map(foes.map((f) => [f, getMostHarm(ctx, f)]))
  const best = foes.reduce((b, f) => (harm.get(f)! > harm.get(b)! ? f : b))
  const reached = foes.filter((f) => getLayer(view, members, id, here, f, cellOf(view, f), 'potential', freshGuard(getMeans(view.characters[f], false, w).STA), w) > 0)
  if (reached.some((f) => harm.get(best)! <= w.retarget * harm.get(f)!)) return null
  const at = cellOf(view, best)
  if (!at) return null
  const field = fieldOf(view, best, at, here)
  const from = field(here)
  const steps = stepsOf(ctx)
  const safest = steps.reduce((least, s) => Math.min(least, s.threat), ctx.now)
  const calm = (s: Step) => (s.threat - safest) / w.courage - companyAt(ctx, s.c.cell) * w.teamwork <= 0
  const byMovement = new Map<string, { s: Step; closer: number; cost: number }>()
  for (const s of steps) {
    const closer = from - field(s.c.cell)
    if (closer <= 0 || !calm(s)) continue
    const key = `${s.b.surge ?? ''}|${s.walk.movement}`
    const cost = getDefensiveCost(s.c.STA + s.b.surgeSTA, s.threat - ctx.now, me.injuries.bleed, w)
    const was = byMovement.get(key)
    if (was && (closer < was.closer || (closer === was.closer && cost >= was.cost))) continue
    if (!allowed(ctx, s)) continue
    byMovement.set(key, { s, closer, cost })
  }
  const name = view.characters[best]?.name ?? best
  for (const m of [...byMovement.values()].sort((x, y) => x.cost - y.cost)) {
    const plan = stepPlan(ctx, m.s, m.closer, `goes after ${name} (${m.s.walk.movement}, ${m.closer} cells nearer, defensive cost ${m.cost.toFixed(1)})`)
    if (plan) return plan
  }
  return null
}

// spec "Search": with no foe the side knows of, a walk of at most `search` AP
// spent this round towards the nearest cell nobody of its side sees, never
// ending more than `solitude` metres from the nearest ally unless it comes
// nearer one. A foe the side knows of is gone after by Aggro.
function planSearch(ctx: Ctx): Plan | null {
  const { view, id, w, me, here, team } = ctx
  const board = view.board
  if (!board || !here || ctx.foes.length) return null
  const allow = w.search - Math.max(0, ROUND_AP - me.resources.AP)
  if (allow <= 0) return null
  const eyes = getEyesToward(view, id, 0)
  const watched = team.flatMap((t) => cellOf(view, t) ?? [])
  const nearest = extentCells(board.origin, board.extent).sort((x, y) => distance(here, x) - distance(here, y)).find((c) => !watched.some((t) => seesAcross(board, [t], [c], eyes)))
  if (!nearest) return null
  const friends = team.filter((t) => t !== id).flatMap((t) => cellOf(view, t) ?? [])
  const apart = (cell: Coord) => (friends.length ? Math.min(...friends.map((f) => distance(cell, f))) : 0)
  const apartHere = apart(here)
  const fits = (cell: Coord) => apart(cell) <= w.solitude || apart(cell) < apartHere
  for (const walk of getWalks(view, id)) {
    const found = walk.cells
      .filter((c) => c.AP <= allow && !sameCell(c.cell, here) && distance(c.cell, nearest) < distance(here, nearest) && fits(c.cell))
      .sort((x, y) => distance(x.cell, nearest) - distance(y.cell, nearest) || x.AP + x.STA - (y.AP + y.STA))
      .find((c) => walk.clear(c))
    if (!found) continue
    const intent = moveIntent(id, walk.movement, found.cell, found.elevation)
    if (takesWalk(view, id, intent, found.AP, found.STA)) return { kind: 'walk', intent, score: 0, why: `searches: walks towards cells nobody of its side sees (${walk.movement})` }
  }
  return null
}

// What the character would do now with the turn it holds: the attack or the
// escape, whichever scores more; a collapsed one only stops its bleed.
function planNow(view: SceneState, members: readonly string[], id: string, w: SpecWeights, unnoticed: ReadonlySet<string>): Plan | null {
  const me = view.characters[id]
  if (me && isCollapsed(view, me)) return getCollapsedCare(view, id)
  const ctx = getCtx(view, members, id, w, unnoticed)
  if (!ctx) return null
  return [planAttack(ctx), planEscape(ctx)].reduce<Plan | null>((best, p) => (p && (!best || p.score > best.score) ? p : best), null)
}

// Whether the round is as good as over for the character's foes: every one
// has agreed to end it or is believed to have no AP left, so that what the
// character's AP would defend this round is nothing.
function isRoundEnding(ctx: Ctx): boolean {
  const { view, w } = ctx
  return getSides(view, ctx.members).foes.every((f) => hasAgreedToEnd(view, f) || getMeans(view.characters[f], false, w).AP <= 0)
}

// How the character would better its position once it has nothing to do now:
// Search with no foe the side knows of, else Tactical and Aggro in the order
// `aggro` says, and failing both, once the round is as good as over for its
// foes (`isRoundEnding`), Tactical with the AP left out of its cost.
function planLater(view: SceneState, members: readonly string[], id: string, w: SpecWeights, unnoticed: ReadonlySet<string>): Plan | null {
  const me = view.characters[id]
  if (me && isCollapsed(view, me)) return null
  const ctx = getCtx(view, members, id, w, unnoticed)
  if (!ctx) return null
  if (!ctx.foes.length) return planSearch(ctx)
  const order = w.aggro >= 1 ? [() => planAggro(ctx), () => planTactical(ctx, false)] : [() => planTactical(ctx, false), () => planAggro(ctx)]
  for (const plan of order) {
    const made = plan()
    if (made) return made
  }
  return isRoundEnding(ctx) ? planTactical(ctx, true) : null
}

function planTurn(view: SceneState, members: readonly string[], id: string, w: SpecWeights, unnoticed: ReadonlySet<string>, pass: Pass): Plan | null {
  return planNow(view, members, id, w, unnoticed) ?? (pass === 'any' ? planLater(view, members, id, w, unnoticed) : null)
}

// spec "Defend": of the defences the panel offers against `attack`, the one
// with the most harm it saves less its Defensive Cost (what the AP it spends
// leaves the character more open to this round, and its STA), taking the hit
// at 0. An earmarked surge's AP left is lost when the stack is played out by
// one who does not keep it, so it is spent first. An answer only a surge
// opens is left out: the surge is weighed by itself (`answer`).
type Defence = { draft: ActionDraft | null; score: number; harm: number }

function weighDefences(view: SceneState, members: readonly string[], id: string, attack: PairAttack, gap: number, w: SpecWeights): Defence {
  const open = getOpenAction(view)
  const me = view.characters[id]
  const at = cellOf(view, id)
  const left = { AP: me.resources.AP, STA: me.resources.STA }
  const dropped = !keepsSurgeAP(view, id) ? getSurgeAPLeft(me) : 0
  const now = getThreatOn(view, members, id, at, left, 'immediate', w)
  const none = attack.defences.find((d) => d.draft === null)
  const undefended = none ? getHarmAgainst(attack, none, gap) : 0
  let best: Defence = { draft: null, score: 0, harm: undefended }
  const offered = open ? getAvailableActions(view, id).filter((o) => o.available && o.reactionTo === open.id && o.surge === null) : []
  for (const o of offered) {
    const d = attack.defences.find((x) => x.draft && sameDraft(x.draft, o.draft))
    if (!d) continue
    const harm = getHarmAgainst(attack, d, gap)
    const after = { AP: Math.max(0, Math.min(left.AP - d.cost.AP, left.AP - dropped)), STA: Math.max(0, left.STA - d.cost.STA) }
    const score = undefended - harm - getDefensiveCost(d.cost.STA, getThreatOn(view, members, id, at, after, 'immediate', w) - now, me.injuries.bleed, w)
    if (score > best.score) best = { draft: o.draft, score, harm }
  }
  return best
}

// The answer to an attack on `id`: the opportunity attack a shot draws from
// it, if one is worth making, then the defence `weighDefences` picks. A surge
// the panel offers (the reaction surge, or the movement surge with its
// reflexes, combat.tex "Reflex") is made first where the defence it opens,
// read on the fight with it made, scores more by more than its STA and the
// recovery it gives up cost (the user's ruling, 2026-11-20). Anything else
// it is asked to answer, it answers with an opportunity attack or lets pass.
function answer(input: SeatInput, id: string, w: SpecWeights, find: Find, press: Press): Decision | null {
  const view = input.view()
  const open = getOpenAction(view)
  const me = view.characters[id]
  if (!open || !me) return press(find('pass', id), 'lets it come')
  if (open.targetId !== id || (open.kind !== 'strike' && open.kind !== 'shoot')) return opportunity(input, id, w) ?? press(find('pass', id), 'lets it come')
  const struck = open.kind === 'shoot' ? opportunity(input, id, w) : null
  if (struck) return struck
  const known = getKnownAttack(view, open, id)
  if (!known) return press(find('pass', id), 'lets it come: does not know the attack')
  const best = weighDefences(view, input.members, id, known.attack, known.gap, w)
  const surges = me.resources.STA > 0 ? input.buttons.filter((b) => b.command.kind === 'surge' && argOf(b.command) === id) : []
  let surging: { button: (typeof surges)[number]; gain: number; why: string } | null = null
  for (const surge of surges) {
    const kind = surge.command.args[1] as SurgeKind
    const surged = trial(view, surge.command)
    const made = surged.characters[id]
    const reopened = getOpenAction(surged)
    const after = reopened ? getKnownAttack(surged, reopened, id) : null
    if (surged === view || made?.usedSurge !== kind || !after) continue
    const recovered = getRecoveredSTA(me, me.resources.STA, getSurgeRecovery('recovery')(me)) - me.resources.STA
    const cost = w.caution * getSTAHarm(me.resources.STA - made.resources.STA + recovered, me.injuries.bleed, w)
    const withSurge = weighDefences(surged, input.members, id, after.attack, after.gap, w)
    const gain = withSurge.score - best.score - cost
    if (withSurge.draft === null || gain <= 0 || (surging && gain <= surging.gain)) continue
    surging = { button: surge, gain, why: `makes the ${kind} surge to answer with ${withSurge.draft.kind} (${withSurge.score.toFixed(1)} against ${best.score.toFixed(1)}, the surge ${cost.toFixed(1)})` }
  }
  if (surging) {
    const pressed = press(surging.button, surging.why)
    if (pressed) return pressed
  }
  if (best.draft === null) return press(find('pass', id), `takes the hit (harm ${best.harm.toFixed(1)}, no defence worth its cost)`)
  const picks = fillAnswer(view, input.members, id, best.draft, w)
  if (!picks) return press(find('pass', id), `lets it come: ${best.draft.kind} cannot be finished`)
  return { kind: 'declare', intent: { actorId: id, option: best.draft, picks }, why: `answers with ${best.draft.kind} (harm ${best.harm.toFixed(1)}, ${best.score.toFixed(1)} over taking it)` }
}

// spec "Immediate actions": an opportunity attack scored as an attack is, made
// from where the character stands: of the rows the draw opens, the one scoring
// most, if above nothing.
function opportunity(input: SeatInput, id: string, w: SpecWeights): Decision | null {
  const view = input.view()
  const open = getOpenAction(view)
  const ctx = getCtx(view, input.members, id, w, input.unnoticed(id))
  if (!open || !ctx) return null
  const { me, here } = ctx
  const offers = getAvailableActions(view, id).filter((o) => o.available && o.reactionTo === open.id && o.draft.kind === 'opportunityAttack')
  let best: { draft: ActionDraft; picks: Pick[]; score: number; why: string } | null = null
  for (const o of offers) {
    const declared = trial(view, { kind: 'react', args: [id, o.draft, o.surge] })
    const drawn = getUnfinishedAnswers(declared, open).find((r) => r.actorId === id)
    const target = drawn?.targetId ? view.characters[drawn.targetId] : undefined
    if (!drawn || !target) continue
    const rows = getOpenChoices(declared).filter((c) => c.actorId === id && c.part === 'row').map((c) => c.value as PairAttack['row'])
    const pair = getPair(me, target)
    for (let i = 0; i < pair.length; i++) {
      const attack = pair[i]
      if (attack.kind !== 'strike' || !rows.some((r) => r.weaponKey === attack.row.weaponKey && r.attack === attack.row.attack && r.variant === attack.row.variant)) continue
      const { AP, STA } = attack.cost
      if (AP > me.resources.AP || STA > me.resources.STA) continue
      const none = attack.defences.find((d) => d.draft === null)
      if (!none || getHarmAgainst(attack, none, attack.reach) <= 0) continue
      const guard = { AP: me.resources.AP - AP, STA: me.resources.STA - STA }
      if (isRuinous(view, input.members, id, here, STA, guard, w)) continue
      const pick = pickOf(ctx, attack, i, attack.reach, target.id)
      const cost = getOffensiveCost(AP, STA, ctx.onMe(here, guard) - ctx.now, me.injuries.bleed, w)
      const score = pick.harm + pick.delta - cost
      if (score <= 0 || (best && score <= best.score)) continue
      const picks: Pick[] = [{ part: 'row', value: attack.row }, ...(attack.declaresHeavy ? [{ part: 'modifier' as const, value: { key: `heavy${attack.heavy}`, on: true } }] : [])]
      best = { draft: o.draft, picks, score, why: `opportunity attack on ${target.name} (${attackName(attack)}: harm ${pick.harm.toFixed(1)} against ${pick.defence} + threat on it ${pick.delta.toFixed(1)} - cost ${cost.toFixed(1)} = ${score.toFixed(1)})` }
    }
  }
  if (!best) return null
  const picks = fillAnswer(view, input.members, id, best.draft, w, best.picks)
  return picks ? { kind: 'declare', intent: { actorId: id, option: best.draft, picks }, why: best.why } : null
}

// What the answer still asks for once declared (where an evasive jump lands),
// picked: the cell of the least immediate threat on the character, anything
// else as first offered, after the `start` picks; null when it asks for
// something nothing offers.
function fillAnswer(view: SceneState, members: readonly string[], id: string, draft: ActionDraft, w: SpecWeights, start: readonly Pick[] = []): Pick[] | null {
  const open = getOpenAction(view)
  const me = view.characters[id]
  if (!open || !me) return null
  const guard = { AP: me.resources.AP, STA: me.resources.STA }
  const threat = (cell: Coord) => getThreatOn(view, members, id, cell, guard, 'immediate', w)
  const picks: Pick[] = [...start]
  for (let i = 0; i < 4 + start.length; i++) {
    const made = declare(view, { actorId: id, option: draft, picks }, TRIAL)
    if (!made.ok) return null
    if (!getUnfinishedAnswers(made.ready, open).some((r) => r.actorId === id)) return picks
    const fills = getOpenChoices(made.ready).filter((c) => c.actorId === id && !c.chosen)
    const cells = fills.filter((c) => c.part === 'cell')
    const pick = cells.length ? cells.reduce((b, c) => (threat(c.value as Coord) < threat(b.value as Coord) ? c : b)) : fills[0]
    if (!pick) return null
    picks.push({ part: pick.part, value: pick.value })
  }
  return null
}

// A walk the turn cannot end without (a coward's run): to the cell of the least immediate threat.
function getAway(view: SceneState, members: readonly string[], id: string, w: SpecWeights, unnoticed: ReadonlySet<string>): Decision | null {
  const ctx = getCtx(view, members, id, w, unnoticed)
  if (!ctx) return null
  const away = [...stepsOf(ctx)].filter((s) => s.b.surge === null).sort((x, y) => x.threat - y.threat).find((s) => s.walk.clear(s.c) && declare(view, moveIntent(id, s.walk.movement, s.c.cell, s.c.elevation), TRIAL).ok)
  return away ? { kind: 'declare', intent: moveIntent(id, away.walk.movement, away.c.cell, away.c.elevation), why: `gets away (threat ${away.threat.toFixed(1)})` } : null
}

// The limit stress action the character's turn is owed for (the user's
// ruling, 2026-11-15): a violent character attacks whatever the attack
// scores, or goes after a foe; a coward runs; every other one defaults to
// coward. Where only a rest makes an owed surge payable, it rests first.
// 'none' when the turn is no limit stress action.
function takeStressTurn(input: SeatInput, id: string, w: SpecWeights, find: Find, press: Press): Decision | null | 'none' {
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
    const ctx = getCtx(view, input.members, id, w, input.unnoticed(id))
    const plan = ctx && (planAttack(ctx, true) ?? planAggro(ctx))
    if (plan?.kind === 'attack' || plan?.kind === 'walk') return { kind: 'declare', intent: plan.intent, why: `violent: ${plan.why}` }
  }
  if (turn.action === 'coward' && getSurgeAPLeft(me) > 0) {
    const run = getAway(view, input.members, id, w, input.unnoticed(id))
    if (run) return { ...run, why: `coward: ${run.why}` }
  }
  return endTurn(input, id, find, press)
}

// The turn as the box weighed it before starting it (`specBox`), on the fight
// as starting it would leave it, kept for the turn it then takes: read again
// only where the fight the turn is taken in is not the one weighed.
type Weighed = { view: SceneState; members: readonly string[]; unnoticed: ReadonlySet<string>; plan: Plan }

const weighed = new WeakMap<SpecWeights, Map<string, Weighed>>()

function keepWeighed(w: SpecWeights, id: string, kept: Weighed): void {
  const byId = weighed.get(w) ?? new Map<string, Weighed>()
  weighed.set(w, byId)
  byId.set(id, kept)
}

function recallWeighed(w: SpecWeights, id: string, view: SceneState, members: readonly string[], unnoticed: ReadonlySet<string>): Weighed | null {
  const byId = weighed.get(w)
  const kept = byId?.get(id)
  if (!kept) return null
  byId!.delete(id)
  const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>) => a.size === b.size && [...a].every((x) => b.has(x))
  return sameSet(new Set(kept.members), new Set(members)) && sameSet(kept.unnoticed, unnoticed) && isSame(kept.view, view) ? kept : null
}

// Whether two values written as JSON are alike, parts they share passed over.
function isSame(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null || Array.isArray(a) !== Array.isArray(b)) return false
  const x = a as Record<string, unknown>
  const y = b as Record<string, unknown>
  const keys = Object.keys(x)
  return keys.length === Object.keys(y).length && keys.every((k) => Object.hasOwn(y, k) && isSame(x[k], y[k]))
}

// The turn the character holds, one action at a time, read again after each.
function takeTurn(input: SeatInput, id: string, w: SpecWeights, find: Find, press: Press): Decision | null {
  const stress = takeStressTurn(input, id, w, find, press)
  if (stress !== 'none') return stress
  const view = input.view()
  const kept = recallWeighed(w, id, view, input.members, input.unnoticed(id))
  const plan = kept ? kept.plan : planTurn(view, input.members, id, w, input.unnoticed(id), 'any')
  if (plan?.kind === 'attack' && opensAfter(view, id, plan.intent) === 'givingUp') {
    const give = input.buttons.find((b) => b.command.kind === 'edit' && argOf(b.command) === id && (b.command.args[1] as { kind: string }).kind === 'endSurge')
    const made = press(give, `gives up the surge AP left to attack: ${plan.why}`)
    if (made) return made
  }
  if (plan && plan.kind !== 'surge') return { kind: 'declare', intent: plan.intent, why: plan.why }
  if (plan?.kind === 'surge') {
    const surge = input.buttons.find((b) => b.command.kind === 'surge' && argOf(b.command) === id && b.command.args[1] === plan.surge)
    const made = press(surge, plan.why)
    if (made) return made
  }
  return endTurn(input, id, find, press) ?? getAway(view, input.members, id, w, input.unnoticed(id))
}

// spec "Decide take turn": outside a turn of its own, the seat asks for one
// as a player at the table would (combat.tex "Turn order": "first to ask,
// first to play"), for the member whose plan scores most: a turn someone else
// holds it contests for what it would do now, a turn nobody holds it starts
// for what it would do now, or on the pass that asks for anything, for what
// would better its position once no member has anything to do now.
export function specBox(w: SpecWeights): Box {
  const box: Box = (input) => {
    const { members, waits, buttons } = input
    const { find, press } = finding(buttons)
    for (const wait of waits) {
      const made = wait.for === 'answer' ? answer(input, wait.id, w, find, press)
        : wait.for === 'turn' ? takeTurn(input, wait.id, w, find, press)
        : settleWait(input, wait, find, press, w)
      if (made) return made
    }
    const view = input.view()
    const planned = plansOf(w, view)
    const holder = getTurnHolder(view)
    if (holder && !members.includes(holder) && !members.some((id) => view.contenders.includes(id))) {
      let contest: { id: string; plan: Plan } | null = null
      for (const id of members) {
        if (!find('toggleContest', id)) continue
        const plan = planned(`${id}|contest`, () => planNow(wonBy(view, id), members, id, w, input.unnoticed(id)))
        if (plan && (!contest || plan.score > contest.plan.score)) contest = { id, plan }
      }
      const made = contest && press(find('toggleContest', contest.id), `contests the turn: ${contest.plan.why}`)
      if (made) return made
    }
    let best: { id: string; begun: SceneState; plan: Plan } | null = null
    for (const pass of input.pass === 'any' ? (['immediate', 'any'] as const) : (['immediate'] as const)) {
      for (const id of members) {
        const start = find('startTurn', id)
        if (!start) continue
        const begun = trial(view, start.command)
        const unnoticed = input.unnoticed(id)
        const plan = planned(`${id}|${pass}`, () => (pass === 'immediate' ? planNow(begun, members, id, w, unnoticed) : planLater(begun, members, id, w, unnoticed)))
        if (plan && (!best || plan.score > best.plan.score)) best = { id, begun, plan }
      }
      if (best) break
    }
    const start = best && find('startTurn', best.id)
    if (best && start) {
      keepWeighed(w, best.id, { view: best.begun, members, unnoticed: input.unnoticed(best.id), plan: best.plan })
      return { kind: 'press', pick: start, why: `has something worth doing: ${best.plan.why}` }
    }
    return input.pass === 'any' ? carryOn(input, find) : { kind: 'wait', why: 'nothing to do now' }
  }
  box.remembers = true
  return box
}

// The plans weighed on a view of the fight, by member and question, so that a
// seat asked again on the same view weighs each only once.
const plansKept = new WeakMap<SpecWeights, WeakMap<SceneState, Map<string, Plan | null>>>()

function plansOf(w: SpecWeights, view: SceneState): (key: string, weigh: () => Plan | null) => Plan | null {
  const byView = plansKept.get(w) ?? new WeakMap<SceneState, Map<string, Plan | null>>()
  plansKept.set(w, byView)
  const known = byView.get(view) ?? new Map<string, Plan | null>()
  byView.set(view, known)
  return (key, weigh) => {
    if (!known.has(key)) known.set(key, weigh())
    return known.get(key)!
  }
}
