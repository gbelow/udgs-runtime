import { describe, it, expect } from 'vitest'
import armorsCatalog from '../../../assets/armors.json'
import { ArmorSchema } from '../../types'
import { scaleArmor } from './helpers'
import { getGearPenalties } from './gear'
import { makeCharacter } from '../../factories'
import { dmgArr, SMArr } from '../../tables'

// gear.tex "Armors" table, transcribed column for column:
// Name | RES (outer/inner) | Protection | Insulation | Deflection | Burden.
// Burden is stored as a positive magnitude here and negated by the AGI/STA
// getters, so the rulebook's "-2" is a 2 below.
const BOOK = {
  Skin:            { RES: 0,  RESlayer: 0,  protection: 0,  INS: 0, deflection: 4, penalty: 0 },
  Clothing:        { RES: 3,  RESlayer: 0,  protection: 0,  INS: 2, deflection: 4, penalty: 0 },
  FurCoat:         { RES: 7,  RESlayer: 0,  protection: 2,  INS: 6, deflection: 5, penalty: 0 },
  ThickHide:       { RES: 8,  RESlayer: 0,  protection: 4,  INS: 7, deflection: 5, penalty: 0 },
  Gambeson:        { RES: 10, RESlayer: 0,  protection: 3,  INS: 6, deflection: 5, penalty: 0 },
  PaddedArmor:     { RES: 12, RESlayer: 0,  protection: 6,  INS: 8, deflection: 5, penalty: 1 },
  ChainShirt:      { RES: 8,  RESlayer: 0,  protection: 3,  INS: 5, deflection: 5, penalty: 0 },
  Hauberk:         { RES: 10, RESlayer: 0,  protection: 5,  INS: 6, deflection: 5, penalty: 1 },
  Brigandine:      { RES: 12, RESlayer: 8,  protection: 8,  INS: 8, deflection: 6, penalty: 2 },
  HalfArmor:       { RES: 16, RESlayer: 10, protection: 10, INS: 7, deflection: 5, penalty: 2 },
  FullArmor:       { RES: 16, RESlayer: 10, protection: 10, INS: 8, deflection: 7, penalty: 3 },
  ReinforcedArmor: { RES: 18, RESlayer: 10, protection: 12, INS: 8, deflection: 8, penalty: 4 },
} as const

const catalog = armorsCatalog as Record<string, unknown>

describe('armors.json matches the gear.tex Armors table', () => {
  it('holds exactly the armors the table lists', () => {
    expect(Object.keys(catalog).sort()).toEqual(Object.keys(BOOK).sort())
  })

  it.each(Object.entries(BOOK))('%s carries the printed values', (key, expected) => {
    const armor = ArmorSchema.parse(catalog[key])
    expect(armor).toMatchObject(expected)
  })

  it('parses every entry losslessly — no stripped or defaulted fields', () => {
    for (const [key, raw] of Object.entries(catalog)) {
      expect(ArmorSchema.parse(raw), key).toEqual(raw)
    }
  })

  // gear.tex "Armor layers": "If armor has two values, it is layered."
  it('tags every two-value armor as layered and no others', () => {
    for (const [key, raw] of Object.entries(catalog)) {
      const armor = ArmorSchema.parse(raw)
      expect(armor.properties.includes('layered'), key).toBe(armor.RESlayer > 0)
    }
  })
})

describe('scaleArmor', () => {
  const hauberk = ArmorSchema.parse(catalog.Hauberk)

  it('is the identity for a size 3 character', () => {
    expect(scaleArmor(hauberk, 3)).toEqual(hauberk)
  })

  it('scales every damage-facing value by the size damage multiplier', () => {
    const size = 5
    const DM = dmgArr[size - 1]
    const scaled = scaleArmor(ArmorSchema.parse(catalog.FullArmor), size)
    const full = ArmorSchema.parse(catalog.FullArmor)

    expect(scaled.RES).toBe(Math.floor(full.RES * DM))
    expect(scaled.RESlayer).toBe(Math.floor(full.RESlayer * DM))
    expect(scaled.INS).toBe(Math.floor(full.INS * DM))
    expect(scaled.protection).toBe(Math.floor(full.protection * DM))
  })

  it('offsets deflection by the size modifier rather than scaling it', () => {
    const size = 5
    const full = ArmorSchema.parse(catalog.FullArmor)
    expect(scaleArmor(full, size).deflection).toBe(full.deflection - SMArr[size - 1])
  })

  it('produces an object the schema accepts unchanged', () => {
    const scaled = scaleArmor(hauberk, 5)
    expect(ArmorSchema.parse(scaled)).toEqual(scaled)
  })
})

// gear.tex "Burden penalties": penalties from multiple gear stack and are then
// "modified by (STR-10)/3".
describe('getGearPenalties', () => {
  const armored = (STR: number) =>
    makeCharacter({ trainables: { STR: { value: STR } }, armor: catalog.FullArmor })

  it('stacks the armor penalty for an average-strength wearer', () => {
    expect(getGearPenalties(armored(10))).toBe(3)
  })

  it('reduces the penalty as STR climbs past 10', () => {
    expect(getGearPenalties(armored(13))).toBe(2)
    expect(getGearPenalties(armored(16))).toBe(1)
    expect(getGearPenalties(armored(19))).toBe(0)
  })

  it('increases the penalty below STR 10', () => {
    expect(getGearPenalties(armored(7))).toBe(4)
  })

  it('never returns a bonus', () => {
    expect(getGearPenalties(armored(25))).toBe(0)
    expect(getGearPenalties(makeCharacter({ trainables: { STR: { value: 20 } } }))).toBe(0)
  })
})
