import type { CombatState } from '../combat/types'
import { isDead } from '../character/rules/afflictions'

// The numbers a bot weighs its options with, all in the same unit: a fraction
// of a character's way to death (injury level over its death threshold).
// `threat`: how much the damage the foes could still do from where an option
// leaves the party counts against it; it is left at nothing when `horizon` has
// the foes' turns played out. `engage`: what each cell between
// the character and its nearest foe costs, so that two bots do not wait on
// each other for ever. `ap`, `sta`: what a point of AP or STA the party has
// left, against what its foes have, is worth. AP is worth what it can still
// do this round; STA only tells in fights of three rounds and more, so it
// counts for nothing until an option is looked at that far ahead. `horizon`:
// how many rounds, counting the one it is in, the fight is played on after an
// option, by the bot that does not weigh (0: none, the state it leaves is
// valued as it stands). `patience`: what holding costs for each round the fight
// has already gone on, so that bots that each wait for the other to come do not
// wait for ever. `samples`: how many dice each option is played with.
export type Tuning = { threat: number; engage: number; ap: number; sta: number; horizon: number; patience: number; samples: number }

export const DEFAULT_TUNING: Tuning = { threat: 0, engage: 0.02, ap: 0.005, sta: 0.005, horizon: 3, patience: 0.03, samples: 5 }

// The side a bot plays: the characters it controls. Everyone else in the fight
// is its foe.
export type Party = {
  members: readonly string[]
  tuning?: Partial<Tuning>
}

export function getTuning(party: Party): Tuning {
  return { ...DEFAULT_TUNING, ...party.tuning }
}

export function isMember(party: Party, id: string): boolean {
  return party.members.includes(id)
}

// The party that controls the character, if a bot does.
export function findParty(parties: readonly Party[], id: string): Party | undefined {
  return parties.find((party) => isMember(party, id))
}

export function isStanding(state: CombatState, id: string): boolean {
  const c = state.characters[id]
  return !!c && !isDead(c)
}

// Who the party still fights: not fallen, and not surrendered (combat.tex
// "Surrender").
export function getLiveFoes(state: CombatState, party: Party): string[] {
  return Object.keys(state.characters).filter((id) => !isMember(party, id) && isStanding(state, id) && !state.surrendered.includes(id))
}
