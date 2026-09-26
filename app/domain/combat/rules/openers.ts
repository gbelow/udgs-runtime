import type { Action, ActionOf, CombatState, MoveAction, ReactionAction, ReactionKind, RootAction } from '../types'
import { makeAction } from '../factories'
import { isReactionAction } from './actionCatalog'
import { getOpenedBy, getReactionsTo } from './log'
import { getOpportunityAction, getOpportunityState, getOpportunityStop, isOpportunityReached } from './attack'
import { getDrawnOpportunityAttacks, isFlankInReach } from './opportunity'
import { getCounterSlot, getCounterStrike, getCounterStrikeOf, type CounterSlot } from './counter'
import { getInterruptionOf } from './interruption'
import { getEscapeAfterBlast, getEscapeBeforeBlast, getEvasionMove, getFollowMove, type ReactionMove } from './reactionMoves'

// What each reaction opens, and when. `before` is played out between the
// root's roll and its effect (combat.tex "Opportunity Attack": "The attack
// occurs before the effect of the triggering action"), one opened action at
// a time, each once the one before has landed: the action it opens, with
// the fight as it is fought in, or null when it opens nothing now. `after`
// generates follow-ups once the root has landed — none from a voided root,
// unless the reaction is `evenIfVoided` (the table's ruling: no follow-ups
// for an interrupted action). A reaction kind added to the catalog does not
// compile until it has an entry here.
export type Opened = { state: CombatState; action: Action }

export type Opener<K extends ReactionKind> = {
  before?(state: CombatState, root: RootAction, reaction: ActionOf<K>, newId: () => string): Opened | null
  after?(state: CombatState, root: RootAction, reaction: ActionOf<K>, newId: () => string): Action[]
  evenIfVoided?: true
}

export const REACTION_OPENERS: { [K in ReactionKind]: Opener<K> } = {
  evade: {},
  evasiveJump: {},
  block: {},
  intercept: {},
  guard: {},
  resist: {},
  assist: {},
  carry: {},
  letGo: {},
  evasion: {
    after: (state, root, reaction, newId) => openMove(reaction, newId, getEvasionMove(root, reaction)),
  },
  follow: {
    after: (state, root, reaction, newId) => openMove(reaction, newId, getFollowMove(root)),
  },
  // the escape the reflex clears the way for goes before the blast, the one
  // a miss leaves after it (combat.tex "Avoiding an Explosion")
  avoidExplosion: {
    after: (state, root, reaction, newId) => openMove(reaction, newId,
      root.kind === 'explosion' ? getEscapeBeforeBlast(reaction) : root.kind === 'blast' ? getEscapeAfterBlast(state, root, reaction) : null),
  },
  // combat.tex "Opportunity Attack": each attack the root drew is opened in
  // the order it comes to them; a move or a push has everyone it carries
  // stood one space short of the stretch the attack fires on while it is
  // fought. None is opened once the root is brought to a stop, nor on a
  // stretch it never reaches; a flanker the attacker has got out of range of
  // is passed over (combat.tex "Flanking").
  opportunityAttack: {
    before: (state, root, reaction, newId) => {
      if (getOpenedBy(state, reaction)) return null
      if (getOpportunityStop(state, root) !== null || !isOpportunityReached(state, root, reaction)) return null
      if (root.kind === 'strike' && !isFlankInReach(state, reaction, root)) return null
      const placed = getOpportunityState(state, reaction)
      return { state: placed, action: getOpportunityAction(placed, reaction, newId()) }
    },
  },
  // abilities.tex "Counterattack": "The attack with the higher result hits
  // first" — the strike opened ahead of the attack's effect when it rolled
  // higher or the same (the table's ruling: a tie lands both, neither
  // breaking the other), after it when it rolled lower, unless the attack
  // interrupted the one who made it. That one is its target's attack, not
  // the attack's own follow-up, so it comes whether or not the attack landed.
  counterattack: {
    before: (state, root, reaction, newId) => {
      const strike = openCounter(state, root, reaction, ['before', 'tie'], newId)
      return strike ? { state, action: strike } : null
    },
    after: (state, root, reaction, newId) => {
      if (getInterruptionOf(root, reaction.actorId) !== 'none') return []
      const strike = openCounter(state, root, reaction, ['after'], newId)
      return strike ? [strike] : []
    },
    evenIfVoided: true,
  },
}

export function getOpener<K extends ReactionKind>(reaction: { kind: K }): Opener<K> {
  return REACTION_OPENERS[reaction.kind]
}

// The reactions to the root in the order what they open is played out
// before its effect: the opportunity attacks it drew in the order it comes
// to them (`getDrawnOpportunityAttacks`), then the rest as declared.
export function getReactionsInOrder(state: CombatState, root: RootAction): ReactionAction[] {
  const drawn = getDrawnOpportunityAttacks(state, root).map(({ reaction }) => reaction)
  return [...drawn, ...getReactionsTo(state, root.id).filter(isReactionAction).filter((r) => r.kind !== 'opportunityAttack')]
}

// The reactions whose follow-ups the landed root generates: its own — but a
// blast's, which are those to the explosion it went off from, the reflexes
// that cleared or missed it (combat.tex "Avoiding an Explosion").
export function getAnsweringReactions(state: CombatState, root: RootAction): ReactionAction[] {
  const answered = root.kind === 'blast' && root.spawnedBy ? root.spawnedBy : root.id
  return getReactionsTo(state, answered).filter(isReactionAction)
}

function openCounter(state: CombatState, root: RootAction, reaction: ActionOf<'counterattack'>, slots: CounterSlot[], newId: () => string): Action | null {
  const slot = getCounterSlot(root, reaction)
  if (!slot || !slots.includes(slot) || getCounterStrikeOf(state, reaction)) return null
  return getCounterStrike(reaction, newId())
}

// The move a reaction opens for its reactor.
function openMove(reaction: Action, newId: () => string, fields: ReactionMove | null): MoveAction[] {
  return fields ? [makeAction('move', { ...fields, id: newId(), actorId: reaction.actorId, spawnedBy: reaction.id })] : []
}
