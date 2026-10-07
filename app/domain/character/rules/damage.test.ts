import { describe, it, expect } from 'vitest'
import { makeCampaignCharacter } from '../../factories'
import { DamageSchema, ItemSchema, type CampaignCharacter, type Damage, type Degree } from '../../types'
import { injuryMap } from '../../tables'
import { getOutcome } from './damage'

const target = makeCampaignCharacter({})

type Blow = Partial<Omit<Damage, 'damage'>> & { blunt?: number; cut?: number; degree?: Degree }

// A blow's damage as delivered, hard enough to cut, at the degree given —
// a hit unless said otherwise.
function blow({ blunt = 0, cut = 0, degree = 'hit', ...overrides }: Blow, target: CampaignCharacter) {
  return getOutcome(DamageSchema.parse({ damage: [{ kind: 'blunt', value: blunt }, { kind: 'cut', value: cut }], hardness: 4, ...overrides }), degree, target)
}

const damages = Array.from({ length: 60 }, (_, i) => i * 3)

const parts = target.body.map((part) => [part.name, part] as const)

describe('localized damage', () => {
  // combat.tex "Localized damage": "Maximum injury tier applied to the body is
  // 2" for the hand and 3 for the leg — whatever the blow, the body takes no
  // more IL than the tier its part caps it at.
  it.each(parts)('caps what the body takes from a hit to the %s', (_, part) => {
    for (const blunt of damages) {
      const outcome = blow({ blunt, location: part.location, part: part.id }, target)
      if (part.maxTier !== null) expect(outcome.IL).toBeLessThanOrEqual(injuryMap[`T${part.maxTier}`].IL)
      else if (outcome.tier !== null) expect(outcome.IL).toBe(injuryMap[`T${outcome.tier}`].IL)
    }
  })

  // gear.tex "Piercing": "cannot amputate".
  it.each(parts)('a piercing blow to the %s never amputates', (_, part) => {
    for (const cut of damages) {
      const outcome = blow({ cut, location: part.location, part: part.id, properties: ['piercing'] }, target)
      expect(outcome.wound !== null && outcome.wound.heal === null).toBe(false)
    }
  })
})

describe('the degree', () => {
  // combat.tex "Strike": "misses do nothing"; "Defend": on a miss an evade
  // leaves the attack with 0. Whatever the damage, nothing lands.
  it.each(['none', 'evade', 'evasiveJump'] as const)('a miss against %s does nothing', (defense) => {
    for (const blunt of damages) {
      const outcome = blow({ blunt, cut: blunt, degree: 'miss', defense }, target)
      expect(outcome.IL + outcome.bleed + outcome.apLoss + outcome.afflictions.length).toBe(0)
      expect(outcome.wound).toBeNull()
      expect(outcome.dead).toBe(false)
    }
  })
})

describe('additional effects', () => {
  // combat.tex "Physical attacks": "use the largest damage of the two, but
  // apply the additional effects of both" — what the blunt component does
  // beyond the injury is the same whatever the cutting component is.
  it("are the blunt component's whichever type causes the injury", () => {
    for (const blunt of damages) {
      const alone = blow({ blunt, smash: true }, target)
      for (const cut of damages) {
        const both = blow({ blunt, cut, smash: true }, target)
        expect(both.interruption).toBe(alone.interruption)
        expect(both.apLoss).toBe(alone.apLoss)
      }
    }
  })
})

describe('hand wounds', () => {
  // combat.tex "Hand": the hand a wound takes is the one used for defense —
  // the one holding what the target blocked with.
  it('land on the hand holding the blocking item', () => {
    const dagger = ItemSchema.parse({ id: 'd1', name: 'Dagger', type: 'weapon', refId: 'Dagger', bulk: 1 })
    const blocker = { ...target, body: target.body.map((part) => (part.id === 'handR' ? { ...part, itemId: dagger.id } : part)), held: [dagger] }
    const outcome = blow({ blunt: 200, location: 'hand', defense: 'block', defenseWeaponKey: dagger.id }, blocker)
    expect(outcome.wound?.part?.id).toBe('handR')
  })
})

// combat.tex "Explosion Block": "the explosion damage gets reduced by the
// defenses from the shield."
describe('an explosion blocked with a shield', () => {
  const shield = { defense: 'blockExplosion' as const, block: 100, blockCap: 100, shield: true }
  const burn = (defended: boolean) => getOutcome(DamageSchema.parse({ damage: [{ kind: 'burn', value: 20 }], ...(defended ? shield : {}) }), 'hit', target)

  it('absorbs the damage, impact included', () => {
    expect(burn(false).damage).toBeGreaterThan(0)
    expect(burn(true).damage).toBe(0)
    const impact = (defended: boolean) => getOutcome(DamageSchema.parse({ damage: [{ kind: 'blunt', value: 20 }], ...(defended ? shield : {}) }), 'critical', target)
    expect(impact(false).damage).toBeGreaterThan(0)
    expect(impact(true).damage).toBe(0)
  })
})
