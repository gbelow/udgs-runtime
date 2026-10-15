import type { CampaignCharacter } from '../../types'
import type { CampaignUpdater, Homecoming } from '../types'
import { addInstance } from '../../instances'
import { without } from '../../utils'
import { addParty, dropEmptyParties, joinParty, withParty } from './parties'
import { nameByParty } from './names'

// Only a fight hands out AP (combat.tex "End of the round"), so whoever is on
// the roster has none.
function withoutAP(c: CampaignCharacter): CampaignCharacter {
  return c.resources.AP === 0 ? c : { ...c, resources: { ...c.resources, AP: 0 } }
}

// The character joins the roster, in the party `into` names or else the one
// they were in or another (see `joinParty`), under an id nobody at the table
// has `taken`, named by the party they join (`nameByParty`).
export function addToRoster(char: CampaignCharacter, newId: () => string, taken: readonly string[], into?: string): CampaignUpdater {
  return (state) => {
    const added = addInstance(withoutAP(char), newId, taken)
    const rostered = { ...state, characters: { ...state.characters, [added.id]: added } }
    if (into && state.parties[into]) return nameByParty([added.id])({ ...rostered, partyOf: { ...rostered.partyOf, [added.id]: into } })
    return joinParty(added.id, newId)(rostered)
  }
}

// The character comes back to the roster from a fight, under the id they left
// with, into the party the fight left them in — one it made joins the
// campaign, under its own name unless another party has it. One the campaign
// has not named yet is named by that party (`nameByParty`), by the name they
// went by in the fight if they can be. They still sit out the ET they were
// sent in.
export function checkIn(char: CampaignCharacter, home: Homecoming, fightName: string): CampaignUpdater {
  return (state) => {
    const nameInUse = Object.values(state.parties).some((p) => p.name === home.name)
    const opened = state.parties[home.partyId]
      ? withParty(home.partyId, (p) => ({ ...p, name: home.name || p.name }))(state)
      : addParty(home.partyId, home.from, nameInUse ? undefined : home.name)(state)
    const back = dropEmptyParties({ ...opened, characters: { ...opened.characters, [char.id]: withoutAP(char) }, partyOf: { ...opened.partyOf, [char.id]: home.partyId } })
    return nameByParty([char.id], fightName)(back)
  }
}

// The character leaves the roster, the party they were in and their name.
export function removeFromRoster(id: string): CampaignUpdater {
  return (state) => {
    if (!state.characters[id]) return state
    return dropEmptyParties({
      ...state,
      characters: without(state.characters, id),
      partyOf: without(state.partyOf, id),
      names: without(state.names, id),
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
