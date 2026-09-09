import { describe, it, expect } from 'vitest'
import armorsCatalog from '../../../assets/armors.json'
import { ArmorSchema, ContainerSchema } from '../../types'
import { scaleArmor } from './helpers'
import { getGearPenalties } from './gear'
import { makeCharacter } from '../../factories'

const catalog = armorsCatalog as Record<string, unknown>
const entries = Object.entries(catalog)

// The catalog is the transcription of the gear.tex "Armors" table — one copy,
// diffable against the book by eye. These tests check the properties the file
// itself cannot state, never the numbers in it.
describe('armors.json', () => {
  it.each(entries)('%s parses losslessly — nothing stripped, nothing defaulted', (key, raw) => {
    expect(ArmorSchema.parse(raw), key).toEqual(raw)
  })

  // gear.tex "Armor layers": "If armor has two values, it is layered." The
  // second value and the property are authored separately in the asset, so
  // this is the one place they can be held to each other.
  it.each(entries)('%s tags its layers and its RES the same way', (key, raw) => {
    const armor = ArmorSchema.parse(raw)
    expect(armor.properties.includes('layered'), key).toBe(armor.RESlayer > 0)
  })
})

describe('scaleArmor', () => {
  const armors = entries.map(([key, raw]) => [key, ArmorSchema.parse(raw)] as const)
  const scales = [1, 2, 3, 4, 5, 6, 7]

  // Size 3 is the scale the catalog is authored at, so scaling to it is a
  // no-op. It is the fixed point the whole scaling ladder hangs off.
  it.each(armors)('leaves %s alone at the authored scale', (_key, armor) => {
    expect(scaleArmor(armor, 3)).toEqual(armor)
  })

  it.each(armors)('keeps %s a valid armor at every scale', (_key, armor) => {
    for (const scale of scales) {
      const scaled = scaleArmor(armor, scale)
      expect(ArmorSchema.parse(scaled)).toEqual(scaled)
    }
  })

  // Out-of-range scales are clamped rather than thrown, so a character saved
  // with a nonsense size still renders.
  it.each(armors)('clamps %s to the ends of the size table', (_key, armor) => {
    expect(scaleArmor(armor, -3)).toEqual(scaleArmor(armor, 1))
    expect(scaleArmor(armor, 99)).toEqual(scaleArmor(armor, 7))
  })
})

// gear.tex "Burden penalties": armor, weapon and container penalties stack and
// are then "modified by (STR-10)/3". Penalties are stored as positive
// magnitudes, so the total is a cost — carrying gear can never pay out.
describe('getGearPenalties', () => {
  const armored = (STR: number) =>
    makeCharacter({ trainables: { STR: { value: STR } }, armor: catalog.ReinforcedArmor })
  const strengths = [1, 4, 7, 10, 13, 16, 19, 25, 40]

  it('is 0 for a character carrying nothing', () => {
    expect(getGearPenalties(makeCharacter(null))).toBe(0)
  })

  it.each(strengths)('never returns a bonus at STR %i', (STR) => {
    expect(getGearPenalties(armored(STR))).toBeGreaterThanOrEqual(0)
  })

  it('never falls when another burden is added', () => {
    const bare = armored(10)
    const packed = {
      ...bare,
      containers: { pack: ContainerSchema.parse({ name: 'Backpack', penalty: 2 }) },
    }
    expect(getGearPenalties(packed)).toBeGreaterThanOrEqual(getGearPenalties(bare))
  })
})
