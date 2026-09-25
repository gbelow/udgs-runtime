import type { SurgeKind } from '../../types'
import type { Action, CombatState } from '../types'
import { getNextStep, getOpenAction, getReactionsTo, getTargetIds } from '../rules/action'
import { getAffected } from '../rules/explosion'
import { getFightName } from '../rules/activeCharacter'

// Who a character is to an action.
export type Role = 'actor' | 'target' | 'reactor' | 'none'

export function getRole(state: CombatState, root: Action, characterId: string): Role {
  if (root.actorId === characterId) return 'actor'
  if (getReactionsTo(state, root.id).some((r) => r.actorId === characterId)) return 'reactor'
  if (root.targetId === characterId) return 'target'
  if (root.kind === 'explosion' && getAffected(state, root).some((a) => a.id === characterId)) return 'target'
  return 'none'
}

export type CombatRosterEntry = {
  id: string
  name: string
  isActive: boolean
  hasSurged: boolean
  usedSurge: SurgeKind | null
  // the character's part in the open action, if there is one
  role: Role | null
  // whether a click on the entry aims the open action at it
  targetable: boolean
}

// The fight's roster as the UI reads it: who is in it, who is selected, who has
// already spent their surge this round and which one (combat.tex "Action
// surge": one per round, cleared by nextRound).
export function getCombatRoster(state: CombatState): CombatRosterEntry[] {
  const open = getOpenAction(state)
  const targets = new Set(open && getNextStep(state) === 'target' ? getTargetIds(state, open) : [])
  return Object.entries(state.characters).map(([id, c]) => ({
    id,
    name: getFightName(state, id),
    isActive: id === state.activeCharacterId,
    hasSurged: c.usedSurge !== null,
    usedSurge: c.usedSurge,
    role: open ? getRole(state, open, id) : null,
    targetable: targets.has(id),
  }))
}

// Everything the roster displays, as one string. A roster entry is freshly
// allocated on every call, so it cannot gate its own re-render by identity;
// gating on this instead means any change the UI can see schedules the render
// that recomputes it. Same reasoning as the term breakdowns.
export function getCombatRosterDigest(state: CombatState): string {
  return JSON.stringify(getCombatRoster(state))
}
