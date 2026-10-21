import type { SceneState, Deliveries, FallAction } from '../types'
import { FALL } from '../../tables'
import { getBalanceTerms } from '../../character/rules/skills'
import { getFallDeliveries } from '../../character/rules/fall'
import type { Term } from '../../character/rules/terms'
import { coordKey } from './board/geometry'
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

export function getFallFacts(state: SceneState, action: FallAction): Deliveries {
  const faller = state.characters[action.actorId]
  if (!faller || !action.roll) return {}
  const deliveries = getFallDeliveries(faller, action.height, isSoftLanding(state, action), action.roll.degree)
  return deliveries.length > 0 ? { [faller.id]: deliveries } : {}
}
