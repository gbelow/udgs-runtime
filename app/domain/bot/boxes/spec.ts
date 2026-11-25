import type { CampaignCharacter, Coord, SurgeKind } from '../../types'
import type { ActionDraft, Degree, SceneState } from '../../scene/types'
import type { SceneCommand } from '../../scene/commands/registry'
import { getSurgeAPLeft, getSurgeRecovery, getSurgeSTA } from '../../character/rules/surge'
import { getRecoveredSTA } from '../../character/rules/characteristics'
import { getAction, getOpenAction } from '../../scene/rules/log'
import { getBlastOf, type BlastShape } from '../../scene/rules/explosion'
import { getCombinedOf, isCombinedLanding } from '../../scene/rules/combinedMove'
import { getAvailableActions, getUnfinishedAnswers } from '../../scene/rules/options'
import { getOpenChoices } from '../../scene/projections/choices'
import { cellNumber, coordKey, distance, extentCells, sameCell } from '../../scene/rules/board/geometry'
import { getEyes, getEyesToward, seesAcross } from '../../scene/rules/board/board'
import { getStressDue, getStressSocial, getStressTurn } from '../../scene/rules/stress'
import { getTurnHolder, hasAgreedToEnd } from '../../scene/rules/turn'
import { isCollapsed } from '../../scene/rules/situational'
import { isDown } from '../../scene/rules/fight'
import { ROUND_AP } from '../../tables'
import { declare, type Intent, type Pick } from '../declare'
import { getWorstDrawnAlong, getWorstDrawnAt } from '../approach'
import { getSides } from '../table'
import { getPair, type PairAttack, type PairDefence } from '../pairs'
import { getBlastHarm, getEscapedBlast, getReflexCost, getReflexOdds, withBlock, withEscape } from '../blast'
import { getDefenders, getProtections } from '../protect'
import { getAnswer, getEvaded, getHarmAdded, getMet, getUndefendedHarm } from '../harm'
import { cellOf, getAttackRoute, getBelievedAP, getMeans, getPaceAt, getStrikeCells, getTeam } from '../threat'
import { REST_TUNING } from '../rest'
import { getSTAHarm, type SpecWeights } from '../cost'
import { getAPWorth, getCompany, getEvadedThreat, getExposed, getExposure, getExposureLimit, getFarThreat, getThreat, lineOfFire, PEEK_BLOCKS, SHOT_GAP, type Exposure, type Guard } from '../threatMap'
import { argOf, arrivedAt, attackIntent, attackName, canPay, getBudgets, getCollapsedCare, getKnownAttack, getOpenedWalks, getRunBlock, getWalkBudgets, getWalks, heldAP, isWalkPaid, moveIntent, opensAfter, ownAP, RUN_BLOCKS, runs, sameDraft, takesOpenedWalk, takesWalk, trial, TRIAL, wonBy, type AttackCell, type Budget, type Walk, type WalkCell } from '../moves'
import { carryOn, endTurn, finding, settleWait, type Find, type Press } from './nearest'
import type { Box, Decision, Pass, SeatInput } from '../decision'
import { getAbsentFoes, type Notes } from '../memory'

// The box instructions/bot-spec.md describes, read section by section:
//
// - a turn is asked for (or anyone else's contested) for what the character
//   would do now: an attack, or an escape where its exposure is too much,
//   whichever scores more, above nothing; once the turn is its own it asks
//   that again after every action, then how to better its position
//   (Tactical, towards the target its strategy picked for the round; Search
//   with no foe the side knows of), and with nothing worth doing once no foe
//   can still act this round, Tactical once more with the AP left out of its
//   cost, before it ends the turn and agrees to end the round. An action
//   decided is played through as one block (the user's ruling, 2026-11-23):
//   the surge that pays for it, the walk and the attack it is made of, each
//   declared in turn without weighing it again, the next turn asked for to go
//   on with it where the turn is lost to a contest, and decided afresh only
//   once the rest of it can no longer be done or the round is over; a reaction
//   is weighed when it is asked for;
// - an attack scores the harm it leaves against the defence the target's
//   Defense rule picks, what that defence costs the target, the target's
//   threat on the character's side and the exposure it sheds, less the STA it
//   spends and the worst opportunity attack it draws (spec "Attacking");
// - attacked, it defends by the Defense rule (harm.ts `getAnswer`), and defends
//   an ally more exposed than itself by the same rule (`protect`); in an
//   explosion, it makes its reflex and escapes where the harm, the STA and the
//   exposure are least, blocks it, or does nothing (spec "Avoid explosion"); drawn an
//   opportunity attack, it makes it where it scores above nothing as an attack
//   does;
// - of the strategies only Attack is played (the user's ruling, 2026-11-24).
//
// The rest (morale, concentration, landing what it rolled with a hit's
// overflow spent as `getBestSpend` spends it, the round's rest step) it plays
// as the nearest box does.

export const SPEC_WEIGHTS: SpecWeights = { ...REST_TUNING, AP: 1.3, STA: 3, IL: 2, bleed: 8, caution: 5, courage: 0.75, aggro: 1, aggressivity: 0.5, search: 4, solitude: 5 }

// An action decided: its first step, and what is declared after it (`then`).
type Plan = (
  | { kind: 'attack' | 'walk' | 'care'; intent: Intent; score: number; why: string }
  | { kind: 'surge'; surge: SurgeKind; score: number; why: string }
) & { then?: readonly Intent[] }

// What an AP is worth to the character at a place (spec "Cost"), and the harm
// that gets through to it there holding so much AP (`getExposed`), as the
// fight stands.
type Place = { worth: number; exposed: (AP: number) => number }

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
  // the character's target this round (spec "Strategies", `noteTargets`), null for none
  target: string | null
  left: Guard
  // the AP of its own it holds, a surge's AP dropped at the turn's end
  held: number
  budgets: Budget[]
  at: (cell: Coord | null) => Place
  // its potential exposure there, at a fresh round's AP (spec "Tactical")
  later: (cell: Coord | null) => number
  // the potential exposure too much for it (spec "Escape")
  limit: number
  picks: Map<string, TargetPick>
  rated: Map<string, { worth: number; threat: number }>
  drawn: Map<WalkCell, number>
  fired: Map<string, number>
}

function kept<T>(read: (cell: Coord | null) => T): (cell: Coord | null) => T {
  const known = new Map<string, T>()
  return (cell) => {
    const key = cell ? String(cellNumber(cell)) : ''
    let made = known.get(key)
    if (made === undefined) known.set(key, (made = read(cell)))
    return made
  }
}

function getCtx(view: SceneState, members: readonly string[], id: string, w: SpecWeights, unnoticed: ReadonlySet<string>, target: string | null = null): Ctx | null {
  const me = view.characters[id]
  if (!me) return null
  const here = cellOf(view, id)
  const foes = getSides(view, members).foes.filter((f) => cellOf(view, f) !== null)
  const left = { AP: me.resources.AP, STA: me.resources.STA }
  return {
    view, members, id, w, me, here, foes, target, left,
    held: Math.max(0, left.AP - getSurgeAPLeft(me)),
    targets: foes.filter((f) => !unnoticed.has(f)),
    team: getTeam(view, members).filter((t) => !isDown(view, t)),
    budgets: getBudgets(view, id),
    at: kept((cell) => {
      const on = getExposure(view, members, foes, id, 'immediate', w, [{ id, at: cell }])
      const company = getCompany(view, id, cell, w)
      return { worth: getAPWorth(on, company, left.AP), exposed: (AP) => getExposed(on, company, AP) }
    }),
    later: kept((cell) => {
      const on = getExposure(view, members, foes, id, 'potential', w, [{ id, at: cell }])
      return getExposed(on, getCompany(view, id, cell, w), ROUND_AP)
    }),
    limit: getExposureLimit(me, w),
    picks: new Map(),
    rated: new Map(),
    drawn: new Map(),
    fired: new Map(),
  }
}

// spec "Cost": of an action that ends at `place`, spending `AP` of its own.
const costAt = (ctx: Ctx, place: Place, AP: number, STA: number, free = false): number => (free ? 0 : AP * place.worth) + getSTAHarm(STA, ctx.me.injuries.bleed, ctx.w)

// The AP of its own left to the character by an action paid by `b`, `walkAP` of
// the `spent` walked, and how much less harm gets through to it at `place`
// with that than where it stands with the AP it holds.
const leftAfter = (ctx: Ctx, b: Budget, walkAP: number, spent: number): number => Math.max(0, ctx.held - ownAP(ctx.view, ctx.id, b, walkAP, spent))
const getShed = (ctx: Ctx, place: Place, left: number): number => ctx.at(ctx.here).exposed(ctx.held) - place.exposed(left)

const meansOf = (ctx: Ctx) => (f: string) => getMeans(ctx.view.characters[f], false, ctx.w)
const harmOf = (ctx: Ctx) => (attack: PairAttack, gap: number) => getUndefendedHarm(attack, gap, ctx.w)

// spec "Attacking": the worst opportunity attack a walk draws, and the worst
// a shot fired from `at` does.
function drawnOn(ctx: Ctx, c: WalkCell, running: boolean, from: Coord | null = ctx.here): number {
  const known = ctx.drawn.get(c)
  if (known !== undefined) return known
  const made = getWorstDrawnAlong(ctx.view, ctx.id, from, c.path, running, ctx.foes, meansOf(ctx), harmOf(ctx))
  ctx.drawn.set(c, made)
  return made
}

function firedFrom(ctx: Ctx, at: Coord | null): number {
  const key = at ? coordKey(at) : ''
  const known = ctx.fired.get(key)
  if (known !== undefined) return known
  const made = getWorstDrawnAt(ctx.view, ctx.id, at, ctx.foes, meansOf(ctx), harmOf(ctx))
  ctx.fired.set(key, made)
  return made
}

// What the target of `attack`, `gap` metres away, is believed to do (spec
// "Defense"): the harm left, counting of the bleed only what it adds over what
// the target bleeds already (`getHarmAdded`), and what the defence costs the
// target (spec "Cost", read for it).
type TargetPick = { harm: number; defence: string; cost: number }

function pickOf(ctx: Ctx, attack: PairAttack, index: number, gap: number, foe: string): TargetPick {
  const key = `${foe}|${index}|${gap}`
  const known = ctx.picks.get(key)
  if (known) return known
  const { view, w } = ctx
  const target = view.characters[foe]
  const answer = getAnswer(attack, gap, getMeans(target, false, w), w)
  const met = getMet(attack, answer)
  const pick: TargetPick = {
    harm: met ? getHarmAdded(attack, met, gap, target.injuries.bleed, w) : 0,
    defence: answer.defence?.draft?.kind ?? 'no defence',
    cost: answer.AP * rate(ctx, foe).worth + getSTAHarm(answer.STA, target.injuries.bleed, w),
  }
  ctx.picks.set(key, pick)
  return pick
}

// What an AP is worth to `foe` where it stands, exposed to the character's
// side (spec "Cost"), and the target threat of spec "Attacking": the harm its
// immediate threat leaves each of the side it can hit, once answered by the
// Defense rule, on average.
function rate(ctx: Ctx, foe: string): { worth: number; threat: number } {
  const known = ctx.rated.get(foe)
  if (known) return known
  const { view, members, w, team } = ctx
  const c = view.characters[foe]
  const worth = getAPWorth(getExposure(view, members, team, foe, 'immediate', w), getCompany(view, foe, cellOf(view, foe), w), getBelievedAP(c, false, w))
  const hits = team.flatMap((t) => {
    const guard = getMeans(view.characters[t], members.includes(t), w)
    const { attack, gap, times } = getThreat(view, members, foe, t, 'immediate', w)
    return attack ? [times * getAnswer(attack, gap, guard, w).harm] : []
  })
  const rated = { worth, threat: hits.length ? hits.reduce((sum, h) => sum + h, 0) / hits.length : 0 }
  ctx.rated.set(foe, rated)
  return rated
}

// The cells an attack is made from: where the character stands (`standing`)
// or any the walk takes it to, where `clear` says the attack meets its
// target; a shot only as far as the peek goes (spec "Peek attack").
function getSpots(ctx: Ctx, attack: PairAttack, walk: Walk | null, at: Coord | null, standing: boolean, clear: (c: Coord) => boolean): AttackCell[] {
  const { view, id, here } = ctx
  const stood: AttackCell[] = standing ? [{ cell: here, AP: 0, STA: 0, path: [] }] : []
  if (!here || !at) return stood
  const meets = (c: Coord) => distance(c, at) <= attack.reach && clear(c)
  const pace = getPaceAt(view, id, 'walk')
  const peeks = attack.kind === 'shoot'
  const walked = !walk || (peeks && walk.movement !== 'walk') ? [] : walk.cells.filter((c) => (!peeks || (pace !== null && c.AP <= PEEK_BLOCKS * pace.AP)) && !sameCell(c.cell, here) && meets(c.cell))
  return [...stood.filter(() => meets(here)), ...walked]
}

// spec "Attacking": of every attack on every foe the character notices, from
// where it stands or any cell of a walk that reaches (`getSpots`), the one
// scoring most, if above nothing (or whatever it scores, when `compelled`).
// The surges that may pay for it (the user's rulings, 2026-11-20): the
// movement surge only for a run of at least RUN_BLOCKS blocks, the combat
// surge only for an attack the character's own AP cannot pay for, the focus
// surge only for the shot it opens.
//
// Of the PEEKS_WEIGHED best shots paid from the character's own AP, each is
// weighed again with a walk back after it (spec "Peek attack"): the cell the AP
// it leaves reaches within the peek where it scores most. The walk is part of
// the block.
const PEEKS_WEIGHED = 8

type Weighed = { score: number; settle: () => Plan | null }

function planAttack(ctx: Ctx, compelled = false, on: readonly string[] = ctx.targets): Plan | null {
  const { view, id, w, me, here, budgets } = ctx
  const runBlock = getRunBlock(view, id)
  const focusSTA = getSurgeSTA('focus')(me) + getRecoveredSTA(me, me.resources.STA, getSurgeRecovery('recovery')(me)) - me.resources.STA
  const pace = getPaceAt(view, id, 'walk')
  const rank = (b: Budget) => (b.surge === null ? 0 : b.surge === 'movement' ? 1 : 2)
  const order = [...budgets].sort((a, b) => rank(a) - rank(b))
  // the attacks (by foe and row) paid for without the combat surge
  const paid = new Set<string>()
  const weighed: (Weighed & { peek: (() => Weighed | null) | null })[] = []
  for (const b of order) {
    if (b.surge !== null && me.resources.STA <= 0) continue
    const walks = b.surge === 'movement' ? getWalks(b.view, id, 'run') : getWalks(b.view, id)
    for (const [n, walk] of (walks.length ? walks : [null]).entries()) for (const foe of on) {
      const target = view.characters[foe]
      const at = cellOf(view, foe)
      if (!target) continue
      const pair = getPair(me, target)
      for (let i = 0; i < pair.length; i++) {
        const attack = pair[i]
        const key = `${foe}|${i}`
        if (!attack.opens.action || (b.surge === 'combat' && paid.has(key))) continue
        const needsFocus = attack.needsFocus && me.usedSurge !== 'focus'
        if (needsFocus && (me.usedSurge !== null || b.surge !== null)) continue
        const fires = attack.kind === 'shoot' && view.board && at ? lineOfFire(view.board, getEyes(view, id, foe)) : null
        const clear = fires && at ? (c: Coord) => fires(c, at) : getStrikeCells(view, id, foe, at, attack.reach)
        for (const spot of getSpots(ctx, attack, walk, at, n === 0 && b.surge !== 'movement', clear)) {
          const { cell, AP, STA } = spot
          if (b.surge === 'movement' && (runBlock === null || AP < RUN_BLOCKS * runBlock)) continue
          const spent = AP + attack.cost.AP
          const STAspent = STA + attack.cost.STA
          if (!canPay(b, AP, attack.cost.AP) || STAspent > b.STA) continue
          if (b.surge !== 'combat') paid.add(key)
          const gap = cell && at ? distance(cell, at) : 0
          if (getUndefendedHarm(attack, gap, w) <= 0) continue
          const fromHere = !here || !cell || sameCell(cell, here)
          const pick = pickOf(ctx, attack, i, gap, foe)
          const threat = w.aggressivity * rate(ctx, foe).threat
          const drew = Math.max(fromHere ? 0 : drawnOn(ctx, spot as WalkCell, runs(walk)), attack.kind === 'shoot' ? firedFrom(ctx, cell) : 0)
          const scored = (end: Coord | null, moreAP: number, moreSTA: number, leaving: number) => {
            const shed = getShed(ctx, ctx.at(end), leftAfter(ctx, b, AP + moreAP, spent + moreAP))
            const STAharm = getSTAHarm(STAspent + moreSTA + b.surgeSTA + (needsFocus ? focusSTA : 0), me.injuries.bleed, w)
            const most = Math.max(drew, leaving)
            const score = pick.harm + pick.cost + threat + shed - STAharm - most
            const why = () => `(${attackName(attack)}: harm ${pick.harm.toFixed(1)} against ${pick.defence} + its cost ${pick.cost.toFixed(1)} + threat from it ${threat.toFixed(1)} + exposure shed ${shed.toFixed(1)} - STA ${STAharm.toFixed(1)} - drawn ${most.toFixed(1)} = ${score.toFixed(1)})`
            return { score, why }
          }
          const alone = scored(cell, 0, 0, 0)
          const settleWith = (score: number, why: () => string, after: readonly Intent[]) => (): Plan | null => {
            const movement = walk?.movement
            if (!fromHere && !walk?.clear(spot as WalkCell)) return null
            const next = fromHere ? attackIntent(id, attack, foe) : movement && spot.elevation !== undefined && cell ? moveIntent(id, movement, cell, spot.elevation) : null
            const surge = needsFocus ? 'focus' : b.surge
            const paidView = needsFocus ? trial(view, { kind: 'surge', args: [id, 'focus'] }) : b.view
            if (!next || (!fromHere && !takesWalk(paidView, id, next, AP, STA))) return null
            const strike = attackIntent(id, attack, foe)
            const opens = opensAfter(arrivedAt(paidView, id, cell, AP, STA), id, strike)
            if (!opens || (opens === 'givingUp' && attack.cost.AP > heldAP(b, AP))) return null
            if (surge) return { kind: 'surge', surge, score, why: surge === 'focus' ? `focuses to shoot: ${why()}` : `makes the ${surge} surge: ${why()}`, then: fromHere ? [strike, ...after] : [next, strike, ...after] }
            if (!fromHere) return { kind: 'walk', intent: next, score, why: `walks to attack: ${why()}`, then: [strike, ...after] }
            return opensAfter(view, id, next) ? { kind: 'attack', intent: next, score, why: why(), then: [...after] } : null
          }
          const named = `${attack.kind}s ${target.name}`
          const peek = (): Weighed | null => {
            const from = cell ?? here
            const back = from ? getWalks(fromHere ? view : arrivedAt(view, id, cell, AP, STA), id).find((x) => x.movement === 'walk') : undefined
            if (!from || !back || !pace) return null
            let best: Weighed | null = null
            for (const r of back.cells) {
              if (sameCell(r.cell, from) || r.AP > PEEK_BLOCKS * pace.AP || !canPay(b, AP + r.AP, attack.cost.AP) || STAspent + r.STA > b.STA) continue
              const { score, why } = scored(r.cell, r.AP, r.STA, drawnOn(ctx, r, false, from))
              if ((best && score <= best.score) || !back.clear(r)) continue
              best = { score, settle: settleWith(score, () => `${named} and walks to cover ${why()}`, [moveIntent(id, back.movement, r.cell, r.elevation)]) }
            }
            return best
          }
          weighed.push({ score: alone.score, settle: settleWith(alone.score, () => `${named} ${alone.why()}`, []), peek: attack.kind === 'shoot' && b.surge === null ? peek : null })
        }
      }
    }
  }
  weighed.sort((x, y) => y.score - x.score)
  const peeked = weighed.filter((x) => x.peek).slice(0, PEEKS_WEIGHED).flatMap((x) => x.peek?.() ?? [])
  for (const { score, settle } of [...weighed, ...peeked].sort((x, y) => y.score - x.score)) {
    if (score <= 0 && !compelled) break
    const plan = settle()
    if (plan) return plan
  }
  return null
}

// A walk weighed: the cell, the walk and the budget paying for it, and the place it ends at.
type Step = { b: Budget; walk: Walk; c: WalkCell } & Place

// Every walk the character could make this turn (`getWalkBudgets`).
function getSteps(ctx: Ctx): Step[] {
  const { view, id, here } = ctx
  const steps: Step[] = []
  if (!here) return steps
  for (const { b, walks } of getWalkBudgets(view, id, ctx.budgets)) for (const walk of walks) for (const c of walk.cells) {
    if (!sameCell(c.cell, here) && isWalkPaid(view, id, b, c.AP)) steps.push({ b, walk, c, ...ctx.at(c.cell) })
  }
  return steps
}

// The walks weighed once per view, character and side, whichever plan asks first.
const stepsKept = new WeakMap<SpecWeights, WeakMap<SceneState, Map<string, Step[]>>>()

function stepsOf(ctx: Ctx): Step[] {
  const byView = stepsKept.get(ctx.w) ?? new WeakMap<SceneState, Map<string, Step[]>>()
  stepsKept.set(ctx.w, byView)
  const known = byView.get(ctx.view) ?? new Map<string, Step[]>()
  byView.set(ctx.view, known)
  const key = `${ctx.id}|${ctx.members.join(',')}`
  let steps = known.get(key)
  if (!steps) known.set(key, (steps = getSteps(ctx)))
  return steps
}

// A step as a plan: the surge that pays for it first, if any; null where the
// table does not take the walk at the price it was weighed at.
function stepPlan(ctx: Ctx, s: Step, score: number, why: string): Plan | null {
  const intent = moveIntent(ctx.id, s.walk.movement, s.c.cell, s.c.elevation)
  if (s.b.surge) return { kind: 'surge', surge: s.b.surge, score, why: `makes the ${s.b.surge} surge: ${why}`, then: [intent] }
  return takesWalk(ctx.view, ctx.id, intent, s.c.AP, s.c.STA) ? { kind: 'walk', intent, score, why } : null
}

// Of `steps` by what each gains less what it costs and the worst opportunity attack
// it draws, the best that walks clear and that `settle` takes, above nothing.
// What a walk draws only takes from its score, so the steps are read best
// first and no further than the best one found.
function bestStep<T extends { score: number }>(ctx: Ctx, steps: readonly Step[], gainOf: (s: Step) => number, costOf: (s: Step) => number, settle: (s: Step, score: number, told: string) => T | null): T | null {
  const weighed = steps.flatMap((s) => {
    const gain = gainOf(s)
    const cost = costOf(s)
    return gain - cost <= 0 ? [] : [{ s, gain, cost, net: gain - cost }]
  })
  let best: T | null = null
  for (const { s, gain, cost, net } of weighed.sort((x, y) => y.net - x.net)) {
    const least = best?.score ?? 0
    if (net <= least) break
    const drew = drawnOn(ctx, s.c, runs(s.walk))
    if (net - drew <= least || !s.walk.clear(s.c)) continue
    best = settle(s, net - drew, `${gain.toFixed(1)} better - cost ${cost.toFixed(1)} - drawn ${drew.toFixed(1)}: ${(net - drew).toFixed(1)}`) ?? best
  }
  return best
}

// spec "Escape": only from a potential exposure above `limit`, to wherever
// the exposure it sheds less the STA of the walk and what it draws is most.
// The potential exposure reads a fresh round's AP, so that spending AP is no
// reason to run (the user's ruling, 2026-11-24).
function planEscape(ctx: Ctx): Plan | null {
  const { here, limit } = ctx
  const exposed = here ? ctx.later(here) : 0
  if (exposed <= limit) return null
  const shed = (s: Step) => getShed(ctx, s, leftAfter(ctx, s.b, s.c.AP, s.c.AP))
  const STAharm = (s: Step) => getSTAHarm(s.c.STA + s.b.surgeSTA, ctx.me.injuries.bleed, ctx.w)
  return bestStep(ctx, stepsOf(ctx), shed, STAharm, (s, score, told) => stepPlan(ctx, s, score, `escapes (${s.walk.movement}, potential exposure ${exposed.toFixed(1)} over ${limit.toFixed(1)}, ${told})`))
}

// What the box notes for each member: its target with the round it was picked
// in (`noteTargets`), and the block it is playing through, null for none.
type Targeted = { round: number; target: string }
type Note = Targeted | Block | null
const targetKey = (id: string) => `target|${id}`
const blockKey = (id: string) => `block|${id}`

// spec "Strategies", "Attack" (the only one played): each member's target,
// picked once a round and again once it is down or the side no longer knows
// where it stands: the foe its immediate threat is most on, and with none, the
// one it would harm most answering with an evasion, where they stand playing no
// part. Its block is kept with it through the round it was decided in.
function noteTargets(previous: Notes | undefined, view: SceneState, members: readonly string[], w: SpecWeights): Notes {
  const foes = getSides(view, members).foes.filter((f) => cellOf(view, f) !== null && !isCollapsed(view, view.characters[f]))
  const notes: Record<string, Note> = {}
  for (const id of members) {
    const block = getBlock(previous, view, id)
    if (block) notes[blockKey(id)] = block
    const me = view.characters[id]
    if (!me || !foes.length) continue
    const noted = previous?.[targetKey(id)] as Targeted | undefined
    const kept = noted?.round === view.round ? noted.target : null
    const most = (read: (f: string) => number) => foes.map((f) => ({ f, n: read(f) })).reduce((b, x) => (x.n > b.n ? x : b))
    const threatened = kept && foes.includes(kept) ? null : most((f) => getThreat(view, members, id, f, 'immediate', w).threat)
    const target = !threatened ? kept : threatened.n > 0 ? threatened.f : most((f) => getPair(me, view.characters[f]).reduce((n, a) => (a.opens.action ? Math.max(n, getEvaded(a, a.kind === 'shoot' ? SHOT_GAP : a.reach, w).harm) : n), 0)).f
    if (target !== null) notes[targetKey(id)] = { round: view.round, target }
  }
  return notes
}

const getTarget = (notes: Notes, id: string): string | null => (notes[targetKey(id)] as Targeted | undefined)?.target ?? null

// spec "Tactical": a cell's Score, `aggro` times the character's potential
// threat on its target from there, as an evasion of it leaves it, whatever
// that costs (the user's ruling, 2026-11-25), less its potential exposure there.
// Where it has none on the target from where it stands, the target is read
// nearer (spec "Strategies", "Attack", `getFarThreat`), along the way to it.
function getTacticalScore(ctx: Ctx, target: string, here: Coord): (cell: Coord) => number {
  const { view, members, id, w } = ctx
  const threatFrom = (cell: Coord, by?: (r: Exposure) => number) => getThreat(view, members, id, target, 'potential', w, [{ id, at: cell }], by)
  const mine = (cell: Coord) => getEvadedThreat(threatFrom(cell, getEvadedThreat))
  const far = threatFrom(here).threat > 0 ? null : getFarThreat(view, id, target, w)
  const way = new Map((far ? (getAttackRoute(view, id, target)?.path ?? []) : []).map((cell, i) => [cellNumber(cell), i + 1]))
  const threat = (cell: Coord) => {
    if (!far) return mine(cell)
    const walked = sameCell(cell, here) ? 0 : way.get(cellNumber(cell))
    return Math.max(mine(cell), walked === undefined ? 0 : far(walked))
  }
  return (cell) => w.aggro * threat(cell) - ctx.later(cell)
}

// spec "Tactical": towards the character's target, to the cell whose Score
// betters the one where it stands by the most over the walk's Cost and what it
// draws, if above nothing. `free` leaves the AP out of the cost (spec "Decide
// take turn").
function planTactical(ctx: Ctx, free: boolean): Plan | null {
  return pickTactical(ctx, stepsOf(ctx), free, (s, score, why) => stepPlan(ctx, s, score, why))
}

function pickTactical<T extends { score: number }>(ctx: Ctx, steps: readonly Step[], free: boolean, settle: (s: Step, score: number, why: string) => T | null): T | null {
  const { view, here, target } = ctx
  if (!here || !target || !ctx.foes.includes(target)) return null
  const score = getTacticalScore(ctx, target, here)
  const stay = score(here)
  const name = view.characters[target]?.name ?? target
  const cost = (s: Step) => costAt(ctx, s, ownAP(view, ctx.id, s.b, s.c.AP, s.c.AP), s.c.STA + s.b.surgeSTA, free)
  return bestStep(ctx, steps, (s) => score(s.c.cell) - stay, cost, (s, net, told) => settle(s, net, `repositions${free ? ' before the round ends' : ''} towards ${name} (${s.walk.movement}, score ${told})`))
}

// spec "Avoid explosion": the walks of an escape made holding `AP`, each with
// the harm the explosion does where it ends, the exposure it adds and the STA
// it costs, the least first; only those that score less than standing still,
// which takes the harm where it stands.
function getEscapes(ctx: Ctx, view: SceneState, blast: BlastShape, AP: number): { s: Step; harm: number; score: number }[] {
  const { id, here, w } = ctx
  const walks = getOpenedWalks(view, id)
  if (!walks || !here) return []
  const b = getBudgets(view, id)[0]
  const exposed = ctx.at(here).exposed(AP)
  const stay = getBlastHarm(view, blast, id, null, w)
  return walks.flatMap((walk) => walk.cells.flatMap((c) => {
    if (sameCell(c.cell, here) || !canPay(b, c.AP, 0) || c.STA > b.STA) return []
    const harm = getBlastHarm(view, blast, id, c.cell, w)
    const s: Step = { b, walk, c, ...ctx.at(c.cell) }
    const score = harm + s.exposed(Math.max(0, AP - ownAP(view, id, b, c.AP, c.AP))) - exposed + getSTAHarm(c.STA, ctx.me.injuries.bleed, w)
    return score < stay ? [{ s, harm, score }] : []
  })).sort((x, y) => x.score - y.score)
}

// spec "Avoid explosion": the Score of the answer `draft` to the explosion
// open in `view`, made holding `AP` of the character's own and `paid` of its
// cost paid by a surge: the harm expected over its test's degrees (a block's
// once the shield absorbs; a reflex's the Score of the best escape the degree
// opens, or standing still where none beats it), and the exposure the answer
// itself adds and the STA it costs. Null where the table does not take it.
function getAnswerScore(view: SceneState, members: readonly string[], id: string, draft: ActionDraft, AP: number, paid: number, w: SpecWeights): number | null {
  const declared = trial(view, { kind: 'react', args: [id, draft, null] })
  const open = getOpenAction(declared)
  const ctx = getCtx(view, members, id, w, new Set())
  if (declared === view || open?.kind !== 'explosion' || !ctx) return null
  const odds = getReflexOdds(declared, open, id)
  const cost = getReflexCost(declared, open, id)
  if (!odds || !cost) return null
  const left = Math.max(0, AP - Math.max(0, cost.AP - paid))
  const blast = getBlastOf(declared, open)
  const stay = getBlastHarm(declared, blast, id, null, w)
  const harmAt = (degree: Degree): number => {
    if (draft.kind === 'blockExplosion') return getBlastHarm(withBlock(declared, open, id, degree), blast, id, null, w, open.id)
    const escape = withEscape(declared, open, id, degree)
    return (escape ? getEscapes(ctx, escape, blast, left).find((e) => e.s.walk.clear(e.s.c))?.score : undefined) ?? stay
  }
  const harm = (Object.keys(odds) as Degree[]).reduce((sum, degree) => sum + (odds[degree] > 0 ? odds[degree] * harmAt(degree) : 0), 0)
  const place = ctx.at(ctx.here)
  return harm + place.exposed(left) - place.exposed(AP) + getSTAHarm(cost.STA, ctx.me.injuries.bleed, w)
}

// spec "Avoid explosion": the answer to an explosion, whichever scores least:
// its reflex, a block with each shield, or nothing, which takes the harm where
// it stands. A surge is made first only where what it answers with then scores
// less, its STA and the recovery it gives up counted: the movement surge for
// its reflexes (combat.tex "Reflex"), any other only where nothing could be
// paid for without it.
function avoid(input: SeatInput, id: string, w: SpecWeights, find: Find, press: Press): Decision | null {
  const view = input.view()
  const open = getOpenAction(view)
  const me = view.characters[id]
  if (open?.kind !== 'explosion' || !me) return null
  const stay = getBlastHarm(view, getBlastOf(view, open), id, null, w)
  if (stay <= 0) return press(find('pass', id), 'lets the explosion come: it would do it no harm')
  const held = Math.max(0, me.resources.AP - getSurgeAPLeft(me))
  const bestIn = (state: SceneState, paid: number) => {
    const root = getOpenAction(state)
    const drafts = getAvailableActions(state, id).flatMap((o) => (root && o.available && o.reactionTo === root.id && o.surge === null && (o.draft.kind === 'avoidExplosion' || o.draft.kind === 'blockExplosion') ? [o.draft] : []))
    const scored = drafts.flatMap((draft) => {
      const score = getAnswerScore(state, input.members, id, draft, held, paid, w)
      return score === null ? [] : [{ draft, score }]
    })
    return scored.reduce<(typeof scored)[number] | null>((b, x) => (!b || x.score < b.score ? x : b), null)
  }
  const plain = bestIn(view, getSurgeAPLeft(me))
  const least = Math.min(stay, plain?.score ?? stay)
  let surging: { button: SeatInput['buttons'][number]; score: number; why: string } | null = null
  for (const surge of me.resources.STA > 0 ? input.buttons.filter((b) => b.command.kind === 'surge' && argOf(b.command) === id) : []) {
    const kind = surge.command.args[1] as SurgeKind
    if (plain && kind !== 'movement') continue
    const surged = trial(view, surge.command)
    const made = surged.characters[id]
    const best = surged !== view && made?.usedSurge === kind ? bestIn(surged, getSurgeAPLeft(made)) : null
    if (!best || !made) continue
    const recovered = getRecoveredSTA(me, me.resources.STA, getSurgeRecovery('recovery')(me)) - me.resources.STA
    const cost = getSTAHarm(me.resources.STA - made.resources.STA + recovered, me.injuries.bleed, w)
    const score = best.score + cost
    if (score >= least || (surging && score >= surging.score)) continue
    surging = { button: surge, score, why: `makes the ${kind} surge to answer the explosion with ${best.draft.kind} (score ${least.toFixed(1)} to ${score.toFixed(1)}, the surge ${cost.toFixed(1)} of it)` }
  }
  const pressed = surging && press(surging.button, surging.why)
  if (pressed) return pressed
  if (!plain || plain.score >= stay) return press(find('pass', id), `takes the explosion (harm ${stay.toFixed(1)}${plain ? `, ${plain.draft.kind} scores ${plain.score.toFixed(1)}` : ''})`)
  return { kind: 'declare', intent: { actorId: id, option: plain.draft, picks: [] }, why: `answers the explosion with ${plain.draft.kind} (harm ${stay.toFixed(1)} where it stands, score ${plain.score.toFixed(1)})` }
}

// The move a reaction has opened for the character (combat.tex "Evasion": the
// reflex's AP "is used to move and does not need to be spent again"), made as
// Tactical moves (the user's ruling, 2026-11-23), at the Cost of what the
// reaction has not paid. A surge's AP left is lost whether it moves or not.
// The move a defence of an ally is made after goes to the cell of the least
// exposure the defence can be made from. Null with no such move open, or none
// worth making.
function stepOpened(input: SeatInput, id: string, w: SpecWeights): Decision | null {
  const view = input.view()
  const walks = getOpenedWalks(view, id)
  const ctx = walks && getCtx(view, input.members, id, w, input.unnoticed(id), getTarget(input.notes, id))
  if (!walks || !ctx?.here) return null
  const { here, budgets } = ctx
  const b = budgets[0]
  const open = getOpenAction(view)
  const opener = open?.spawnedBy ? getAction(view, open.spawnedBy) : null
  const guarding = opener && 'recipe' in opener && getCombinedOf(ctx.me, opener)?.recipe.order === 'before'
  const blast = open?.kind === 'move' ? getEscapedBlast(view, open) : null
  if (blast) {
    const escape = getEscapes(ctx, view, blast, ctx.held).find((e) => e.s.walk.clear(e.s.c) && takesOpenedWalk(view, id, moveIntent(id, e.s.walk.movement, e.s.c.cell, e.s.c.elevation), e.s.c.AP, e.s.c.STA))
    return escape ? { kind: 'declareOpened', picks: moveIntent(id, escape.s.walk.movement, escape.s.c.cell, escape.s.c.elevation).picks, why: `escapes the explosion (${escape.s.walk.movement}, harm ${getBlastHarm(view, blast, id, null, w).toFixed(1)} to ${escape.harm.toFixed(1)}, score ${escape.score.toFixed(1)})` } : null
  }
  const steps = walks.flatMap((walk) => walk.cells.flatMap((c): Step[] => (sameCell(c.cell, here) || !canPay(b, c.AP, 0) || c.STA > b.STA ? [] : [{ b, walk, c, ...ctx.at(c.cell) }])))
  const intentOf = (s: Step) => moveIntent(id, s.walk.movement, s.c.cell, s.c.elevation)
  if (guarding && open?.kind === 'move') {
    const landing = steps.filter((s) => isCombinedLanding(view, open, s.c.cell) && s.walk.clear(s.c)).sort((x, y) => x.exposed(ctx.held) - y.exposed(ctx.held) || x.c.AP - y.c.AP).find((s) => takesOpenedWalk(view, id, intentOf(s), s.c.AP, s.c.STA))
    return landing ? { kind: 'declareOpened', picks: intentOf(landing).picks, why: `steps in to defend (${landing.walk.movement}, exposure ${landing.exposed(ctx.held).toFixed(1)})` } : null
  }
  const picked = pickTactical(ctx, steps, false, (s, score, why) => {
    const intent = intentOf(s)
    return takesOpenedWalk(view, id, intent, s.c.AP, s.c.STA) ? { score, why, picks: intent.picks } : null
  })
  return picked && { kind: 'declareOpened', picks: picked.picks, why: `with the move its reaction opened, ${picked.why}` }
}

// spec "Search": with no foe the side knows of, a walk of at most `search` AP
// spent this round towards the nearest cell nobody of its side sees, never
// ending more than `solitude` metres from the nearest ally unless it comes
// nearer one. A foe the side knows of is gone after by Tactical.
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

// Whether the round is as good as over for the character's foes, those it
// knows to be about and not where among them (the user's ruling): every one
// has agreed to end it or shows its AP in the lowest third, which a spent foe
// shows and is as little as a seat is told, so that what the character's AP
// would defend this round is next to nothing.
function isRoundEnding(ctx: Ctx): boolean {
  const { view, w } = ctx
  const spent = (c: CampaignCharacter) => c.shown?.AP === 0 || getBelievedAP(c, false, w) <= 0
  return getSides(view, ctx.members).foes.every((f) => hasAgreedToEnd(view, f) || spent(view.characters[f]))
    && getAbsentFoes(view).every(({ id, face }) => view.agreedToEnd.includes(id) || spent(face))
}

// How the character would better its position once it has nothing to do now:
// Search with no foe the side knows of, else Tactical towards `target`, and
// failing that, once the round is as good as over for its foes
// (`isRoundEnding`), Tactical with the AP left out of its cost.
function planLater(view: SceneState, members: readonly string[], id: string, w: SpecWeights, unnoticed: ReadonlySet<string>, target: string | null): Plan | null {
  const me = view.characters[id]
  if (me && isCollapsed(view, me)) return null
  const ctx = getCtx(view, members, id, w, unnoticed, target)
  if (!ctx) return null
  if (!ctx.foes.length) return planSearch(ctx)
  return planTactical(ctx, false) ?? (isRoundEnding(ctx) ? planTactical(ctx, true) : null)
}

function planTurn(view: SceneState, members: readonly string[], id: string, w: SpecWeights, unnoticed: ReadonlySet<string>, pass: Pass, target: string | null): Plan | null {
  return planNow(view, members, id, w, unnoticed) ?? (pass === 'any' ? planLater(view, members, id, w, unnoticed, target) : null)
}

// The defences the panel offers against the open attack, with no surge made for them.
function offeredTo(view: SceneState, id: string): (d: PairDefence) => boolean {
  const open = getOpenAction(view)
  const drafts = open ? getAvailableActions(view, id).filter((o) => o.available && o.reactionTo === open.id && o.surge === null).map((o) => o.draft) : []
  return (d) => d.draft !== null && drafts.some((x) => sameDraft(x, d.draft!))
}

// The answer to an attack on `id`: the opportunity attack a shot draws from
// it, if one is worth making, then the defence the Defense rule picks (spec
// "Defend"). A surge the panel offers is made first only where the defence the
// rule picks with it made prevents more harm than the surge's STA, and the
// recovery it gives up, costs, and could not be paid for without it; the
// movement surge for its reflexes too (combat.tex "Reflex"), whatever could.
// Defended by an ally already, it lets the attack come. Anything else it is
// asked to answer, it answers defending an ally, with an opportunity attack or
// lets pass.
function answer(input: SeatInput, id: string, w: SpecWeights, find: Find, press: Press): Decision | null {
  const view = input.view()
  const open = getOpenAction(view)
  const me = view.characters[id]
  if (!open || !me) return press(find('pass', id), 'lets it come')
  if (open.kind === 'explosion') return avoid(input, id, w, find, press)
  if (open.targetId !== id || (open.kind !== 'strike' && open.kind !== 'shoot')) return protect(input, id, w) ?? opportunity(input, id, w) ?? press(find('pass', id), 'lets it come')
  if (getDefenders(view, open).some((d) => d !== id)) return press(find('pass', id), 'lets it come: defended by an ally')
  const struck = open.kind === 'shoot' ? opportunity(input, id, w) : null
  if (struck) return struck
  const known = getKnownAttack(view, open, id)
  if (!known) return press(find('pass', id), 'lets it come: does not know the attack')
  const offered = offeredTo(view, id)
  const payable = (d: PairDefence) => offered(d) && d.cost.AP <= me.resources.AP && d.cost.STA <= me.resources.STA
  const best = getAnswer(known.attack, known.gap, me.resources, w, offered)
  const surges = me.resources.STA > 0 ? input.buttons.filter((b) => b.command.kind === 'surge' && argOf(b.command) === id) : []
  let surging: { button: (typeof surges)[number]; gain: number; why: string } | null = null
  for (const surge of surges) {
    const kind = surge.command.args[1] as SurgeKind
    const surged = trial(view, surge.command)
    const made = surged.characters[id]
    const reopened = getOpenAction(surged)
    const after = reopened ? getKnownAttack(surged, reopened, id) : null
    if (surged === view || made?.usedSurge !== kind || !after) continue
    const picked = getAnswer(after.attack, after.gap, made.resources, w, offeredTo(surged, id))
    const draft = picked.defence?.draft
    if (!draft || (kind !== 'movement' && known.attack.defences.some((d) => d.draft && sameDraft(d.draft, draft) && payable(d)))) continue
    const recovered = getRecoveredSTA(me, me.resources.STA, getSurgeRecovery('recovery')(me)) - me.resources.STA
    const cost = getSTAHarm(me.resources.STA - made.resources.STA + recovered + picked.STA, me.injuries.bleed, w)
    const gain = best.harm - picked.harm - cost
    if (gain <= 0 || (surging && gain <= surging.gain)) continue
    surging = { button: surge, gain, why: `makes the ${kind} surge to answer with ${draft.kind} (harm ${best.harm.toFixed(1)} to ${picked.harm.toFixed(1)}, the surge ${cost.toFixed(1)})` }
  }
  if (surging) {
    const pressed = press(surging.button, surging.why)
    if (pressed) return pressed
  }
  const draft = best.defence?.draft
  if (!draft) return press(find('pass', id), `takes the hit (harm ${best.harm.toFixed(1)})`)
  const picks = fillAnswer(view, input.members, id, draft, w)
  if (!picks) return press(find('pass', id), `lets it come: ${draft.kind} cannot be finished`)
  return { kind: 'declare', intent: { actorId: id, option: draft, picks }, why: `answers with ${draft.kind} (harm ${best.undefended.toFixed(1)} to ${best.harm.toFixed(1)} for ${best.AP} AP)` }
}

// spec "Protect": an ally attacked is defended where more harm would get
// through to it than to the character, each where it stands with the AP it
// holds (`getExposed`), with the block, intercept or guard the Defense rule
// picks, read for the ally (bot/protect.ts), where the harm it prevents, its
// bleed counted only over the ally's own (`getHarmAdded`), is above the
// Cost; never an ally who defends itself or is defended already (the user's
// ruling: no redundant defence).
function protect(input: SeatInput, id: string, w: SpecWeights): Decision | null {
  const view = input.view()
  const { members } = input
  const open = getOpenAction(view)
  const ally = open?.targetId
  if (!open || (open.kind !== 'strike' && open.kind !== 'shoot') || !ally || ally === id || !getTeam(view, members).includes(ally) || getDefenders(view, open).length > 0) return null
  const ctx = getCtx(view, members, id, w, new Set(), getTarget(input.notes, id))
  if (!ctx) return null
  const { me, foes } = ctx
  const target = view.characters[ally]
  const exposed = (who: string, AP: number) => getExposed(getExposure(view, members, foes, who, 'immediate', w), getCompany(view, who, cellOf(view, who), w), AP)
  const theirs = exposed(ally, getMeans(target, members.includes(ally), w).AP)
  const mine = exposed(id, me.resources.AP)
  if (theirs <= mine) return null
  const met = getProtections(view, id, (draft) => fillAnswer(view, members, id, draft, w))
  if (!met) return null
  const best = getAnswer(met.attack, met.gap, me.resources, w)
  const made = met.protections.find((p) => p.defence === best.defence)
  if (!made) return null
  const added = (d: PairDefence | undefined) => (d ? getHarmAdded(met.attack, d, met.gap, target.injuries.bleed, w) : 0)
  const prevented = added(met.attack.defences.find((d) => d.draft === null)) - added(made.defence)
  const cost = costAt(ctx, ctx.at(ctx.here), made.defence.cost.AP, made.defence.cost.STA)
  if (prevented <= cost) return null
  return { kind: 'declare', intent: { actorId: id, option: made.draft, picks: made.picks }, why: `defends ${target.name} with ${made.draft.kind} (harm ${best.undefended.toFixed(1)} to ${best.harm.toFixed(1)} for ${made.defence.cost.AP} AP, prevents ${prevented.toFixed(1)}, cost ${cost.toFixed(1)}; exposed ${theirs.toFixed(1)} against its own ${mine.toFixed(1)})` }
}

// spec "Immediate actions": an opportunity attack scored as an attack is, made
// from where the character stands: of the rows the draw opens, the one scoring
// most, if above nothing; never on one who is down, as no attack is.
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
    if (!drawn || !target || !ctx.foes.includes(target.id)) continue
    const rows = getOpenChoices(declared).filter((c) => c.actorId === id && c.part === 'row').map((c) => c.value as PairAttack['row'])
    const pair = getPair(me, target)
    for (let i = 0; i < pair.length; i++) {
      const attack = pair[i]
      if (attack.kind !== 'strike' || !rows.some((r) => r.weaponKey === attack.row.weaponKey && r.attack === attack.row.attack && r.variant === attack.row.variant)) continue
      const { AP, STA } = attack.cost
      if (AP > me.resources.AP || STA > me.resources.STA || getUndefendedHarm(attack, attack.reach, w) <= 0) continue
      const pick = pickOf(ctx, attack, i, attack.reach, target.id)
      const threat = w.aggressivity * rate(ctx, target.id).threat
      const cost = -getShed(ctx, ctx.at(here), Math.max(0, ctx.held - Math.max(0, AP - getSurgeAPLeft(me)))) + getSTAHarm(STA, me.injuries.bleed, w)
      const score = pick.harm + pick.cost + threat - cost
      if (score <= 0 || (best && score <= best.score)) continue
      const picks: Pick[] = [{ part: 'row', value: attack.row }, ...(attack.declaresHeavy ? [{ part: 'modifier' as const, value: { key: `heavy${attack.heavy}`, on: true } }] : [])]
      best = { draft: o.draft, picks, score, why: `opportunity attack on ${target.name} (${attackName(attack)}: harm ${pick.harm.toFixed(1)} against ${pick.defence} + its cost ${pick.cost.toFixed(1)} + threat from it ${threat.toFixed(1)} - exposure and STA ${cost.toFixed(1)} = ${score.toFixed(1)})` }
    }
  }
  if (!best) return null
  const picks = fillAnswer(view, input.members, id, best.draft, w, best.picks)
  return picks ? { kind: 'declare', intent: { actorId: id, option: best.draft, picks }, why: best.why } : null
}

// What the answer still asks for once declared (where an evasive jump lands),
// picked: the cell of the least exposure once the answer is paid, anything
// else as first offered, after the `start` picks; null when it asks for something nothing offers.
function fillAnswer(view: SceneState, members: readonly string[], id: string, draft: ActionDraft, w: SpecWeights, start: readonly Pick[] = []): Pick[] | null {
  const open = getOpenAction(view)
  const ctx = getCtx(view, members, id, w, new Set())
  if (!open || !ctx) return null
  const price = getAvailableActions(view, id).find((o) => o.reactionTo === open.id && sameDraft(o.draft, draft))?.cost?.AP ?? 0
  const exposed = (cell: Coord) => ctx.at(cell).exposed(Math.max(0, ctx.held - price))
  const picks: Pick[] = [...start]
  for (let i = 0; i < 4 + start.length; i++) {
    const made = declare(view, { actorId: id, option: draft, picks }, TRIAL)
    if (!made.ok) return null
    if (!getUnfinishedAnswers(made.ready, open).some((r) => r.actorId === id)) return picks
    const fills = getOpenChoices(made.ready).filter((c) => c.actorId === id && !c.chosen)
    const cells = fills.filter((c) => c.part === 'cell')
    const pick = cells.length ? cells.reduce((b, c) => (exposed(c.value as Coord) < exposed(b.value as Coord) ? c : b)) : fills[0]
    if (!pick) return null
    picks.push({ part: pick.part, value: pick.value })
  }
  return null
}

// A walk the turn cannot end without (a coward's run): to the cell of the least exposure.
function getAway(view: SceneState, members: readonly string[], id: string, w: SpecWeights, unnoticed: ReadonlySet<string>): Decision | null {
  const ctx = getCtx(view, members, id, w, unnoticed)
  if (!ctx) return null
  const exposed = (s: Step) => s.exposed(leftAfter(ctx, s.b, s.c.AP, s.c.AP))
  const away = [...stepsOf(ctx)].filter((s) => s.b.surge === null).sort((x, y) => exposed(x) - exposed(y)).find((s) => s.walk.clear(s.c) && declare(view, moveIntent(id, s.walk.movement, s.c.cell, s.c.elevation), TRIAL).ok)
  return away ? { kind: 'declare', intent: moveIntent(id, away.walk.movement, away.c.cell, away.c.elevation), why: `gets away (exposure ${exposed(away).toFixed(1)})` } : null
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
    const ctx = getCtx(view, input.members, id, w, input.unnoticed(id), getTarget(input.notes, id))
    const plan = ctx && (planAttack(ctx, true) ?? planTactical(ctx, true))
    if (plan?.kind === 'attack' || plan?.kind === 'walk') return { kind: 'declare', intent: plan.intent, why: `violent: ${plan.why}` }
  }
  if (turn.action === 'coward' && getSurgeAPLeft(me) > 0) {
    const run = getAway(view, input.members, id, w, input.unnoticed(id))
    if (run) return { ...run, why: `coward: ${run.why}` }
  }
  return endTurn(input, id, find, press)
}

// An action decided and not yet played through (see the head of this file):
// the plan, and the steps left of it, kept for the round it was decided in.
type BlockStep = { surge: SurgeKind } | { intent: Intent }
// `at`: where each target of the block's attacks stood when it was decided;
// one no longer there, or that the character no longer notices, drops the
// block (the user's ruling, 2026-11-23). A step is crossed off with the notes
// of the decision that plays it (decision.ts `noted`).
type Block = { round: number; plan: Plan; steps: readonly BlockStep[]; started: boolean; at: Record<string, Coord | null> }

const targetOf = (intent: Intent): string | null => (intent.picks.find((p) => p.part === 'target')?.value as string | undefined) ?? null

function blockOf(view: SceneState, plan: Plan): Block {
  const steps: BlockStep[] = [plan.kind === 'surge' ? { surge: plan.surge } : { intent: plan.intent }, ...(plan.then ?? []).map((intent) => ({ intent }))]
  const targets = steps.flatMap((s) => ('intent' in s ? (targetOf(s.intent) ?? []) : []))
  return { round: view.round, plan, steps, started: false, at: Object.fromEntries(targets.map((t) => [t, cellOf(view, t)])) }
}

// The character's block, where it was decided this round.
function getBlock(notes: Notes | undefined, view: SceneState, id: string): Block | null {
  const block = notes?.[blockKey(id)] as Block | null | undefined
  return block && block.round === view.round ? block : null
}

const noting = (id: string, block: Block | null, decision: Decision): Decision => ({ ...decision, noted: { [blockKey(id)]: block } })

// The cell a walk declared by `intent` ends on.
function walkEnd(intent: Intent): Coord | null {
  if (intent.option.kind !== 'move') return null
  const cell = intent.picks.find((p) => p.part === 'cell')?.value as Coord | undefined
  return cell ?? null
}

// The next step of the character's block, with the steps after it noted: each
// step done already passed over, null once none is left or the next can no
// longer be done.
function carryBlock(input: SeatInput, id: string, block: Block, press: Press): Decision | null {
  const view = input.view()
  const me = view.characters[id]
  if (!me) return null
  const from = (n: number): Block => ({ ...block, steps: block.steps.slice(n), started: true })
  for (const [n, step] of block.steps.entries()) {
    const why = block.started ? `carries on: ${block.plan.why}` : block.plan.why
    if ('surge' in step) {
      if (me.usedSurge === step.surge) continue
      const button = input.buttons.find((b) => b.command.kind === 'surge' && argOf(b.command) === id && b.command.args[1] === step.surge)
      const made = press(button, why)
      return made && noting(id, from(n + 1), made)
    }
    const end = walkEnd(step.intent)
    const here = cellOf(view, id)
    if (end && here && sameCell(end, here)) continue
    const target = targetOf(step.intent)
    const stood = target ? block.at[target] : null
    const standing = target ? cellOf(view, target) : null
    if (target && stood && (!standing || !sameCell(stood, standing))) return null
    if (target && input.unnoticed(id).has(target)) return null
    const opens = end ? (declare(view, step.intent, TRIAL).ok ? 'open' : null) : opensAfter(view, id, step.intent)
    if (opens === 'givingUp') {
      const give = input.buttons.find((b) => b.command.kind === 'edit' && argOf(b.command) === id && (b.command.args[1] as { kind: string }).kind === 'endSurge')
      const made = press(give, `gives up the surge AP left to attack: ${why}`)
      if (made) return noting(id, from(n), made)
    }
    return opens === 'open' ? noting(id, from(n + 1), { kind: 'declare', intent: step.intent, why }) : null
  }
  return null
}

// The turn the character holds, one action at a time: the block it decided
// played through, then the next action decided.
function takeTurn(input: SeatInput, id: string, w: SpecWeights, find: Find, press: Press): Decision | null {
  const stress = takeStressTurn(input, id, w, find, press)
  if (stress !== 'none') return stress
  const view = input.view()
  const block = getBlock(input.notes, view, id)
  const carried = block && carryBlock(input, id, block, press)
  if (carried) return carried
  const plan = planTurn(view, input.members, id, w, input.unnoticed(id), 'any', getTarget(input.notes, id))
  const made = plan && carryBlock(input, id, blockOf(view, plan), press)
  if (made) return made
  const last = endTurn(input, id, find, press) ?? getAway(view, input.members, id, w, input.unnoticed(id))
  return last && noting(id, null, last)
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
        : (wait.for === 'action' ? stepOpened(input, wait.id, w) : null) ?? settleWait(input, wait, find, press, w)
      if (made) return made
    }
    const view = input.view()
    const planned = plansOf(w, view)
    const holder = getTurnHolder(view)
    if (holder && !members.includes(holder) && !members.some((id) => view.contenders.includes(id))) {
      let contest: { id: string; plan: Plan; block: Block } | null = null
      for (const id of members) {
        if (!find('toggleContest', id)) continue
        const kept = getBlock(input.notes, view, id)
        const plan = kept ? kept.plan : planned(`${id}|contest`, () => planNow(wonBy(view, id), members, id, w, input.unnoticed(id)))
        if (plan && (!contest || plan.score > contest.plan.score)) contest = { id, plan, block: kept ?? blockOf(view, plan) }
      }
      const made = contest && press(find('toggleContest', contest.id), `contests the turn: ${contest.plan.why}`)
      if (made && contest) return noting(contest.id, contest.block, made)
    }
    let best: { id: string; plan: Plan; block: Block } | null = null
    for (const pass of input.pass === 'any' ? (['immediate', 'any'] as const) : (['immediate'] as const)) {
      for (const id of members) {
        const start = find('startTurn', id)
        if (!start) continue
        const begun = begunBy(view, id, start.command)
        const unnoticed = input.unnoticed(id)
        const target = getTarget(input.notes, id)
        const kept = getBlock(input.notes, view, id)
        const plan = kept ? kept.plan : planned(`${id}|${pass}|${target}`, () => (pass === 'immediate' ? planNow(begun, members, id, w, unnoticed) : planLater(begun, members, id, w, unnoticed, target)))
        if (plan && (!best || plan.score > best.plan.score)) best = { id, plan, block: kept ?? blockOf(begun, plan) }
      }
      if (best) break
    }
    const start = best && find('startTurn', best.id)
    if (best && start) return noting(best.id, best.block, { kind: 'press', pick: start, why: `has something worth doing: ${best.plan.why}` })
    return input.pass === 'any' ? carryOn(input, find) : { kind: 'wait', why: 'nothing to do now' }
  }
  box.remembers = true
  box.notes = (previous, view, members) => noteTargets(previous, view, members, w)
  return box
}

// The fight as it would be had the character started the turn, one trial per
// view and character, so that every plan weighed on it reads the same state.
const begunKept = new WeakMap<SceneState, Map<string, SceneState>>()

function begunBy(view: SceneState, id: string, command: SceneCommand): SceneState {
  const known = begunKept.get(view) ?? new Map<string, SceneState>()
  begunKept.set(view, known)
  let begun = known.get(id)
  if (!begun) known.set(id, (begun = trial(view, command)))
  return begun
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
