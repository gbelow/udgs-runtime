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
  // Aggro: how many times more harm a foe out of reach must be open to than
  // every foe in reach, for the character to go after it
  retarget: number
  // 1: Aggro is tried before Tactical, 0: Tactical before Aggro
  aggro: number
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

// What an action of the character's own costs it: spending `AP` (any at all
// pays `baseAPcost`), leaving it `delta` more exposed to its foes this round
// (their immediate threat on it after, less before), and `STA`. `free` leaves
// the AP out (spec "Decide take turn": before agreeing to end the round).
export function getOffensiveCost(AP: number, STA: number, delta: number, bleed: number, w: SpecWeights, free = false): number {
  const spent = free ? 0 : w.AP * ((AP > 0 ? w.baseAPcost : 0) + delta)
  return w.caution * (spent + getSTAHarm(STA, bleed, w))
}

// What a defence costs the one making it: what it leaves it exposed to, and its STA.
export function getDefensiveCost(STA: number, delta: number, bleed: number, w: SpecWeights): number {
  return w.caution * (w.AP * delta + getSTAHarm(STA, bleed, w))
}
