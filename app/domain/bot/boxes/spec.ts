import type { CampaignCharacter, Coord, SurgeKind } from '../../types'
import type { ActionDraft, SceneState } from '../../scene/types'
import type { SceneCommand } from '../../scene/commands/registry'
import { getSurgeAPLeft, getSurgeRecovery, getSurgeSTA } from '../../character/rules/surge'
import { getRecoveredSTA } from '../../character/rules/characteristics'
import { getOpenAction } from '../../scene/rules/log'
import { getAvailableActions, getUnfinishedAnswers } from '../../scene/rules/options'
import { getOpenChoices } from '../../scene/projections/choices'
import { cellNumber, coordKey, distance, extentCells, sameCell } from '../../scene/rules/board/geometry'
import { getEyes, getEyesToward, seesAcross } from '../../scene/rules/board/board'
import { getStressDue, getStressSocial, getStressTurn } from '../../scene/rules/stress'
import { getTurnHolder, hasAgreedToEnd, keepsSurgeAP } from '../../scene/rules/turn'
import { isCollapsed } from '../../scene/rules/situational'
import { ROUND_AP } from '../../tables'
import { declare, type Intent, type Pick } from '../declare'
import { getApproachDrawn, getStandingCost, type Drawn } from '../approach'
import { getSides } from '../table'
import { getPair, type PairAttack } from '../pairs'
import { cellOf, getBelievedAP, getHarmAgainst, getHarmOnBleeding, getMeans, getStrikeCells, getTeam, type SpendCost } from '../threat'
import { REST_TUNING } from '../rest'
import { getCost, getSTAHarm, type SpecWeights } from '../cost'
import { getCostDelta, getLayer, getLayersBy, getLayersOn, getThreatBy, getThreatHarm, getThreatOn, isRuinous, lineOfFire, sumLayers, SHOT_GAP, type Guard, type Layers } from '../threatMap'
import { argOf, arrivedAt, attackIntent, attackName, canPay, getAttackCells, getBudgets, getCollapsedCare, getKnownAttack, getRunBlock, getWalkBudgets, getWalks, heldAP, isWalkPaid, moveIntent, opensAfter, ownAP, RUN_BLOCKS, runs, sameDraft, takesWalk, trial, TRIAL, wonBy, type Budget, type Walk, type WalkCell } from '../moves'
import { carryOn, endTurn, finding, settleWait, type Find, type Press } from './nearest'
import type { Box, Decision, Pass, SeatInput } from '../decision'
import type { Notes } from '../memory'

// The box instructions/bot-spec.md describes, read section by section:
//
// - a turn is asked for (or anyone else's contested) for what the character
//   would do now: an attack, or an escape from the danger where it stands,
//   whichever scores more, above nothing; once the turn is its own it asks
//   that again after every action, then how to better its position
//   (Tactical, towards the target it keeps; Search with no foe the side
//   knows of), and with nothing worth doing once no foe can still act
//   this round, Tactical once more with the AP left out of its cost, before
//   it ends the turn and agrees to end the round. An action decided is
//   played through as one block (the user's ruling, 2026-11-23): the surge
//   that pays for it, the walk and the attack it is made of, each declared in
//   turn without weighing it again, the next turn asked for to go on with it
//   where the turn is lost to a contest, and decided afresh only once the
//   rest of it can no longer be done or the round is over; a reaction is
//   weighed when it is asked for;
// - an attack scores the harm it leaves against the defence the target is
//   believed to pick, and how the threat of everyone on the target changes
//   once both have paid, less its Cost and the opportunity attacks it draws
//   (spec "Attacking");
// - attacked, it picks the defence with the most it saves less its Cost,
//   taking the hit at 0 (spec "Defend"); drawn an opportunity attack, it
//   makes it where it scores above nothing as an attack does;
// - no option it takes is believed to leave it collapsed or dead this round
//   (spec "Guard", threatMap.ts `isRuinous`).
//
// The rest (morale, concentration, landing what it rolled with a hit's
// overflow spent as `getBestSpend` spends it, the round's rest step) it plays
// as the nearest box does.

export const SPEC_WEIGHTS: SpecWeights = { ...REST_TUNING, AP: 1.3, STA: 2, caution: 1.8, IL: 2, bleed: 5, search: 4, solitude: 10, retarget: 2, courage: 20, teamwork: 1, baseAPcost: 1, aggro: 1, aggressivity: 0.5 }

// spec "Escape": the party members within this many metres of where the character sets out
const ESCAPE_COMPANY = 10

// An action decided: its first step, and what is declared after it (`then`).
type Plan = (
  | { kind: 'attack' | 'walk' | 'care'; intent: Intent; score: number; why: string }
  | { kind: 'surge'; surge: SurgeKind; score: number; why: string }
) & { then?: readonly Intent[] }

const NOTHING_DRAWN: Drawn = { worth: 0, harm: 0, AP: 0, STA: 0 }

// The foes' immediate threat on a character somewhere, and the change a Cost
// reads in it from where the character stands now (spec "Cost", `getCostDelta`).
type OnMe = { threat: number; delta: number }

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
  // the character's target (spec "Tactical", `noteTargets`), null for none
  target: string | null
  left: Guard
  budgets: Budget[]
  // the foes' immediate threat on the character at `cell` holding `AP`, each
  // read once, and the threat where it stands now
  onMe: (cell: Coord | null, AP: number) => OnMe
  now: number
  picks: Map<string, TargetPick>
}

function getCtx(view: SceneState, members: readonly string[], id: string, w: SpecWeights, unnoticed: ReadonlySet<string>, target: string | null = null): Ctx | null {
  const me = view.characters[id]
  if (!me) return null
  const here = cellOf(view, id)
  const foes = getSides(view, members).foes.filter((f) => cellOf(view, f) !== null)
  const left = { AP: me.resources.AP, STA: me.resources.STA }
  const layersOn = (cell: Coord | null, AP: number) => getLayersOn(view, members, id, 'immediate', w, [{ id, at: cell, AP }])
  const standing = layersOn(here, left.AP)
  const read = new Map<string, OnMe>()
  const onMe = (cell: Coord | null, AP: number): OnMe => {
    const key = `${cell ? cellNumber(cell) : ''}|${AP}`
    const known = read.get(key)
    if (known) return known
    const layers = layersOn(cell, AP)
    const made = { threat: sumLayers(layers), delta: getCostDelta(standing, layers) }
    read.set(key, made)
    return made
  }
  return { view, members, id, w, me, here, foes, targets: foes.filter((f) => !unnoticed.has(f)), team: getTeam(view, members), target, left, budgets: getBudgets(view, id), onMe, now: sumLayers(standing), picks: new Map() }
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
// (spec "Defend", read for it): of those it can pay for, the most harm it
// saves less its Cost, the threat of the character's side on it read with
// the AP the defence leaves it and the character at `cell` holding `AP`, as the target
// meets the attack once it is paid for; taking the hit at 0. `TargetPick.AP`:
// what the target is left holding.
// `counted`: the harm the attack is scored with, of the bleed only what it
// adds over what the target bleeds already (`getHarmOnBleeding`).
// `prevented`: w.aggressivity times the target's immediate threat on the
// character's side (`getThreatFrom`).
type TargetPick = { harm: number; counted: number; defence: string; AP: number; prevented: number }

function pickOf(ctx: Ctx, attack: PairAttack, index: number, gap: number, foe: string, cell: Coord | null, AP: number): TargetPick {
  const key = `${foe}|${index}|${gap}|${cell ? coordKey(cell) : ''}|${AP}`
  const known = ctx.picks.get(key)
  if (known) return known
  const { view, members, w, team } = ctx
  const target = view.characters[foe]
  const guard = getMeans(target, false, w)
  const threatOn = (held: number) => getLayersBy(view, members, team, foe, 'immediate', w, [{ id: foe, AP: held }, { id: ctx.id, at: cell, AP }])
  const before = threatOn(guard.AP)
  const none = attack.defences.find((d) => d.draft === null)
  const undefended = none ? getHarmAgainst(attack, none, gap) : 0
  let best = { score: 0, harm: undefended, defence: 'no defence', AP: guard.AP, met: none }
  for (const d of attack.defences) {
    if (d.draft === null || d.cost.AP > guard.AP || d.cost.STA > guard.STA) continue
    const harm = getHarmAgainst(attack, d, gap)
    const kept = guard.AP - d.cost.AP
    const score = undefended - harm - getCost(d.cost.AP, d.cost.STA, getCostDelta(before, threatOn(kept)), target.injuries.bleed, w)
    if (score > best.score) best = { score, harm, defence: d.draft.kind, AP: kept, met: d }
  }
  const counted = best.met ? getHarmOnBleeding(attack, best.met, gap, target.injuries.bleed) : best.harm
  const pick: TargetPick = { harm: best.harm, counted, defence: best.defence, AP: best.AP, prevented: getThreatFrom(ctx, foe) }
  ctx.picks.set(key, pick)
  return pick
}

// The harm an attack is scored with, and where the target's bleed took some
// off, what it was before.
const harmText = (pick: TargetPick, target: CampaignCharacter): string =>
  pick.counted === pick.harm ? pick.harm.toFixed(1) : `${pick.counted.toFixed(1)} (${pick.harm.toFixed(1)}, bleeding ${target.injuries.bleed} already)`

// spec "Attacking": w.aggressivity times the immediate threat of `foe` on
// everyone of the character's side as they stand, the aggression an attack
// on it goes against (the user's term, 2026-11-23: a multiplier over its
// threat, not a change in it).
function getThreatFrom(ctx: Ctx, foe: string): number {
  const { view, members, w, team } = ctx
  return w.aggressivity * team.reduce((sum, t) => sum + getLayer(view, members, foe, t, 'immediate', w), 0)
}

// spec "Attacking": the change in the immediate threat of everyone on `foe`,
// after the attack less before: the character at `cell` holding `AP`, `foe`
// holding what the defence it is believed to pick (`pick`) leaves it.
function getThreatGain(ctx: Ctx, foe: string, cell: Coord | null, AP: number, pick: TargetPick): number {
  const { view, members, id, w, team } = ctx
  return getThreatBy(view, members, team, foe, 'immediate', w, [{ id, at: cell, AP }, { id: foe, AP: pick.AP }]) - getThreatBy(view, members, team, foe, 'immediate', w)
}

// spec "Attacking": of every attack on every foe the character notices, from
// where it stands or the cheapest cell of a walk that reaches
// (`getAttackCells`), the one scoring most, if above nothing (or whatever it
// scores, when `compelled`). The surges that may pay for it (the user's
// rulings, 2026-11-20): the movement surge only for a run of at least
// RUN_BLOCKS blocks, the combat surge only for an attack the character's own
// AP cannot pay for, the focus surge only for the shot it opens.
//
// Of the COVER_WEIGHED best attacks paid from the character's own AP, each is
// weighed again with a walk after it to cover (the user's peek, 2026-11-23,
// tried on every attack): the cell the AP it leaves reaches where the attack,
// read with the threat on the character there, scores most, less the
// opportunity attacks that walk draws. The walk is part of the block.
const COVER_WEIGHED = 4

function planAttack(ctx: Ctx, compelled = false, on: readonly string[] = ctx.targets): Plan | null {
  const { view, id, w, me, here, budgets } = ctx
  const runBlock = getRunBlock(view, id)
  const focusSTA = getSurgeSTA('focus')(me) + getRecoveredSTA(me, me.resources.STA, getSurgeRecovery('recovery')(me)) - me.resources.STA
  const rank = (b: Budget) => (b.surge === null ? 0 : b.surge === 'movement' ? 1 : 2)
  const order = [...budgets].sort((a, b) => rank(a) - rank(b))
  // the attacks (by foe and row) paid for without the combat surge
  const paid = new Set<string>()
  const weighed: { score: number; settle: () => Plan | null; cover?: () => { score: number; settle: () => Plan | null } | null }[] = []
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
        const fires = attack.kind === 'shoot' && board && at ? lineOfFire(board, getEyes(view, id, foe)) : null
        const clear = fires && at ? (c: Coord) => fires(c, at) : getStrikeCells(view, id, foe, at, attack.reach)
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
          const onMe = ctx.onMe(cell, guard.AP)
          if (isRuinous(me, me.resources.STA - guard.STA, onMe.threat, w)) continue
          const pick = pickOf(ctx, attack, i, gap, foe, cell, guard.AP)
          const onTarget = getThreatGain(ctx, foe, cell, guard.AP, pick)
          const cost = getCost(ownAP(view, id, b, AP, spent), STAspent + b.surgeSTA + (needsFocus ? focusSTA : 0), onMe.delta, me.injuries.bleed, w)
          const drew = answering.harm + (attack.kind === 'shoot' ? firedFrom(ctx, cell, AP, STA) : 0)
          const score = pick.counted + onTarget - cost - drew + pick.prevented
          const why = `${attack.kind}s ${target.name} (${attackName(attack)}: harm ${harmText(pick, target)} against ${pick.defence} + threat on it ${onTarget.toFixed(1)} - cost ${cost.toFixed(1)} - drawn ${drew.toFixed(1)} + threat from it ${pick.prevented.toFixed(1)} = ${score.toFixed(1)})`
          const fromHere = !here || !cell || sameCell(cell, here)
          const movement = walk?.movement
          const settleWith = (score: number, why: string, after: readonly Intent[]) => (): Plan | null => {
            const next = fromHere ? attackIntent(id, attack, foe) : movement && elevation !== undefined && cell ? moveIntent(id, movement, cell, elevation) : null
            const surge = needsFocus ? 'focus' : b.surge
            const paidView = needsFocus ? trial(view, { kind: 'surge', args: [id, 'focus'] }) : b.view
            if (!next || (!fromHere && !takesWalk(paidView, id, next, AP, STA))) return null
            const strike = attackIntent(id, attack, foe)
            const opens = opensAfter(arrivedAt(paidView, id, cell, AP, STA), id, strike)
            if (!opens || (opens === 'givingUp' && attack.cost.AP > heldAP(b, AP))) return null
            if (surge) return { kind: 'surge', surge, score, why: surge === 'focus' ? `focuses to shoot: ${why}` : `makes the ${surge} surge: ${why}`, then: fromHere ? [strike, ...after] : [next, strike, ...after] }
            if (!fromHere) return { kind: 'walk', intent: next, score, why: `walks to attack: ${why}`, then: [strike, ...after] }
            return opensAfter(view, id, next) ? { kind: 'attack', intent: next, score, why, then: [...after] } : null
          }
          // the walk to cover after it, from where it attacks with what the attack leaves
          const cover = () => {
            const from = cell ?? here
            if (b.surge !== null || !from) return null
            const arrived = fromHere ? view : arrivedAt(view, id, cell, AP, STA)
            let best: { score: number; settle: () => Plan | null } | null = null
            for (const after of getWalks(arrived, id)) for (const r of after.cells) {
              if (sameCell(r.cell, from) || !canPay(b, AP + r.AP, attack.cost.AP + answering.AP) || STAspent + r.STA > b.STA || !after.clear(r)) continue
              const left = held(b, spent + r.AP, STAspent + r.STA)
              const there = ctx.onMe(r.cell, left.AP)
              if (isRuinous(me, me.resources.STA - left.STA, there.threat, w)) continue
              const leaving = getApproachDrawn(view, id, from, r.cell, runs(after), ctx.foes, (f) => getMeans(view.characters[f], false, w), guard, w, r.path, spendingOf(ctx)).harm
              const coverOn = getThreatGain(ctx, foe, r.cell, left.AP, pick)
              const coverCost = getCost(ownAP(view, id, b, AP + r.AP, spent + r.AP), STAspent + r.STA + (needsFocus ? focusSTA : 0), there.delta, me.injuries.bleed, w)
              const coverScore = pick.counted + coverOn - coverCost - drew - leaving + pick.prevented
              if (best && coverScore <= best.score) continue
              const coverWhy = `${attack.kind}s ${target.name} and walks to cover (${attackName(attack)}: harm ${harmText(pick, target)} against ${pick.defence} + threat on it ${coverOn.toFixed(1)} - cost ${coverCost.toFixed(1)} - drawn ${(drew + leaving).toFixed(1)} + threat from it ${pick.prevented.toFixed(1)} = ${coverScore.toFixed(1)})`
              best = { score: coverScore, settle: settleWith(coverScore, coverWhy, [moveIntent(id, after.movement, r.cell, r.elevation)]) }
            }
            return best
          }
          weighed.push({ score, settle: settleWith(score, why, []), cover })
        }
      }
    }
  }
  weighed.sort((x, y) => y.score - x.score)
  const covered = weighed.slice(0, COVER_WEIGHED).flatMap((x) => x.cover?.() ?? [])
  for (const { score, settle } of [...weighed, ...covered].sort((x, y) => y.score - x.score)) {
    if (score <= 0 && !compelled) break
    const plan = settle()
    if (plan) return plan
  }
  return null
}

// A walk weighed: the cell, the walk and the budget paying for it, and what it leaves the character holding;
// the foes' immediate threat on it there, and the change a Cost reads in it (`Ctx.onMe`).
type Step = { b: Budget; walk: Walk; c: WalkCell; guard: Guard; threat: number; delta: number }

// Every walk the character could make this turn (`getWalkBudgets`), each with
// the foes' immediate threat on it where it ends, holding what the walk leaves.
function getSteps(ctx: Ctx): Step[] {
  const { view, id, here } = ctx
  const steps: Step[] = []
  if (!here) return steps
  for (const { b, walks } of getWalkBudgets(view, id, ctx.budgets)) for (const walk of walks) for (const c of walk.cells) {
    if (sameCell(c.cell, here) || !isWalkPaid(view, id, b, c.AP)) continue
    const guard = held(b, c.AP, c.STA)
    steps.push({ b, walk, c, guard, ...ctx.onMe(c.cell, guard.AP) })
  }
  return steps
}

// The walks weighed once per view, character and side, whichever plan asks first.
const kept = new WeakMap<SpecWeights, WeakMap<SceneState, Map<string, Step[]>>>()

function stepsOf(ctx: Ctx): Step[] {
  const byView = kept.get(ctx.w) ?? new WeakMap<SceneState, Map<string, Step[]>>()
  kept.set(ctx.w, byView)
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

const allowed = (ctx: Ctx, s: Step): boolean => s.walk.clear(s.c) && !isRuinous(ctx.me, ctx.me.resources.STA - s.guard.STA, s.threat, ctx.w)

// spec "Escape": to the cell of the least immediate threat on the character,
// read with what the walk leaves it, scored by the danger it sheds, less
// `teamwork` for every party member within ESCAPE_COMPANY metres of where it
// sets out, the walk's STA and the opportunity attacks it draws; taken only
// where that is above `courage`.
function planEscape(ctx: Ctx): Plan | null {
  const { here, now, w, me } = ctx
  if (!here || now <= 0) return null
  const company = companyAt(ctx, here)
  for (const s of [...stepsOf(ctx)].sort((x, y) => x.threat - y.threat || x.c.AP + x.c.STA - (y.c.AP + y.c.STA))) {
    if (!allowed(ctx, s)) continue
    const drew = drawnOn(ctx, s.c.cell, s.c.AP, s.c.STA, runs(s.walk), s.c.path, s.b).harm
    const score = now - s.threat - company * w.teamwork - getSTAHarm(s.c.STA + s.b.surgeSTA, me.injuries.bleed, w) - drew
    if (score <= w.courage) return null
    const plan = stepPlan(ctx, s, score, `escapes (${s.walk.movement}, threat ${now.toFixed(1)} to ${s.threat.toFixed(1)}, ${company} near, drawn ${drew.toFixed(1)}: ${score.toFixed(1)})`)
    if (plan) return plan
  }
  return null
}

// spec "Tactical": the most harm `me`'s attacks are believed to leave `foe`
// answering with an evade (`getThreatHarm`), where they stand playing no part
// (a shot read from SHOT_GAP metres).
function getTargetHarm(me: CampaignCharacter, foe: CampaignCharacter | undefined): number {
  if (!foe) return 0
  return getPair(me, foe).reduce((most, a) => (a.opens.action ? Math.max(most, getThreatHarm(a, a.kind === 'shoot' ? SHOT_GAP : a.reach)) : most), 0)
}

// spec "Tactical": each member's target, kept from one look at the fight to
// the next. A member with none, or whose target the side no longer knows to
// stand anywhere, takes the foe it would harm most (`getTargetHarm`); one with
// a target changes it only for a foe it would harm more than `retarget` times
// as much.
function noteTargets(previous: Notes | undefined, view: SceneState, members: readonly string[], w: SpecWeights): Notes {
  const foes = getSides(view, members).foes.filter((f) => cellOf(view, f) !== null)
  const targets: Record<string, string> = {}
  for (const id of members) {
    const me = view.characters[id]
    if (!me || !foes.length) continue
    const harm = (f: string) => getTargetHarm(me, view.characters[f])
    const best = foes.reduce((b, f) => (harm(f) > harm(b) ? f : b))
    const kept = previous?.[id]
    targets[id] = kept && foes.includes(kept) && harm(best) <= w.retarget * harm(kept) ? kept : best
  }
  return targets
}

// spec "Tactical": a cell's Score, `aggro` times the character's potential
// threat on its target from there, less every foe's potential threat on it
// there. The rest of the team's threat on the target, and the foes' on the
// rest of the team, are the same wherever it stands, so they are left out.
function tacticalScore(ctx: Ctx, target: string, cell: Coord): number {
  const { view, members, id, w } = ctx
  const moved = [{ id, at: cell }]
  return w.aggro * getLayer(view, members, id, target, 'potential', w, moved) - getThreatOn(view, members, id, 'potential', w, moved)
}

// spec "Tactical": towards the character's target (`noteTargets`). Of the
// cells it walks to where an escape would not be called for (the danger
// there, over the least danger of any cell it walks to, less `teamwork` for
// every party member near, comes to no more than `courage`), and whose Score
// betters the one where it stands by more than the walk's Cost and the
// opportunity attacks it draws, the best scoring of each movement, by the
// movement whose Cost is least. `free` leaves the AP out of the cost (spec
// "Decide take turn"). Of each movement's cells, TACTICAL_SCAN are read for
// what they draw, best scoring first.
const TACTICAL_SCAN = 8

function planTactical(ctx: Ctx, free: boolean): Plan | null {
  const { view, id, w, me, here, target } = ctx
  if (!here || !target || !ctx.foes.includes(target)) return null
  const stay = tacticalScore(ctx, target, here)
  const steps = stepsOf(ctx)
  const safest = steps.reduce((least, s) => Math.min(least, s.threat), ctx.now)
  const calm = (s: Step) => s.threat - safest - companyAt(ctx, s.c.cell) * w.teamwork <= w.courage
  const byMovement = new Map<string, { s: Step; gain: number; cost: number }[]>()
  for (const s of steps) {
    if (!calm(s)) continue
    const gain = tacticalScore(ctx, target, s.c.cell) - stay
    const cost = getCost(ownAP(view, id, s.b, s.c.AP, s.c.AP), s.c.STA + s.b.surgeSTA, s.delta, me.injuries.bleed, w, free)
    if (gain - cost <= 0) continue
    const key = `${s.b.surge ?? ''}|${s.walk.movement}`
    byMovement.set(key, [...(byMovement.get(key) ?? []), { s, gain, cost }])
  }
  const name = view.characters[target]?.name ?? target
  const picked: { s: Step; cost: number; score: number; why: string }[] = []
  for (const cells of byMovement.values()) {
    let read = 0
    for (const k of cells.sort((x, y) => y.gain - x.gain)) {
      if (read >= TACTICAL_SCAN) break
      if (!allowed(ctx, k.s)) continue
      read++
      const drew = drawnOn(ctx, k.s.c.cell, k.s.c.AP, k.s.c.STA, runs(k.s.walk), k.s.c.path, k.s.b).harm
      const score = k.gain - k.cost - drew
      if (score <= 0) continue
      picked.push({ s: k.s, cost: k.cost, score, why: `repositions${free ? ' before the round ends' : ''} towards ${name} (${k.s.walk.movement}, score ${k.gain.toFixed(1)} better - cost ${k.cost.toFixed(1)} - drawn ${drew.toFixed(1)}: ${score.toFixed(1)})` })
      break
    }
  }
  for (const r of picked.sort((x, y) => x.cost - y.cost)) {
    const plan = stepPlan(ctx, r.s, r.score, r.why)
    if (plan) return plan
  }
  return null
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

// Whether the round is as good as over for the character's foes: every one
// has agreed to end it or is believed to have no AP left, so that what the
// character's AP would defend this round is nothing.
function isRoundEnding(ctx: Ctx): boolean {
  const { view, w } = ctx
  return getSides(view, ctx.members).foes.every((f) => hasAgreedToEnd(view, f) || getBelievedAP(view.characters[f], false, w) <= 0)
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

// spec "Defend": of the defences the panel offers against `attack`, the one
// with the most harm it saves less its Cost, the threat on the character read
// with the AP the defence leaves it; taking the hit at 0. An earmarked surge's AP left is lost when the
// stack is played out by one who does not keep it, so it is spent first. An
// answer only a surge opens is left out: the surge is weighed by itself
// (`answer`). `now`: the foes' layers on the character before the block the
// defence is part of, read before any surge made for it.
type Defence = { draft: ActionDraft | null; score: number; harm: number }

function weighDefences(view: SceneState, members: readonly string[], id: string, attack: PairAttack, gap: number, w: SpecWeights, now: Layers): Defence {
  const open = getOpenAction(view)
  const me = view.characters[id]
  const AP = me.resources.AP
  const dropped = !keepsSurgeAP(view, id) ? getSurgeAPLeft(me) : 0
  const none = attack.defences.find((d) => d.draft === null)
  const undefended = none ? getHarmAgainst(attack, none, gap) : 0
  let best: Defence = { draft: null, score: 0, harm: undefended }
  const offered = open ? getAvailableActions(view, id).filter((o) => o.available && o.reactionTo === open.id && o.surge === null) : []
  for (const o of offered) {
    const d = attack.defences.find((x) => x.draft && sameDraft(x.draft, o.draft))
    if (!d) continue
    const harm = getHarmAgainst(attack, d, gap)
    const after = Math.max(0, Math.min(AP - d.cost.AP, AP - dropped))
    const delta = getCostDelta(now, getLayersOn(view, members, id, 'immediate', w, [{ id, AP: after }]))
    const score = undefended - harm - getCost(d.cost.AP, d.cost.STA, delta, me.injuries.bleed, w)
    if (score > best.score) best = { draft: o.draft, score, harm }
  }
  return best
}

// The answer to an attack on `id`: the opportunity attack a shot draws from
// it, if one is worth making, then the defence `weighDefences` picks. A surge
// the panel offers (the reaction surge, or the movement surge with its
// reflexes, combat.tex "Reflex") is made first where the defence it opens,
// read on the fight with it made, scores more by more than its STA and the
// recovery it gives up cost (the user's ruling, 2026-11-20); the surge and
// the defence are one block (the user's ruling, 2026-11-23), so the threat
// on the character before it is read before the surge. Anything else
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
  const now = getLayersOn(view, input.members, id, 'immediate', w)
  const best = weighDefences(view, input.members, id, known.attack, known.gap, w, now)
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
    const withSurge = weighDefences(surged, input.members, id, after.attack, after.gap, w, now)
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
      if (AP > me.resources.AP || STA > me.resources.STA) continue
      const none = attack.defences.find((d) => d.draft === null)
      if (!none || getHarmAgainst(attack, none, attack.reach) <= 0) continue
      const left = Math.max(0, me.resources.AP - AP)
      const onMe = ctx.onMe(here, left)
      if (isRuinous(me, STA, onMe.threat, w)) continue
      const pick = pickOf(ctx, attack, i, attack.reach, target.id, here, left)
      const onTarget = getThreatGain(ctx, target.id, here, left, pick)
      const cost = getCost(AP, STA, onMe.delta, me.injuries.bleed, w)
      const score = pick.counted + onTarget - cost + pick.prevented
      if (score <= 0 || (best && score <= best.score)) continue
      const picks: Pick[] = [{ part: 'row', value: attack.row }, ...(attack.declaresHeavy ? [{ part: 'modifier' as const, value: { key: `heavy${attack.heavy}`, on: true } }] : [])]
      best = { draft: o.draft, picks, score, why: `opportunity attack on ${target.name} (${attackName(attack)}: harm ${harmText(pick, target)} against ${pick.defence} + threat on it ${onTarget.toFixed(1)} - cost ${cost.toFixed(1)} + threat from it ${pick.prevented.toFixed(1)} = ${score.toFixed(1)})` }
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
  const threat = (cell: Coord) => getThreatOn(view, members, id, 'immediate', w, [{ id, at: cell }])
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
    const ctx = getCtx(view, input.members, id, w, input.unnoticed(id), input.notes[id] ?? null)
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
// one no longer there drops the block (the user's ruling, 2026-11-23).
type Block = { round: number; plan: Plan; steps: BlockStep[]; started: boolean; at: Record<string, Coord | null> }
type Blocks = Map<string, Block>

const targetOf = (intent: Intent): string | null => (intent.picks.find((p) => p.part === 'target')?.value as string | undefined) ?? null

function blockOf(view: SceneState, plan: Plan): Block {
  const steps: BlockStep[] = [plan.kind === 'surge' ? { surge: plan.surge } : { intent: plan.intent }, ...(plan.then ?? []).map((intent) => ({ intent }))]
  const targets = steps.flatMap((s) => ('intent' in s ? (targetOf(s.intent) ?? []) : []))
  return { round: view.round, plan, steps, started: false, at: Object.fromEntries(targets.map((t) => [t, cellOf(view, t)])) }
}

// The character's block, where it was decided this round.
function heldBlock(blocks: Blocks, view: SceneState, id: string): Block | null {
  const block = blocks.get(id)
  if (block && block.round === view.round) return block
  blocks.delete(id)
  return null
}

// The cell a walk declared by `intent` ends on.
function walkEnd(intent: Intent): Coord | null {
  if (intent.option.kind !== 'move') return null
  const cell = intent.picks.find((p) => p.part === 'cell')?.value as Coord | undefined
  return cell ?? null
}

// The next step of the character's block: each step done already passed
// over, null (and the block dropped) once none is left or the next can no
// longer be done.
function carryBlock(input: SeatInput, id: string, blocks: Blocks, press: Press): Decision | null {
  const view = input.view()
  const block = heldBlock(blocks, view, id)
  const me = view.characters[id]
  if (!block || !me) return null
  while (block.steps.length) {
    const step = block.steps[0]
    const why = block.started ? `carries on: ${block.plan.why}` : block.plan.why
    if ('surge' in step) {
      if (me.usedSurge === step.surge) {
        block.steps.shift()
        continue
      }
      const button = input.buttons.find((b) => b.command.kind === 'surge' && argOf(b.command) === id && b.command.args[1] === step.surge)
      const made = press(button, why)
      if (!made) break
      block.steps.shift()
      block.started = true
      return made
    }
    const end = walkEnd(step.intent)
    const here = cellOf(view, id)
    if (end && here && sameCell(end, here)) {
      block.steps.shift()
      continue
    }
    const target = targetOf(step.intent)
    const stood = target ? block.at[target] : null
    const standing = target ? cellOf(view, target) : null
    if (target && stood && (!standing || !sameCell(stood, standing))) break
    const opens = end ? (declare(view, step.intent, TRIAL).ok ? 'open' : null) : opensAfter(view, id, step.intent)
    if (opens === 'givingUp') {
      const give = input.buttons.find((b) => b.command.kind === 'edit' && argOf(b.command) === id && (b.command.args[1] as { kind: string }).kind === 'endSurge')
      const made = press(give, `gives up the surge AP left to attack: ${why}`)
      if (made) {
        block.started = true
        return made
      }
    }
    if (opens !== 'open') break
    block.steps.shift()
    block.started = true
    return { kind: 'declare', intent: step.intent, why }
  }
  blocks.delete(id)
  return null
}

// The turn the character holds, one action at a time: the block it decided
// played through, then the next action decided.
function takeTurn(input: SeatInput, id: string, w: SpecWeights, blocks: Blocks, find: Find, press: Press): Decision | null {
  const stress = takeStressTurn(input, id, w, find, press)
  if (stress !== 'none') return stress
  const carried = carryBlock(input, id, blocks, press)
  if (carried) return carried
  const view = input.view()
  const plan = planTurn(view, input.members, id, w, input.unnoticed(id), 'any', input.notes[id] ?? null)
  if (plan) {
    blocks.set(id, blockOf(view, plan))
    const made = carryBlock(input, id, blocks, press)
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
  const blocks: Blocks = new Map()
  const box: Box = (input) => {
    const { members, waits, buttons } = input
    const { find, press } = finding(buttons)
    for (const wait of waits) {
      const made = wait.for === 'answer' ? answer(input, wait.id, w, find, press)
        : wait.for === 'turn' ? takeTurn(input, wait.id, w, blocks, find, press)
        : settleWait(input, wait, find, press, w)
      if (made) return made
    }
    const view = input.view()
    const planned = plansOf(w, view)
    const holder = getTurnHolder(view)
    if (holder && !members.includes(holder) && !members.some((id) => view.contenders.includes(id))) {
      let contest: { id: string; plan: Plan; kept: boolean } | null = null
      for (const id of members) {
        if (!find('toggleContest', id)) continue
        const kept = heldBlock(blocks, view, id)
        const plan = kept ? kept.plan : planned(`${id}|contest`, () => planNow(wonBy(view, id), members, id, w, input.unnoticed(id)))
        if (plan && (!contest || plan.score > contest.plan.score)) contest = { id, plan, kept: kept !== null }
      }
      const made = contest && press(find('toggleContest', contest.id), `contests the turn: ${contest.plan.why}`)
      if (made && contest) {
        if (!contest.kept) blocks.set(contest.id, blockOf(view, contest.plan))
        return made
      }
    }
    let best: { id: string; begun: SceneState; plan: Plan; kept: boolean } | null = null
    for (const pass of input.pass === 'any' ? (['immediate', 'any'] as const) : (['immediate'] as const)) {
      for (const id of members) {
        const start = find('startTurn', id)
        if (!start) continue
        const begun = begunBy(view, id, start.command)
        const unnoticed = input.unnoticed(id)
        const target = input.notes[id] ?? null
        const kept = heldBlock(blocks, view, id)
        const plan = kept ? kept.plan : planned(`${id}|${pass}|${target}`, () => (pass === 'immediate' ? planNow(begun, members, id, w, unnoticed) : planLater(begun, members, id, w, unnoticed, target)))
        if (plan && (!best || plan.score > best.plan.score)) best = { id, begun, plan, kept: kept !== null }
      }
      if (best) break
    }
    const start = best && find('startTurn', best.id)
    if (best && start) {
      if (!best.kept) blocks.set(best.id, blockOf(best.begun, best.plan))
      return { kind: 'press', pick: start, why: `has something worth doing: ${best.plan.why}` }
    }
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
