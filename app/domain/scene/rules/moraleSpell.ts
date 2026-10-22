import { LIMIT_STRESS_ACTIONS, type LimitStressAction } from '../../lists'
import type { MoraleEffect, MoraleSpellEffect } from '../../types'
import { SPELLS, isSpellKey } from '../../spells'
import { getAfflictions, isDead } from '../../character/rules/afflictions'
import { getLinkSpell } from '../../character/rules/concentration'
import type { CastAction, MoraleSpellOutcome, SceneState, SpellTestAction } from '../types'
import { getAction } from './log'
import { getDistanceBetween } from './board/board'
import { getLinkedTargets } from './link'
import { getSenseReaches } from './detection'
import { getMoraleOutcome } from './morale'
import { getSituationalAfflictions } from './situational'

export function getMoraleSpell(key: string): MoraleSpellEffect | null {
  return isSpellKey(key) ? SPELLS[key].morale : null
}

// The dead make no morale test.
function isDeadIn(state: SceneState, id: string): boolean {
  const c = state.characters[id]
  return !!c && isDead(c)
}

// Who a cast of a morale spell puts to the test once it hits: the one aimed
// at, or (spells.tex "Overwhelming Terror", "Provocative Mockery") "all
// targets within range of active synesthesia or under the effect of
// telepathic link", the link the spell is cast through.
export function getMoraleSpellTargets(state: SceneState, root: CastAction): string[] {
  const spell = getMoraleSpell(root.key)
  if (!spell || !isSpellKey(root.key)) return []
  if (spell.target === 'target') return root.targetId && !isDeadIn(state, root.targetId) ? [root.targetId] : []
  const link = getLinkSpell(root.key)
  const linked = link ? getLinkedTargets(state, root.actorId, link) : []
  return Object.keys(state.characters).filter((id) => id !== root.actorId && !isDeadIn(state, id)
    && (linked.includes(id) || getSenseReaches(state, root.actorId, id).some((r) => r.sense === 'synesthesia' && r.active)))
}

// spells.tex "Suggestion": "The limit stress actions triggered can be either
// the target's natural one or violent when enraged, coward when afraid and
// all to confused" — of a target who is none of these, nothing.
export function getSuggestible(state: SceneState, targetId: string): LimitStressAction[] {
  const c = state.characters[targetId]
  if (!c) return []
  const afflictions = getAfflictions(c, getSituationalAfflictions(state, targetId))
  if (afflictions.includes('confused')) return [...LIMIT_STRESS_ACTIONS]
  const enraged = afflictions.includes('enraged')
  const afraid = afflictions.includes('afraid')
  if (!enraged && !afraid) return []
  return LIMIT_STRESS_ACTIONS.filter((a) => a === c.limitStress || (enraged && a === 'violent') || (afraid && a === 'coward'))
}

// Whether a morale spell may be aimed at the target: within its range (any
// distance without a board), and for a suggestion one with something to be
// suggested. A spell that is no morale spell is not this rule's to bar.
export function canAimMoraleSpell(state: SceneState, root: CastAction, targetId: string): boolean {
  const spell = getMoraleSpell(root.key)
  if (!spell) return true
  const distance = getDistanceBetween(state, root.actorId, targetId)
  const inRange = spell.range === null || distance === null || distance <= spell.range
  return inRange && (spell.effect.compels !== 'suggested' || getSuggestible(state, targetId).length > 0)
}

// spells.tex "Suggestion": the declaration is not whole until it names a
// limit stress action the target may be given.
export function isSuggestionComplete(state: SceneState, root: CastAction): boolean {
  if (getMoraleSpell(root.key)?.effect.compels !== 'suggested') return true
  return !!root.targetId && root.suggested !== null && getSuggestible(state, root.targetId).includes(root.suggested)
}

// The limit stress action a miss on the spell's test activates: the one the
// spell names, the one suggested, or the target's own — a martyr the test
// leaves enraged being violent (creating.tex "Limit Stress Actions").
function getCompelled(state: SceneState, test: SpellTestAction, spell: MoraleEffect, inflicted: string[]): LimitStressAction | null {
  if (spell.compels === 'suggested') {
    const cast = test.spawnedBy ? getAction(state, test.spawnedBy) : null
    return cast?.kind === 'cast' ? cast.suggested : null
  }
  if (spell.compels !== null) return spell.compels
  const own = test.targetId ? state.characters[test.targetId]?.limitStress ?? null : null
  return own === 'martyr' && inflicted.includes('enraged') ? 'violent' : own
}

// combat.tex "Morale": a morale spell's test is the target's morale test,
// made at once ("triggers an immediate morale test"); the caster is the enemy
// within 30 m, so a miss activates a limit stress action. spells.tex "Pacify":
// a hit or better rids the target of fear and anger and takes back a limit
// stress action they still owe; anything less does nothing.
export function getMoraleSpellOutcome(state: SceneState, test: SpellTestAction): MoraleSpellOutcome | null {
  const morale = getMoraleSpell(test.key)
  if (!morale || !test.targetId || (!test.roll && !test.accepted)) return null
  const spell = morale.effect
  const degree = test.accepted || !test.roll ? 'miss' : test.roll.degree
  const beaten = degree === 'hit' || degree === 'critical'
  if (spell.pacify) {
    const owed = state.compulsions.some((t) => t.id === test.targetId && !t.taken)
    return { cure: beaten ? ['afraid', 'enraged'] : [], inflict: [], compel: null, constraint: null, pacified: beaten && owed }
  }
  const outcome = getMoraleOutcome(degree, true, spell.taunt)
  const compel = outcome.limitStress ? getCompelled(state, test, spell, outcome.inflict) : null
  return { cure: outcome.cure, inflict: outcome.inflict, compel, constraint: compel ? spell.constraint : null, pacified: false }
}
