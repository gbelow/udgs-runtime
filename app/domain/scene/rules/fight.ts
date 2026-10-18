import { isCombatStarted } from './started'
import type { SceneState, Table } from '../types'
import { getPlayingOutBar } from './log'
import { getNextRoundBar } from './turn'
import type { Homecoming } from '../../campaign/types'

// Why the fight cannot give its characters back to the party now: the
// combat is ended first.
export function getReturnBar(fight: SceneState): string | null {
  if (Object.keys(fight.characters).length === 0) return 'nobody is in the fight'
  if (isCombatStarted(fight)) return 'end the combat first'
  return getPlayingOutBar(fight)
}

// Why the fight's log cannot be saved to the journal now, or null.
export function getSaveLogBar(fight: SceneState): string | null {
  if (fight.landed.length === 0) return 'nothing has been played out yet'
  return fight.logSaved >= fight.landed.length ? 'nothing new since the log was last saved' : null
}

// Why the combat cannot end now, or null: only where the round ends, once
// everyone has agreed to end it.
export function getEndCombatBar(fight: SceneState): string | null {
  if (!isCombatStarted(fight)) return 'combat has not started'
  return getPlayingOutBar(fight) ?? getNextRoundBar(fight)
}

// Why nobody can join the fight now, or null: before it starts, or at a round
// change once whoever concentrates has held on or let go, before the morale
// tests (the table's ruling).
export function getJoinBar(fight: SceneState): string | null {
  return fight.round === 0 || fight.roundStep === 'join' ? null : 'joins only before the fight starts or at the round change, before the morale tests'
}

// Whether the character was sent to the fight from the roster, rather than
// brought straight into it: the campaign keeps their party while they are
// away.
export function isFromRoster({ campaign }: Table, id: string): boolean {
  return id in campaign.partyOf && !campaign.characters[id]
}

// The party the fight leaves the character in, for the campaign to take them
// back into — the one they were sent in, or one of their own, if a fight from
// before there were parties in it left them in none. A party the fight made
// goes where the first party the campaign sent to it is.
export function getHomecoming({ campaign, fight }: Table, id: string): Homecoming {
  const partyId = fight.partyOf[id] ?? campaign.partyOf[id] ?? id
  const sent = Object.keys(fight.parties).find((pid) => campaign.parties[pid])
  return { partyId, name: fight.parties[partyId]?.name ?? '', from: sent ? campaign.parties[sent] : undefined }
}
