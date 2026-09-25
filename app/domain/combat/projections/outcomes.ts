import type { Action, ActionRoll, CombatState, Deliveries, DragFacts } from '../types'
import type { Delivery } from '../../types'
import type { Outcome } from '../../character/rules/damage'
import { ACTIONS } from '../rules/actionCatalog'
import { SPELLS, isSpellKey } from '../../spells'
import { getAttackFacts, outcomeOf } from '../rules/damage'
import { isAttackAction } from '../rules/attack'
import { getExplosionFacts } from '../rules/explosion'
import { getGrappleFacts, getManeuverFacts } from '../rules/grapple'
import { isCancelled, isTriggeringAction } from '../rules/opportunity'
import { getFightName } from '../rules/activeCharacter'

// The outcome of the open action on everyone it lands on, as it would land
// now: the same function the resolution applies, so the preview and the
// result cannot differ. One entry for the target of a strike or a shot; one
// per character in an explosion's area. Nothing, from an action an
// opportunity attack cancelled.
export function getOutcomePreviews(state: CombatState, root: Action): { id: string; outcome: Outcome }[] {
  if (isTriggeringAction(root) && isCancelled(state, root)) return []
  if (root.kind === 'explosion') return deliveryOutcomes(state, root.facts ?? getExplosionFacts(state, root))
  if (root.kind === 'grapple') return deliveryOutcomes(state, (root.facts ?? getManeuverFacts(state, root))?.deliveries ?? {})
  if (!isAttackAction(root) || !root.targetId) return []
  const target = state.characters[root.targetId]
  const facts = root.facts ?? getAttackFacts(state, root)
  const outcome = target && facts ? outcomeOf(facts, target) : null
  return outcome ? [{ id: root.targetId, outcome }] : []
}

function deliveryOutcomes(state: CombatState, deliveries: Deliveries): { id: string; outcome: Outcome }[] {
  return flatten(deliveries).flatMap(({ id, delivery }) => {
    const target = state.characters[id]
    const outcome = target ? outcomeOf(delivery, target) : null
    return outcome ? [{ id, outcome }] : []
  })
}

function flatten(deliveries: Deliveries): { id: string; delivery: Delivery }[] {
  return Object.entries(deliveries).flatMap(([id, ds]) => ds.map((delivery) => ({ id, delivery })))
}

// What an action did to a grapple, a line per character it changed:
// grabbed, let go, knocked down, stood up, disarmed, pushed; or that the
// action was cancelled before it could do any of it.
export function getGrappleNotes(state: CombatState, root: Action): { target: string; text: string }[] {
  const named = (id: string) => getFightName(state, id)
  if (isTriggeringAction(root) && isCancelled(state, root)) return [{ target: named(root.actorId), text: `${ACTIONS[root.kind].label} cancelled` }]
  if (root.kind === 'drag') return root.facts ? dragNotes(root.facts, named) : []
  if (root.kind === 'pickUp') return root.picked ? [{ target: named(root.actorId), text: `picked up ${root.picked.name}` }] : []
  const facts = getGrappleFacts(root)
  if (!facts) return []
  const itemName = (ownerId: string, itemId: string) => state.characters[ownerId]?.held.find((i) => i.id === itemId)?.name
    ?? state.floor.find((f) => f.item.id === itemId)?.item.name ?? 'an item'
  const lines = facts.pair.flatMap((id) => [
    ...((facts.on[id] ?? []).length > 0 ? [{ target: named(id), text: (facts.on[id] ?? []).join(', ') }] : []),
    ...((facts.off[id] ?? []).length > 0 ? [{ target: named(id), text: `no longer ${(facts.off[id] ?? []).join(', ')}` }] : []),
    ...(facts.prone.includes(id) ? [{ target: named(id), text: 'knocked down' }] : []),
    ...(facts.stand.includes(id) ? [{ target: named(id), text: 'stands up' }] : []),
    ...(facts.dropped?.ownerId === id ? [{ target: named(id), text: `drops ${itemName(id, facts.dropped.itemId)}` }] : []),
  ])
  const taken = [
    ...(facts.seized ? [{ target: named(facts.pair[1]), text: `${itemName(facts.pair[1], facts.seized)} seized` }] : []),
    ...facts.freed.map((itemId) => ({ target: named(facts.pair[0]), text: `frees ${itemName(facts.pair[0], itemId)}` })),
  ]
  if (facts.grapple === null) return [...lines, { target: facts.pair.map(named).join(' and '), text: 'apart' }]
  if (root.kind === 'strike') return [{ target: named(facts.pair[1]), text: 'grabbed' }, ...lines]
  const all = [...lines, ...taken]
  return all.length > 0 ? all : [{ target: facts.pair.map(named).join(' and '), text: 'no effect' }]
}

function dragNotes(facts: DragFacts, named: (id: string) => string): { target: string; text: string }[] {
  const moved = Object.keys(facts.to)
  return [
    moved.length > 0 ? { target: moved.map(named).join(', '), text: `moved ${facts.steps}m` } : { target: '', text: 'nobody moves' },
    ...(facts.interrupted.length > 0 ? [{ target: facts.interrupted.map(named).join(', '), text: 'interrupted' }] : []),
    ...(facts.released.length > 0 ? [{ target: facts.released.map(named).join(', '), text: 'let go' }] : []),
  ]
}

// What an action delivered, per character: a strike's single effect to its
// target, everything an explosion or a cast produced to whoever it was
// produced for. Empty before the action has anything to say.
function getDeliveries(root: Action): { id: string; delivery: Delivery }[] {
  if (root.kind === 'explosion' || root.kind === 'cast') return flatten(root.facts ?? {})
  if (root.kind === 'grapple') return flatten(root.facts?.deliveries ?? {})
  if (!isAttackAction(root) || !root.targetId || !root.facts) return []
  return [{ id: root.targetId, delivery: root.facts }]
}

// What the last action to be played out did, for the table to read once the
// panel has moved on: what it was, what it rolled, and what it landed on
// whom — the injuries it caused, and a line for everything else it
// delivered, including what is still waiting on the target's own die
// (spells.tex "Casting spells": the caster's part ends at the production).
export type ActionReport = {
  label: string
  actor: string
  roll: ActionRoll | null
  outcomes: { target: string; outcome: Outcome }[]
  notes: { target: string; text: string }[]
}

export function getLastReport(state: CombatState): ActionReport | null {
  const root = [...state.actions].reverse().find((a) => a.status === 'resolved' && a.reactionTo === null)
  if (!root) return null
  const named = (id: string) => getFightName(state, id)
  const delivered = getDeliveries(root)
  return {
    label: getActionLabel(root, delivered[0]?.delivery.effect.name),
    actor: named(root.actorId),
    roll: root.roll,
    outcomes: delivered.flatMap(({ id, delivery }) => {
      const target = state.characters[id]
      const outcome = target ? outcomeOf(delivery, target) : null
      return outcome ? [{ target: named(id), outcome }] : []
    }),
    notes: delivered.flatMap(({ id, delivery }) => {
      if (delivery.effect.type === 'damage' && delivery.degree !== null) return []
      const waiting = delivery.test ? ` · ${delivery.test.roll} vs ${delivery.test.DL}` : ''
      return [{ target: named(id), text: `${delivery.effect.name}${waiting}` }]
    }).concat(getChargeNote(state, root), getGrappleNotes(state, root)),
  }
}

// spells.tex "Charged": a charged spell lands on an object rather than on
// anyone, so what it did is which object now carries it.
function getChargeNote(state: CombatState, root: Action): { target: string; text: string }[] {
  if (root.kind !== 'cast' || root.roll?.degree !== 'hit' || !isSpellKey(root.key) || SPELLS[root.key].type !== 'charged') return []
  const caster = state.characters[root.actorId]
  const item = caster?.held.find((i) => i.charge?.key === root.key)
  return item ? [{ target: caster.fightName ?? '', text: `charged into ${item.name}` }] : []
}

// What the action was, in the words whatever it delivered gave itself — the
// weapon row, the spell effect — since the row it was made with may be gone
// by the time it is read (a thrown weapon, an object a charge destroyed).
// The spell names a cast that delivered nothing, and the kind names the
// rest.
function getActionLabel(root: Action, delivered: string | undefined): string {
  if (root.kind === 'grapple') return root.maneuver
  if (delivered) return delivered
  if ((root.kind === 'cast' || root.kind === 'explosion') && isSpellKey(root.key)) return SPELLS[root.key].name
  return ACTIONS[root.kind].label
}
