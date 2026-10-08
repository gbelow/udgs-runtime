import type { CampaignCharacter } from '../../types'
import type { CampaignUpdater } from '../types'
import { withInstance } from '../../instances'

export function addToRoster(char: CampaignCharacter, newId: () => string): CampaignUpdater {
  return (state) => ({ ...state, characters: withInstance(char, state.characters, newId) })
}

export function removeFromRoster(id: string): CampaignUpdater {
  return (state) => {
    if (!state.characters[id]) return state
    const { [id]: _gone, ...characters } = state.characters
    return { ...state, characters, activeCharacterId: state.activeCharacterId === id ? null : state.activeCharacterId }
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
