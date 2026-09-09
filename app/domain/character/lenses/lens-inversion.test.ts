import { describe, it, expect } from 'vitest'
import {
  skillLenses, characteristicLenses, movementLenses, senseLenses, miscLenses,
  skillTermGetters, characteristicTermGetters, sumTerms,
} from './index'
import { makeCampaignCharacter, makeCharacter } from '../../factories'
import type { CampaignCharacter, Character, Characteristics, Movement, Senses, Skills } from '../../types'

// The core architectural promise of the domain layer: a lens `set(c, v)` writes
// through the modifiers to the stored *base* so that reading the same lens back
// returns exactly `v`. If this holds, the UI can bind two-way to a derived value
// and trust the round-trip. These tests are the proof of that claim.
//
// The subject deliberately carries non-trivial base values everywhere, so a
// broken inversion cannot accidentally pass by echoing an unchanged number.
function subject() {
  return makeCharacter({
    size: 3,
    TGH: 0,
    trainables: {
      STR: { value: 12 }, AGI: { value: 11 }, STA: { value: 13 },
      CON: { value: 4 }, INT: { value: 3 }, SPI: { value: 2 }, DEX: { value: 5 },
      melee: { value: 2 }, ranged: { value: 1 }, awareness: { value: 3 },
      sorcery: { value: 1 }, charisma: { value: 2 },
      conviction1: { value: 1 }, conviction2: { value: 1 },
      strike: { value: 3 }, defend: { value: 2 }, reflex: { value: 1 },
      accuracy: { value: 4 }, SD: { value: 2 }, stealth: { value: 1 },
      prestidigitation: { value: 2 }, balance: { value: 1 }, health: { value: 3 },
      swim: { value: 1 }, climb: { value: 2 }, explore: { value: 1 },
      will: { value: 2 }, persuasion: { value: 1 }, deception: { value: 1 },
      insight: { value: 1 }, devotion: { value: 1 },
    },
  })
}

const TARGET = 7

// Getters whose result does NOT read the stored base with a +1 coefficient, so
// the generic setter's inversion assumption cannot hold. Documented, not fixed.
//   grapple   – getGrapple has its `skill('grapple')` term commented out
//   detection – getDetection ignores skills.detection entirely
//   cunning   – getCunning SUBTRACTS skills.cunning (negative coefficient)
// const NON_INVERTIBLE_SKILLS = ['grapple', 'cunning', 'detection'] as const

describe('lens inversion — skills', () => {
  const invertible = (Object.keys(skillLenses) as (keyof Skills)[])
    // .filter((k) => !NON_INVERTIBLE_SKILLS.includes(k as never))

  it.each(invertible)('set → get round-trips for "%s"', (skill) => {
    const lens = skillLenses[skill]
    expect(lens.get(lens.set(subject(), TARGET))).toBe(TARGET)
  })
})

// describe('lens inversion — skills (KNOWN violations, expected to fail until fixed)', () => {
//   for (const skill of NON_INVERTIBLE_SKILLS) {
//     it.fails(`set → get round-trips for "${skill}"`, () => {
//       const lens = skillLenses[skill]
//       expect(lens.get(lens.set(subject(), TARGET))).toBe(TARGET)
//     })
//   }
// })

describe('lens inversion — characteristics', () => {
  // getDevotion (SPI + trainables.devotion) and the generic setter read and
  // write the SAME stored base, so "devotion" round-trips like the rest.
  const invertible = Object.keys(characteristicLenses) as (keyof Characteristics)[]

  it.each(invertible)('set → get round-trips for "%s"', (name) => {
    const lens = characteristicLenses[name]
    expect(lens.get(lens.set(subject(), TARGET))).toBe(TARGET)
  })
})

describe('lens inversion — movement', () => {
  it.each(Object.keys(movementLenses) as (keyof Movement)[])(
    'set → get round-trips for "%s"',
    (name) => {
      const lens = movementLenses[name]
      expect(lens.get(lens.set(subject(), TARGET))).toBe(TARGET)
    },
  )
})

describe('lens inversion — misc', () => {
  it.each(Object.keys(miscLenses) as (keyof typeof miscLenses)[])(
    'set → get round-trips for "%s"',
    (name) => {
      const lens = miscLenses[name]
      expect(lens.get(lens.set(subject(), TARGET))).toBe(TARGET)
    },
  )
})

describe('lens inversion — senses', () => {
  const senses = Object.keys(senseLenses) as (keyof Senses)[]

  it.each(senses)('the numeric lenses of "%s" round-trip', (sense) => {
    for (const field of ['rangePenalty', 'bonus'] as const) {
      const lens = senseLenses[sense][field]
      expect(lens.get(lens.set(subject(), TARGET))).toBe(TARGET)
    }
  })

  it.each(senses)('the boolean lenses of "%s" round-trip both ways', (sense) => {
    for (const field of ['active', 'hasSense'] as const) {
      const lens = senseLenses[sense][field]
      for (const value of [true, false]) {
        expect(lens.get(lens.set(subject(), value))).toBe(value)
      }
    }
  })
})

// The other half of the same promise: every derived value is the sum of the
// terms the sheet shows as its breakdown, so the tooltip and the number can
// never drift apart. Held against a subject carrying modifiers from every
// direction — size, gear, injury and afflictions — so a term that is silently
// dropped shows up as a difference.
function afflicted(): CampaignCharacter {
  const base = makeCampaignCharacter({})
  return {
    ...base,
    trainables: subject().trainables,
    size: 5,
    hasHelm: 1,
    hasGauntlets: 1,
    afflictions: ['disoriented', 'confused'],
    injuries: { ...base.injuries, injuryLevel: 25 },
  }
}

describe('breakdown terms sum to the derived value', () => {
  const subjects: [string, Character][] = [['base', subject()], ['afflicted', afflicted()]]

  it('has a breakdown for every skill', () => {
    expect(Object.keys(skillTermGetters).sort()).toEqual(Object.keys(skillLenses).sort())
  })

  it.each(Object.keys(skillLenses) as (keyof Skills)[])('"%s" agrees with its terms', (skill) => {
    for (const [, c] of subjects) {
      expect(sumTerms(skillTermGetters[skill](c))).toBe(skillLenses[skill].get(c))
    }
  })

  it.each(Object.keys(characteristicTermGetters) as (keyof Characteristics)[])(
    '"%s" agrees with its terms',
    (name) => {
      for (const [, c] of subjects) {
        expect(sumTerms(characteristicTermGetters[name]!(c))).toBe(characteristicLenses[name].get(c))
      }
    },
  )
})
