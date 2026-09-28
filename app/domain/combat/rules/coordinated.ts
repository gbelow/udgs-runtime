import type { Action, ActionOf, CombatState, ShootAction } from '../types'
import { makeAction } from '../factories'
import { getAction, getOpenedBy, getReactionsTo } from './log'
import { isInShotRange } from './board'

// combat.tex "Coordinated Shots": "Whenever an ally shoots a target, it is
// possible to target the same target in the same action, as long as they are
// in range. The target defends all shots with a single action." A shot
// joined to another is a shot of its own, opened by the reaction that joined
// it; the target's one defense is declared against the shot it joined.

// The join a shot was opened by; null for a shot no join opened.
export function getJoinReaction(state: CombatState, shot: Action): ActionOf<'joinShot'> | null {
  const reaction = shot.spawnedBy ? getAction(state, shot.spawnedBy) : null
  return reaction?.kind === 'joinShot' ? reaction : null
}

// The shot the target defends against: the one the others were joined to,
// or the shot itself when nothing joined it.
export function getShotLead(state: CombatState, shot: Action): Action {
  const lead = getJoinReaction(state, shot)?.reactionTo
  return (lead ? getAction(state, lead) : null) ?? shot
}

// The shot and every shot joined to it, the lead first, in the order they
// were joined.
export function getShotGroup(state: CombatState, shot: Action): ShootAction[] {
  const lead = getShotLead(state, shot)
  const joined = getReactionsTo(state, lead.id).flatMap((r) => {
    const opened = r.kind === 'joinShot' ? getOpenedBy(state, r) : null
    return opened?.kind === 'shoot' ? [opened] : []
  })
  return [...(lead.kind === 'shoot' ? [lead] : []), ...joined]
}

// Whether the shooter can shoot the target with the row and way of
// shooting, from where they stand.
export function isJoinInRange(state: CombatState, actorId: string, shot: { weaponKey: string; attack: string; variant: string }, targetId: string): boolean {
  return isInShotRange(state, makeAction('shoot', { id: '', actorId, ...shot }), targetId)
}

// The shot a join opens, as declared on the reaction: committed already,
// since the reaction was, and aimed at the target of the shot it joins.
export function getJoinedShot(reaction: ActionOf<'joinShot'>, id: string): ShootAction {
  const { weaponKey, attack, variant, location, ammoId } = reaction
  return makeAction('shoot', { id, actorId: reaction.actorId, targetId: reaction.targetId, weaponKey, attack, variant, location, ammoId, spawnedBy: reaction.id, step: 'react' })
}
