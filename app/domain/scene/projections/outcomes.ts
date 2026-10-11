import type { Action, ActionRoll, SceneState, DragFacts, MoraleSpellOutcome } from '../types'
import type { Degree, Effect, Item } from '../../types'
import type { Outcome, OutcomeStep } from '../../character/rules/damage'
import { getBrokenItems } from '../rules/breakage'
import { getActionName } from './labels'
import { getCarriedItems } from '../../item/rules/items'
import { findFloorItem } from '../rules/floor'
import { SPELLS, isSpellKey } from '../../spells'
import { outcomeOf } from '../rules/damage'
import { getGrappleFacts } from '../rules/grapple'
import { isVoided } from '../rules/opportunity'
import { getFightName } from '../rules/fighters'
import { getAction, getHistory } from '../rules/log'
import { getDeliveries } from '../rules/deliveries'
import { isSpellTestBeaten } from '../rules/cast'
import { getLinkSpell } from '../../character/rules/concentration'
import { getReadyItems } from '../../item/rules/containers'
import { getSpiritBlow } from '../../character/rules/spirit'
import { resisted } from '../rules/test'

// What the settled or resolved action's damage does to each character it
// was delivered to, as they stand.
export function getOutcomes(state: SceneState, settled: Action): { id: string; outcome: Outcome }[] {
  return getDeliveries(settled).flatMap(({ id, delivery }) => {
    const target = state.characters[id]
    const outcome = target ? outcomeOf(delivery, target) : null
    return outcome ? [{ id, outcome }] : []
  })
}

// What an action did to a grapple, a line per character it changed:
// grabbed, let go, knocked down, stood up, disarmed, pushed; or that the
// action was cancelled before it could do any of it.
export function getActionNotes(state: SceneState, root: Action): { target: string; text: string }[] {
  const named = (id: string) => getFightName(state, id)
  const broke = getBrokenItems(root).map(({ ownerId, itemId, name }) => ({ target: state.characters[ownerId] ? named(ownerId) : 'floor', text: breakNote(state.characters[ownerId]?.worn?.id === itemId, name) }))
  return [...getRootNotes(state, root, named), ...broke]
}

// gear.tex "Weapon Breakage", "Armor Breakage": a weapon breaks, armor is
// pitted.
function breakNote(isArmor: boolean, name: string): string {
  return `${name || 'an item'} ${isArmor ? 'pitted' : 'broke'}`
}

function findItem(state: SceneState, ownerId: string, itemId: string): Item | undefined {
  const owner = state.characters[ownerId]
  const carried = owner ? [...getCarriedItems(owner), ...(owner.onBack ? [owner.onBack] : [])] : []
  return carried.find((i) => i.id === itemId) ?? findFloorItem(state, itemId)?.item
}

function getRootNotes(state: SceneState, root: Action, named: (id: string) => string): { target: string; text: string }[] {
  if (isVoided(state, root)) return [{ target: named(root.actorId), text: `${getActionName(root)} cancelled` }]
  if (root.kind === 'drag') return root.facts ? dragNotes(root.facts, named) : []
  if (root.kind === 'pickUp') return root.picked ? [{ target: named(root.actorId), text: `picked up ${root.picked.name}` }] : []
  if (root.kind === 'throw') return root.thrown ? [{ target: named(root.actorId), text: `threw ${root.thrown.name}` }] : []
  if (root.kind === 'drink') return root.drunk ? [{ target: named(root.actorId), text: `drank ${root.drunk.name}` }] : []
  if (root.kind === 'reload') return root.loaded ? [{ target: named(root.actorId), text: `loaded ${root.loaded.name}` }] : []
  if (root.kind === 'spellTest') return spellTestNotes(root, named)
  if (root.kind === 'fall') return [{ target: named(root.actorId), text: `fell ${root.height}m` }]
  const facts = getGrappleFacts(root)
  if (!facts) return []
  const itemName = (ownerId: string, itemId: string) => findItem(state, ownerId, itemId)?.name ?? 'an item'
  const lines = facts.pair.flatMap((id) => [
    ...((facts.on[id] ?? []).length > 0 ? [{ target: named(id), text: (facts.on[id] ?? []).join(', ') }] : []),
    ...((facts.off[id] ?? []).length > 0 ? [{ target: named(id), text: `no longer ${(facts.off[id] ?? []).join(', ')}` }] : []),
    ...(facts.prone.includes(id) ? [{ target: named(id), text: 'knocked down' }] : []),
    ...(facts.dropped?.ownerId === id ? [{ target: named(id), text: `drops ${facts.dropped.name || itemName(id, facts.dropped.itemId)}` }] : []),
  ])
  if (facts.grapple === null) return [...lines, { target: facts.pair.map(named).join(' and '), text: 'apart' }]
  if (root.kind === 'strike') return [{ target: named(facts.pair[1]), text: 'grabbed' }, ...lines]
  return lines.length > 0 ? lines : [{ target: facts.pair.map(named).join(' and '), text: 'no effect' }]
}

// spells.tex "Telepathic Link": whether the test left the target linked to
// the caster, or broke the link; combat.tex "Morale": what a morale spell's
// test left the target, and the limit stress action it compels.
function spellTestNotes(root: Extract<Action, { kind: 'spellTest' }>, named: (id: string) => string): { target: string; text: string }[] {
  const morale = root.morale && root.targetId ? [{ target: named(root.targetId), text: getMoraleNote(root.morale, named(root.actorId)) }] : []
  const link = isSpellKey(root.key) ? getLinkSpell(root.key) : null
  if (!root.targetId || (!root.roll && !root.accepted) || link === null) return morale
  if (isSpellTestBeaten(root)) return [...morale, { target: named(root.targetId), text: link === root.key ? 'resists the link' : 'breaks the link' }]
  return link === root.key ? [{ target: named(root.targetId), text: `linked to ${named(root.actorId)}` }] : morale
}

function getMoraleNote(outcome: MoraleSpellOutcome, caster: string): string {
  const bond = outcome.constraint === 'attack' ? `, attacking only ${caster}` : outcome.constraint === 'flee' ? `, running from ${caster}` : ''
  const parts = [
    ...(outcome.inflict.length > 0 ? [outcome.inflict.join(', ')] : []),
    ...(outcome.compel ? [`compelled: ${outcome.compel}${bond}`] : []),
    ...(outcome.pacified ? ['owes no limit stress action'] : []),
    ...(outcome.inflict.length === 0 && outcome.cure.length > 0 ? [`no longer ${outcome.cure.join(' or ')}`] : []),
  ]
  return parts.length > 0 ? parts.join('; ') : 'no effect'
}

function dragNotes(facts: DragFacts, named: (id: string) => string): { target: string; text: string }[] {
  const moved = Object.keys(facts.to)
  return [
    ...(facts.released.length > 0 ? [{ target: facts.released.map(named).join(', '), text: 'let go' }] : []),
    moved.length > 0 && facts.steps > 0 ? { target: moved.map(named).join(', '), text: `moved ${facts.steps}m` } : { target: '', text: 'nobody moves' },
  ]
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
  outcomes: { target: string; outcome: Outcome; steps: OutcomeStep[] }[]
  notes: { target: string; text: string }[]
}

export function getLastReport(state: SceneState): ActionReport | null {
  const id = getHistory(state).at(-1)
  return id ? getActionReport(state, id) : null
}

export function getActionReport(state: SceneState, id: string): ActionReport | null {
  const root = getAction(state, id)
  if (!root) return null
  const named = (id: string) => getFightName(state, id)
  const delivered = getDeliveries(root)
  return {
    label: getActionLabel(root, delivered[0]?.delivery.effect.name),
    actor: named(root.kind === 'spellTest' && root.targetId ? root.targetId : root.actorId),
    roll: root.roll,
    outcomes: root.results.length > 0
      ? root.results.map(({ targetId, outcome, steps }) => ({ target: named(targetId), outcome, steps }))
      : getOutcomes(state, root).map(({ id, outcome }) => ({ target: named(id), outcome, steps: [] })),
    notes: delivered.flatMap(({ id, delivery }) => {
      if (delivery.effect.type === 'damage' && delivery.degree !== null) return []
      const waiting = delivery.test && delivery.degree === null ? ` · ${delivery.test.roll} vs ${delivery.test.DL}` : ''
      return [{ target: named(id), text: `${delivery.effect.name}${lossLabel(delivery.effect, delivery.degree)}${waiting}` }]
    }).concat(getTestedNotes(root, named), getChargeNote(state, root), getActionNotes(state, root)),
  }
}

// The test each target made against what the action delivered them, as it
// landed (rules/tested.ts), and whether they beat it.
function getTestedNotes(root: Action, named: (id: string) => string): { target: string; text: string }[] {
  return root.tested.map(({ targetId, name, roll }) => ({
    target: named(targetId),
    text: `${name} test: ${roll.score} vs ${roll.DL}, ${roll.degree}${resisted(roll.degree) === 'miss' ? ', resisted' : ''}`,
  }))
}

// What a cost or a spiritual blow takes from whoever it lands on.
function lossLabel(effect: Effect, degree: Degree | null): string {
  if (effect.type === 'spirit') {
    const blow = getSpiritBlow(effect.effect, degree)
    return blow ? ` -${blow.STA} STA, ${blow.interruption}` : ''
  }
  if (effect.type !== 'cost') return ''
  const lost = (['AP', 'STA'] as const).filter((k) => effect.effect[k] > 0).map((k) => `-${effect.effect[k]} ${k}`)
  return lost.length > 0 ? ` ${lost.join(' ')}` : ''
}

// spells.tex "Charged": a charged spell lands on an object rather than on
// anyone, so what it did is which object now carries it.
function getChargeNote(state: SceneState, root: Action): { target: string; text: string }[] {
  if (root.kind !== 'cast' || root.roll?.degree !== 'hit' || !isSpellKey(root.key) || SPELLS[root.key].type !== 'charged') return []
  const caster = state.characters[root.actorId]
  const item = caster ? getReadyItems(caster).find((i) => i.charge?.key === root.key) : undefined
  return item ? [{ target: getFightName(state, caster.id), text: `charged into ${item.name}` }] : []
}

// What the action was, in the words whatever it delivered gave itself — the
// weapon row, the spell effect — since the row it was made with may be gone
// by the time it is read (a thrown weapon, an object a charge destroyed).
// A maneuver goes by its own name whatever its holds dealt, the spell names
// a cast that delivered nothing, and the action's name the rest.
function getActionLabel(root: Action, delivered: string | undefined): string {
  if (root.kind !== 'grapple' && delivered) return delivered
  if ((root.kind === 'cast' || root.kind === 'explosion' || root.kind === 'blast') && isSpellKey(root.key)) return SPELLS[root.key].name
  if (root.kind === 'spellTest' && isSpellKey(root.key)) return `${SPELLS[root.key].name} test`
  return getActionName(root)
}
