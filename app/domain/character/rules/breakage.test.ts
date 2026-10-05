import { describe, it, expect } from 'vitest'
import { getArmorBreakChance, type Hit } from './breakage'
import { getOutcome } from './damage'
import { makeCampaignCharacter } from '../../factories'
import { DamageSchema, ItemSchema, type DamageKind } from '../../types'

// gear.tex "Equipment Breakage": a gambeson is fibre, RES 10.
const gambeson = ItemSchema.parse({ name: 'Gambeson', type: 'armor', refId: 'Gambeson', bulk: 2 })
const wearer = { ...makeCampaignCharacter({ name: 'w' }), worn: gambeson }

function hit(kind: DamageKind, value: number, { piercing = false, hardness = 0 } = {}): Hit {
  const damage = DamageSchema.parse({ damage: [{ kind, value }], hardness, properties: piercing ? ['piercing'] : [] })
  return { damage, outcome: getOutcome(damage, 'hit', wearer) }
}

describe('the chance armor breaks under what reached it', () => {
  // gear.tex "Equipment Breakage": damage >= RES is one in six, twice RES breaks it
  it('is one in six at RES and certain at twice RES, for a blow of no hardness', () => {
    expect(getArmorBreakChance(wearer, [hit('blunt', 15)])).toBeCloseTo(1 / 6)
    expect(getArmorBreakChance(wearer, [hit('blunt', 20)])).toBe(1)
  })

  // gear.tex "Equipment Breakage": "If it receives both >= RES, it has 50% chance"
  it('is a half when the instances reach RES in both blunt and cut', () => {
    expect(getArmorBreakChance(wearer, [hit('blunt', 12, { hardness: 5 }), hit('cut', 12, { hardness: 5 })])).toBe(1 / 2)
  })

  // gear.tex "Piercing": "Only breaks objects when damage > 3x RES"
  it('needs a piercing blow to exceed three times RES', () => {
    expect(getArmorBreakChance(wearer, [hit('cut', 30, { piercing: true, hardness: 5 })])).toBe(0)
    expect(getArmorBreakChance(wearer, [hit('cut', 31, { piercing: true, hardness: 5 })])).toBe(1)
  })

  // gear.tex "Equipment Breakage": burning is a special case
  it('is nothing for burning damage', () => {
    expect(getArmorBreakChance(wearer, [hit('burn', 100)])).toBe(0)
  })
})
