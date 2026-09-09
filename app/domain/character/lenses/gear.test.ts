import { describe, it, expect } from 'vitest'
import weaponsCatalog from '../../../assets/weapons.json'
import armorsCatalog from '../../../assets/armors.json'
import { applySTRmod, getDamageTiers, getWeaponAttackRows } from './gear'
import { getSTARegen, REST_AP_COST } from './characteristics'
import { restCharacter } from '../commands/rest'
import { getAttacksList } from '../commands/weaponAttack'
import { makeCharacter, makeCampaignCharacter } from '../../factories'
import { ArmorSchema, WeaponSchema } from '../../types'
import type { CampaignCharacter, Character } from '../../types'

const armors = Object.entries(armorsCatalog as Record<string, unknown>)
const weapons = Object.entries(weaponsCatalog as Record<string, unknown>)

// combat.tex "Damage Tiers": the threshold for tier n is the armor value plus
// n x TGH, one ladder per damage type. The numbers belong to the armor and the
// injury table; what belongs here is the shape of the ladder.
describe('getDamageTiers', () => {
  const wearing = (armor: unknown): Character =>
    makeCharacter({ size: 3, TGH: 2, trainables: { STR: { value: 10 } }, armor })

  it.each(armors)('climbs in even steps for %s', (key, raw) => {
    const rows = getDamageTiers(wearing(raw))
    const armor = ArmorSchema.parse(raw)

    expect(rows.map((row) => row.tier)).toEqual([...rows.map((row) => row.tier)].sort((a, b) => a - b))
    expect(rows[0].blunt, key).toBe(armor.protection)
    expect(rows[0].RES, key).toBe(armor.RES)
    expect(rows[0].INS, key).toBe(armor.INS)

    // One step, shared by every damage type: the tier multiplies TGH, and the
    // armor value only sets where the ladder starts.
    const step = rows[1].blunt - rows[0].blunt
    rows.forEach((row, tier) => {
      expect(row.blunt - armor.protection, key).toBe(tier * step)
      expect(row.RES - armor.RES, key).toBe(tier * step)
      expect(row.INS - armor.INS, key).toBe(tier * step)
    })
  })

  // gear.tex "Rigid armors": the second RES number is the inner layer, and 0
  // means there is no second layer to report rather than a layer worth nothing.
  it.each(armors)('reports an inner layer for %s only if it has one', (key, raw) => {
    const armor = ArmorSchema.parse(raw)
    const rows = getDamageTiers(wearing(raw))
    if (armor.RESlayer > 0) {
      const step = rows[1].RESlayer - rows[0].RESlayer
      rows.forEach((row, tier) => expect(row.RESlayer - armor.RESlayer, key).toBe(tier * step))
    } else {
      expect(rows.every((row) => row.RESlayer === 0), key).toBe(true)
    }
  })

  it('reports a wound chance that is a probability', () => {
    const rows = getDamageTiers(wearing(armorsCatalog.FullArmor))
    expect(rows.every((row) => row.woundChance >= 0 && row.woundChance <= 1)).toBe(true)
  })
})

// combat.tex "Rest": one action, one recovery. The sheet's readout and the
// command have to be the same number, which is the reason both go through the
// lens instead of computing it.
describe('rest', () => {
  const rester = (STA: number): CampaignCharacter => {
    const base = makeCampaignCharacter({})
    return {
      ...base,
      trainables: { ...base.trainables, STA: { ...base.trainables.STA, value: STA } },
      resources: { ...base.resources, STA: 0, AP: 6 },
    }
  }

  it.each([0, 3, 4, 7, 12, 13, 30])('recovers what the lens reports at STA %i', (STA) => {
    const c = rester(STA)
    const rested = restCharacter(c)
    expect(rested.resources.STA).toBe(c.resources.STA + getSTARegen(c))
    expect(rested.resources.AP).toBe(c.resources.AP - REST_AP_COST)
  })

  it('never recovers a negative amount', () => {
    for (const STA of [0, 1, 4, 12, 30]) {
      expect(getSTARegen(rester(STA))).toBeGreaterThanOrEqual(0)
    }
  })
})

// gear.tex weapon tables: a `*mod` column is a multiple of STR added to the
// flat value of its row. One rule with two applications — the row the sheet
// renders and the attack the character rolls — so both call the same function.
describe('applySTRmod', () => {
  const wielder = makeCharacter({ trainables: { STR: { value: 13 } } })

  it('is the identity where the table prints no modifier', () => {
    for (const value of [0, 6, -4]) expect(applySTRmod(value, 0, wielder)).toBe(value)
  })

  // Read across the whole catalog: wherever an attack offers a normal attack,
  // the damage on the rendered row and the damage the attack rolls have to be
  // one number. This is the duplication the lens exists to prevent.
  function disagreements(column: 'blunt' | 'cut') {
    const mismatched: string[] = []
    let compared = 0

    for (const [key, raw] of weapons) {
      const weapon = WeaponSchema.parse(raw)
      const rows = getWeaponAttackRows(weapon)(wielder)
      weapon.attacks.forEach((atk, index) => {
        const basic = getAttacksList({ atk })(wielder).find((variant) => variant.name === 'basic')
        if (!basic) return
        compared++
        if (rows[index][column] !== basic[column]) mismatched.push(`${key}[${index}]`)
      })
    }

    return { mismatched, compared }
  }

  it('gives the rendered row and the rolled attack the same blunt damage', () => {
    const { mismatched, compared } = disagreements('blunt')
    expect(mismatched).toEqual([])
    expect(compared).toBeGreaterThan(0)
  })

  // Known violation: the row getter never applies STRmod to cut, while the
  // attack builder applies the blunt multiple to it — so a weapon with no cut
  // rolls cutting damage it does not display. gear.tex prints an independent
  // multiple per damage column ("Halberd: Blunt STR, Cut 1.5x STR") that a
  // single stored STRmod cannot carry either way.
  it.fails('gives the rendered row and the rolled attack the same cut damage', () => {
    expect(disagreements('cut').mismatched).toEqual([])
  })
})
