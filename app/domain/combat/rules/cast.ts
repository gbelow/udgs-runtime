import type { CampaignCharacter } from '../../types'
import type { ActionRoll, CastAction, CombatState, Deliveries } from '../types'
import { isCancelled } from './opportunity'
import { getEffectRange, getSelfEffects, getTargetEffects, produceSpellEffect } from '../../character/rules/production'
import { SPELLS, isSpellKey, type SpellKey } from '../../spells'
import { GRAZE_SAVE, SPELL_MODIFICATIONS, type SpellModification } from '../../tables'
import { canCastSpell, getCastingDL, getMissingGear, getSpellSkill } from '../../character/rules/spells'
import { ActionCost } from '../../character/rules/actionCosts'
import { canAfford } from '../../character/rules/cost'
import { Term } from '../../character/rules/terms'
import { getDistanceBetween, hasLineOfSight } from './board'
import { resolveTest } from './test'
import { isAreaEffect } from './explosion'

// spells.tex "Casting spells": what the cast produces, per character — the
// caster's own effects to the caster, the target's to the target, nothing
// from a cast that failed or was cancelled. From here the caster is out of
// it: each delivery is the one who holds it's to roll. A charged spell
// produces nothing now: "activates an object that stays charged", and what
// it does waits in the object until the charge is released.
export function getCastFacts(state: CombatState, root: CastAction): Deliveries {
  const caster = state.characters[root.actorId]
  if (!caster || root.roll?.degree !== 'hit' || !isSpellKey(root.key) || isCancelled(state, root)) return {}
  const spell = SPELLS[root.key]
  if (spell.type === 'charged') return {}
  const facts: Deliveries = {}
  const own = getSelfEffects(spell).filter((e) => e.trigger === 'instant').map((e) => produceSpellEffect(caster, e, root.improved, root.key))
  if (own.length > 0) facts[root.actorId] = own
  if (root.targetId && state.characters[root.targetId]) {
    const theirs = getTargetEffects(spell).map((e) => produceSpellEffect(caster, e, root.improved, root.key))
    if (theirs.length > 0) facts[root.targetId] = [...(facts[root.targetId] ?? []), ...theirs]
  }
  return facts
}

export function getCastTerms(c: CampaignCharacter, action: CastAction): Term[] {
  return isSpellKey(action.key) ? [{ label: SPELLS[action.key].name, value: getSpellSkill(c, action.key) }] : []
}

// spells.tex "Casting spells": "In case of a graze in combat, there is the
// option to increase spell cost by 2 AP to gain +3 once in the test if that
// will turn the graze into a hit." The die stays as thrown; the roll is
// read again with the bonus.
export function getGrazeSavedRoll(roll: ActionRoll): ActionRoll {
  return resolveTest({ skill: roll.score - roll.die + GRAZE_SAVE.bonus, DL: roll.DL, explodes: false, scale: 'overflow', grazes: true }, () => roll.die)
}

// spells.tex "Casting spells": the price of buying a graze up to a hit.
export const GRAZE_SAVE_COST: ActionCost = { AP: GRAZE_SAVE.AP, STA: 0 }

export function canSaveGraze(state: CombatState, root: CastAction): boolean {
  const caster = state.characters[root.actorId]
  if (!caster || root.status !== 'rolled' || root.grazeSaved || !root.roll || root.roll.degree !== 'graze') return false
  if (isCancelled(state, root) || !canAfford(caster, GRAZE_SAVE_COST)) return false
  return getGrazeSavedRoll(root.roll).degree === 'hit'
}

// The spells the character could declare a cast of: each learned spell,
// with whether it can be cast on the focus surge or quickened without it
// (spells.tex "Quicken Spell").
export type SpellOption = {
  key: SpellKey
  name: string
  DL: number | null
  quickenedDL: number | null
  cost: ActionCost
  castable: boolean
  quickenable: boolean
  // why it cannot be cast, when it cannot
  reason: string | null
  // whether it aims at someone
  targeted: boolean
}

// spells.tex "Requirements", "Casting spells": what stands between the
// caster and the spell, the missing gear first — it is the one the caster
// can do something about from here.
function reasonAgainst(c: CampaignCharacter, key: SpellKey): string | null {
  const spell = SPELLS[key]
  const missing = getMissingGear(c, key)
  if (missing) return `needs ${missing}`
  if (!canAfford(c, spell.cost)) return 'cannot pay for it'
  if (spell.DL === null) return 'no casting DL'
  return canCastSpell(c, key, false) ? null : 'needs a focus surge'
}

export function getSpellOptions(c: CampaignCharacter): SpellOption[] {
  return (Object.keys(c.spells) as SpellKey[]).filter(isSpellKey).map((key) => {
    const spell = SPELLS[key]
    return {
      key,
      name: spell.name,
      DL: spell.DL,
      quickenedDL: getCastingDL(spell, true),
      cost: { AP: spell.cost.AP, STA: spell.cost.STA },
      castable: canCastSpell(c, key, false),
      quickenable: canCastSpell(c, key, true),
      reason: reasonAgainst(c, key),
      targeted: isTargetedSpell(key),
    }
  })
}

// spells.tex "Spell Improvements": what the cast's overflow can still buy,
// each priced in HOP.
export type ImprovementOption = {
  name: SpellModification
  HOP: number
  text: string
  times: number
  available: boolean
}

export function getCastHOPRemaining(root: CastAction): number {
  return (root.roll?.HOP ?? 0) - (Object.keys(SPELL_MODIFICATIONS) as SpellModification[]).reduce((sum, m) => sum + (root.improved[m] ?? 0) * SPELL_MODIFICATIONS[m].HOP, 0)
}

// spells.tex "Concentration": nothing left to spend overflow on once the
// cast is cancelled — it produces nothing regardless of what is bought.
export function getImprovementOptions(state: CombatState, root: CastAction): ImprovementOption[] {
  if (!root.roll || root.roll.degree !== 'hit' || isCancelled(state, root)) return []
  const remaining = getCastHOPRemaining(root)
  return (Object.keys(SPELL_MODIFICATIONS) as SpellModification[]).map((name) => ({
    name,
    HOP: SPELL_MODIFICATIONS[name].HOP,
    text: SPELL_MODIFICATIONS[name].text,
    times: root.improved[name] ?? 0,
    available: SPELL_MODIFICATIONS[name].HOP <= remaining,
  }))
}

// Whether the spell as declared aims at someone: it has an effect for one
// target, and is not cast on an object (spells.tex "Charged": what it does
// waits in the object, and is aimed when the charge is released).
export function isTargeted(root: CastAction): boolean {
  return isSpellKey(root.key) && isTargetedSpell(root.key)
}

function isTargetedSpell(key: SpellKey): boolean {
  return SPELLS[key].type !== 'charged' && getTargetEffects(SPELLS[key]).length > 0
}

// combat.tex "Explosions": a cast that hit with an area to it opens that area
// as an explosion of the caster's, aimed and played out on its own; a charged
// spell's area waits in its object.
export function opensExplosion(state: CombatState, root: CastAction): boolean {
  if (root.roll?.degree !== 'hit' || !isSpellKey(root.key) || isCancelled(state, root)) return false
  const spell = SPELLS[root.key]
  return spell.type !== 'charged' && spell.effects.some(isAreaEffect)
}

// Whether every targeted effect of the spell reaches the target from where
// the caster stands, at the range bought (spells.tex "Extend Spell"), in
// sight; touch reaches an adjacent target. True on a fight without a board.
export function isInCastRange(state: CombatState, root: CastAction, targetId: string): boolean {
  const distance = getDistanceBetween(state, root.actorId, targetId)
  if (distance === null || !isSpellKey(root.key)) return true
  return getTargetEffects(SPELLS[root.key]).every((e) => distance <= (getEffectRange(e, root.improved) ?? 1)) && hasLineOfSight(state, root.actorId, targetId)
}
