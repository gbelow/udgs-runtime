import type { CampaignState } from '../types'
import { getPartyMembers } from '../rules/place'
import { getPartyMoveBar } from '../rules/parties'
import { getRosterName } from '../rules/roster'
import { perState } from '../../perState'
import { getTimelineView, type TimelineView } from './timeline'

export type RosterMember = { id: string; name: string; isActive: boolean }
export type RosterPartyView = { id: string; name: string; timeline: TimelineView; members: RosterMember[] }
export type RosterView = {
  parties: RosterPartyView[]
  // on the roster in no party, and so outside time
  unplaced: RosterMember[]
}

const member = (state: CampaignState, id: string): RosterMember => ({ id, name: getRosterName(state, id), isActive: id === state.activeCharacterId })

// The campaign's parties out of a fight, in play first, each with when it is
// and who is in it, and whoever is in no party.
export const getRosterView = perState((state: CampaignState): RosterView => {
  const parties = Object.entries(state.parties).map(([id, party]) => ({
    id, name: party.name, timeline: getTimelineView(state, id, party),
    members: getPartyMembers(state, id).filter((m) => state.characters[m]).map((m) => member(state, m)),
  }))
  return {
    parties: [...parties.filter((p) => p.timeline.active), ...parties.filter((p) => !p.timeline.active)],
    unplaced: Object.keys(state.characters).filter((id) => !state.parties[state.partyOf[id]]).map((id) => member(state, id)),
  }
})

export const getRosterViewDigest = perState((state: CampaignState) => JSON.stringify(getRosterView(state)))

// Why the character cannot join each other party, by party; null where they
// can.
export function getMoveBars(state: CampaignState, id: string): Record<string, string | null> {
  return Object.fromEntries(Object.keys(state.parties).filter((pid) => pid !== state.partyOf[id]).map((pid) => [pid, getPartyMoveBar(state, id, pid)]))
}
