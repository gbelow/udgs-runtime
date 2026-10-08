import type { CampaignState } from '../types'
import { perState } from '../../combat/projections/perState'

export type PartyEntry = { id: string; name: string; isActive: boolean }

// Who is with the party, out of any fight, and who is selected.
export const getPartyRoster = perState((state: CampaignState): PartyEntry[] =>
  Object.entries(state.characters).map(([id, c]) => ({ id, name: c.fightName ?? '', isActive: id === state.activeCharacterId })))

// Everything the roster displays, as one string to gate its render on.
export const getPartyRosterDigest = perState((state: CampaignState) => JSON.stringify(getPartyRoster(state)))
