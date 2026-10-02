import type { CampaignCharacter, Delivery } from '../../types'
import type { Arc, CastAction, CombatState, Deliveries, FireAgainAction } from '../types'
import { SPELLS, isSpellKey, type SpellKey } from '../../spells'
import { getActiveSpellKeys } from '../../character/rules/effects'
import { getHeldEntry, getHeldSize } from '../../character/rules/concentration'
import { drawCharges, getChargeDraw, hasChargesFor } from '../../character/rules/spells'
import { findReadyItem } from '../../item/rules/containers'
import { canAfford } from '../../character/rules/cost'
import { isDead } from '../../character/rules/afflictions'
import type { ActionCost } from '../../character/rules/actionCosts'
import { getSpellEffects, produceEffects } from '../../character/rules/production'
import { getTargetDeliveries, isAreaSpell, isInSpellReach } from './cast'
import { isAreaEffect } from './explosion'
import { getDistanceBetween } from './board'
import { getArc, getPartner } from './partners'

// A held spell fired again without the casting test (the table's ruling):
// a spray aimed anew from where its holder stands, which lays its ground
// and harms nobody; a shot at the one target its arc is bound to.

export function getRepeatCost(key: SpellKey): ActionCost | null {
  const repeat = SPELLS[key].repeat
  return repeat ? { AP: repeat.AP, STA: 0 } : null
}

// The charges firing it again draws, at the size it was cast at; a
// fraction of one by the percentile die thrown for it.
export function getRepeatDraw(c: CampaignCharacter, key: SpellKey): number {
  return getChargeDraw(SPELLS[key].repeat?.ammo ?? 0, getHeldSize(c, key))
}

export function getFireAgainCharges(root: FireAgainAction): number {
  return isSpellKey(root.key) ? drawCharges(SPELLS[root.key].repeat?.ammo ?? 0, root.size, root.chargeRoll) : 0
}

// What a held spell fired again is fired with: the item and size it is held
// at, and the target its arc is bound to.
export function getHold(state: CombatState, c: CampaignCharacter, key: SpellKey): { itemId: string; size: number; targetId: string | null } {
  return { itemId: getHeldEntry(c, key)?.itemId ?? '', size: getHeldSize(c, key), targetId: getArcTarget(state, c.id, key) }
}

// The metres a held spray reaches from its holder, at the size it was cast
// at; 0 for a spell that is not one.
function getSprayReach(c: CampaignCharacter, key: SpellKey): number {
  const itemId = getHeldEntry(c, key)?.itemId ?? ''
  return Math.max(0, ...produceEffects(c, getSpellEffects(c, key, itemId), getHeldSize(c, key)).filter(isAreaEffect).flatMap((e) => (e.area?.shape === 'spray' ? [e.area.length] : [])))
}

// The held sprays this character could aim anew in answer to a trigger,
// each with how far it reaches.
export function getRetargetOptions(c: CampaignCharacter): { key: SpellKey; reach: number }[] {
  return getActiveSpellKeys(c)
    .filter((key) => SPELLS[key].repeat !== null && isAreaSpell(key))
    .map((key) => ({ key, reach: getSprayReach(c, key) }))
    .filter(({ reach }) => reach > 0)
}

// The held sprays whose holders pay their upkeep at the round change, each
// owed a free aim (the table's ruling); the dead hold nothing.
export function getUpkeepAims(state: CombatState): { actorId: string; key: SpellKey }[] {
  return Object.values(state.characters).flatMap((c) => (isDead(c) ? [] : getRetargetOptions(c).map(({ key }) => ({ actorId: c.id, key }))))
}

// Why the held spell cannot be fired again now, or null.
export function getFireAgainBar(state: CombatState, c: CampaignCharacter, key: SpellKey): string | null {
  const cost = getRepeatCost(key)
  const entry = getHeldEntry(c, key)
  if (!cost || !entry) return 'not held'
  if (!canAfford(c, cost)) return 'cannot pay for it'
  const item = findReadyItem(c, entry.itemId ?? '')?.item
  if (!item || !hasChargesFor(item, SPELLS[key].repeat?.ammo ?? 0, getHeldSize(c, key))) return 'no charges left'
  if (!isAreaSpell(key) && getArcTarget(state, c.id, key) === null) return 'bound to nobody'
  return null
}

// The held spells this character could fire again, each with why not.
export function getFireAgainOptions(state: CombatState, c: CampaignCharacter): { key: SpellKey; reason: string | null }[] {
  return getActiveSpellKeys(c).filter((key) => SPELLS[key].repeat !== null).map((key) => ({ key, reason: getFireAgainBar(state, c, key) }))
}

// Whether casting the spell leaves its caster holding an arc to the target:
// a sustained spell aimed at one, fired again at it.
function bindsArc(key: SpellKey): boolean {
  return SPELLS[key].type === 'sustained' && SPELLS[key].repeat !== null && !isAreaSpell(key)
}

// spells.tex "Sustained": a cast that hit and did not fail, of a spell its
// caster is not already holding, takes hold of its arc to the target.
export function getArcMade(state: CombatState, root: CastAction): Arc | null {
  const caster = state.characters[root.actorId]
  if (!caster || !isSpellKey(root.key) || !bindsArc(root.key) || !root.targetId || root.roll?.degree !== 'hit' || root.failed || getHeldEntry(caster, root.key)) return null
  return { kind: 'arc', members: [root.actorId, root.targetId], holders: [root.actorId], anchors: {}, key: root.key }
}

// The arc a caster holds to someone: the one target of a held spell that
// makes one (spells.tex "Sustained Lightning").
export function getArcTarget(state: CombatState, casterId: string, key: SpellKey): string | null {
  const arc = getArc(state, casterId, key)
  return arc ? getPartner(arc, casterId) : null
}

// spells.tex "Sustained Lightning": "it ends if the target leaves the
// spell's range" — or the caster's sight (the table's ruling), at the range
// it was cast at — "or touches the caster, in which case the arc
// short-circuits, causing damage to both". The held spells whose arc has
// broken as the board stands, which do not come back, and what the
// short-circuit of a touch deals each end.
type BrokenArc = { casterId: string; targetId: string | null; key: SpellKey; shock: Delivery[] }

export function getBrokenArcs(state: CombatState): BrokenArc[] {
  return Object.values(state.characters).flatMap((c) => c.active.flatMap((e): BrokenArc[] => {
    if (e.kind !== 'spell' || !isSpellKey(e.key) || !bindsArc(e.key)) return []
    const targetId = getArcTarget(state, c.id, e.key)
    const size = getHeldSize(c, e.key)
    const touched = targetId !== null && (getDistanceBetween(state, c.id, targetId) ?? Infinity) <= 1
    if (targetId && !touched && isInSpellReach(state, c.id, targetId, e.key, e.extend ?? 0, size)) return []
    return [{ casterId: c.id, targetId, key: e.key, shock: touched ? getTargetDeliveries(c, e.key, e.itemId ?? '', size).map((d) => ({ ...d, degree: 'hit' as const, test: null })) : [] }]
  }))
}

// What a shot at the bound target delivers. A spray delivers nothing here;
// its explosion lays the ground.
export function getFireAgainFacts(state: CombatState, root: FireAgainAction): Deliveries {
  const caster = state.characters[root.actorId]
  if (!caster || !isSpellKey(root.key) || !root.targetId || !state.characters[root.targetId] || isAreaSpell(root.key)) return {}
  const theirs = getTargetDeliveries(caster, root.key, root.itemId, root.size)
  return theirs.length > 0 ? { [root.targetId]: theirs } : {}
}
