import type { CampaignCharacter } from '../../types'
import type { CampaignState, CampaignUpdater } from '../types'
import { getPartyMembers } from '../rules/place'
import { withParty } from './parties'
import { gainHunger, gainThirst } from '../../character/commands/heal'
import { wearOff } from '../../character/commands/consume'
import { ETS_PER_DAY, getDaysEnded } from '../rules/clock'

// survival.tex "Day": "Every end of day, characters get +2 hunger and +2
// thirst".
const DAILY_HUNGER = 2
const DAILY_THIRST = 2

// abilities.tex "Bone Setting": a wound set heals by its rate every day,
// without the hunger and thirst healing IL costs (survival.tex "Healing
// Wounds"); healed to none, it is gone.
function healSetWounds(c: CampaignCharacter): CampaignCharacter {
  if (!c.injuries.wounds.some((w) => w.perDay > 0)) return c
  const wounds = c.injuries.wounds.map((w) => ({ ...w, IL: Math.max(0, w.IL - w.perDay) })).filter((w) => w.IL > 0)
  return { ...c, injuries: { ...c.injuries, wounds } }
}

const endDay = (c: CampaignCharacter): CampaignCharacter => healSetWounds(gainThirst(DAILY_THIRST)(gainHunger(DAILY_HUNGER)(c)))

// Moves the party's clock on by this many ETs, ending every day it passes
// on its members on the roster and wearing off what they took. A party
// outside time feels none of it.
function passPartyETs(state: CampaignState, partyId: string, ETs: number): CampaignState {
  const party = state.parties[partyId]
  if (!party || party.clock === null || ETs <= 0) return state
  const days = getDaysEnded(party.clock, party.clock + ETs)
  const lived = getPartyMembers(state, partyId).filter((id) => state.characters[id]).map((id) =>
    [id, wearOff(ETs)(Array.from({ length: days }).reduce<CampaignCharacter>((acc) => endDay(acc), state.characters[id]))])
  return {
    ...state,
    characters: { ...state.characters, ...Object.fromEntries(lived) },
    parties: { ...state.parties, [partyId]: { ...party, clock: party.clock + ETs } },
  }
}

// Moves these parties' clocks on by this many ETs, each along its own
// timeline.
export function passETs(count: number, partyIds: readonly string[]): CampaignUpdater {
  return (state) => {
    const ETs = Math.max(0, Math.round(count))
    return partyIds.reduce((s, pid) => passPartyETs(s, pid, ETs), state)
  }
}

// Brings the party to the ETs reading `clock` without living the time
// between: a party outside time joins that timeline, one on a timeline skips
// ahead on it. Time is never turned back.
export function placeOnTimeline(partyId: string, clock: number): CampaignUpdater {
  return (state) => {
    const party = state.parties[partyId]
    const to = Math.max(0, Math.round(clock))
    if (!party || (party.clock !== null && to <= party.clock)) return state
    return withParty(partyId, (p) => ({ ...p, clock: to }))(state)
  }
}

// Brings the party to the ETs reading `clock` by living every ET between,
// forward only.
export function passTimeTo(partyId: string, clock: number): CampaignUpdater {
  return (state) => {
    const from = state.parties[partyId]?.clock ?? null
    return from === null ? state : passPartyETs(state, partyId, Math.round(clock) - from)
  }
}

// Puts the party in play, where time passes for it, or out of it.
export function setPartyActive(partyId: string, active: boolean): CampaignUpdater {
  return withParty(partyId, (p) => ({ ...p, active }))
}

// survival.tex "Night and Darkness": "The day can have any number of periods
// of day and night. This depends on the season and the location on the map."
export function setDayETs(dayETs: number): CampaignUpdater {
  return (state) => ({ ...state, dayETs: Math.min(ETS_PER_DAY, Math.max(0, Math.round(dayETs))) })
}
