import type { CampaignCharacter } from '../../types'
import type { CampaignUpdater, Homecoming } from '../types'
import { addInstance, makeFightName } from '../../instances'
import { addParty, dropEmptyParties, joinParty, withParty } from './parties'

// The character joins the roster, in the party they were in or another (see
// `joinParty`), under an id nobody at the table has `taken`.
export function addToRoster(char: CampaignCharacter, newId: () => string, taken: readonly string[]): CampaignUpdater {
  return (state) => {
    const added = addInstance(char, state.characters, newId, taken)
    return joinParty(added.id, newId)({ ...state, characters: { ...state.characters, [added.id]: added } })
  }
}

// The character comes back to the roster from a fight, under the id they left
// with, into the party the fight left them in — one it made joins the
// campaign, under its own name unless another party has it. They still sit
// out the ET they were sent in.
export function checkIn(char: CampaignCharacter, home: Homecoming): CampaignUpdater {
  return (state) => {
    const nameInUse = Object.values(state.parties).some((p) => p.name === home.name)
    const opened = state.parties[home.partyId]
      ? withParty(home.partyId, (p) => ({ ...p, name: home.name || p.name }))(state)
      : addParty(home.partyId, home.from, nameInUse ? undefined : home.name)(state)
    const back = { ...char, fightName: makeFightName(char, state.characters) }
    return dropEmptyParties({ ...opened, characters: { ...opened.characters, [char.id]: back }, partyOf: { ...opened.partyOf, [char.id]: home.partyId } })
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
