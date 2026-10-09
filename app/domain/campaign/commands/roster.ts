import type { CampaignCharacter } from '../../types'
import type { CampaignUpdater } from '../types'
import { addInstance } from '../../instances'
import { dropEmptyParties, joinParty } from './parties'

// The character joins the roster, in the party they were in or another (see
// `joinParty`).
export function addToRoster(char: CampaignCharacter, newId: () => string): CampaignUpdater {
  return (state) => {
    const added = addInstance(char, state.characters, newId)
    return joinParty(added.id, newId)({ ...state, characters: { ...state.characters, [added.id]: added } })
  }
}

// The character leaves the roster and the party they were in.
export function removeFromRoster(id: string): CampaignUpdater {
  return (state) => {
    if (!state.characters[id]) return state
    const { [id]: _gone, ...characters } = state.characters
    const { [id]: _party, ...partyOf } = state.partyOf
    return dropEmptyParties({
      ...state,
      characters,
      partyOf,
      out: state.out.filter((o) => o !== id),
      activeCharacterId: state.activeCharacterId === id ? null : state.activeCharacterId,
    })
  }
}

// survival.tex "Rest": "If rest is interrupted, it gets cancelled and the
// interrupting event happens instead" — the character leaves the roster for
// a fight but stays in their party, sitting out what they planned this ET.
export function checkOut(id: string): CampaignUpdater {
  return (state) => {
    if (!state.characters[id]) return state
    const { [id]: _gone, ...characters } = state.characters
    return {
      ...state,
      characters,
      out: state.out.includes(id) ? state.out : [...state.out, id],
      activeCharacterId: state.activeCharacterId === id ? null : state.activeCharacterId,
    }
  }
}

export function updateRosterCharacter(id: string, updater: (c: CampaignCharacter) => CampaignCharacter): CampaignUpdater {
  return (state) => {
    const c = state.characters[id]
    return c ? { ...state, characters: { ...state.characters, [id]: updater(c) } } : state
  }
}

export function setRosterActive(id: string): CampaignUpdater {
  return (state) => (state.characters[id] ? { ...state, activeCharacterId: id } : state)
}
