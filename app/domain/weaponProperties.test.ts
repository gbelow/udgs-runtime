import { describe, it, expect } from 'vitest'
import baseWeapons from '../assets/weapons.json'
import { parseWeaponProperties } from './weaponProperties'
import { WeaponSchema } from './types'

const weapons = Object.entries(baseWeapons as Record<string, unknown>)

// gear.tex "Weapons Properties" are authored as the comma-separated cell the
// book prints, and parsed once at the schema boundary. Every token has to land
// somewhere: in a typed field, in `recognized`, or in `unknown`. Nothing is
// dropped, which is what makes a typo in an asset distinguishable from a rule
// this codebase has not implemented.
const authored = [
  '',
  '  ,, bladed ,  ',
  'DEF, bladed',
  'heavy I',
  'heavy II',
  'heavy III',
  'heavy I-II',
  'heavy I-III',
  'heavy II-III',
  'bladed, heavy I-II, DEF',
  'braced, hook',
  'fast',
  'draw, DEF',
  'STR 16, size 4',
  'piercing, wibble',
]

const typedCount = (props: ReturnType<typeof parseWeaponProperties>) =>
  (props.heavy ? 1 : 0) + (props.braced ? 1 : 0) + (props.hook ? 1 : 0) + (props.fast ? 1 : 0) + (props.draw ? 1 : 0)

describe('parseWeaponProperties keeps every token', () => {
  const strings = [
    ...authored,
    ...weapons.flatMap(([, raw]) => WeaponSchema.parse(raw).attacks.map((atk) => atk.properties)),
  ]

  it.each(strings.map((raw, i) => [i, raw] as const))('case %i drops nothing from %j', (_i, raw) => {
    const props = parseWeaponProperties(raw)
    const tokens = raw.split(',').map((t) => t.trim()).filter((t) => t.length > 0)
    expect(typedCount(props) + props.recognized.length + props.unknown.length).toBe(tokens.length)
  })

  it('reads a heavy range as two bounds, never backwards', () => {
    for (const raw of strings) {
      const heavy = parseWeaponProperties(raw).heavy
      if (!heavy) continue
      expect(heavy.min).toBeGreaterThanOrEqual(0)
      expect(heavy.max).toBeGreaterThanOrEqual(heavy.min)
      expect(heavy.max).toBeLessThanOrEqual(3)
    }
  })
})

// This is the test the parse's `unknown` bucket exists for: it reads the
// authored asset instead of restating the parser, so a weapon added with a
// misspelled property fails here.
describe('weapons.json property vocabulary', () => {
  it.each(weapons)('%s uses only rulebook properties', (_name, raw) => {
    const weapon = WeaponSchema.parse(raw)
    for (const atk of weapon.attacks) {
      expect(atk.props.unknown).toEqual([])
    }
  })
})

// The schema strips a serialized `props` before the transform recomputes it, so
// a stored character cannot carry a parse that has drifted from its own
// authored `properties` string.
describe('props survives a serialization round-trip', () => {
  it('recomputes props from properties, ignoring any stored value', () => {
    const weapon = WeaponSchema.parse({ name: 'Test', attacks: [{ blunt: 4, properties: 'heavy I-II' }] })
    const stored = JSON.parse(JSON.stringify(weapon))
    // Simulate a stale parse riding along in the stored JSON.
    stored.attacks[0].props = { heavy: null, braced: false, hook: false, fast: false, draw: false, recognized: [], unknown: [] }

    expect(WeaponSchema.parse(stored)).toEqual(weapon)
  })

  it.each(weapons)('%s reparses to the same weapon', (_name, raw) => {
    const weapon = WeaponSchema.parse(raw)
    expect(WeaponSchema.parse(JSON.parse(JSON.stringify(weapon)))).toEqual(weapon)
  })
})
