import type { SurgeKind } from '../../types'
import type { Action, SceneState } from '../types'
import { getDeclaredTargets } from '../rules/action'
import { getOpenAction, getReactionsTo } from '../rules/log'
import { getAffected, getBlastOf } from '../rules/explosion'
import { getFightName } from '../rules/fighters'
import { perState } from '../../perState'
import { getHeldOf } from '../rules/hold'
import { getActionNoun } from './labels'

// Who a character is to an action.
export type Role = 'actor' | 'target' | 'reactor' | 'none'

export function getRole(state: SceneState, root: Action, characterId: string): Role {
  if (root.actorId === characterId) return 'actor'
  if (getReactionsTo(state, root.id).some((r) => r.actorId === characterId)) return 'reactor'
  if (root.targetId === characterId) return 'target'
  if (root.kind === 'explosion' && getAffected(state, getBlastOf(state, root)).some((a) => a.id === characterId)) return 'target'
  if (root.kind === 'blast' && getAffected(state, root).some((a) => a.id === characterId)) return 'target'
  return 'none'
}

export type CombatRosterEntry = {
  id: string
  name: string
  isActive: boolean
  hasSurged: boolean
  usedSurge: SurgeKind | null
  surrendered: boolean
  // combat.tex "Concentration": what the character holds over to the next
  // round, and the AP it has been paid
  holding: { label: string; AP: number } | null
  // the character's part in the open action, if there is one
  role: Role | null
  // whether a click on the entry aims the open action at it
  targetable: boolean
}

function holdingOf(state: SceneState, id: string): CombatRosterEntry['holding'] {
  const held = getHeldOf(state, id)
  return held ? { label: getActionNoun(held), AP: held.carried.AP } : null
}

// The fight's roster as the UI reads it: who is in it, who is selected, who has
// already spent their surge this round and which one (combat.tex "Action
// surge": one per round, cleared by nextRound).
function buildCombatRoster(state: SceneState): CombatRosterEntry[] {
  const open = getOpenAction(state)
  const targets = new Set(getDeclaredTargets(state, open))
  return Object.entries(state.characters).map(([id, c]) => ({
    id,
    name: getFightName(state, id),
    isActive: id === state.activeCharacterId,
    hasSurged: c.usedSurge !== null,
    usedSurge: c.usedSurge,
    surrendered: state.surrendered.includes(id),
    holding: holdingOf(state, id),
    role: open ? getRole(state, open, id) : null,
    targetable: targets.has(id),
  }))
}

export const getCombatRoster = perState(buildCombatRoster)

export type RosterParty = { id: string; name: string; entries: CombatRosterEntry[] }

// The roster split by party, in the order the parties joined the fight;
// anyone in none comes last, in a party with no name.
function buildRosterParties(state: SceneState): RosterParty[] {
  const roster = getCombatRoster(state)
  const parties = Object.entries(state.parties).map(([id, p]) => ({ id, name: p.name, entries: roster.filter((e) => state.partyOf[e.id] === id) }))
  const loose = roster.filter((e) => !state.parties[state.partyOf[e.id]])
  return loose.length > 0 ? [...parties, { id: '', name: '', entries: loose }] : parties
}

export const getRosterParties = perState(buildRosterParties)

// The active character's party and the others they could join, and why they
// cannot change party now.
export type PartyPicker = { partyId: string; name: string; parties: { id: string; name: string }[]; bar: string | null }

function buildPartyPicker(state: SceneState): PartyPicker | null {
  const id = state.activeCharacterId
  if (!id || !state.characters[id]) return null
  const partyId = state.partyOf[id]
  return {
    partyId,
    name: state.parties[partyId].name,
    parties: Object.entries(state.parties).map(([pid, p]) => ({ id: pid, name: p.name })),
    bar: getOpenAction(state) ? 'an action is being played out' : null,
  }
}

export const getPartyPicker = perState(buildPartyPicker)
export const getPartyPickerDigest = perState((state) => JSON.stringify(getPartyPicker(state)))

// Everything the roster displays, as one string. A roster entry is freshly
// allocated on every call, so it cannot gate its own re-render by identity;
// gating on this instead means any change the UI can see schedules the render
// that recomputes it. Same reasoning as the term breakdowns.
export const getCombatRosterDigest = perState((state) => JSON.stringify(getRosterParties(state)))
