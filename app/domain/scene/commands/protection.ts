import type { Action, SceneState } from '../types'
import type { CampaignCharacter } from '../../types'
import { hasGrant } from '../../character/rules/effects'
import { meetAttitudes } from '../../character/commands/attitudes'
import { getAvailableActions } from '../rules/options'
import { isProtectionFailed, isProtectionMove } from '../rules/protection'
import { getAction } from '../rules/log'
import { getUnsurged } from '../../character/rules/surge'
import { updateCharacter } from './characters'
import { rally } from './social'

// abilities.tex "Guardian": what the protection surge leaves, once made, and
// once an attack it was offered against lands.

// "Promoted Attitudes": "Gains 1 XP each time they use their protection
// surge". "Rallying Guard": "Using protection surge automatically makes a
// rally". The surge is used once its run is made (the user's ruling,
// 2026-11-28: passing the run up takes everything back), so both come as the
// run lands.
export function landProtectionRun(state: SceneState, move: Action): SceneState {
  const defense = getProtectionDefense(state, move)
  return defense ? madeProtectionSurge(state, defense.actorId) : state
}

function madeProtectionSurge(state: SceneState, id: string): SceneState {
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

// The defense made on a protection surge that opened the move: the run it
// carries.
function getProtectionDefense(state: SceneState, move: Action): Action | null {
  const defense = move.kind === 'move' && move.spawnedBy ? getAction(state, move.spawnedBy) : null
  return defense?.surged?.kind === 'protection' && isProtectionMove(state, defense) ? defense : null
}

// The user's ruling (2026-11-28): the run is what makes a protection surge,
// so passing it up takes everything back: the surge is undone and the
// defense, which comes to nothing without it, is paid back. Nor is it counted
// as a reposition (commands/log.ts), and what using the surge brings is never
// given (`landProtectionRun`).
export function passUpProtection(state: SceneState, move: Action): SceneState {
  const defense = getProtectionDefense(state, move)
  const surged = defense?.surged
  if (!defense || !surged) return state
  const paid = defense.cost ?? { AP: 0, STA: 0 }
  const undone = (c: CampaignCharacter) => getUnsurged('protection', surged)({ ...c, resources: { ...c.resources, AP: c.resources.AP + paid.AP, STA: c.resources.STA + paid.STA } })
  return updateCharacter(defense.actorId, undone, 'protection surge undone: its run was passed up')(state)
}
