import { ETS_PER_DAY, getDay } from '../rules/clock'

export type ClockView = { day: number; et: number; etsPerDay: number }

// The clock as the table reads it: the day and the ET of that day, both
// counted from 1.
export function getClockView(clock: number): ClockView {
  return { day: getDay(clock) + 1, et: (clock % ETS_PER_DAY) + 1, etsPerDay: ETS_PER_DAY }
}
