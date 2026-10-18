import type { CampaignState, SeenCampaign, Sequence } from '../types'
import { getPartyMembers } from '../rules/place'
import { isPlaying } from '../rules/clock'
import { getPartyMoveBar } from '../rules/parties'
import { getRosterName } from '../rules/roster'
import { perState } from '../../perState'
import { getTimelineView, type TimelineView } from './timeline'

// `fighting` is a member sent to the fight, off the roster until it sends them back.
export type RosterMember = { id: string; name: string; isActive: boolean; fighting: boolean }
// `playing` is the sequence the party is in, or none while it is frozen or
// outside time; `sequence` is the one it will be in when it plays. `fighting`
// is whether any of its members is in the fight.
export type RosterPartyView = { id: string; name: string; sequence: Sequence; playing: Sequence | null; fighting: boolean; timeline: TimelineView; members: RosterMember[] }
export type RosterView = {
  parties: RosterPartyView[]
  // on the roster in no party, and so outside time
  unplaced: RosterMember[]
}

const member = (state: SeenCampaign, id: string): RosterMember => ({ id, name: getRosterName(state, id), isActive: id === state.activeCharacterId, fighting: !state.characters[id] })

// The campaign's parties, in play first, each with when it is and who is in
// it — those sent to the fight too, marked — and the sequence it is in, and
// whoever is in no party.
export const getRosterView = perState((state: SeenCampaign): RosterView => {
  const parties = Object.entries(state.parties).map(([id, party]) => {
    const members = getPartyMembers(state, id).map((m) => member(state, m))
    return {
      id, name: party.name, sequence: party.sequence, playing: isPlaying(party) ? party.sequence : null, fighting: members.some((m) => m.fighting), timeline: getTimelineView(state, id, party),
      members,
    }
  })
  return {
    parties: [...parties.filter((p) => p.timeline.active), ...parties.filter((p) => !p.timeline.active)],
    unplaced: Object.keys(state.characters).filter((id) => !state.parties[state.partyOf[id]]).map((id) => member(state, id)),
  }
})

// The parties in play in one sequence: what that sequence's screen lists,
// with nobody outside a party.
export function getRosterIn(view: RosterView, sequence: Sequence): RosterView {
  return { ...view, parties: view.parties.filter((p) => p.playing === sequence), unplaced: [] }
}

export const getRosterViewDigest =perState((state: SeenCampaign) => JSON.stringify(getRosterView(state)))

// Why the character cannot join each other party, by party; null where they
// can.
export function getMoveBars(state: CampaignState, id: string): Record<string, string | null> {
  return Object.fromEntries(Object.keys(state.parties).filter((pid) => pid !== state.partyOf[id]).map((pid) => [pid, getPartyMoveBar(state, id, pid)]))
}
