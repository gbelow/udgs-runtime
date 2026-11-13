import type { Degree } from '../types'
import type { RootAction, SceneState } from '../scene/types'
import type { CommandContext, SceneCommand } from '../scene/commands/registry'
import { replaceActions } from '../scene/commands/log'
import { getOpenAction } from '../scene/rules/log'
import { isAttackAction, isRootAction } from '../scene/rules/actionCatalog'
import { needsDie } from '../scene/rules/action'
import { getSettled } from '../scene/rules/settle'
import { getHitHOP, getHOPOptions } from '../scene/rules/damage'
import { getOutcomes } from '../scene/projections/outcomes'
import type { Outcome } from '../character/rules/damage'
import { getOpenChoices, type OpenChoice } from '../scene/projections/choices'
import { settle, type Pick } from './declare'

// What the open action would do if its die came up so: a tool for trying a
// declaration before making it. The roll is supposed, everything after it is
// the table's own: what the overflow can buy at that roll is what the open
// choices offer, the purchases are pressed as a person presses them (`settle`),
// and what lands is what the resolve would land (`getSettled`), read off as the
// panel reads it (`getOutcomes`). The answers already declared to it stand.
//
// An attack has no critical (play.tex "Hit Overflow Point"): a hit's overflow
// is its HOP.

export type Supposed = { degree: Degree; HOP?: number }

// The open action as though its die had just come up so: rolled, waiting on
// what its actor chooses before it lands, nothing bought yet. Null for one
// that is not closed by a die.
export function suppose(state: SceneState, roll: Supposed): SceneState | null {
  const open = getOpenAction(state)
  if (!open || !isRootAction(open) || !needsDie(state, open)) return null
  const HOP = roll.degree === 'hit' || roll.degree === 'critical' ? roll.HOP ?? 0 : 0
  const score = { miss: -1, graze: 0, hit: 5 + HOP, critical: 10 + HOP }[roll.degree]
  const rolled = { ...open, step: 'post' as const, spent: {}, roll: { die: 0, DL: 0, score, degree: roll.degree, HOP, skillTerms: [], DLTerms: [] } } as RootAction
  return replaceActions(state, [rolled])
}

export type Prediction =
  // `buys` are the choices open to the actor at that roll (what the overflow
  // can buy, a grapple, an improvement), `spent` the presses that bought
  // `picks`, and `HOP` an attack's overflow and what is left of it after them
  | { ok: true; outcomes: { id: string; outcome: Outcome }[]; buys: OpenChoice[]; spent: SceneCommand[]; HOP: { total: number; remaining: number } | null }
  | { ok: false; refused: string }

// The open action rolled as supposed, with `picks` chosen, before it lands.
type Run = { prediction: Prediction; ready: SceneState | null }

function run(supposed: SceneState, picks: readonly Pick[], ctx: CommandContext): Run {
  const actorId = getOpenAction(supposed)!.actorId
  const buys = getOpenChoices(supposed).filter((c) => c.actorId === actorId && !c.chosen)
  const settled = settle(supposed, picks, ctx, false)
  if (!settled.ok) return { prediction: { ok: false, refused: settled.refused }, ready: null }
  const open = getOpenAction(settled.ready) as RootAction
  const budget = isAttackAction(open) ? getHitHOP(settled.ready, open) : null
  return {
    prediction: { ok: true, outcomes: getOutcomes(settled.ready, getSettled(settled.ready, open)), buys, spent: settled.commands, HOP: budget && { total: budget.total, remaining: budget.remaining } },
    ready: settled.ready,
  }
}

export function predict(state: SceneState, roll: Supposed, picks: readonly Pick[], ctx: CommandContext): Prediction {
  const supposed = suppose(state, roll)
  if (!supposed) return { ok: false, refused: 'the open action is not closed by a die' }
  return run(supposed, picks, ctx).prediction
}

// The overflow of a supposed hit spent on damage, as well as it can be: a hit
// injures by the one kind that gets furthest past its armor and adds the
// effects of every kind it carries (combat.tex "Physical attacks"), so the
// overflow goes all to one kind, and whatever cannot buy another of it to
// smash. Tried: all in smash; and, if the attack carries a cut, slices with
// the rest in smash, and bust then slices with the rest in smash. Slices are
// bought only as far as they raise the cut's tier: past the highest it can
// reach, the HOP buys more in smash, whose blunt effects add to the cut's.
// The best is the one whose injury reaches the highest tier, then the one
// whose kinds reach the most tiers between them, then the one that gets
// furthest past the target's armor. `picks` are bought first
// (a hand switch, an assassination); the other purchases are not tried.
export type Spend = { purchases: Pick[]; prediction: Prediction }
export type BestSpend = { ok: true; best: Spend; tried: Spend[] } | { ok: false; refused: string }

const buy = (purchase: string, times: number): Pick[] => Array.from({ length: Math.max(0, times) }, () => ({ part: 'overflow' as const, value: purchase }))

export function bestSpend(state: SceneState, roll: Supposed, picks: readonly Pick[], ctx: CommandContext): BestSpend {
  const supposed = suppose(state, roll)
  if (!supposed) return { ok: false, refused: 'the open action is not closed by a die' }
  const base = run(supposed, picks, ctx)
  if (!base.prediction.ok || !base.ready) return { ok: false, refused: base.prediction.ok ? 'nothing to spend' : base.prediction.refused }
  const nothing: Spend = { purchases: [], prediction: base.prediction }
  const open = getOpenAction(base.ready) as RootAction
  if (!isAttackAction(open)) return { ok: true, best: nothing, tried: [nothing] }
  const targetId = open.targetId
  const remaining = getHitHOP(base.ready, open).remaining
  const offered = getHOPOptions(base.ready, open)
  const price = (purchase: string): number | null => offered.find((o) => o.purchase === purchase && o.available)?.cost ?? null
  const smash = price('smash')
  const slice = price('slice')
  const bust = price('bust')
  const target = (p: Prediction) => (p.ok ? p.outcomes.find((o) => o.id === targetId)?.outcome ?? null : null)
  const leftover = (left: number): Pick[] => (smash ? buy('smash', Math.floor(left / smash)) : [])
  const tried: Spend[] = [nothing]
  const tryOut = (purchases: Pick[]): Spend => {
    const spend = { purchases, prediction: run(supposed, [...picks, ...purchases], ctx).prediction }
    tried.push(spend)
    return spend
  }
  // after `first`, as few slices as reach the highest cut tier `left` HOP can
  // buy, and the rest in smash; the tier rises with every slice or stays, so
  // the fewest are found by halving
  const sliced = (first: Pick[], left: number): Spend => {
    const unit = slice ?? 0
    // a slice priced at no HOP is counted as one, so the count stays finite
    const most = slice === null ? 0 : Math.floor(left / Math.max(1, unit))
    const known = new Map<number, Spend>()
    const at = (n: number): Spend => known.get(n) ?? known.set(n, tryOut([...first, ...buy('slice', n), ...leftover(left - n * unit)])).get(n)!
    const cutTier = (n: number) => target(at(n).prediction)?.tiers.cut ?? -1
    const top = cutTier(most)
    let [lo, hi] = [0, most]
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2)
      if (cutTier(mid) >= top) hi = mid
      else lo = mid + 1
    }
    return at(lo)
  }
  const spends: Spend[] = []
  if (smash) spends.push(tryOut(leftover(remaining)))
  const carried = target(base.prediction)
  if (carried && 'cut' in carried.tiers) {
    if (slice !== null) spends.push(sliced([], remaining))
    if (bust !== null) spends.push(sliced(buy('bust', 1), remaining - bust))
  }

  const score = (spend: Spend): number[] => {
    const o = target(spend.prediction)
    if (!o) return [-Infinity]
    return [o.tier ?? -1, Object.values(o.tiers).reduce<number>((sum, t) => sum + (t ?? -1), 0), o.damage - o.armor]
  }
  const better = (a: Spend, b: Spend) => {
    const [x, y] = [score(a), score(b)]
    const i = x.findIndex((v, k) => v !== y[k])
    return i >= 0 && x[i] > y[i]
  }
  const best = spends.filter((s) => s.prediction.ok).reduce<Spend | null>((b, s) => (b === null || better(s, b) ? s : b), null)
  return { ok: true, best: best ?? nothing, tried }
}
