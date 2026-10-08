// combat.tex "Start": "A combat is played in rounds, which represent 3
// seconds of game time each."
const ROUND_SECONDS = 3

// survival.tex "Exploration Turn (ET)": "It is convenient to divide a day into
// blocks of 4 hours because it splits a day into 6 parts."
export const ET_SECONDS = 4 * 60 * 60
export const DAY_SECONDS = 6 * ET_SECONDS

// The game time a fight took, by the rounds it ran.
export function getFightSeconds(rounds: number): number {
  return rounds * ROUND_SECONDS
}

// The clock at the start of the ET after the one it is in.
export function getNextET(clock: number): number {
  return (Math.floor(clock / ET_SECONDS) + 1) * ET_SECONDS
}
