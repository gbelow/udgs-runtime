import type { CampaignCharacter, Condition, Delivery } from '../../types'
import { Outcome, getOutcome } from '../lenses/damage'
import { payCost } from './cost'

// The one place a delivered effect changes a character. A delivery whose
// degree is known lands now: the effect is applied, and what its landing
// came to is held against the gate of each follow-up, which is then
// delivered in turn. One whose degree is still the target's to decide waits
// in `pending` for their test. Buffs and suppressions are never applied:
// they are read off the catalogs for as long as their source is in effect.
export function deliver(delivery: Delivery): (c: CampaignCharacter) => CampaignCharacter {
  return (c: CampaignCharacter) => {
    if (delivery.degree === null) return { ...c, pending: [...c.pending, delivery] }
    const { effect } = delivery
    switch (effect.type) {
      case 'cost':
        return follow(delivery, null)(payCost(effect.effect)(c))
      case 'damage': {
        const outcome = getOutcome(effect.effect, delivery.degree, c)
        return follow(delivery, outcome)(takeOutcome(outcome)(c))
      }
      case 'buff':
      case 'suppression':
        return follow(delivery, null)(c)
    }
  }
}

// combat.tex "Cutting damage": poison lands "when damage is at least T0" —
// what a follow-up asks of its parent's outcome before it is delivered.
function passes(when: Condition | null, outcome: Outcome | null): boolean {
  if (when === null) return true
  if (when.minTier !== null && (outcome === null || outcome.tier === null || outcome.tier < when.minTier)) return false
  return true
}

function follow(delivery: Delivery, outcome: Outcome | null): (c: CampaignCharacter) => CampaignCharacter {
  return (c: CampaignCharacter) => delivery.then.filter((next) => passes(next.when, outcome)).reduce((acc, next) => deliver(next)(acc), c)
}

// combat.tex "Injury level", "Bleed", "Wounds", "Interruption": the injury
// lands on the level, the bleed on its intensity, the wound joins what the
// character carries in `active` until it is healed, and a death from the
// head puts the level at the threshold that is death. A wound already
// carried is not carried twice, and its affliction is read off it rather
// than stored; only unconsciousness, which no wound carries, is written.
function takeOutcome(outcome: Outcome): (c: CampaignCharacter) => CampaignCharacter {
  return (c: CampaignCharacter) => {
    const { wound } = outcome
    const carried = wound && c.active.some((e) => e.kind === 'wound' && e.key === wound.key && (e.hand ?? null) === wound.hand)
    const active = wound && !carried
      ? [...c.active, { kind: 'wound' as const, key: wound.key, ...(wound.hand !== null ? { hand: wound.hand } : {}) }]
      : c.active
    const injuryLevel = c.injuries.injuryLevel + outcome.IL
    return {
      ...c,
      active,
      afflictions: [...new Set([...c.afflictions, ...outcome.afflictions.filter((a) => a === 'unconscious')])],
      injuries: {
        ...c.injuries,
        injuryLevel: outcome.dead ? Math.max(injuryLevel, c.injuries.deathThreshold) : injuryLevel,
        bleed: c.injuries.bleed + outcome.bleed,
      },
      resources: { ...c.resources, AP: c.resources.AP - outcome.apLoss },
    }
  }
}
