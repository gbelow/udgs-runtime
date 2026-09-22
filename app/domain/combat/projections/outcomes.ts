import type { Action, ActionRoll, CombatState } from '../types'
import type { Delivery } from '../../types'
import type { Outcome } from '../../character/rules/damage'
import { ACTIONS } from '../actionCatalog'
import { SPELLS, isSpellKey } from '../../spells'
import { getAttackFacts, outcomeOf } from '../rules/damage'
import { getExplosionFacts } from '../rules/explosion'

// The outcome of the open action on everyone it lands on, as it would land
// now: the same function the resolution applies, so the preview and the
// result cannot differ. One entry for the target of a strike or a shot; one
// per character in an explosion's area.
export function getOutcomePreviews(state: CombatState, root: Action): { id: string; outcome: Outcome }[] {
  if (root.kind === 'explosion') {
    const facts = root.facts ?? getExplosionFacts(state, root)
    return Object.entries(facts).flatMap(([id, deliveries]) => {
      const target = state.characters[id]
      return deliveries.flatMap((d) => {
        const outcome = target ? outcomeOf(d, target) : null
        return outcome ? [{ id, outcome }] : []
      })
    })
  }
  if ((root.kind !== 'strike' && root.kind !== 'shoot') || !root.targetId) return []
  const target = state.characters[root.targetId]
  const facts = root.facts ?? getAttackFacts(state, root)
  const outcome = target && facts ? outcomeOf(facts, target) : null
  return outcome ? [{ id: root.targetId, outcome }] : []
}

// What an action delivered, per character: a strike's single effect to its
// target, everything an explosion or a cast produced to whoever it was
// produced for. Empty before the action has anything to say.
function getDeliveries(root: Action): { id: string; delivery: Delivery }[] {
  if (root.kind === 'explosion' || root.kind === 'cast') {
    return Object.entries(root.facts ?? {}).flatMap(([id, deliveries]) => deliveries.map((delivery) => ({ id, delivery })))
  }
  if ((root.kind !== 'strike' && root.kind !== 'shoot') || !root.targetId || !root.facts) return []
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
  const named = (id: string) => state.characters[id]?.fightName ?? ''
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
    }).concat(getChargeNote(state, root)),
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
  if (delivered) return delivered
  if ((root.kind === 'cast' || root.kind === 'explosion') && isSpellKey(root.key)) return SPELLS[root.key].name
  return ACTIONS[root.kind].label
}
