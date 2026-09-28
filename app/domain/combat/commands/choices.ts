import type { Action, Direction, HOPPurchase, Updater } from '../types'
import { canSaveGraze, getGrazeSavedRoll, getImprovementOptions } from '../rules/cast'
import { getHOPOptions } from '../rules/damage'
import { isSpray } from '../rules/explosion'
import type { SpellModification } from '../../tables'
import { applyPhase, getRolledOpen, replaceActions } from './log'

// The choices made once the die is known and before the action lands: what
// a hit's overflow buys, where a spray is pointed, what a
// maneuver's hit is made of. Each edits only the rolled action, except the
// graze a cast buys up, whose price is taken as it is bought.

// combat.tex "Success Overflow": buys one effect out of the hit's HOP. Only
// what the option list offers as open, so the command refuses exactly what
// the button shows as closed.
export function spendHOP(purchase: HOPPurchase): Updater {
  return (state) => {
    const open = getRolledOpen(state, ['strike', 'shoot'])
    if (!open) return state
    if (!getHOPOptions(state, open).find((o) => o.purchase === purchase)?.available) return state
    return replaceActions(state, [{ ...open, spent: addOne(open.spent, purchase) }])
  }
}

// Takes one purchase back. Nothing has landed on the target until the
// action resolves, so the overflow is free to re-spend up to that point.
export function refundHOP(purchase: HOPPurchase): Updater {
  return (state) => {
    const open = getRolledOpen(state, ['strike', 'shoot'])
    if (!open) return state
    const spent = takeOne(open.spent, purchase)
    return spent ? replaceActions(state, [{ ...open, spent }]) : state
  }
}

// A tally of purchases, one more of `key`.
function addOne<K extends string>(tally: Partial<Record<K, number>>, key: K): Partial<Record<K, number>> {
  return { ...tally, [key]: (tally[key] ?? 0) + 1 }
}

// One fewer, the key gone at none; null when there is none to take back.
function takeOne<K extends string>(tally: Partial<Record<K, number>>, key: K): Partial<Record<K, number>> | null {
  const bought = tally[key] ?? 0
  if (bought === 0) return null
  const rest: Partial<Record<K, number>> = { ...tally }
  delete rest[key]
  return bought > 1 ? { ...rest, [key]: bought - 1 } : rest
}

// Points a rolled spray where the attacker chooses, now that the reactions
// have moved (combat.tex "Sprays": "The attacker can choose the exact
// direction of the cone after the movement").
export function aimExplosion(direction: Direction): Updater {
  return (state) => {
    const open = getRolledOpen(state, ['blast'])
    if (!open || !isSpray(open)) return state
    return replaceActions(state, [{ ...open, direction }])
  }
}

// combat.tex "Grapple Maneuvers": what a maneuver's hit is made of, the
// attacker's call once the die is known — committing themselves along
// ("throw oneself along", "stay immobilized yourself") and what a disarm
// goes for. Nothing has landed until the maneuver resolves.
export function chooseManeuver(fields: { along?: boolean; item?: string }): Updater {
  return (state) => {
    const open = getRolledOpen(state, ['grapple'])
    if (!open) return state
    return replaceActions(state, [{ ...open, along: fields.along ?? open.along, item: fields.item ?? open.item }])
  }
}

// spells.tex "Spell Improvements": buys one improvement out of the cast's
// HOPs, only what the option list offers as open.
export function improveSpell(name: SpellModification): Updater {
  return (state) => {
    const open = getRolledOpen(state, ['cast'])
    if (!open) return state
    if (!getImprovementOptions(state, open).find((o) => o.name === name)?.available) return state
    return replaceActions(state, [{ ...open, improved: addOne(open.improved, name) }])
  }
}

// spells.tex "Casting spells": raises the grazed cast to the hit the +3
// makes of it and takes the 2 AP it costs, once. Nothing to take back: the
// price is paid as it is bought.
export function saveGraze(): Updater {
  return (state) => {
    const open = getRolledOpen(state, ['cast'])
    if (!open?.roll || !canSaveGraze(state, open)) return state
    const saved: Action = { ...open, grazeSaved: true, roll: getGrazeSavedRoll(open.roll) }
    return applyPhase(replaceActions(state, [saved]), [saved], 'save')
  }
}

// Takes one improvement back, while nothing has been produced yet.
export function refundImprovement(name: SpellModification): Updater {
  return (state) => {
    const open = getRolledOpen(state, ['cast'])
    if (!open) return state
    const improved = takeOne(open.improved, name)
    return improved ? replaceActions(state, [{ ...open, improved }]) : state
  }
}
