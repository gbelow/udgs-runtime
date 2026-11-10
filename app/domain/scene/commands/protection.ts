import type { Action, SceneState } from '../types'
import { hasGrant } from '../../character/rules/effects'
import { meetAttitudes } from '../../character/commands/attitudes'
import { getAvailableActions } from '../rules/options'
import { isProtectionFailed } from '../rules/protection'
import { updateCharacter } from './characters'
import { rally } from './social'

// abilities.tex "Guardian": what the protection surge leaves, once made, and
// once an attack it was offered against lands.

// "Promoted Attitudes": "Gains 1 XP each time they use their protection
// surge". "Rallying Guard": "Using protection surge automatically makes a
// rally".
export function madeProtectionSurge(state: SceneState, id: string): SceneState {
  const met = updateCharacter(id, meetAttitudes({ event: 'protectionSurge' }), 'conviction attitude')(state)
  const c = met.characters[id]
  return c && hasGrant(c, 'rallyingGuard') ? rally(met, id) : met
}

// Who could have made their protection surge against the attack, as it is
// paid, and did not: those it is still offered to.
export function getUnprotectedBy(state: SceneState, root: Action): string[] {
  if (root.kind !== 'strike' && root.kind !== 'shoot') return []
  return Object.keys(state.characters).filter((id) => getAvailableActions(state, id).some((o) => o.available && o.surge === 'protection'))
}

// "Prohibited Attitudes": "Loses 1 XP whenever they refuse to use their
// protection surge and an ally takes tier 2 damage or higher", from the
// attack it was refused against.
export function meetUnprotected(state: SceneState, landed: Action): SceneState {
  if (landed.unprotectedBy.length === 0 || !isProtectionFailed(landed)) return state
  return landed.unprotectedBy.reduce((s, id) => updateCharacter(id, meetAttitudes({ event: 'refusedProtection' }), 'conviction attitude')(s), state)
}
