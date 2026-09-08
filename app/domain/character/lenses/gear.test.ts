import { describe, it, expect } from 'vitest'
import { applySTRmod, getDamageTiers, getWeaponAttackRows } from './gear'
import { getSTARegen } from './characteristics'
import { getTGH } from './misc'
import { restCharacter } from '../commands/rest'
import { getAttacksList } from '../commands/weaponAttack'
import { makeCharacter, makeCampaignCharacter } from '../../factories'
import { WeaponSchema } from '../../types'
import type { Character } from '../../types'

// combat.tex "Damage Tiers":
//   Tier 0 armor        IL 1    wound 0
//   Tier 1 armor+TGH    IL 5    wound 0
//   Tier 2 armor+2xTGH  IL 10   wound 50%
//   Tier 3 armor+3xTGH  IL 20   wound 100%
//   Tier 4 armor+4xTGH  IL 30   wound 100%
//   Tier 5 armor+5xTGH  IL 50   wound 100%
// T5 is the last tier — the accompanying note reads "A T5 means instant death".
describe('getDamageTiers (combat.tex "Damage Tiers")', () => {
  const armored = (): Character =>
    makeCharacter({
      size: 3,
      TGH: 2,
      trainables: { STR: { value: 10 } },
      armor: { name: 'Test Plate', protection: 7, RES: 5, RESlayer: 3, INS: 4, deflection: 4 },
    })

  it('covers tiers 0 through 5', () => {
    expect(getDamageTiers(armored()).map((r) => r.tier)).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('sets every tier threshold to armor + tier x TGH, per damage type', () => {
    const c = armored()
    const TGH = getTGH(c)
    const rows = getDamageTiers(c)

    rows.forEach((row, tier) => {
      expect(row.blunt).toBe(c.armor.protection + tier * TGH)
      expect(row.RES).toBe(c.armor.RES + tier * TGH)
      expect(row.INS).toBe(c.armor.INS + tier * TGH)
    })
  })

  it('leaves tier 0 at the bare armor values', () => {
    const c = armored()
    const [t0] = getDamageTiers(c)
    expect(t0.blunt).toBe(c.armor.protection)
    expect(t0.RES).toBe(c.armor.RES)
    expect(t0.INS).toBe(c.armor.INS)
  })

  it('carries the IL and wound chance of each tier', () => {
    const rows = getDamageTiers(armored())
    expect(rows.map((r) => r.IL)).toEqual([1, 5, 10, 20, 30, 50])
    expect(rows.map((r) => r.woundChance)).toEqual([0, 0, 0.5, 1, 1, 1])
  })

  // gear.tex "Rigid armors": the second RES number is the inner layer, and it
  // scales with the tier the same way the outer layer does.
  it('scales the rigid-armor inner RES layer alongside the outer one', () => {
    const c = armored()
    const TGH = getTGH(c)
    getDamageTiers(c).forEach((row, tier) => {
      expect(row.RESlayer).toBe(c.armor.RESlayer + tier * TGH)
    })
  })

  it('reports no inner layer when the armor has none', () => {
    const c = makeCharacter({ armor: { name: 'Skin', RESlayer: 0 } })
    expect(getDamageTiers(c).every((r) => r.RESlayer === 0)).toBe(true)
  })
})

// combat.tex "Rest": costs 4 AP and recovers STA by an amount equal to STA/4.
describe('getSTARegen (combat.tex "Rest")', () => {
  const withSTA = (STA: number) => makeCharacter({ trainables: { STA: { value: STA } } })

  it.each([
    [0, 0],
    [3, 0],
    [4, 1],
    [7, 1],
    [12, 3],
    [13, 3],
  ])('recovers floor(STA/4): STA %i -> %i', (STA, expected) => {
    expect(getSTARegen(withSTA(STA))).toBe(expected)
  })

  it('is the same number the Rest command applies, and costs 4 AP', () => {
    const c = makeCampaignCharacter({
      trainables: { STA: { value: 12 } },
      resources: { STA: 0, AP: 6 },
    })
    const rested = restCharacter(c)
    expect(rested.resources.STA).toBe(c.resources.STA + getSTARegen(c))
    expect(rested.resources.AP).toBe(c.resources.AP - 4)
  })
})

// gear.tex weapon tables: a `*mod` column is a multiple of STR added to the flat
// value of its row.
describe('applySTRmod (gear.tex weapon tables)', () => {
  const strong = makeCharacter({ trainables: { STR: { value: 13 } } })

  it('returns the flat value untouched when the modifier is 0', () => {
    expect(applySTRmod(6, 0, strong)).toBe(6)
  })

  it('adds mod x STR to the flat value and floors the result', () => {
    expect(applySTRmod(6, 1, strong)).toBe(19)
    expect(applySTRmod(6, 0.5, strong)).toBe(12) // 6 + 6.5 -> 12
  })

  it('is the single source for both the rendered row and the rolled attack', () => {
    const c = makeCharacter({ trainables: { STR: { value: 11 } } })
    const weapon = WeaponSchema.parse({
      name: 'Test Spear',
      scale: 3,
      attacks: [{ type: 'melee', blunt: 4, cut: 2, STRmod: 0.5, RES: 8, RESmod: 0.5, AP: 2 }],
    })

    const [row] = getWeaponAttackRows(weapon)(c)
    const [basic] = getAttacksList({ atk: weapon.attacks[0] })(c)

    expect(row.blunt).toBe(applySTRmod(4, 0.5, c))
    expect(row.RES).toBe(applySTRmod(8, 0.5, c))
    // The displayed blunt and the blunt the basic attack rolls are one number.
    expect(row.blunt).toBe(basic.blunt)
    // Only blunt rows carry STR multiples.
    expect(row.cut).toBe(2)
  })
})
