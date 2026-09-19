import type { CampaignCharacter, SurgeKind } from '../../types'
import type { CombatState } from '../types'
import { Role, getNextStep, getOpenAction, getRole, getTargetIds } from './action'

// Read-side: which character is active is a pure function of combat state.
// The domain owns this so combat commands never need to import CombatStore.
export function getActiveCharacter(state: CombatState): CampaignCharacter | null {
  if (!state.activeCharacterId) return null
  return state.characters[state.activeCharacterId] ?? null
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
    name: c.fightName ?? '',
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
  return getCombatRoster(state)
    .map((e) => `${e.id}:${e.name}:${e.isActive ? 1 : 0}:${e.usedSurge ?? ''}:${e.role ?? ''}:${e.targetable ? 1 : 0}`)
    .join('|')
}
