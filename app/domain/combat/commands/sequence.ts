import type { Action, CastAction, CombatState, ExplosionAction, RootAction } from '../types'
import { getOpenAction } from '../rules/log'
import { getTriggers } from '../rules/reactions'
import { getSettled } from '../rules/settle'
import { opensExplosion } from '../rules/cast'
import { getAttackOptions } from '../rules/attack'
import { isInReach } from '../rules/board'
import { getBlastOf, isSpray } from '../rules/explosion'
import { isVoided } from '../rules/opportunity'
import { getAnsweringReactions, getOpener, getReactionsInOrder } from '../rules/openers'
import { getRiposteOpening } from '../rules/riposte'
import { getDisplacement, getStunEscapes } from '../rules/grapple'
import { getHookKnockdown } from '../rules/damage'
import { makeAction } from '../factories'
import { appendActions, applyPhase, replaceActions } from './log'

// What carries the fight on between the commands. Every action runs
// define → react → roll → post → effect; the actions its reactions open are
// played out between its roll and its effect, and the follow-ups its effect
// generates after it. Each is pushed onto the stack over the action that
// opened it, so the top is always the one the table is waiting on, and when
// it lands the action beneath picks up where it was. Not commands of their
// own — the action commands call these after every change.

// Carries the fight on from whatever is on top of the stack: a rolled action
// opens the next of the actions its reactions opened before its effect. One
// waiting on a declaration, an answer or a choice is left to it — except
// those with nothing of their own left to decide, which land once their
// attacks are fought: an explosion, and a displacement, which nobody able to
// answer it is walked at once.
export function advance(state: CombatState, newId: () => string): CombatState {
  const top = getOpenAction(state)
  if (!top) return state
  if (top.kind === 'displace' && top.step === 'react' && getTriggers(state, top).length === 0) {
    return advance(replaceActions(state, [{ ...top, step: 'post', cost: { AP: 0, STA: 0 } }]), newId)
  }
  if (top.step !== 'post') return state
  const opened = openBefore(state, top, newId)
  return opened === state && (top.kind === 'displace' || top.kind === 'explosion') ? land(state, top, newId) : opened
}

// The action's effect: settled as it stands, landed on everyone it
// concerns, and closed, with the follow-ups it generates pushed over the
// action beneath, and the fight carried on from there.
export function land(state: CombatState, open: RootAction, newId: () => string): CombatState {
  const resolved = getSettled(state, open)
  const landed = applyPhase(replaceActions(state, [resolved]), [resolved], 'resolve')
  return advance(appendActions(landed, getFollowUps(landed, resolved, newId)), newId)
}

// What the root's reactions open before its effect, the next of them once
// the one before has landed, in the order `getReactionsInOrder` gives
// (rules/openers.ts).
function openBefore(state: CombatState, root: RootAction, newId: () => string): CombatState {
  for (const reaction of getReactionsInOrder(state, root)) {
    const opened = getOpener(reaction).before?.(state, root, reaction, newId)
    if (opened) return appendActions(opened.state, [opened.action])
  }
  return state
}

// abilities.tex "Riposte": the defender's attack after a melee attack their
// defense made miss or graze, aimed back at the attacker "if in range" —
// some strike they hold reaches — for them to declare or pass up.
function openRiposte(state: CombatState, root: RootAction, newId: () => string): Action[] {
  const defense = getRiposteOpening(state, root)
  const riposter = defense ? state.characters[defense.actorId] : undefined
  if (!defense || !riposter) return []
  const strike = makeAction('strike', { id: newId(), actorId: defense.actorId, targetId: root.actorId, spawnedBy: defense.id })
  const reaches = getAttackOptions(riposter, 'strike').some((o) => isInReach(state, { ...strike, ...o }, root.actorId))
  return reaches ? [strike] : []
}

// combat.tex "Avoiding an Explosion": the explosion goes off as a blast,
// once the escapes the reflexes that cleared it open have been walked — so
// it goes beneath them.
function goOff(root: ExplosionAction, newId: () => string): Action {
  return makeAction('blast', { id: newId(), actorId: root.actorId, spawnedBy: root.id, key: root.key, effects: root.effects, center: root.center, step: 'post' })
}

// The follow-ups the landed action generates, the last played out first:
// the blast an explosion goes off as, beneath everything else; what its
// reactions open after it (rules/openers.ts), in the order they were
// declared; the escapes a stun opens, the way a push was pointed, walked,
// the explosion a cast that hit with an area to it goes off as, aimed and
// played out on its own (the caster's part is done), the knockdown a hook
// opens; and on top, a riposte.
// A voided action generates nothing (the table's ruling: no follow-ups for
// an interrupted action) but what a reaction opens `evenIfVoided`.
export function getFollowUps(state: CombatState, root: RootAction, newId: () => string): Action[] {
  const voided = isVoided(state, root)
  const blast = root.kind === 'explosion' && !voided ? [goOff(root, newId)] : []
  const opened = getAnsweringReactions(state, root).flatMap((reaction) => {
    const opener = getOpener(reaction)
    return opener.after && (!voided || opener.evenIfVoided) ? opener.after(state, root, reaction, newId) : []
  })
  if (voided) return opened
  const displacement = root.kind === 'drag' ? getDisplacement(state, root) : null
  return [
    ...blast,
    ...opened,
    ...escapesOnStun(state, root, newId),
    ...(displacement ? [makeAction('displace', { ...displacement, id: newId(), actorId: root.actorId, spawnedBy: root.id, step: 'react' })] : []),
    ...(root.kind === 'cast' && opensExplosion(state, root) ? [castExplosion(state, root, newId)] : []),
    ...openHookKnockdown(state, root, newId),
    ...openRiposte(state, root, newId),
  ]
}

// The explosion a cast goes off as: to be aimed, a disk; a spray has nothing
// to aim before the reflexes, only a range to show them (combat.tex
// "Sprays"), so it is committed as it opens.
function castExplosion(state: CombatState, root: CastAction, newId: () => string): ExplosionAction {
  const explosion = makeAction('explosion', { id: newId(), actorId: root.actorId, source: 'cast', key: root.key, spawnedBy: root.id })
  return isSpray(getBlastOf(state, explosion)) ? { ...explosion, step: 'react' } : explosion
}

// combat.tex "Hook Attack": the knockdown the hook opens, for the hooker to
// take or skip, unresisted against one running or jumping.
function openHookKnockdown(state: CombatState, root: RootAction, newId: () => string): Action[] {
  const knockdown = root.kind === 'strike' ? getHookKnockdown(state, root) : null
  if (!knockdown || root.kind !== 'strike') return []
  return [makeAction('grapple', { maneuver: 'knockdown', hook: true, unresisted: knockdown.unresisted, id: newId(), actorId: root.actorId, targetId: root.targetId, spawnedBy: root.id })]
}

// combat.tex "Escape": each escape a stun opens, as a maneuver of the held
// one's that nobody may resist, for them to take or skip.
function escapesOnStun(state: CombatState, root: RootAction, newId: () => string): Action[] {
  return getStunEscapes(state, root).map(({ heldId, holderId }) =>
    makeAction('grapple', { maneuver: 'escape', unresisted: true, id: newId(), actorId: heldId, targetId: holderId, spawnedBy: root.id }))
}
