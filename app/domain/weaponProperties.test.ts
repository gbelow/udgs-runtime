import { describe, it, expect } from 'vitest'
import baseWeapons from '../assets/weapons.json'
import { parseWeaponProperties } from './weaponProperties'
import { WeaponSchema } from './types'
import { makeCharacter } from './factories'
import { getAttacksList } from './character/commands'

const wielder = makeCharacter({ trainables: { STR: { value: 10 } } })

function variantsFor(properties: string): string[] {
  const weapon = WeaponSchema.parse({
    name: 'Test',
    attacks: [{ type: 'melee', blunt: 4, AP: 2, properties }],
  })
  return getAttacksList({ atk: weapon.attacks[0] })(wielder).map((v) => v.name)
}

// gear.tex "Heavy I/II/III": "Having a higher degree of heavy allows using any
// lower degree. Having heavy I-III or similar means that heavy I is minimum,
// and normal attacks are not allowed." Each spelling below is read straight off
// that sentence — a bare degree keeps the normal attack and grants every degree
// up to it; a range drops the normal attack and starts at its lower bound.
describe('heavy degrees (gear.tex "Heavy I/II/III")', () => {
  it.each([
    ['heavy I', ['basic', 'heavyI']],
    ['heavy II', ['basic', 'heavyI', 'heavyII']],
    ['heavy III', ['basic', 'heavyI', 'heavyII', 'heavyIII']],
    ['heavy I-II', ['heavyI', 'heavyII']],
    ['heavy I-III', ['heavyI', 'heavyII', 'heavyIII']],
    ['heavy II-III', ['heavyII', 'heavyIII']],
  ])('%s -> %j', (properties, expected) => {
    expect(variantsFor(properties)).toEqual(expected)
  })

  it('offers only the normal attack when the weapon has no heavy property', () => {
    expect(variantsFor('DEF, bladed')).toEqual(['basic'])
  })

  it('reads heavy alongside other properties in any position', () => {
    expect(variantsFor('bladed, heavy I-II, DEF')).toEqual(['heavyI', 'heavyII'])
  })
})

describe('non-heavy attack properties', () => {
  it('adds the braced and hook variants', () => {
    expect(variantsFor('braced, hook')).toEqual(['basic', 'braced', 'hook'])
  })

  // gear.tex "Slow, Fast, UF" is a ranged-weapon property; it is what gates the
  // quick shot / snipe pair.
  it('adds the ranged pair for a fast weapon', () => {
    expect(variantsFor('fast')).toEqual(['basic', 'quick', 'snipe'])
  })
})

// The parse is total, so a token is either a rule this codebase implements, a
// rule it recognizes but has not implemented, or a typo. This test is the whole
// point of that distinction: it reads the authored asset rather than restating
// the parser, so it fails when a weapon is added with a misspelled property.
describe('weapons.json property vocabulary', () => {
  const weapons = Object.entries(baseWeapons as Record<string, unknown>)

  it('has weapons to check', () => {
    expect(weapons.length).toBeGreaterThan(0)
  })

  it.each(weapons)('%s uses only rulebook properties', (_name, raw) => {
    const weapon = WeaponSchema.parse(raw)
    for (const atk of weapon.attacks) {
      expect(atk.props.unknown).toEqual([])
    }
  })
})

describe('parseWeaponProperties', () => {
  it('ignores empty and whitespace-only entries', () => {
    const props = parseWeaponProperties('  ,, bladed ,  ')
    expect(props.recognized).toEqual(['bladed'])
    expect(props.unknown).toEqual([])
  })

  it('collects a token outside the rulebook vocabulary as unknown', () => {
    // The shape a typo takes: right rule, wrong spelling.
    expect(parseWeaponProperties('heavyI').unknown).toEqual(['heavyI'])
    expect(parseWeaponProperties('Heavy I').unknown).toEqual(['Heavy I'])
    expect(parseWeaponProperties('heavy IV').unknown).toEqual(['heavy IV'])
  })

  // gear.tex "STR x" is a strength requirement and "Size x" a wieldable size —
  // both carry a number, so they cannot be matched as fixed strings.
  it('recognizes the parameterized properties', () => {
    expect(parseWeaponProperties('STR 16, size 4').unknown).toEqual([])
  })

  it('keeps an unimplemented rule separate from an unknown token', () => {
    const props = parseWeaponProperties('piercing, wibble')
    expect(props.recognized).toEqual(['piercing'])
    expect(props.unknown).toEqual(['wibble'])
  })
})

// The schema strips a serialized `props` before the transform recomputes it, so
// a stored character cannot carry a parse that has drifted from its own
// authored `properties` string.
describe('props survives a serialization round-trip', () => {
  it('recomputes props from properties, ignoring any stored value', () => {
    const weapon = WeaponSchema.parse({
      name: 'Test',
      attacks: [{ blunt: 4, properties: 'heavy I-II' }],
    })
    const stored = JSON.parse(JSON.stringify(weapon))
    // Simulate a stale parse riding along in the stored JSON.
    stored.attacks[0].props = { heavy: null, braced: false, hook: false, fast: false, recognized: [], unknown: [] }

    const reparsed = WeaponSchema.parse(stored)
    expect(reparsed.attacks[0].props.heavy).toEqual({ min: 1, max: 2 })
  })
})
