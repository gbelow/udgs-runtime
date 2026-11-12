import type { SceneState } from '../scene/types'
import { isDead } from '../character/rules/afflictions'

// The numbers a bot weighs its options with, all in the same unit: harm, a
// share of a character in the fight (harm.ts).
// `potential`: what the party's side threatens its foes with (threat.ts: their
// best attack per point of cost with a rested round), against what the foes
// threaten it with, for what the next round holds. `immediate`: what the foes
// threaten the acting character with now, on their own turns, with the AP and
// STA they have. `engage`: what each cell between
// the character and its nearest foe costs, so that two bots do not wait on
// each other for ever. `ap`, `sta`: what a point of AP or STA the party has
// left, against what its foes have, is worth. AP is worth what it can still
// do this round; STA only tells in fights of three rounds and more, so it
// counts for nothing until an option is looked at that far ahead. `horizon`:
// how many rounds, counting the one it is in, the fight is played on after an
// option, by the bot that does not weigh (0: none, the state it leaves is
// valued as it stands, `potential` standing for what each side would do next). `patience`: what holding costs for each round the fight
// has already gone on, so that bots that each wait for the other to come do not
// wait for ever.
// `exchange`, `drain`: what an attack is worth as it is committed, besides what
// comes of it in the fight played on (exchange.ts): `exchange` weighs the
// damage it takes on average over the die, once its target has answered as it
// would weigh it; `drain` what a point of AP is worth that the target pays to
// answer it. `defensive`: the bot attacks a foe only once it has no defense left
// to answer with, and holds until then. 1: a defense only a reaction surge pays
// for is not counted, so the attack is the one that draws it; 2: any defense is.
// `switchBelow`: a weapon is switched for a rested round when the threat with the
// one in hand is under this and the other's is over it; for this turn it is
// switched when the threat after paying for the switch is the greater.
// `forced`: the least an attack is worth, as a share of what it is worth
// unanswered, however it is answered: making the target pay is a threat even
// when it does no harm.
// `undefended`: what a target that does not answer an attack is counted to pay
// for it, in the unit of AP a defense costs (threat.ts); lower for a bot that
// thinks little of defending.
export type Tuning = { potential: number; immediate: number; undefended: number; forced: number; switchBelow: number; engage: number; ap: number; sta: number; horizon: number; patience: number; exchange: number; drain: number; defensive: number }

export const DEFAULT_TUNING: Tuning = { potential: 1, immediate: 1, undefended: 1, forced: 0.3, switchBelow: 0.05, engage: 0.02, ap: 0, sta: 0.005, horizon: 0, patience: 0.03, exchange: 1, drain: 0.02, defensive: 0 }

// The characters a bot plays, all of one owner (the GM, or a player), which it
// sees in full (belief.ts). Its side is them and whoever the fight puts in a
// party with one of them (`getSide`); everyone else is its foe.
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

export function isStanding(state: SceneState, id: string): boolean {
  const c = state.characters[id]
  return !!c && !isDead(c)
}

// Whether the character is on the party's side: one of its members, or in
// the same party of the fight as one of them, whoever plays it.
export function isOnSide(state: SceneState, party: Party, id: string): boolean {
  if (isMember(party, id)) return true
  const own = state.partyOf[id]
  return own !== undefined && party.members.some((m) => state.partyOf[m] === own)
}

// Everyone on the party's side still in the fight.
export function getSide(state: SceneState, party: Party): string[] {
  return Object.keys(state.characters).filter((id) => isOnSide(state, party, id))
}

// Who the party still fights: not on its side, not fallen, and not
// surrendered (combat.tex "Surrender").
export function getLiveFoes(state: SceneState, party: Party): string[] {
  return Object.keys(state.characters).filter((id) => !isOnSide(state, party, id) && isStanding(state, id) && !state.surrendered.includes(id))
}
