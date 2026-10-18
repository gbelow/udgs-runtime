import type { CampaignCharacter } from '../../types'
import type { CampaignUpdater, Homecoming } from '../types'
import { withFreeId } from '../rules/roster'
import { without } from '../../utils'
import { addParty, dropEmptyParties, joinParty, withParty } from './parties'
import { nameByParty } from './names'

// Only a fight hands out AP (combat.tex "End of the round"), so whoever is on
// the roster has none.
function withoutAP(c: CampaignCharacter): CampaignCharacter {
  return c.resources.AP === 0 ? c : { ...c, resources: { ...c.resources, AP: 0 } }
}

// The character joins the roster, in the party `into` names or else the one
// they were in or another (see `joinParty`), under an id the campaign has not
// given anyone else (`withFreeId`), named by the party they join
// (`nameByParty`); with `into` null, in no party, outside time.
export function addToRoster(char: CampaignCharacter, newId: () => string, into?: string | null): CampaignUpdater {
  return (state) => {
    const added = withFreeId(state, withoutAP(char), newId)
    const rostered = { ...state, characters: { ...state.characters, [added.id]: added } }
    if (into === null) return rostered
    if (into && state.parties[into]) return nameByParty([added.id])({ ...rostered, partyOf: { ...rostered.partyOf, [added.id]: into } })
    return joinParty(added.id, newId)(rostered)
  }
}

// The character comes back to the roster from a fight, under the id they left
// with, into the party the fight left them in — one it made joins the
// campaign, under its own name unless another party has it. One the campaign
// has not named yet is named by that party (`nameByParty`), by the name they
// went by in the fight if they can be.
export function checkIn(char: CampaignCharacter, home: Homecoming, fightName: string): CampaignUpdater {
  return (state) => {
    const nameInUse = Object.values(state.parties).some((p) => p.name === home.name)
    const opened = state.parties[home.partyId]
      ? withParty(home.partyId, (p) => ({ ...p, name: home.name || p.name }))(state)
      : addParty(home.partyId, home.from, nameInUse ? undefined : home.name)(state)
    const back = dropEmptyParties({ ...opened, characters: { ...opened.characters, [char.id]: withoutAP(char) }, partyOf: { ...opened.partyOf, [char.id]: home.partyId }, lent: opened.lent.filter((l) => l !== char.id) })
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
    })
  }
}

// The character leaves the roster for a fight but stays in their party.
export function checkOut(id: string): CampaignUpdater {
  return (state) => {
    if (!state.characters[id]) return state
    const { [id]: _gone, ...characters } = state.characters
    return {
      ...state,
      characters,
      lent: state.lent.includes(id) ? state.lent : [...state.lent, id],
    }
  }
}

// The campaign lends the id to a fight, for a character brought straight
// into it, so that nobody else is given it while they are there.
export function lend(id: string): CampaignUpdater {
  return (state) => (state.lent.includes(id) ? state : { ...state, lent: [...state.lent, id] })
}

// The id lent to a fight comes back, its character gone with the fight.
export function release(id: string): CampaignUpdater {
  return (state) => (state.lent.includes(id) ? { ...state, lent: state.lent.filter((l) => l !== id) } : state)
}

export function updateRosterCharacter(id: string, updater: (c: CampaignCharacter) => CampaignCharacter): CampaignUpdater {
  return (state) => {
    const c = state.characters[id]
    return c ? { ...state, characters: { ...state.characters, [id]: updater(c) } } : state
  }
}
