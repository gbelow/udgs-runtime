import type { CampaignCharacter } from '../../types'
import type { CampaignState, CampaignUpdater } from '../types'
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

function endDays(state: CampaignState, days: number): CampaignState {
  if (days <= 0) return state
  const characters = Object.fromEntries(Object.entries(state.characters).map(([id, c]) =>
    [id, Array.from({ length: days }).reduce<CampaignCharacter>((acc) => endDay(acc), c)]))
  return { ...state, characters }
}

// Moves the clock on by this many ETs, ending every day it passes on the
// roster and wearing off what was taken.
export function passETs(count: number): CampaignUpdater {
  return (state) => {
    const ETs = Math.max(0, Math.round(count))
    if (ETs === 0) return state
    const ended = endDays(state, getDaysEnded(state.clock, state.clock + ETs))
    const characters = Object.fromEntries(Object.entries(ended.characters).map(([id, c]) => [id, wearOff(ETs)(c)]))
    return { ...ended, characters, clock: state.clock + ETs }
  }
}

// survival.tex "Infection": "Optional" — the table plays it or not.
export function setInfection(infection: boolean): CampaignUpdater {
  return (state) => ({ ...state, infection })
}

// survival.tex "Night and Darkness": "The day can have any number of periods
// of day and night. This depends on the season and the location on the map."
export function setDayETs(dayETs: number): CampaignUpdater {
  return (state) => ({ ...state, dayETs: Math.min(ETS_PER_DAY, Math.max(0, Math.round(dayETs))) })
}
