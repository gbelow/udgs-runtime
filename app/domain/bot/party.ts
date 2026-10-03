import type { CombatState } from '../combat/types'
import { isDead } from '../character/rules/afflictions'

// The numbers a bot weighs its options with, all in the same unit: a fraction
// of a character's way to death (injury level over its death threshold).
// `threat`: how much the damage the foes could do next counts against an
// option, against the damage it does itself. `engage`: what each cell between
// the character and its nearest foe costs, so that two bots do not wait on
// each other for ever. `ap`, `sta`: what a point of AP or STA the party has
// left, against what its foes have, is worth. AP is worth what it can still
// do this round; STA only tells in fights of three rounds and more, so it
// counts for nothing until an option is looked at that far ahead. `samples`:
// how many dice each option is played out with.
export type Tuning = { threat: number; engage: number; ap: number; sta: number; samples: number }

export const DEFAULT_TUNING: Tuning = { threat: 1, engage: 0.02, ap: 0.005, sta: 0, samples: 4 }

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
