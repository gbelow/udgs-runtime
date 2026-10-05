import type { ActionKind, AttackAction, CombatState, HOPPurchase, RootAction } from '../combat/types'
import type { Outcome } from '../types'
import type { Dice } from '../combat/dice'
import { rollOrPay } from '../combat/commands/action'
import { spendHOP } from '../combat/commands/choices'
import { appendActions } from '../combat/commands/log'
import { getAttackFacts, getHOPOptions } from '../combat/rules/damage'
import { getBreakOdds, getBreakRisks } from '../combat/rules/breakage'
import { injuryMap } from '../tables'
import { getDefaultAim, getFreeAttackOptions } from '../combat/rules/attack'
import { getPayableCost } from '../combat/rules/action'
import { getSettled } from '../combat/rules/settle'
import { getAction, getOpenAction } from '../combat/rules/log'
import { getOutcomes } from '../combat/projections/outcomes'
import { getStrikeDefenses } from './defenses'
import { getStrikes, type Strike } from './weapons'

// What an attack would do to one foe as the fight stands, for a bot choosing
// among its attacks: every row and variation the attacker can pay for and
// reach the foe with, against every defense the foe could still answer with
// (read off the same options the panel offers it), over every value of the
// attacker's die, the overflow of a hit (HOP) spent on whatever does the most.
// A defense is a static DL (combat.tex "Defend"), so only the attacker's die is
// thrown. The d10 explodes where the test says it does (play.tex "Exploding
// die"), a normal test.
//
// The injury level (IL) is what an attack adds to the foe, capped at what it
// has left before death. What it costs is the attack's own AP and STA, and the
// AP and STA a HOP purchase adds, so IL per AP, per STA and per weighted cost
// can be compared across attacks. Equipment breakage (gear.tex "Equipment
// Breakage") is valued in the same unit by the table's ruling: a weapon that
// breaks is worth a tier 3 injury and a shield a tier 2 one, to whoever it
// is taken from. The value of an attack is its IL plus the foe's breakage less
// the attacker's own. Armor breakage is left out.

export type EstimateOptions = {
  // where the blow is aimed, a body location the foe has; the chest otherwise
  aim?: string
  // how many AP an STA is worth, for the single cost to rank by
  staWeight?: number
}

export type BreakEstimate = {
  // whose item gives way
  owner: 'attacker' | 'foe'
  kind: 'weapon' | 'shield'
  // the odds, over the die
  odds: number
}

// The IL an item is worth, by the table's ruling.
const BREAK_IL = { weapon: injuryMap.T3.IL, shield: injuryMap.T2.IL } as const

export type DieResult = {
  die: number
  p: number
  degree: string
  score: number
  DL: number
  HOP: number
  // the overflow's best spend and what it costs the attacker on top
  spent: HOPPurchase[]
  extra: { AP: number; STA: number }
  outcome: Outcome | null
  breaks: BreakEstimate[]
}

export type DefenseEstimate = {
  label: string
  kind: ActionKind | 'none'
  // what answering costs the foe
  cost: { AP: number; STA: number }
  // landings that came to the same thing as this one, an evasive jump's
  landings: number
  pHit: number
  pGraze: number
  pStun: number
  pDead: number
  // IL added, with the overflow spent and without
  expectedIL: number
  expectedILUnspent: number
  expectedBleed: number
  expectedAPLoss: number
  expectedArrived: number
  // the items the blow puts at risk, over the die, and what they come to in IL: the foe's
  // counted for the attacker, the attacker's against it
  breaks: BreakEstimate[]
  expectedBreakIL: number
  // IL added plus the breakage
  value: number
  // what the best HOP spend costs the attacker on top of the attack, on average
  expectedExtra: { AP: number; STA: number }
  byDie: DieResult[]
}

export type AttackEstimate = {
  kind: 'strike' | 'shoot'
  weapon: string
  attack: string
  variant: string
  label: string
  // the attack's own price
  cost: { AP: number; STA: number }
  // every answer the foe has, and no answer at all, in the order of the foe's preference
  defenses: DefenseEstimate[]
  // the answer that leaves the attacker the least: what the foe is assumed to choose
  guarded: DefenseEstimate
  expectedIL: number
  expectedBreakIL: number
  // IL added plus the breakage, what the attacks are ranked by
  value: number
  // total price with the HOP purchases made, in AP, in STA and weighted
  totalCost: { AP: number; STA: number; weighted: number }
  ilPerAP: number | null
  ilPerSTA: number | null
  ilPerCost: number
}

type Spend = { purchases: HOPPurchase[]; AP: number; STA: number }

// The d10 as (value, probability). Where the test explodes, a 9 adds d6s while
// they show 6 and a 0 subtracts them; the tail is cut at two d6s and the rest
// folded into the last value.
function distribution(explodes: boolean): { value: number; p: number }[] {
  const faces = Array.from({ length: 10 }, (_, face) => ({ value: face, p: 0.1 }))
  if (!explodes) return faces
  const sums: { s: number; p: number }[] = []
  for (let j = 1; j <= 5; j++) sums.push({ s: j, p: 1 / 6 })
  for (let j = 1; j <= 5; j++) sums.push({ s: 6 + j, p: 1 / 36 })
  sums.push({ s: 13, p: 1 / 36 })
  return [
    ...faces.filter((f) => f.value !== 0 && f.value !== 9),
    ...sums.map(({ s, p }) => ({ value: 9 + s, p: 0.1 * p })),
    ...sums.map(({ s, p }) => ({ value: -s, p: 0.1 * p })),
  ]
}

// The attack's die, then nines for whatever else is thrown with it: the
// percentiles of breakage are read as chances instead.
function scripted(value: number, flags?: boolean[]): Dice {
  let thrown = 0
  return (explodes) => {
    flags?.push(explodes)
    return thrown++ === 0 ? value : 9
  }
}

// What a blow comes to, to rank by: death, then injury level, then tier, then
// bleeding, then the damage that got through.
function rank(o: Outcome | null): number {
  if (!o) return -1
  return (o.dead ? 1e9 : 0) + o.IL * 1e6 + ((o.tier ?? -1) + 1) * 1e4 + o.bleed * 1e2 + o.arrived.blunt + o.arrived.cut
}

const NO_DEFENSE: Defense = { label: 'no defense', kind: 'none', declare: null, cost: { AP: 0, STA: 0 } }

type Defense = { label: string; kind: ActionKind | 'none'; declare: ((state: CombatState, open: RootAction, newId: () => string) => CombatState | null) | null; cost: { AP: number; STA: number } }

type Play = { degree: string; score: number; DL: number; HOP: number; best: Outcome | null; spend: Spend; unspent: Outcome | null; breaks: BreakEstimate[] }

export function estimateAttacks(state: CombatState, attackerId: string, targetId: string, options: EstimateOptions = {}): AttackEstimate[] {
  const staWeight = options.staWeight ?? 1
  let ids = 0
  const newId = () => `estimate${++ids}`
  const target = state.characters[targetId]
  if (!target || !state.characters[attackerId]) return []
  const room = Math.max(0, target.injuries.deathThreshold - target.injuries.injuryLevel)

  const outcomeOn = (s: CombatState, open: RootAction): Outcome | null => getOutcomes(s, getSettled(s, open)).find((o) => o.id === targetId)?.outcome ?? null

  const aimed = (strike: Strike): CombatState => {
    const part = options.aim ? target.body.find((p) => p.location === options.aim && !p.lost) : undefined
    const aim = part ? { location: part.location, part: part.id } : getDefaultAim(target)
    return appendActions(strike.state, [{ ...strike.open, targetId, ...aim }])
  }

  // every way of spending the overflow of a hit, as states at `post`
  const spends = (rolled: CombatState): { state: CombatState; spend: Spend }[] => {
    const seen = new Set<string>()
    const found: { state: CombatState; spend: Spend }[] = []
    const walk = (s: CombatState, purchases: HOPPurchase[], AP: number, STA: number): void => {
      const now = getOpenAction(s) as AttackAction
      const key = JSON.stringify(now.spent)
      if (seen.has(key) || found.length > 400) return
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

  // the items the blow puts at risk as it lands, the armor left out
  const breaksOf = (s: CombatState, root: AttackAction): BreakEstimate[] =>
    getBreakRisks(s, root, getAttackFacts(s, root))
      .filter((risk) => risk.slot === 'defender' || risk.slot === 'attacker')
      .map((risk) => ({ owner: risk.swung ? 'attacker' as const : 'foe' as const, kind: risk.shield ? 'shield' as const : 'weapon' as const, odds: getBreakOdds(risk) }))
      .filter((b) => b.odds > 0)

  const play = (locked: CombatState, openId: string, defense: Defense, dice: Dice): Play | null => {
    let s = locked
    if (defense.declare) {
      const declared = defense.declare(s, getOpenAction(s) as RootAction, newId)
      if (!declared) return null
      s = declared
    }
    const rolled = rollOrPay(dice, newId)(s)
    if (rolled === s) return null
    s = rolled

    const now = getOpenAction(s)
    if (now && now.step === 'post' && (now.kind === 'strike' || now.kind === 'shoot')) {
      const roll = now.roll
      const unspent = outcomeOn(s, now)
      const choices = roll?.degree === 'hit' ? spends(s) : [{ state: s, spend: { purchases: [], AP: 0, STA: 0 } }]
      let best = { outcome: unspent, spend: choices[0].spend, state: choices[0].state }
      for (const c of choices) {
        const o = outcomeOn(c.state, getOpenAction(c.state) as RootAction)
        const better = rank(o) - rank(best.outcome) || best.spend.AP + best.spend.STA - (c.spend.AP + c.spend.STA)
        if (better > 0) best = { outcome: o, spend: c.spend, state: c.state }
      }
      return { degree: roll?.degree ?? 'miss', score: roll?.score ?? 0, DL: roll?.DL ?? 0, HOP: roll?.HOP ?? 0, best: best.outcome, spend: best.spend, unspent, breaks: breaksOf(best.state, getOpenAction(best.state) as AttackAction) }
    }
    const landed = getAction(s, openId)
    if (!landed || (landed.kind !== 'strike' && landed.kind !== 'shoot')) return null
    const outcome = landed.results.find((r) => r.targetId === targetId)?.outcome ?? null
    return { degree: landed.roll?.degree ?? 'miss', score: landed.roll?.score ?? 0, DL: landed.roll?.DL ?? 0, HOP: landed.roll?.HOP ?? 0, best: outcome, spend: { purchases: [], AP: 0, STA: 0 }, unspent: outcome, breaks: breaksOf(s, landed) }
  }

  const estimateDefense = (locked: CombatState, openId: string, defense: Defense): DefenseEstimate | null => {
    const flags: boolean[] = []
    if (play(locked, openId, defense, scripted(5, flags)) === null) return null
    const byDie: DieResult[] = []
    const e = { hit: 0, graze: 0, stun: 0, dead: 0, IL: 0, unspent: 0, bleed: 0, APLoss: 0, arrived: 0, AP: 0, STA: 0, breakIL: 0 }
    const broken = new Map<string, BreakEstimate>()
    for (const { value, p } of distribution(flags[0] ?? true)) {
      const r = play(locked, openId, defense, scripted(value))
      if (!r) continue
      const IL = Math.min(r.best?.IL ?? 0, room)
      byDie.push({ die: value, p, degree: r.degree, score: r.score, DL: r.DL, HOP: r.HOP, spent: r.spend.purchases, extra: { AP: r.spend.AP, STA: r.spend.STA }, outcome: r.best, breaks: r.breaks })
      if (r.degree === 'hit') e.hit += p
      if (r.degree === 'graze') e.graze += p
      if (r.best && r.best.interruption !== 'none') e.stun += p
      if (r.best?.dead) e.dead += p
      e.IL += p * IL
      e.unspent += p * Math.min(r.unspent?.IL ?? 0, room)
      e.bleed += p * (r.best?.bleed ?? 0)
      e.APLoss += p * (r.best?.apLoss ?? 0)
      e.arrived += p * ((r.best?.arrived.blunt ?? 0) + (r.best?.arrived.cut ?? 0))
      for (const b of r.breaks) {
        const key = `${b.owner} ${b.kind}`
        broken.set(key, { ...b, odds: (broken.get(key)?.odds ?? 0) + p * b.odds })
        e.breakIL += p * b.odds * BREAK_IL[b.kind] * (b.owner === 'foe' ? 1 : -1)
      }
      e.AP += p * r.spend.AP
      e.STA += p * r.spend.STA
    }
    return {
      label: defense.label,
      kind: defense.kind,
      cost: defense.cost,
      landings: 1,
      pHit: e.hit,
      pGraze: e.graze,
      pStun: e.stun,
      pDead: e.dead,
      expectedIL: e.IL,
      expectedILUnspent: e.unspent,
      expectedBleed: e.bleed,
      expectedAPLoss: e.APLoss,
      expectedArrived: e.arrived,
      breaks: [...broken.values()],
      expectedBreakIL: e.breakIL,
      value: e.IL + e.breakIL,
      expectedExtra: { AP: e.AP, STA: e.STA },
      byDie: byDie.sort((a, b) => a.die - b.die),
    }
  }

  const sameResult = (a: DefenseEstimate, b: DefenseEstimate): boolean =>
    a.kind === 'evasiveJump' && b.kind === 'evasiveJump' && JSON.stringify({ ...a, label: '', landings: 0 }) === JSON.stringify({ ...b, label: '', landings: 0 })

  return getStrikes(state, attackerId, 'strike', newId).concat(getStrikes(state, attackerId, 'shoot', newId))
    .filter((strike) => strike.targets.includes(targetId))
    .flatMap((strike): AttackEstimate[] => {
      const locked = aimed(strike)
      const openId = strike.open.id
      const defenses: DefenseEstimate[] = []
      for (const defense of [...getStrikeDefenses(locked, targetId, attackerId), NO_DEFENSE]) {
        const estimate = estimateDefense(locked, openId, defense)
        if (!estimate) continue
        const twin = defenses.find((d) => sameResult(d, estimate))
        if (twin) twin.landings++
        else defenses.push(estimate)
      }
      if (defenses.length === 0) return []

      const open = strike.open
      const priced = getPayableCost(locked, open)
      const cost = { AP: priced?.AP ?? 0, STA: priced?.STA ?? 0 }
      const weapon = getFreeAttackOptions(state, state.characters[attackerId], open.kind).find((o) => o.weaponKey === open.weaponKey && o.attack === open.attack && o.variant === open.variant)?.weapon ?? open.weaponKey
      return [guardedBy({ kind: open.kind, weapon, attack: open.attack, variant: open.variant, label: `${weapon} ${open.attack} (${open.variant})`, cost }, defenses, staWeight)]
    })
}

// The attack as the foe answers it: of the answers it has, the one that leaves
// the attacker the least, the cheaper answer when two come to the same.
export function guardedBy(attack: Pick<AttackEstimate, 'kind' | 'weapon' | 'attack' | 'variant' | 'label' | 'cost'>, answers: readonly DefenseEstimate[], staWeight = 1): AttackEstimate {
  const preferred = [...answers].sort((a, b) => a.value - b.value || a.cost.AP + a.cost.STA - (b.cost.AP + b.cost.STA))
  const guarded = preferred[0]
  const total = { AP: attack.cost.AP + guarded.expectedExtra.AP, STA: attack.cost.STA + guarded.expectedExtra.STA, weighted: 0 }
  total.weighted = total.AP + staWeight * total.STA
  return {
    ...attack,
    defenses: preferred,
    guarded,
    expectedIL: guarded.expectedIL,
    expectedBreakIL: guarded.expectedBreakIL,
    value: guarded.value,
    totalCost: total,
    ilPerAP: total.AP > 0 ? guarded.value / total.AP : null,
    ilPerSTA: total.STA > 0 ? guarded.value / total.STA : null,
    ilPerCost: total.weighted > 0 ? guarded.value / total.weighted : Math.sign(guarded.value) * Infinity || 0,
  }
}

// The attacks ranked best first: the most value for what they cost, the foe
// answering as it best can; ties go to the harder hitting.
export function rankAttacks(estimates: readonly AttackEstimate[]): AttackEstimate[] {
  return [...estimates].sort((a, b) => b.ilPerCost - a.ilPerCost || b.value - a.value)
}
