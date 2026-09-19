import { describe, it, expect } from 'vitest'
import { CombatStateSchema, StrikeFactsSchema, type CombatState, type StrikeFacts } from '../types'
import { makeCampaignCharacter } from '../../factories'
import type { CampaignCharacter } from '../../types'
import { HIT_LOCATIONS } from '../../lists'
import { LOCATIONS, injuryMap } from '../../tables'
import { getOutcome, getOutcomePreview } from './damage'
import { getOpenAction } from './action'
import { declareAction, resolveAction, rollAction, setTarget } from '../commands/action'

const target = makeCampaignCharacter({})

function facts(overrides: Partial<StrikeFacts>): StrikeFacts {
  return StrikeFactsSchema.parse({ degree: 'hit', hardness: 4, ...overrides })
}

const damages = Array.from({ length: 60 }, (_, i) => i * 3)

describe('localized damage', () => {
  // combat.tex "Localized damage": "Maximum injury tier applied to the body is
  // 2" for the hand and 3 for the leg — whatever the blow, the body takes no
  // more IL than that tier's row.
  it.each(HIT_LOCATIONS)('caps what the body takes from a hit to the %s', (location) => {
    const cap = LOCATIONS[location].maxTier
    for (const blunt of damages) {
      const outcome = getOutcome(facts({ blunt, location }), target)
      if (cap !== null) expect(outcome.IL).toBeLessThanOrEqual(injuryMap[`T${cap}`].IL)
      else if (outcome.tier !== null) expect(outcome.IL).toBe(injuryMap[`T${outcome.tier}`].IL)
    }
  })

  // gear.tex "Piercing": "cannot amputate".
  it.each(HIT_LOCATIONS)('a piercing blow to the %s never amputates', (location) => {
    for (const cut of damages) {
      const outcome = getOutcome(facts({ cut, location, properties: ['piercing'] }), target)
      expect(outcome.wound?.name.startsWith('amputated') ?? false).toBe(false)
    }
  })
})

describe('the degree', () => {
  // combat.tex "Strike": "misses do nothing"; "Defend": on a miss an evade
  // leaves the attack with 0. Whatever the damage, nothing lands.
  it.each(['none', 'evade', 'evasiveJump'] as const)('a miss against %s does nothing', (defense) => {
    for (const blunt of damages) {
      const outcome = getOutcome(facts({ blunt, cut: blunt, degree: 'miss', defense }), target)
      expect(outcome.IL + outcome.bleed + outcome.apLoss + outcome.afflictions.length).toBe(0)
      expect(outcome.wound).toBeNull()
      expect(outcome.dead).toBe(false)
    }
  })
})

function fighter(id: string): CampaignCharacter {
  const base = makeCampaignCharacter({ name: id })
  return { ...base, id, resources: { ...base.resources, AP: 8, STA: 6 } }
}

function combat(...characters: CampaignCharacter[]): CombatState {
  return { ...CombatStateSchema.parse({}), characters: Object.fromEntries(characters.map((c) => [c.id, c])) }
}

// The preview shown before "done" is computed by the same function the
// resolution applies; the target's sheet has to move by exactly what was
// shown.
describe('the preview', () => {
  it('is what the target takes', () => {
    let n = 0
    let s = combat(fighter('atk'), fighter('def'))
    s = declareAction('atk', { kind: 'strike', weaponKey: 'natural:Unarmed', attack: 'punch', variant: 'heavyI' }, () => `a${++n}`)(s)
    s = setTarget('def')(s)
    s = rollAction(30)(s)
    const open = getOpenAction(s)!
    const preview = getOutcomePreview(s, open)!
    expect(preview.tier).not.toBeNull()

    const after = resolveAction()(s)
    expect(after.characters.def.injuries.injuryLevel - s.characters.def.injuries.injuryLevel).toBe(preview.IL)
    expect(after.characters.def.injuries.bleed - s.characters.def.injuries.bleed).toBe(preview.bleed)
    expect(after.characters.def.resources.AP - s.characters.def.resources.AP).toBe(-preview.apLoss)
  })
})
