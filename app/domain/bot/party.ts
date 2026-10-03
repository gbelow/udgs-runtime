import type { CombatState } from '../combat/types'
import { isDead } from '../character/rules/afflictions'

// The side a bot plays: the characters it controls. Everyone else in the fight
// is its foe.
export type Party = {
  members: readonly string[]
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
