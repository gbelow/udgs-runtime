// combat.tex "Start": "A combat is played in rounds, which represent 3
// seconds of game time each."
const ROUND_SECONDS = 3

// survival.tex "Exploration Turn (ET)": "It is convenient to divide a day into
// blocks of 4 hours because it splits a day into 6 parts."
export const ET_SECONDS = 4 * 60 * 60
// survival.tex "Day": "By default, a day has 24 hours."
export const ETS_PER_DAY = 6
export const DAY_SECONDS = ETS_PER_DAY * ET_SECONDS

// The game time a fight took, by the rounds it ran.
export function getFightSeconds(rounds: number): number {
  return rounds * ROUND_SECONDS
}

// The clock at the start of the ET after the one it is in.
export function getNextET(clock: number): number {
  return (Math.floor(clock / ET_SECONDS) + 1) * ET_SECONDS
}

// How many days end as the clock moves from one time to the other.
export function getDaysEnded(from: number, to: number): number {
  return Math.floor(to / DAY_SECONDS) - Math.floor(from / DAY_SECONDS)
}

// survival.tex "Night and Darkness": whether the ET the clock is in falls in
// the night, the day's first `dayETs` ETs being daylight.
export function isNight(clock: number, dayETs: number): boolean {
  return Math.floor((clock % DAY_SECONDS) / ET_SECONDS) >= dayETs
}

// The day the clock is in, counted from 0.
export function getDay(clock: number): number {
  return Math.floor(clock / DAY_SECONDS)
}
