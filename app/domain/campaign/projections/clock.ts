import { DAY_SECONDS, ET_SECONDS } from '../rules/clock'

export type ClockView = { day: number; et: number; minutes: number }

// The clock as the table reads it: the day, the ET of that day, both counted
// from 1, and the minutes already gone in that ET.
export function getClockView(clock: number): ClockView {
  return {
    day: Math.floor(clock / DAY_SECONDS) + 1,
    et: Math.floor((clock % DAY_SECONDS) / ET_SECONDS) + 1,
    minutes: Math.floor((clock % ET_SECONDS) / 60),
  }
}
