import { describe, it, expect } from 'vitest'
import armorsCatalog from '../../../assets/armors.json'
import { getDamageTiers } from './gear'
import { makeCharacter } from '../../factories'
import { ArmorSchema } from '../../types'
import type { Character } from '../../types'

const armors = Object.entries(armorsCatalog as Record<string, unknown>)

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
})
