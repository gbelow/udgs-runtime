import type { CampaignCharacter } from '../../types'
import type { CampaignState, CampaignUpdater } from '../types'
import { gainHunger, gainThirst } from '../../character/commands/heal'
import { getDaysEnded } from '../rules/clock'

// survival.tex "Day": "Every end of day, characters get +2 hunger and +2
// thirst"; "Rest": the day's three healing rests start over.
const DAILY_HUNGER = 2
const DAILY_THIRST = 2

const endDay = (c: CampaignCharacter): CampaignCharacter => gainThirst(DAILY_THIRST)(gainHunger(DAILY_HUNGER)(c))

function endDays(state: CampaignState, days: number): CampaignState {
  if (days <= 0) return state
  const characters = Object.fromEntries(Object.entries(state.characters).map(([id, c]) =>
    [id, Array.from({ length: days }).reduce<CampaignCharacter>((acc) => endDay(acc), c)]))
  return { ...state, characters, rests: {} }
}

// Moves the clock on to this time, ending every day it passes on the roster.
export function advanceClock(to: number): CampaignUpdater {
  return (state) => (to <= state.clock ? state : { ...endDays(state, getDaysEnded(state.clock, to)), clock: to })
}
