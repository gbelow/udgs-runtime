import { DamageSchema, type Character, type Degree, type Delivery } from '../../types'
import type { SceneState, Deliveries, FallAction } from '../types'
import { FALL } from '../../tables'
import { getBalanceTerms } from '../../character/rules/skills'
import { getTGH } from '../../character/rules/misc'
import { hasGrant } from '../../character/rules/abilities'
import { getFallDM2 } from '../../character/rules/size'
import type { Term } from '../../character/rules/terms'
import { coordKey } from '../geometry'
import { delivering } from './delivery'
import { getSensoryTermsHere } from './detection'

// combat.tex "Balance": what a fall costs the one who falls — the DL of the
// landing, the damage it comes to, and what each degree of the Balance test
// leaves of it.

// combat.tex "Choosing Fall DL": "1 per meter until a maximum of 15", except
// that "DLs for 1m can be considered trivial at -5, then 0 for 2m".
export function getFallDL(height: number): number {
  if (height <= FALL.minHeight) return FALL.DLAtMinHeight
  if (height <= 2) return FALL.DLAtTwoMetres
  return Math.min(height, FALL.maxDL)
}

export function getFallTestTerms(state: SceneState, action: FallAction): { skill: Term[]; DL: Term[] } | null {
  const actor = state.characters[action.actorId]
  return actor ? { skill: [...getBalanceTerms(actor), ...getSensoryTermsHere(state, actor.id, 'balance')], DL: [{ label: 'fall', value: getFallDL(action.height) }] } : null
}

// combat.tex "Fall damage": "Soft surfaces, like sand or water halve the
// damage" — the ground the faller lands on.
export function isSoftLanding(state: SceneState, action: FallAction): boolean {
  const cell = action.to ?? state.board?.placements[action.actorId]?.cell
  const ground = cell ? state.board?.terrain[coordKey(cell)] : undefined
  return !!ground && (ground.soft || ground.liquid)
}

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
  return { effect: { name: 'prone', trigger: 'instant', type: 'affliction', effect: { key: 'prone' } }, degree: 'hit', test: null, when: null, then: [], locks: null }
}

// What the landing does to the faller. combat.tex "Fall skill test": a graze
// falls prone, a miss falls prone and "hits the head"; "Receiving a T1 injury
// or higher always makes the character prone and stuns", so the blow
// stuns and the prone is gated on its tier.
export function getFallFacts(state: SceneState, action: FallAction): Deliveries {
  const faller = state.characters[action.actorId]
  if (!faller || !action.roll) return {}
  const { degree } = action.roll
  const value = getFallBlow(faller, action.height, isSoftLanding(state, action), degree)
  const damage = DamageSchema.parse({ damage: [{ kind: 'blunt', value }], location: degree === 'miss' ? 'head' : 'chest', bare: true, stuns: true })
  const blow: Delivery = { ...delivering('fall', damage, 'hit'), then: [{ ...proneDelivery(), when: { minTier: 1 } }] }
  const falls = degree === 'graze' || degree === 'miss' ? [proneDelivery()] : []
  const deliveries = [...(value > 0 ? [blow] : []), ...falls]
  return deliveries.length > 0 ? { [faller.id]: deliveries } : {}
}
