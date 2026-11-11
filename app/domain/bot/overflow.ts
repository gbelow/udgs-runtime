import type { AttackAction, HOPPurchase, RootAction, SceneState } from '../scene/types'
import type { Outcome } from '../types'
import { spendHOP } from '../scene/commands/choices'
import { getHOPOptions } from '../scene/rules/damage'
import { getOpenAction } from '../scene/rules/log'
import { getSettled } from '../scene/rules/settle'
import { getOutcomes } from '../scene/projections/outcomes'

// The overflow of a hit (HOP) spent on whatever does the most to the target:
// every way of spending it the attack offers is tried, and the blow it comes
// to is ranked by death, then injury level, then tier, then bleeding, then
// the damage that got through; of two that come to the same, the cheaper.

export type Spend = { purchases: HOPPurchase[]; AP: number; STA: number }

export type Spent = { state: SceneState; outcome: Outcome | null; unspent: Outcome | null; spend: Spend }

// Past this many ways of spending it, the rest are not tried.
const MOST_TRIED = 400

export function rankOutcome(o: Outcome | null): number {
  if (!o) return -1
  return (o.dead ? 1e9 : 0) + o.IL * 1e6 + ((o.tier ?? -1) + 1) * 1e4 + o.bleed * 1e2 + o.arrived.blunt + o.arrived.cut
}

export function outcomeOn(state: SceneState, open: RootAction, targetId: string): Outcome | null {
  return getOutcomes(state, getSettled(state, open)).find((o) => o.id === targetId)?.outcome ?? null
}

// Every way of spending the overflow of the attack at `post`, as states.
function getSpends(rolled: SceneState): { state: SceneState; spend: Spend }[] {
  const seen = new Set<string>()
  const found: { state: SceneState; spend: Spend }[] = []
  const walk = (s: SceneState, purchases: HOPPurchase[], AP: number, STA: number): void => {
    const now = getOpenAction(s) as AttackAction
    const key = JSON.stringify(now.spent)
    if (seen.has(key) || found.length > MOST_TRIED) return
    seen.add(key)
    found.push({ state: s, spend: { purchases, AP, STA } })
    for (const option of getHOPOptions(s, now)) {
      if (!option.available) continue
      const next = spendHOP(option.purchase)(s)
      if (next === s) continue
      walk(next, [...purchases, option.purchase], AP + (option.price?.AP ?? 0), STA + (option.price?.STA ?? 0))
    }
  }
  walk(rolled, [], 0, 0)
  return found
}

// The attack rolled and waiting at `post`, its overflow spent at its best on
// `targetId`; only a hit has any to spend.
export function spendBest(rolled: SceneState, open: AttackAction, targetId: string): Spent {
  const unspent = outcomeOn(rolled, open, targetId)
  const choices = open.roll?.degree === 'hit' ? getSpends(rolled) : [{ state: rolled, spend: { purchases: [], AP: 0, STA: 0 } }]
  let best: Spent = { state: choices[0].state, outcome: unspent, unspent, spend: choices[0].spend }
  for (const c of choices) {
    const o = outcomeOn(c.state, getOpenAction(c.state) as RootAction, targetId)
    const better = rankOutcome(o) - rankOutcome(best.outcome) || best.spend.AP + best.spend.STA - (c.spend.AP + c.spend.STA)
    if (better > 0) best = { state: c.state, outcome: o, unspent, spend: c.spend }
  }
  return best
}
