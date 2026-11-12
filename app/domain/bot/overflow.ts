import type { AttackAction, HOPPurchase, RootAction, SceneState } from '../scene/types'
import type { Outcome } from '../types'
import { spendHOP } from '../scene/commands/choices'
import { getHOPOptions } from '../scene/rules/damage'
import { getOpenAction } from '../scene/rules/log'
import { getSettled } from '../scene/rules/settle'
import { getOutcomes } from '../scene/projections/outcomes'

// The overflow of a hit (HOP) spent the way a player would: first what is
// bought for the attack it was declared as or adds HOP (assassinate, a braced
// or a hook attack), then the rest on one kind of damage. Penetrating, where
// it is open, does more than slicing, so the cutting way is bust and then
// slice, and smash for what slicing leaves; the blunt way is smash for all
// of it. Whichever comes to more is kept, ranked by death, then injury level,
// then tier, then bleeding, then the damage that got through.

export type Spend = { purchases: HOPPurchase[]; AP: number; STA: number }

export type Spent = { state: SceneState; outcome: Outcome | null; unspent: Outcome | null; spend: Spend }

const FIRST: HOPPurchase[] = ['assassinate', 'braced', 'hook']
const CUTTING: HOPPurchase[] = ['bust', 'slice', 'smash']
const BLUNT: HOPPurchase[] = ['smash']

export function rankOutcome(o: Outcome | null): number {
  if (!o) return -1
  return (o.dead ? 1e9 : 0) + o.IL * 1e6 + ((o.tier ?? -1) + 1) * 1e4 + o.bleed * 1e2 + o.arrived.blunt + o.arrived.cut
}

export function outcomeOn(state: SceneState, open: RootAction, targetId: string): Outcome | null {
  return getOutcomes(state, getSettled(state, open)).find((o) => o.id === targetId)?.outcome ?? null
}

type Bought = { state: SceneState; spend: Spend }

// Each purchase in turn, as many times as the overflow pays for it.
function buyAll(from: Bought, purchases: readonly HOPPurchase[]): Bought {
  let { state, spend } = from
  for (const purchase of purchases) {
    for (;;) {
      const option = getHOPOptions(state, getOpenAction(state) as AttackAction).find((o) => o.purchase === purchase)
      if (!option?.available) break
      const next = spendHOP(purchase)(state)
      if (next === state) break
      state = next
      spend = { purchases: [...spend.purchases, purchase], AP: spend.AP + (option.price?.AP ?? 0), STA: spend.STA + (option.price?.STA ?? 0) }
    }
  }
  return { state, spend }
}

// The attack rolled and waiting at `post`, its overflow spent at its best on
// `targetId`; only a hit has any to spend.
export function spendBest(rolled: SceneState, open: AttackAction, targetId: string): Spent {
  const unspent = outcomeOn(rolled, open, targetId)
  const none: Spent = { state: rolled, outcome: unspent, unspent, spend: { purchases: [], AP: 0, STA: 0 } }
  if (open.roll?.degree !== 'hit') return none
  const first = buyAll({ state: rolled, spend: none.spend }, FIRST)
  let best = none
  for (const way of [CUTTING, BLUNT]) {
    const bought = buyAll(first, way)
    const outcome = outcomeOn(bought.state, getOpenAction(bought.state) as RootAction, targetId)
    if (rankOutcome(outcome) > rankOutcome(best.outcome)) best = { state: bought.state, outcome, unspent, spend: bought.spend }
  }
  return best
}
