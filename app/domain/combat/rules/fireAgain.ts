import type { CampaignCharacter } from '../../types'
import type { CombatState, Deliveries, FireAgainAction } from '../types'
import { SPELLS, isSpellKey, type SpellKey } from '../../spells'
import { getActiveSpellKeys } from '../../character/rules/effects'
import { getHeldEntry, getHeldSize } from '../../character/rules/concentration'
import { drawCharges, getChargeDraw, hasChargesFor } from '../../character/rules/spells'
import { findReadyItem } from '../../item/rules/containers'
import { canAfford } from '../../character/rules/cost'
import type { ActionCost } from '../../character/rules/actionCosts'
import { getTargetDeliveries, isAreaSpell, isInSpellReach } from './cast'

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

// Why the held spell cannot be fired again now, or null.
export function getFireAgainBar(c: CampaignCharacter, key: SpellKey): string | null {
  const cost = getRepeatCost(key)
  const entry = getHeldEntry(c, key)
  if (!cost || !entry) return 'not held'
  if (!canAfford(c, cost)) return 'cannot pay for it'
  const item = findReadyItem(c, entry.itemId ?? '')?.item
  if (!item || !hasChargesFor(item, SPELLS[key].repeat?.ammo ?? 0, getHeldSize(c, key))) return 'no charges left'
  if (!isAreaSpell(key) && !entry.boundTo) return 'bound to nobody'
  return null
}

// The held spells this character could fire again, each with why not.
export function getFireAgainOptions(c: CampaignCharacter): { key: SpellKey; reason: string | null }[] {
  return getActiveSpellKeys(c).filter((key) => SPELLS[key].repeat !== null).map((key) => ({ key, reason: getFireAgainBar(c, key) }))
}

// spells.tex "Sustained Lightning": "it ends if the target leaves the
// spell's range" — or the caster's sight (the table's ruling), at the range
// it was cast at. The held spells whose arc has broken as the board stands,
// which do not come back.
export function getBrokenArcs(state: CombatState, id: string): SpellKey[] {
  const c = state.characters[id]
  if (!c) return []
  return c.active.flatMap((e) => {
    if (e.kind !== 'spell' || !e.boundTo || !isSpellKey(e.key)) return []
    const held = !!state.characters[e.boundTo] && isInSpellReach(state, id, e.boundTo, e.key, e.extend ?? 0, getHeldSize(c, e.key))
    return held ? [] : [e.key]
  })
}

// What a shot at the bound target delivers. A spray delivers nothing here;
// its explosion lays the ground.
export function getFireAgainFacts(state: CombatState, root: FireAgainAction): Deliveries {
  const caster = state.characters[root.actorId]
  if (!caster || !isSpellKey(root.key) || !root.targetId || !state.characters[root.targetId] || isAreaSpell(root.key)) return {}
  const theirs = getTargetDeliveries(caster, root.key, root.itemId, root.size)
  return theirs.length > 0 ? { [root.targetId]: theirs } : {}
}
