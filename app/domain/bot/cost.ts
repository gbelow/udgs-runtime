import type { RestTuning } from './rest'

// The prices of instructions/bot-spec.md "Cost", for any box that plays by it.
// Nothing here decides; it prices.

export type SpecWeights = RestTuning & {
  // harm = IL · IL + bleed · bleed (spec "harm"); the pair tables (pairs.ts
  // `getHarm`) are read at 2 and 5, the defaults
  IL: number
  bleed: number
  // what every cost is multiplied by
  caution: number
  // what spending any AP at all costs, besides what it leaves the spender exposed to
  baseAPcost: number
  // Escape: the danger shed is divided by `courage`, and every ally within
  // ESCAPE_COMPANY metres of where it sets out takes off `teamwork`
  courage: number
  teamwork: number
  // Tactical: how many times more harm another foe must be open to than the
  // character's target, for it to become the target; and what the
  // character's potential threat on its target is multiplied by in a cell's
  // Score
  retarget: number
  aggro: number
  // Attacking: what the target's threat on the character's side is
  // multiplied by, added to an attack's score
  aggressivity: number
  // Search: the most AP a search walk spends, and the most metres from the
  // nearest ally one may end at, unless it comes nearer
  search: number
  solitude: number
}

// What spending `STA` costs one bleeding `bleed`: every STA spent bleeding
// adds its IL (combat.tex "Bleed").
export function getSTAHarm(STA: number, bleed: number, w: SpecWeights): number {
  return STA <= 0 ? 0 : w.STA * STA + w.IL * STA * bleed
}

// spec "Cost": what an action costs the character making it, an attack, a
// walk or a defence alike: spending `AP` (any at all pays `baseAPcost`),
// `delta` (the change in the immediate threat of everyone on it, after less
// before), and `STA`. `free` leaves the AP out (spec "Decide take turn":
// before agreeing to end the round).
export function getCost(AP: number, STA: number, delta: number, bleed: number, w: SpecWeights, free = false): number {
  const spent = free ? 0 : w.AP * ((AP > 0 ? w.baseAPcost : 0) + delta)
  return w.caution * (spent + getSTAHarm(STA, bleed, w))
}
