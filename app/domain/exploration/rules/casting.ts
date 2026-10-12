import type { CampaignCharacter, Character, Delivery, HealEffect, Item, SpellEffect } from '../../types'
import type { CampaignState } from '../../campaign/types'
import type { CastPlan } from '../types'
import type { Test } from '../../play/test'
import { SPELLS, isSpellKey, type SpellKey } from '../../spells'
import { SPELL_MODIFICATIONS } from '../../tables'
import { getCastingDL, getSpellSkill, getSpellTestAddedTerms, getSpellTestRoll, getUnmetCastLabel, hasChargeTarget, isCastOverETs, resolveDL } from '../../character/rules/spells'
import { enhanceEffect, getSpellEffects, produceSpellEffect } from '../../character/rules/production'
import { getTestRollTerms } from '../../character/rules/spirit'
import { sumTerms } from '../../character/rules/terms'
import { getPartyMembers } from '../../campaign/rules/place'
import { findReadyItem, getReadyItems } from '../../item/rules/containers'

// spells.tex "Casting spells": the spells the character can cast over an
// ET — those whose cost takes one.
export function getETSpells(c: Character): SpellKey[] {
  return (Object.keys(c.spells) as SpellKey[]).filter((key) => isSpellKey(key) && isCastOverETs(key))
}

// What stands between the caster and casting the spell over the coming ET.
export function getETCastBar(c: Character, key: string): string | null {
  if (!isSpellKey(key) || !(key in c.spells) || !isCastOverETs(key)) return 'not a spell cast over an ET'
  if (SPELLS[key].DL === null) return 'no casting DL'
  const unmet = getUnmetCastLabel(c, key)
  if (unmet) return `needs ${unmet}`
  if (needsLimb(key) && !getReadyItems(c).some((i) => i.part)) return 'needs a severed limb at hand'
  return hasChargeTarget(c, key) ? null : `needs ${SPELLS[key].chargeInto === 'food' ? 'food' : 'a metal weapon'} at hand`
}

// Whom the caster can aim it at: anyone in their party not sent to a fight,
// the dead too ("Revitalize").
export function getETCastTargets(state: CampaignState, casterId: string): string[] {
  return getPartyMembers(state, state.partyOf[casterId]).filter((id) => state.characters[id] && !state.out.includes(id))
}

// The effects that land on whoever the cast is aimed at, and how many it
// may be aimed at: one for a spell that only leaves its target a test, none
// for one charged into an object (spells.tex "Charged": what it does waits
// there).
function getAimedEffects(key: SpellKey): SpellEffect[] {
  return SPELLS[key].effects.filter((e) => e.target === 'target')
}

export function getETCastCount(key: SpellKey): number {
  if (SPELLS[key].type === 'charged') return 0
  return Math.max(SPELLS[key].test ? 1 : 0, ...getAimedEffects(key).map((e) => e.count))
}

// The heal the spell puts on its target, which the plan may have to name a
// wound, a part or a food for.
export function getAimedHeal(key: SpellKey): HealEffect | null {
  const effect = getAimedEffects(key).find((e) => e.type === 'heal')
  return effect?.type === 'heal' ? effect.effect : null
}

// spells.tex "Reattach Limb": a spell that puts a limb back needs the limb
// at hand, and only one that fits a part the target has lost.
export function needsLimb(key: SpellKey): boolean {
  return getAimedHeal(key)?.of === 'limb'
}

export function getLimbOptions(caster: Character, target: Character | undefined): Item[] {
  const lost = new Set(target?.body.filter((p) => p.lost).map((p) => p.id) ?? [])
  return getReadyItems(caster).filter((i) => i.part && lost.has(i.part.id))
}

// Whether the plan names a limb the first target can take back.
export function hasPlannedLimb(caster: Character, target: Character | undefined, plan: CastPlan): boolean {
  return getLimbOptions(caster, target).some((i) => i.id === plan.item)
}

// Whether "Enhance Spell" adds anything to what the spell does.
export function isEnhanceable(key: SpellKey): boolean {
  return SPELLS[key].effects.some((e) => e.enhance !== 0)
}

// The casting test: the caster's skill with the spell against its DL; the
// overflow over a hit buys improvements.
export function getETCastTest(c: Character, key: SpellKey): Test | null {
  const DL = getCastingDL(SPELLS[key], false)
  return DL === null ? null : { skill: getSpellSkill(c, key), DL, explodes: false, scale: 'overflow', grazes: true }
}

// spells.tex "Spell Improvements": what the overflow buys of what was
// planned — Effortless first, then as many enhancements as are left for.
export function buyETImprovements(plan: CastPlan, HOP: number): { effortless: boolean; enhance: number } {
  const effortless = plan.effortless && HOP >= SPELL_MODIFICATIONS.effortless.HOP
  const left = HOP - (effortless ? SPELL_MODIFICATIONS.effortless.HOP : 0)
  return { effortless, enhance: Math.max(0, Math.min(plan.enhance, Math.floor(left / SPELL_MODIFICATIONS.enhance.HOP))) }
}

// spells.tex "Effortless Spell": "If used outside combat, reduces the
// exhaustion cost of a spell by half, rounded down."
export function getETCastExhaustion(key: SpellKey, effortless: boolean): number {
  const { exhaustion } = SPELLS[key].cost
  return effortless ? Math.floor(exhaustion / 2) : exhaustion
}

// What the cast puts on one target, as this caster makes it with the
// enhancements bought: a heal on the wound the plan names, or the part the
// limb it names was cut from. Buffs
// are left out: one lasts the ET and is read off the cast by the rest it
// helps.
export function produceETCast(caster: CampaignCharacter, plan: CastPlan, enhance: number): Delivery[] {
  if (!isSpellKey(plan.key)) return []
  return getSpellEffects(caster, plan.key)
    .filter((e) => e.target === 'target' && e.type !== 'buff')
    .map((e) => produceSpellEffect(caster, e.type === 'heal' ? { ...e, effect: choose(e.effect, plan, caster) } : e, caster.size, plan.key, enhance))
}

function choose(heal: HealEffect, plan: CastPlan, caster: Character): HealEffect {
  switch (heal.of) {
    case 'injury': return { ...heal, wound: plan.wound }
    case 'limb': return { ...heal, part: findReadyItem(caster, plan.item)?.item.part?.id ?? null }
    default: return heal
  }
}

// spells.tex "Enhanced Sleep": the health a target rests with on top of
// their own over the ET it was cast in.
export function getETRestBonus(key: SpellKey, enhance: number): number {
  return getAimedEffects(key).map((e) => enhanceEffect(e, enhance)).reduce((sum, e) =>
    e.type === 'buff' && e.effect.target === 'skill:health' && e.effect.operation === '+' ? sum + e.effect.value : sum, 0)
}

// Whether the table has to enter the DL of the target's test: the book
// names one the domain cannot work out ("poison DL").
export function entersTargetDL(caster: Character, key: SpellKey): boolean {
  const test = SPELLS[key].test
  return !!test && getSpellTestRoll(key) !== null && resolveDL(caster, test.dl, test.roll).extra !== ''
}

// spells.tex "Immune modulation": the test the spell lets its target make,
// against its DL as the caster sets it, or the one the table entered.
export function getETTargetTest(caster: Character, target: Character, key: SpellKey, entered: number): Test | null {
  const roll = getSpellTestRoll(key)
  const test = SPELLS[key].test
  if (!roll || !test) return null
  const DL = entersTargetDL(caster, key) ? entered : resolveDL(caster, test.dl, test.roll).value ?? 0
  return { skill: sumTerms([...getTestRollTerms(target, roll), ...getSpellTestAddedTerms(caster, key)]), DL, explodes: false, scale: 'degrees' }
}
