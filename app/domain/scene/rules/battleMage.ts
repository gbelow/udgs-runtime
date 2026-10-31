import type { ActionKind, ActionRoll, CastAction, SceneState } from '../types'
import type { Test } from '../../play/test'
import { SPELLS, isSpellKey, getSpellUpkeep } from '../../spells'
import { getActiveSpellKeys, hasGrant } from '../../character/rules/effects'
import { getHeldEntry, isConcentrating } from '../../character/rules/concentration'
import { isDefense } from './actionCatalog'
import { getRootTestTerms } from './attack'
import { getInterruptions } from './interruption'
import { isInTurn } from './turn'
import { getOpenAction } from './log'
import { makeAction } from '../factories'
import { hasUpkeepMove } from './carriedMove'
import { sumTerms } from '../../character/rules/terms'

// abilities.tex "Battle Mage": a caster who keeps a spell going through what
// would otherwise end it. Concentrating is a cast that needs it (combat.tex
// "Concentration"), the same cast held over for the round to change, or a
// sustained spell held (spells.tex "Sustained Spells").

export const RETEST_PENALTY = 3

// "I. Allows the caster to use careful movement while concentrating,
// repurposing the same action points used for the spell" (its recipes,
// rules/carriedMove.ts): what holding on to the held spells pays at the round
// change, the careful move it buys a Battle Mage in their turn; none for
// anyone else.
export function getUpkeepMoveAP(state: SceneState, id: string): number {
  const c = state.characters[id]
  if (!c || !hasUpkeepMove(c)) return 0
  return getActiveSpellKeys(c).reduce((sum, key) => sum + (isSpellKey(key) ? getSpellUpkeep(SPELLS[key]).AP : 0), 0)
}

// The careful move holding on bought, still to be made: in the caster's own
// turn, nothing open, on the board, still holding a spell, and not already
// committed this round.
export function canMoveWhileSustaining(state: SceneState, id: string): boolean {
  const choice = state.concentration.find((x) => x.id === id && x.hold)
  const c = state.characters[id]
  if (!choice || !c || choice.upkeepAP <= 0 || !isConcentrating(c)) return false
  if (choice.moveId !== null && choice.moveId in state.actions) return false
  return !getOpenAction(state) && isInTurn(state, id) && state.board?.placements[id] !== undefined
}

export function getUpkeepMoveOf(state: SceneState, id: string): number {
  return state.concentration.find((x) => x.id === id && x.hold)?.upkeepAP ?? 0
}

// "II. The character can defend actively while concentrating, with AP costs
// paid separately": a defense, or a reflex against a shot (the table's
// ruling), gives up neither a cast, a held one nor a held spell, and gets
// nothing back from it. Anything else gives them up as it would anyone's.
export function keepsConcentrationOn(state: SceneState, reactorId: string, kind: ActionKind | undefined): boolean {
  const c = state.characters[reactorId]
  return kind !== undefined && (isDefense(kind) || kind === 'evasion' || kind === 'guard') && !!c && hasGrant(c, 'concentratedDefense')
}

// "III. When interrupted, instead of losing the spell, redo the spellcasting
// test with a penalty of -3 and choose the worst result between the original
// and this one."
export function retestsCasting(state: SceneState, id: string): boolean {
  const c = state.characters[id]
  return !!c && hasGrant(c, 'castingRetest')
}

// A cast that is not broken by an interruption, for its caster tests it
// again instead.
export function isRetestedCast(state: SceneState, action: { kind: ActionKind; actorId: string }): boolean {
  return action.kind === 'cast' && retestsCasting(state, action.actorId)
}

// The casting test a cast an interruption landed on is thrown again as, once
// it has been rolled and before its caster spends what it came to; null when
// it owes none.
export function getCastRetest(state: SceneState, cast: CastAction): Test | null {
  if (!cast.roll || cast.retest || !retestsCasting(state, cast.actorId)) return null
  if (!cast.shaken && getInterruptions(state, cast).length === 0) return null
  return withPenalty(state, cast)
}

// The test a held spell is kept by: its casting test as the caster would
// throw it now, as far as it was extended.
export function getHeldSpellRetest(state: SceneState, id: string, key: string): Test | null {
  const c = state.characters[id]
  if (!c || !isSpellKey(key)) return null
  const entry = getHeldEntry(c, key)
  return withPenalty(state, makeAction('cast', { id: '', actorId: id, key, extend: entry?.extend ?? 0 }))
}

function withPenalty(state: SceneState, cast: CastAction): Test | null {
  const terms = getRootTestTerms(state, cast)
  if (!terms || terms.scale !== 'overflow') return null
  const skill = [...terms.skill, { label: 'interrupted', value: -RETEST_PENALTY }]
  return { skill: sumTerms(skill), DL: sumTerms(terms.DL), explodes: false, scale: 'overflow', grazes: terms.grazes, terms: { skill, DL: terms.DL } }
}

// The worse of the two throws: the lower over its DL.
export function getWorseRoll(first: ActionRoll, again: ActionRoll): ActionRoll {
  return again.score - again.DL < first.score - first.DL ? again : first
}

// A held spell is kept by a hit (spells.tex "Casting spells": "On a hit, the
// spell works").
export function keepsHeldSpell(roll: ActionRoll): boolean {
  return roll.degree === 'hit' || roll.degree === 'critical'
}

// The spells the action's landing let the caster keep by testing again.
export function getKeptSpells(retests: Record<string, { key: string; roll: ActionRoll }[]>, id: string): string[] {
  return (retests[id] ?? []).filter((r) => keepsHeldSpell(r.roll)).map((r) => r.key)
}
