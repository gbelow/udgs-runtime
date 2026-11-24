import type { RestTuning } from './rest'

// The weights of instructions/bot-spec.md "Constants", and what STA costs.
// Nothing here decides; it prices.

export type SpecWeights = RestTuning & {
  // harm = IL · IL + bleed · bleed (spec "harm")
  IL: number
  bleed: number
  // Defense: the harm an AP has to prevent for a defence to be worth making,
  // where one leaves little harm
  caution: number
  // Escape: the share of the harm the character can still take at which its
  // potential exposure is too much
  courage: number
  // Tactical: what the character's potential threat on its target is
  // multiplied by in a cell's Score
  aggro: number
  // Attacking: what the target's threat on the character's side is
  // multiplied by, added to an attack's score
  aggressivity: number
  // Search: the most AP a search walk spends, and the most metres from the
  // nearest ally one may end at, unless it comes nearer; Cost, Danger: the
  // metres within which party members share the foes' attacks
  search: number
  solitude: number
}

// What spending `STA` costs one bleeding `bleed`: every STA spent bleeding
// adds its IL (combat.tex "Bleed").
export function getSTAHarm(STA: number, bleed: number, w: SpecWeights): number {
  return STA <= 0 ? 0 : w.STA * STA + w.IL * STA * bleed
}
