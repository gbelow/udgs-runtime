import type { CampaignCharacter, Item, Skills } from '../../types'
import type { ActionRoll, CastAction, CombatState, Deliveries, SpellTestAction } from '../types'
import { isCancelled } from './opportunity'
import { getAction } from './log'
import { getCastRange, getSpellEffects, getTargetEffects, produceOutcome, produceSpellEffect } from '../../character/rules/production'
import { SPELLS, isSpellKey, type SpellKey } from '../../spells'
import { GRAZE_SAVE, SPELL_MODIFICATIONS, type SpellModification } from '../../tables'
import { canAffordRestWhileCasting, canCastSpell, getAmplifyBounds, getCastConditions, getCastSize, getCastingDL, getCastableGear, getChargeTargets, getSpellSkill, getUnmetCastLabel, hasChargeTarget, pickSpellGear, resolveDL } from '../../character/rules/spells'
import { getHeldItem } from '../../item/rules/hands'
import { getLinkSpell, getLinkedTargets, mayCastWhileConcentrating } from '../../character/rules/concentration'
import { skillTermGetters } from '../../character/rules/skills'
import { ActionCost } from '../../character/rules/actionCosts'
import { canAfford } from '../../character/rules/cost'
import { Term } from '../../character/rules/terms'
import { getDistanceBetween, hasLineOfSight } from './board'
import { resolveTest, resisted } from './test'
import { isAreaEffect } from './explosion'
import { getSituationalAfflictions, isSuffocating } from './situational'

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
  if (!caster || !takesEffect(state, root) || !isSpellKey(root.key)) return {}
  const spell = SPELLS[root.key]
  if (spell.type === 'charged') return {}
  const size = getCastSizeOf(caster, root)
  const facts: Deliveries = {}
  const effects = getSpellEffects(caster, root.key, root.itemId)
  const own = effects.filter((e) => e.target === 'self' && e.trigger === 'instant').map((e) => produceSpellEffect(caster, e, size, root.key))
  if (own.length > 0) facts[root.actorId] = own
  if (root.targetId && state.characters[root.targetId] && getLinkSpell(root.key) === null) {
    const theirs = getTargetEffects(effects).map((e) => produceSpellEffect(caster, e, size, root.key))
    if (theirs.length > 0) facts[root.targetId] = [...(facts[root.targetId] ?? []), ...theirs]
  }
  return facts
}

// Whether the cast does anything: it hit, was not cancelled, and did not
// fail for want of what its HOP had to buy.
export function takesEffect(state: CombatState, root: CastAction): boolean {
  return root.roll?.degree === 'hit' && isSpellKey(root.key) && !isCancelled(state, root) && !isFailedCast(state, root)
}

// A hit that still does nothing, its costs lost: short of the
// amplifications its item asks for (spells.tex "Relationship between Size
// and Sorcery": "it is necessary to amplify the spell to use it").
export function isFailedCast(state: CombatState, root: CastAction): boolean {
  const caster = state.characters[root.actorId]
  return !!caster && root.roll?.degree === 'hit' && isUnderAmplified(caster, root)
}

export function isUnderAmplified(caster: CampaignCharacter, root: CastAction): boolean {
  return isSpellKey(root.key) && (root.improved.amplify ?? 0) < getAmplifyBounds(caster, root.key, root.itemId).min
}

// The size the cast works at, its amplifications bought.
export function getCastSizeOf(caster: CampaignCharacter, root: CastAction): number {
  return isSpellKey(root.key) ? getCastSize(caster, root.key, root.improved.amplify ?? 0, root.itemId) : caster.size
}

// The AP the cast has spent: its price, and the graze save's if bought
// (spells.tex "Casting spells": "increase spell cost by 2 AP").
export function getCastSpentAP(root: CastAction): number {
  return (root.cost?.AP ?? 0) + (root.grazeSaved ? GRAZE_SAVE_COST.AP : 0)
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
  // what the table has to judge it is cast under, empty for none
  conditions: string
}

// spells.tex "Requirements", "Casting spells": what stands between the
// caster and the spell, what it is cast with first — the one the caster can
// do something about from here.
function reasonAgainst(c: CampaignCharacter, key: SpellKey): string | null {
  const spell = SPELLS[key]
  const unmet = getUnmetCastLabel(c, key)
  if (unmet) return `needs ${unmet}`
  if (!hasChargeTarget(c, key)) return 'needs a metal weapon at hand'
  if (!canAfford(c, spell.cost)) return 'cannot pay for it'
  if (spell.DL === null) return 'no casting DL'
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
      conditions: getCastConditions(key),
    }
  })
}

// spells.tex "Requirements": the gear the cast is made with, and the gear
// at hand it could be made with instead, what is in the hands first — the
// choice only there is more than one. The same for the object a charged
// spell goes into when that is not its gear (spells.tex "Taser").
export type CastGearOption = { itemId: string; name: string; held: boolean }
export type CastGear = { itemId: string; options: CastGearOption[]; chargeItemId: string; chargeOptions: CastGearOption[] }

// Once committed, the cast keeps what it named then, though it may have
// spent the gear's last charge since.
export function getCastGear(c: CampaignCharacter, root: CastAction): CastGear {
  if (!isSpellKey(root.key) || root.step !== 'define') return { itemId: root.itemId, options: [], chargeItemId: root.chargeItemId, chargeOptions: [] }
  const items = getCastableGear(c, root.key)
  const gear = pickSpellGear(items, root.itemId)
  const targets = SPELLS[root.key].chargeInto === 'metalWeapon' ? getChargeTargets(c, root.key, gear) : []
  const option = (i: Item): CastGearOption => ({ itemId: i.id, name: i.name, held: !!getHeldItem(c, i.id) })
  return {
    itemId: gear?.id ?? '',
    options: items.length > 1 ? items.map(option) : [],
    chargeItemId: pickSpellGear(targets, root.chargeItemId)?.id ?? '',
    chargeOptions: targets.length > 1 ? targets.map(option) : [],
  }
}

// spells.tex "Spell Improvements": what the cast's overflow can still buy,
// each priced in HOP.
export type ImprovementOption = {
  name: SpellModification
  HOP: number
  text: string
  times: number
  available: boolean
  // how many the cast needs before it takes effect
  needed: number
}

export function getCastHOPRemaining(root: CastAction): number {
  return (root.roll?.HOP ?? 0) - (Object.keys(SPELL_MODIFICATIONS) as SpellModification[]).reduce((sum, m) => sum + (root.improved[m] ?? 0) * SPELL_MODIFICATIONS[m].HOP, 0)
}

// spells.tex "Concentration": nothing left to spend overflow on once the
// cast is cancelled — it produces nothing regardless of what is bought.
// spells.tex "Amplify Spell": only a spell with something marked to scale,
// and no further than its bounds; "Effortless Spell": once, and only if
// the caster can rest.
export function getImprovementOptions(state: CombatState, root: CastAction): ImprovementOption[] {
  const caster = state.characters[root.actorId]
  if (!caster || !root.roll || root.roll.degree !== 'hit' || !isSpellKey(root.key) || isCancelled(state, root)) return []
  const remaining = getCastHOPRemaining(root)
  const amplify = getAmplifyBounds(caster, root.key, root.itemId)
  return (Object.keys(SPELL_MODIFICATIONS) as SpellModification[]).map((name) => {
    const times = root.improved[name] ?? 0
    const open = name === 'amplify' ? times < amplify.max
      : name === 'effortless' ? times === 0 && !isSuffocating(state, caster) && canAffordRestWhileCasting(caster, getCastSpentAP(root))
      : true
    return {
      name,
      HOP: SPELL_MODIFICATIONS[name].HOP,
      text: SPELL_MODIFICATIONS[name].text,
      times,
      available: open && SPELL_MODIFICATIONS[name].HOP <= remaining,
      needed: name === 'amplify' ? amplify.min : 0,
    }
  })
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
  return SPELLS[key].type !== 'charged' && getTargetEffects(SPELLS[key].effects).length > 0
}

// combat.tex "Explosions": a cast that hit with an area to it opens that area
// as an explosion of the caster's, aimed and played out on its own; a charged
// spell's area waits in its object.
export function opensExplosion(state: CombatState, root: CastAction): boolean {
  if (!takesEffect(state, root) || !isSpellKey(root.key)) return false
  const spell = SPELLS[root.key]
  return spell.detonate !== null || (spell.type !== 'charged' && spell.effects.some(isAreaEffect))
}

// Whether every targeted effect of the spell reaches the target from where
// the caster stands, at the range the cast was extended to (spells.tex
// "Extend Spell") and the size cast at, in sight; touch reaches an adjacent
// target. True on a fight without a board.
export function canAimCast(state: CombatState, root: CastAction, targetId: string): boolean {
  const distance = getDistanceBetween(state, root.actorId, targetId)
  const caster = state.characters[root.actorId]
  if (distance === null || !caster || !isSpellKey(root.key)) return true
  const size = getCastSizeOf(caster, root)
  return getTargetEffects(SPELLS[root.key].effects).every((e) => distance <= (getCastRange(e, root.extend, size) ?? 1)) && hasLineOfSight(state, root.actorId, targetId)
}

// spells.tex "Telepathic Link": who the cast of a spell worked through a
// link puts to the test — the one a linking spell aims at, or everyone the
// link it is cast through holds ("These spells are made against all
// targets affected by link simultaneously"). None for a cast that did not
// hit, was cancelled, or has no test for its targets to make.
export function getSpellTestTargets(state: CombatState, root: CastAction): string[] {
  const caster = state.characters[root.actorId]
  if (!caster || !takesEffect(state, root) || !isSpellKey(root.key) || getSpellTestRoll(root.key) === null) return []
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
  return target && roll ? skillTermGetters[roll](target, getSituationalAfflictions(state, target.id)) : []
}

// The caster's side of the test, resolved for the caster: the book's
// "Charisma".
export function getSpellTestDLTerms(state: CombatState, action: SpellTestAction): Term[] {
  const caster = state.characters[action.actorId]
  const test = isSpellKey(action.key) ? SPELLS[action.key].test : null
  if (!caster || !test) return []
  return [{ label: test.dl, value: resolveDL(caster, test.dl, test.roll).value ?? 0 }]
}

// What reaches the target: the outcome their own degree on the test picks,
// the miss's when they took it without a die, at the size the cast that
// opened the test was made at. The link itself is the caster's to hold
// (commands/reduce.ts).
export function getSpellTestFacts(state: CombatState, action: SpellTestAction): Deliveries {
  const caster = state.characters[action.actorId]
  if (!caster || !action.targetId || !isSpellKey(action.key)) return {}
  if (!action.accepted && !action.roll) return {}
  const degree = action.accepted || !action.roll ? 'miss' : action.roll.degree
  const cast = action.spawnedBy ? getAction(state, action.spawnedBy) : null
  const size = cast?.kind === 'cast' ? getCastSizeOf(caster, cast) : getCastSize(caster, action.key, 0)
  const theirs = produceOutcome(caster, SPELLS[action.key], degree, size)
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
