// The campaign clock counts whole ETs. survival.tex "Exploration Turn (ET)":
// "It is convenient to divide a day into blocks of 4 hours because it splits
// a day into 6 parts." Anything shorter is played out in a scene, which keeps
// its own time.

// survival.tex "Day": "By default, a day has 24 hours."
export const ETS_PER_DAY = 6

// How many days end as the clock moves from one ET to the other.
export function getDaysEnded(from: number, to: number): number {
  return getDay(to) - getDay(from)
}

// survival.tex "Night and Darkness": whether the ET the clock is in falls in
// the night, the day's first `dayETs` ETs being daylight.
export function isNight(clock: number, dayETs: number): boolean {
  return clock % ETS_PER_DAY >= dayETs
}

// The day the clock is in, counted from 0.
export function getDay(clock: number): number {
  return Math.floor(clock / ETS_PER_DAY)
}
