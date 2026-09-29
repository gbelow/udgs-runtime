import type { CampaignCharacter, Skills } from '../../types'
import type { ActionRoll, CastAction, CombatState, Deliveries, SpellTestAction } from '../types'
import { isCancelled } from './opportunity'
import { getEffectRange, getSelfEffects, getTargetEffects, produceSpellEffect } from '../../character/rules/production'
import { SPELLS, isSpellKey, type SpellKey } from '../../spells'
import { GRAZE_SAVE, SPELL_MODIFICATIONS, type SpellModification } from '../../tables'
import { canCastSpell, getCastingDL, getMissingGear, getSpellSkill, resolveDL } from '../../character/rules/spells'
import { getLinkSpell, getLinkedTargets, getSustainingRequirements, holdsSustaining, mayCastWhileConcentrating } from '../../character/rules/concentration'
import { skillTermGetters } from '../../character/rules/skills'
import { ActionCost } from '../../character/rules/actionCosts'
import { canAfford } from '../../character/rules/cost'
import { Term } from '../../character/rules/terms'
import { getDistanceBetween, hasLineOfSight } from './board'
import { resolveTest, resisted } from './test'
import { isAreaEffect } from './explosion'

// spells.tex "Casting spells": what the cast produces, per character — the
// caster's own effects to the caster, the target's to the target, nothing
// from a cast that failed or was cancelled. From here the caster is out of
// it: each delivery is the one who holds it's to roll. A charged spell
// produces nothing now: "activates an object that stays charged", and what
// it does waits in the object until the charge is released. One worked
// through a link reaches its targets through the tests it opens
// (sequence.ts `openSpellTests`), not here.
export function getCastFacts(state: CombatState, root: CastAction): Deliveries {
  const caster = state.characters[root.actorId]
  if (!caster || root.roll?.degree !== 'hit' || !isSpellKey(root.key) || isCancelled(state, root)) return {}
  const spell = SPELLS[root.key]
  if (spell.type === 'charged') return {}
  const facts: Deliveries = {}
  const own = getSelfEffects(spell).filter((e) => e.trigger === 'instant').map((e) => produceSpellEffect(caster, e, root.improved, root.key))
  if (own.length > 0) facts[root.actorId] = own
  if (root.targetId && state.characters[root.targetId] && getLinkSpell(root.key) === null) {
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
  if (!caster || root.step !== 'post' || root.grazeSaved || !root.roll || root.roll.degree !== 'graze') return false
  if (isCancelled(state, root) || !canAfford(caster, GRAZE_SAVE_COST)) return false
  return getGrazeSavedRoll(root.roll).degree === 'hit'
}

// The spells the character could declare a cast of: each learned spell,
// with whether it can be cast on the focus surge or quickened without it
// (spells.tex "Quicken Spell").
export type SpellOption = {
  key: SpellKey
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
  if (!holdsSustaining(c, key)) return `needs ${getSustainingRequirements(key).map((held) => SPELLS[held].name).join(' or ')} held`
  if (!mayCastWhileConcentrating(c, key)) return 'concentrating'
  return canCastSpell(c, key, false) ? null : 'needs a focus surge'
}

export function getSpellOptions(c: CampaignCharacter): SpellOption[] {
  return (Object.keys(c.spells) as SpellKey[]).filter(isSpellKey).map((key) => {
    const spell = SPELLS[key]
    return {
      key,
      DL: getCastingDL(c, spell, false),
      quickenedDL: getCastingDL(c, spell, true),
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

// A linking spell aims at the one it links; a spell cast through a link
// aims at everyone linked, picked by nobody.
function isTargetedSpell(key: SpellKey): boolean {
  const link = getLinkSpell(key)
  if (link !== null) return link === key
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

// spells.tex "Telepathic Link": who the cast of a spell worked through a
// link puts to the test — the one a linking spell aims at, or everyone the
// link it is cast through holds ("These spells are made against all
// targets affected by link simultaneously"). None for a cast that did not
// hit, was cancelled, or has no test for its targets to make.
export function getSpellTestTargets(state: CombatState, root: CastAction): string[] {
  const caster = state.characters[root.actorId]
  if (!caster || root.roll?.degree !== 'hit' || !isSpellKey(root.key) || isCancelled(state, root) || getSpellTestRoll(root.key) === null) return []
  const link = getLinkSpell(root.key)
  if (link === null) return []
  const targets = link === root.key ? (root.targetId ? [root.targetId] : []) : getLinkedTargets(caster, link)
  return targets.filter((id) => state.characters[id])
}

// The skill the spell's targets test with, as the book words the test
// ("Charisma vs will"); null when it names none the sheet has.
function getSpellTestRoll(key: SpellKey): keyof Skills | null {
  const roll = SPELLS[key].test?.roll ?? ''
  return roll in skillTermGetters ? roll as keyof Skills : null
}

export function getSpellTestSkillTerms(state: CombatState, action: SpellTestAction): Term[] {
  const target = action.targetId ? state.characters[action.targetId] : undefined
  const roll = isSpellKey(action.key) ? getSpellTestRoll(action.key) : null
  return target && roll ? skillTermGetters[roll](target) : []
}

// The caster's side of the test, resolved for the caster: the book's
// "Charisma".
export function getSpellTestDLTerms(state: CombatState, action: SpellTestAction): Term[] {
  const caster = state.characters[action.actorId]
  const test = isSpellKey(action.key) ? SPELLS[action.key].test : null
  if (!caster || !test) return []
  return [{ label: test.dl, value: resolveDL(caster, test.dl, test.roll).value ?? 0 }]
}

// What reaches the target, at the degree their test turns into, in full
// when they took it: the spell's effects for a target, none on a hit or
// better. The link itself
// is the caster's to hold (commands/reduce.ts).
export function getSpellTestFacts(state: CombatState, action: SpellTestAction): Deliveries {
  const caster = state.characters[action.actorId]
  if (!caster || !action.targetId || !isSpellKey(action.key)) return {}
  if (!action.accepted && !action.roll) return {}
  const degree = action.accepted || !action.roll ? 'hit' : resisted(action.roll.degree)
  if (degree === 'miss') return {}
  const theirs = getTargetEffects(SPELLS[action.key]).map((e) => ({ ...produceSpellEffect(caster, e, {}, action.key), degree, test: null }))
  return theirs.length > 0 ? { [action.targetId]: theirs } : {}
}

// Whether the target beat the test: a hit or better breaks the link
// ("The link is broken by hitting on any will test triggered by the
// caster").
export function isSpellTestBeaten(action: SpellTestAction): boolean {
  return !action.accepted && action.roll !== null && resisted(action.roll.degree) === 'miss'
}

// spells.tex "Telepathic Link": "or with anyone who allows the link" — a
// willing target takes the test's effects without rolling for it.
export function canAcceptSpellTest(action: SpellTestAction): boolean {
  return action.step === 'react' && !action.accepted
}
