import type { CampaignCharacter } from '../../types'
import type { CampaignState, CampaignUpdater } from '../types'
import { gainHunger, gainThirst } from '../../character/commands/heal'
import { ETS_PER_DAY, getDaysEnded } from '../rules/clock'

// survival.tex "Day": "Every end of day, characters get +2 hunger and +2
// thirst".
const DAILY_HUNGER = 2
const DAILY_THIRST = 2

const endDay = (c: CampaignCharacter): CampaignCharacter => gainThirst(DAILY_THIRST)(gainHunger(DAILY_HUNGER)(c))

function endDays(state: CampaignState, days: number): CampaignState {
  if (days <= 0) return state
  const characters = Object.fromEntries(Object.entries(state.characters).map(([id, c]) =>
    [id, Array.from({ length: days }).reduce<CampaignCharacter>((acc) => endDay(acc), c)]))
  return { ...state, characters }
}

// Moves the clock on by this many ETs, ending every day it passes on the
// roster.
export function passETs(count: number): CampaignUpdater {
  return (state) => {
    const to = state.clock + Math.max(0, Math.round(count))
    return to === state.clock ? state : { ...endDays(state, getDaysEnded(state.clock, to)), clock: to }
  }
}

// survival.tex "Night and Darkness": "The day can have any number of periods
// of day and night. This depends on the season and the location on the map."
export function setDayETs(dayETs: number): CampaignUpdater {
  return (state) => ({ ...state, dayETs: Math.min(ETS_PER_DAY, Math.max(0, Math.round(dayETs))) })
}
