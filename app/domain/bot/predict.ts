import type { Degree } from '../types'
import type { AttackAction, HOPPurchase, RootAction, SceneState } from '../scene/types'
import type { CommandContext, SceneCommand } from '../scene/commands/registry'
import { replaceActions } from '../scene/commands/log'
import { getOpenAction } from '../scene/rules/log'
import { isAttackAction, isRootAction } from '../scene/rules/actionCatalog'
import { needsDie } from '../scene/rules/action'
import { getSettled } from '../scene/rules/settle'
import { isObjectAttack } from '../scene/rules/equipment'
import { getAttackFacts, getHitHOP, getHOPOptions, outcomeOf } from '../scene/rules/damage'
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

// The overflow of a hit spent on damage, as well as it can be: a hit injures
// by the one kind that gets furthest past its armor and adds the effects of
// every kind it carries (combat.tex "Physical attacks"), so the overflow goes
// all to one kind, and whatever cannot buy another of it to smash. Tried: all
// in smash; and, if the attack carries a cut, every count of slices with the
// rest in smash, and bust then every count of slices with the rest in smash.
// The best is the one whose injury reaches the highest tier, then the one
// whose kinds reach the most tiers between them, then the one that gets
// furthest past the target's armor. An assassination is bought first whenever
// it is offered, and the rest spent with the HOP it gives (the user's ruling).
// Each is read off the damage rules as the landing reads them
// (`getAttackFacts`, `outcomeOf`), with nothing pressed: `root` is a rolled
// hit, with whatever it has bought already.
//
// What a spend comes to reads the hit's degree but not its HOP, so a caller
// spending the same hit at several HOPs passes one `known` for all of them,
// and each spend is read once.
export type Purchases = Partial<Record<HOPPurchase, number>>

export function getBestSpend(state: SceneState, root: AttackAction, known?: Map<string, Outcome | null>): { purchases: Purchases; outcome: Outcome | null } {
  const offered = getHOPOptions(state, root)
  if (offered.some((o) => o.purchase === 'assassinate' && o.available)) {
    const rest = getBestSpend(state, { ...root, spent: { ...root.spent, assassinate: (root.spent.assassinate ?? 0) + 1 } }, known)
    return { purchases: { assassinate: 1, ...rest.purchases }, outcome: rest.outcome }
  }
  // one aimed at an object injures nobody, whoever holds it
  const target = root.targetId && !isObjectAttack(root) ? state.characters[root.targetId] : undefined
  const spentWith = (purchases: Purchases) => {
    const spent = { ...root.spent }
    for (const [p, n] of Object.entries(purchases) as [HOPPurchase, number][]) spent[p] = (spent[p] ?? 0) + n
    return spent
  }
  const read = (purchases: Purchases): Outcome | null => {
    if (!known) return readSpend(purchases)
    const key = (Object.entries(spentWith(purchases)) as [HOPPurchase, number][]).filter(([, n]) => n > 0).sort(([a], [b]) => (a < b ? -1 : 1)).map(([p, n]) => `${p}${n}`).join(' ')
    if (known.has(key)) return known.get(key) ?? null
    const outcome = readSpend(purchases)
    known.set(key, outcome)
    return outcome
  }
  const readSpend = (purchases: Purchases): Outcome | null => {
    const facts = getAttackFacts(state, { ...root, spent: spentWith(purchases) })
    return facts && target ? outcomeOf(facts, target) : null
  }
  const price = (p: HOPPurchase): number | null => offered.find((o) => o.purchase === p && o.available)?.cost ?? null
  const remaining = getHitHOP(state, root).remaining
  const smash = price('smash')
  const slice = price('slice')
  const bust = price('bust')
  const withSmash = (left: number, rest: Purchases): Purchases => (smash && left >= smash ? { ...rest, smash: Math.floor(left / smash) } : rest)
  const spends: Purchases[] = [withSmash(remaining, {})]
  const carried = read({})
  if (carried && 'cut' in carried.tiers) {
    const sliced = (left: number, first: Purchases) => {
      if (slice === null || slice <= 0) return
      for (let n = 1; n * slice <= left; n++) spends.push(withSmash(left - n * slice, { ...first, slice: n }))
    }
    sliced(remaining, {})
    if (bust !== null && bust <= remaining) {
      spends.push(withSmash(remaining - bust, { bust: 1 }))
      sliced(remaining - bust, { bust: 1 })
    }
  }
  // a braced or hook attack's bonus, bought for its AP and STA rather than
  // HOP (combat.tex "Braced Attack", "Hook Attack"), tried on every spend
  for (const p of ['braced', 'hook'] as const) if (price(p) !== null) spends.push(...spends.map((s) => ({ ...s, [p]: 1 })))
  const score = (o: Outcome | null): number[] => (o ? [o.tier ?? -1, Object.values(o.tiers).reduce<number>((sum, t) => sum + (t ?? -1), 0), o.damage - o.armor] : [-Infinity])
  const better = (x: number[], y: number[]) => {
    const i = x.findIndex((v, k) => v !== y[k])
    return i >= 0 && x[i] > y[i]
  }
  let best = { purchases: spends[0], outcome: read(spends[0]) }
  for (const purchases of spends.slice(1)) {
    const outcome = read(purchases)
    if (better(score(outcome), score(best.outcome))) best = { purchases, outcome }
  }
  return best
}

// The overflow of a supposed hit spent as `getBestSpend` spends it, pressed
// as a person presses it, after `picks` (a hand switch, an assassination).
// `tried` are the spends pressed: none, and the best; `outcome` is what the
// best was read to come to.
export type Spend = { purchases: Pick[]; prediction: Prediction }
export type BestSpend = { ok: true; best: Spend; tried: Spend[]; outcome: Outcome | null } | { ok: false; refused: string }

const buy = (purchase: string, times: number): Pick[] => Array.from({ length: Math.max(0, times) }, () => ({ part: 'overflow' as const, value: purchase }))

// The presses that buy what `getBestSpend` spends the rolled hit's overflow on.
export function getBestSpendPicks(state: SceneState, root: AttackAction): Pick[] {
  return (Object.entries(getBestSpend(state, root).purchases) as [HOPPurchase, number][]).flatMap(([p, n]) => buy(p, n))
}

export function bestSpend(state: SceneState, roll: Supposed, picks: readonly Pick[], ctx: CommandContext): BestSpend {
  const supposed = suppose(state, roll)
  if (!supposed) return { ok: false, refused: 'the open action is not closed by a die' }
  const base = run(supposed, picks, ctx)
  if (!base.prediction.ok || !base.ready) return { ok: false, refused: base.prediction.ok ? 'nothing to spend' : base.prediction.refused }
  const nothing: Spend = { purchases: [], prediction: base.prediction }
  const open = getOpenAction(base.ready) as RootAction
  if (!isAttackAction(open)) return { ok: true, best: nothing, tried: [nothing], outcome: null }
  const chosen = getBestSpend(base.ready, open)
  const purchases = (Object.entries(chosen.purchases) as [HOPPurchase, number][]).flatMap(([p, n]) => buy(p, n))
  if (purchases.length === 0) return { ok: true, best: nothing, tried: [nothing], outcome: chosen.outcome }
  const best: Spend = { purchases, prediction: run(supposed, [...picks, ...purchases], ctx).prediction }
  return { ok: true, best, tried: [nothing, best], outcome: chosen.outcome }
}
