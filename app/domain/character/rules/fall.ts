import { DamageSchema, type Character, type Degree, type Delivery } from '../../types'
import { FALL } from '../../tables'
import { getTGH } from './misc'
import { hasGrant } from './effects'
import { getFallDM2 } from './size'

// combat.tex "Fall damage": "2x fall height x DM^2 ... the damage ignores
// armor", the height capped at 50m.
function getFallDamage(c: Character, height: number, soft: boolean): number {
  return Math.floor(FALL.damagePerMetre * Math.min(height, FALL.maxHeight) * getFallDM2(c) * (soft ? 0.5 : 1))
}

// combat.tex "Fall skill test": "On a critical on the balance test, reduce the
// damage by 50% and prevent T0 and T1 injuries" (abilities.tex "Gymnast III":
// to 25%). On a hit, reduce damage by
// TGH. On a graze, takes full damage ... and on a miss takes full damage".
// Tier N is met at N x TGH against no armor (combat.tex "Damage Tiers").
export function getFallBlow(c: Character, height: number, soft: boolean, degree: Degree): number {
  const damage = getFallDamage(c, height, soft)
  const TGH = getTGH(c)
  switch (degree) {
    case 'critical': {
      const reduced = Math.floor(damage * (hasGrant(c, 'softLanding') ? FALL.gymnastCritShare : FALL.critShare))
      return TGH > 0 && Math.floor(reduced / TGH) < 2 ? 0 : reduced
    }
    case 'hit': return Math.max(0, damage - TGH)
    case 'graze':
    case 'miss': return damage
  }
}

function proneDelivery(): Delivery {
  return { effect: { name: 'prone', trigger: 'instant', type: 'affliction', effect: { key: 'prone', cure: false } }, degree: 'hit', test: null, when: null, then: [], locks: null }
}

// What the landing does to the faller. combat.tex "Fall skill test": a graze
// falls prone, a miss falls prone and "hits the head"; "Receiving a T1 injury
// or higher always makes the character prone and stuns", so the blow
// stuns and the prone is gated on its tier.
export function getFallDeliveries(c: Character, height: number, soft: boolean, degree: Degree): Delivery[] {
  const value = getFallBlow(c, height, soft, degree)
  const damage = DamageSchema.parse({ damage: [{ kind: 'blunt', value }], location: degree === 'miss' ? 'head' : 'chest', bare: true, stuns: true })
  const blow: Delivery = { effect: { name: 'fall', trigger: 'instant', type: 'damage', effect: damage }, degree: 'hit', test: null, when: null, then: [{ ...proneDelivery(), when: { minTier: 1 } }], locks: null }
  const falls = degree === 'graze' || degree === 'miss' ? [proneDelivery()] : []
  return [...(value > 0 ? [blow] : []), ...falls]
}
