import type { CampaignCharacter } from '../../types'
import type { SceneState, Updater } from '../types'
import { addInstance, makeFightName } from '../../instances'
import { nextPartyName } from '../../campaign/rules/parties'
import { getOpenAction } from '../rules/log'
import { splitChaseGroup } from './chase'

// A party nobody in the fight is in any more is gone from it.
export function dropEmptyFightParties(state: SceneState): SceneState {
  const held = new Set(Object.values(state.partyOf))
  return {
    ...state,
    parties: Object.fromEntries(Object.entries(state.parties).filter(([pid]) => held.has(pid))),
    tablePressure: Object.fromEntries(Object.entries(state.tablePressure).filter(([pid]) => pid === '' || held.has(pid))),
  }
}

// The character enters the fight under their id, in the party named, made
// under `name` if the fight does not have it yet.
export function joinFight(char: CampaignCharacter, partyId: string, name: string): Updater {
  return (state) => {
    const joined = { ...char, fightName: makeFightName(char, state.characters) }
    const parties = state.parties[partyId] ? state.parties : { ...state.parties, [partyId]: { name: name || nextPartyName(state.parties) } }
    return { ...state, characters: { ...state.characters, [char.id]: joined }, parties, partyOf: { ...state.partyOf, [char.id]: partyId } }
  }
}

// A character brought straight into the fight, under an id nobody at the
// table has `taken`, joins the newest party made in it — one that is not among
// `campaignParties` — or a party of their own.
export function addToFight(char: CampaignCharacter, newId: () => string, taken: readonly string[], campaignParties: readonly string[]): Updater {
  return (state) => {
    const added = addInstance(char, state.characters, newId, taken)
    const made = Object.keys(state.parties).filter((pid) => !campaignParties.includes(pid))
    return joinFight(added, made.at(-1) ?? newId(), '')(state)
  }
}

// The character joins another party of the fight. Refused while an action is
// being played out.
export function moveToParty(id: string, partyId: string): Updater {
  return (state) => {
    if (getOpenAction(state) || !state.characters[id] || !state.parties[partyId]) return state
    return dropEmptyFightParties({ ...state, partyOf: { ...state.partyOf, [id]: partyId } })
  }
}

// The character leaves for a new party of their own, on the side of the
// chase they were on. Refused while an action is being played out.
export function splitOff(id: string, newId: () => string): Updater {
  return (state) => {
    if (getOpenAction(state) || !state.characters[id]) return state
    const partyId = newId()
    return dropEmptyFightParties({
      ...state,
      parties: { ...state.parties, [partyId]: { name: nextPartyName(state.parties) } },
      partyOf: { ...state.partyOf, [id]: partyId },
      chase: splitChaseGroup(state, state.partyOf[id] ?? '', partyId),
    })
  }
}

export function renameParty(partyId: string, name: string): Updater {
  return (state) => (state.parties[partyId] && name ? { ...state, parties: { ...state.parties, [partyId]: { name } } } : state)
}
