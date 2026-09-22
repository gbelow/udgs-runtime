import type { AfflictionKey, CampaignCharacter, Condition, Degree, Delivery } from '../../types'
import { AFFLICTIONS, WOUNDS } from '../../tables'
import { SPELLS, isSpellKey } from '../../spells'
import { getCurses } from '../rules/curses'
import { Outcome, getOutcome } from '../rules/damage'
import { skillLenses } from '../lenses'
import { scoreTest } from '../rules/test'
import { payCost } from './cost'

// The one place a delivered effect changes a character. A delivery whose
// degree is known lands now: the effect is applied, and what its landing
// came to is held against the gate of each follow-up, which is then
// delivered in turn. One that leaves a test to the target waits in
// `pending` for their die; one with neither lands at full strength. One
// that locks is not applied but carried: the character keeps the reference
// and reads the effect off the catalog until they beat it. Buffs and
// suppressions are never applied: they are read off the catalogs for as
// long as their source is in effect; what goes to the ground is the
// board's.
export function deliver(delivery: Delivery): (c: CampaignCharacter) => CampaignCharacter {
  return (c: CampaignCharacter) => {
    if (delivery.degree === null && delivery.test !== null) return { ...c, pending: [...c.pending, delivery] }
    const degree = delivery.degree ?? 'hit'
    const { effect } = delivery
    if (delivery.locks !== null) {
      const carried = c.active.some((e) => e.kind === 'curse' && e.key === delivery.locks)
      return follow(delivery, degree, null)(carried ? c : { ...c, active: [...c.active, { kind: 'curse', key: delivery.locks, DL: delivery.test?.DL ?? 0 }] })
    }
    switch (effect.type) {
      case 'cost':
        return follow(delivery, degree, null)(payCost(effect.effect)(c))
      case 'damage': {
        const outcome = getOutcome(effect.effect, degree, c)
        return follow(delivery, degree, outcome)(takeOutcome(outcome)(c))
      }
      case 'affliction':
        return follow(delivery, degree, null)(inflict([effect.effect.key])(c))
      case 'buff':
      case 'suppression':
      case 'terrain':
        return follow(delivery, degree, null)(c)
    }
  }
}

// spells.tex "Curse": "holds until the target shrugs it off" — the test the
// curse's effect names, rolled again against the DL it landed with; a hit
// or better and the curse is gone.
export function resistCurse(key: string, die: number): (c: CampaignCharacter) => CampaignCharacter {
  return (c: CampaignCharacter) => {
    const curse = getCurses(c).find((e) => e.key === key)
    if (!curse || !isSpellKey(key)) return c
    const resist = SPELLS[key].effects.find((e) => e.duration === 'locked' && e.resist)?.resist
    if (!resist) return c
    const degree = scoreTest(die + skillLenses[resist.roll].get(c), curse.DL)
    return resisted(degree) === 'miss' ? { ...c, active: c.active.filter((e) => !(e.kind === 'curse' && e.key === key)) } : c
  }
}

// combat.tex "Evasion": a reflex test against what is coming turns the
// target's degree against it — "On a graze ... only takes half damage", on
// a miss the whole of it, on a hit or better none.
export function resisted(degree: Degree): Degree {
  switch (degree) {
    case 'miss': return 'hit'
    case 'graze': return 'graze'
    default: return 'miss'
  }
}

// The target's die on a pending delivery: their skill against the DL the
// producer set, and the effect lands at the degree their result turns into,
// or not at all. Either way the wait is over.
export function resolvePending(index: number, die: number): (c: CampaignCharacter) => CampaignCharacter {
  return (c: CampaignCharacter) => {
    const delivery = c.pending[index]
    if (!delivery?.test) return c
    const degree = resisted(scoreTest(die + skillLenses[delivery.test.roll].get(c), delivery.test.DL))
    const rest = { ...c, pending: c.pending.filter((_, i) => i !== index) }
    return degree === 'miss' ? rest : deliver({ ...delivery, degree, test: delivery.test })(rest)
  }
}

// combat.tex "Cutting damage": poison lands "when damage is at least T0" —
// what a follow-up asks of its parent's outcome before it is delivered.
function passes(when: Condition | null, outcome: Outcome | null): boolean {
  if (when === null) return true
  if (when.minTier !== null && (outcome === null || outcome.tier === null || outcome.tier < when.minTier)) return false
  return true
}

// A follow-up that decides nothing for itself lands as hard as its parent.
function follow(delivery: Delivery, degree: Degree, outcome: Outcome | null): (c: CampaignCharacter) => CampaignCharacter {
  return (c: CampaignCharacter) =>
    delivery.then
      .filter((next) => passes(next.when, outcome))
      .reduce((acc, next) => deliver(next.degree === null && next.test === null ? { ...next, degree } : next)(acc), c)
}

// combat.tex "Afflictions": one of a group at a time, the one put on last
// standing in for whatever of the group was carried. A key already carried
// is not carried twice.
function inflict(keys: AfflictionKey[]): (c: CampaignCharacter) => CampaignCharacter {
  return (c: CampaignCharacter) =>
    keys.reduce((acc, key) => {
      const { group } = AFFLICTIONS[key]
      const rest = group ? acc.afflictions.filter((k) => AFFLICTIONS[k].group !== group) : acc.afflictions
      return { ...acc, afflictions: rest.includes(key) ? rest : [...rest, key] }
    }, c)
}

// combat.tex "Injury level", "Bleed", "Wounds", "Interruption": the injury
// lands on the level, the bleed on its intensity, the wound joins what the
// character carries in `active` until it is healed, and a death from the
// head puts the level at the threshold that is death. A wound already
// carried is not carried twice, and its affliction is read off it rather
// than stored; what the damage inflicts beyond the wound — unconsciousness,
// a burning — is written.
function takeOutcome(outcome: Outcome): (c: CampaignCharacter) => CampaignCharacter {
  return (c: CampaignCharacter) => {
    const { wound } = outcome
    const carried = wound && c.active.some((e) => e.kind === 'wound' && e.key === wound.key && (e.hand ?? null) === wound.hand)
    const active = wound && !carried
      ? [...c.active, { kind: 'wound' as const, key: wound.key, ...(wound.hand !== null ? { hand: wound.hand } : {}) }]
      : c.active
    const injuryLevel = c.injuries.injuryLevel + outcome.IL
    const wounded = wound ? WOUNDS[wound.key].affliction ?? null : null
    return inflict(outcome.afflictions.filter((a) => a !== wounded))({
      ...c,
      active,
      injuries: {
        ...c.injuries,
        injuryLevel: outcome.dead ? Math.max(injuryLevel, c.injuries.deathThreshold) : injuryLevel,
        bleed: c.injuries.bleed + outcome.bleed,
      },
      resources: { ...c.resources, AP: c.resources.AP - outcome.apLoss },
    })
  }
}
