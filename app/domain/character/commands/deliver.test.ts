import { describe, it, expect } from 'vitest'
import { DamageSchema, type CampaignCharacter, type Delivery } from '../../types'
import { makeCampaignCharacter } from '../../factories'
import { getOutcome } from '../rules/damage'
import { deliver } from './deliver'

const damage = (value: number) => DamageSchema.parse({ damage: [{ kind: 'blunt', value }] })
const blow = (value: number): Delivery => ({ effect: { name: '', trigger: 'instant', type: 'damage', effect: damage(value) }, degree: 'hit', test: null, when: null, then: [], locks: null })
const bleedOf = (c: CampaignCharacter, value: number) => getOutcome(damage(value), 'hit', c).bleed

// combat.tex "Bleed": "Whenever bleeding is received, keep the highest between
// the current bleed and the incoming bleed."
describe('bleed received', () => {
  it('keeps the highest of the current and the incoming bleed', () => {
    const c = makeCampaignCharacter({})
    const values = Array.from({ length: 200 }, (_, i) => i + 1)
    const small = values.find((v) => bleedOf(c, v) > 0)!
    const large = values.find((v) => bleedOf(c, v) > bleedOf(c, small))!
    expect(large).toBeDefined()

    const after = (...hits: number[]) => hits.reduce((acc, v) => deliver(blow(v))(acc), c).injuries.bleed
    expect(after(large, small)).toBe(bleedOf(c, large))
    expect(after(small, large)).toBe(bleedOf(c, large))
    expect(after(small, small)).toBe(bleedOf(c, small))
  })
})
