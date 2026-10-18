import type { RosterMember, RosterPartyView, RosterView } from '../../campaign/projections/roster'
import type { Sequence } from '../../campaign/types'
import type { SceneCard, SceneCardParty } from './cards'

// A party as the table sees it, the campaign's and the fight's under one id:
// who is on the roster in it, and who of it is in the fight, as a card.
// `campaign` is its side of the campaign, none for a party made in the fight;
// `inFight` is whether the fight has it, empty or not; `adds` is where a
// character brought in from the catalog goes — straight into the fight while
// anyone is fighting or the party is the fight's own, else onto the roster.
export type TablePartyView = {
  id: string
  name: string
  campaign: RosterPartyView | null
  inFight: boolean
  adds: 'fight' | 'roster'
  roster: RosterMember[]
  fighters: SceneCard[]
}

export type TablePartiesView = {
  parties: TablePartyView[]
  // in no party: on the roster, outside time, or in the fight in none
  loose: { roster: RosterMember[]; fighters: SceneCard[] }
}

// The campaign's parties and the fight's joined by id — the campaign's in
// play first, then the ones made in the fight — each with the members still
// on the roster and the fighters, who are where the fight has them. With a
// `sequence`, only the campaign's parties playing in it.
export function getTableParties(roster: RosterView, cards: SceneCardParty[], sequence?: Sequence): TablePartiesView {
  const fight = new Map(cards.filter((p) => p.id !== '').map((p) => [p.id, p]))
  const loose = cards.find((p) => p.id === '')?.cards ?? []
  const fighting = cards.some((p) => p.cards.length > 0)
  const fromCampaign = roster.parties.map((p): TablePartyView => ({
    id: p.id, name: p.name, campaign: p, inFight: fight.has(p.id), adds: fighting ? 'fight' : 'roster',
    roster: p.members.filter((m) => !m.fighting), fighters: fight.get(p.id)?.cards ?? [],
  }))
  if (sequence) return { parties: fromCampaign.filter((p) => p.campaign?.playing === sequence), loose: { roster: [], fighters: [] } }
  const known = new Set(roster.parties.map((p) => p.id))
  const madeInFight = [...fight.values()].filter((p) => !known.has(p.id)).map((p): TablePartyView => ({ id: p.id, name: p.name, campaign: null, inFight: true, adds: 'fight', roster: [], fighters: p.cards }))
  return { parties: [...fromCampaign, ...madeInFight], loose: { roster: roster.unplaced, fighters: loose } }
}
