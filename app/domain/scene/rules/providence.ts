import type { AttitudeHappening } from '../../character/rules/attitudes'
import { hasAffliction, isDead } from '../../character/rules/afflictions'
import { hasGrant } from '../../character/rules/effects'
import type { Action, SceneState } from '../types'
import { isAttackAction } from './actionCatalog'
import { getPressureKey, isEnemyOf } from './morale'
import { isVoided } from './opportunity'
import { getHeard, getSocialCost } from './social'
import { getMoraleTurnBar } from './morale'
import { getSituationalAfflictions } from './situational'
import { isCombatStarted } from './started'
import { canAfford, NOT_ENOUGH_AP } from '../../character/rules/cost'

// The Providentialism abilities (abilities.tex "Providentialism") that work
// on the fight: Justice's attitudes, Leadership, Against the Odds, Mercy and
// Inspiring Deed. Duty and Oathbound's negotiation are not built.

// ---------------------------------------------------------------------------
// Justice

// abilities.tex "Justice": who an attack on someone who surrendered is held
// against, once it lands: the attacker and everyone else on their team, or
// null when it is not an attack on a surrendered character.
export function getAttackOnSurrendered(state: SceneState, action: Action): { attacker: string; team: string[] } | null {
  if (!isAttackAction(action) || !action.targetId || action.targetId === action.actorId || isVoided(state, action)) return null
  if (!state.surrendered.includes(action.targetId)) return null
  const side = getPressureKey(state, action.actorId)
  const team = Object.keys(state.characters).filter((id) => id !== action.actorId && !isDead(state.characters[id]) && getPressureKey(state, id) === side)
  return { attacker: action.actorId, team }
}

// abilities.tex "Justice": "Gains 2 XP at the end of a combat where everyone
// that surrendered survives": at least one surrendered (the table's ruling,
// or a fight where nobody did would pay for nothing), and all of them are
// alive.
export function isSurrenderSpared(state: SceneState): boolean {
  return state.surrenderers.length > 0 && state.surrenderers.every((id) => !!state.characters[id] && !isDead(state.characters[id]))
}

// ---------------------------------------------------------------------------
// Leadership

// abilities.tex "Leadership": the rally the holder decides to make once
// everyone has rolled their morale test (the table's ruling), at the price of
// any rally. Why they cannot now, or null.
export function getLeadershipRallyBar(state: SceneState, id: string): string | null {
  const c = state.characters[id]
  if (!c || !hasGrant(c, 'leadership')) return 'has not learned Leadership'
  if (isDead(c) || hasAffliction(c, 'unconscious', getSituationalAfflictions(state, id))) return 'unconscious'
  if (state.roundStep !== 'morale') return 'only once the morale tests are made, at the round change'
  if (getMoraleTurnBar(state)) return 'the morale tests are not all made'
  if (state.moraleRallies.includes(id)) return 'already rallied'
  if (getHeard(state, id, 'rally').length === 0) return 'nobody to rally'
  return canAfford(c, getSocialCost(c, 'rally'), isCombatStarted(state)) ? null : NOT_ENOUGH_AP
}

// ---------------------------------------------------------------------------
// Against the Odds

// abilities.tex "Against the Odds": "Gains +1 AP in any round an opponent
// uses intimidation": those who hear the intimidation, who have it and have
// not had the round's AP yet.
export function getBravedBy(state: SceneState, speaker: string): string[] {
  return getHeard(state, speaker, 'intimidate').filter((id) => {
    const c = state.characters[id]
    return !!c && !isDead(c) && hasGrant(c, 'againstTheOdds') && !state.braved.includes(id)
  })
}

// ---------------------------------------------------------------------------
// Inspiring Deed

// abilities.tex "Inspiring Deed": "any time they roll a 9 on the dice": the
// face the kept d10 showed.
const INSPIRING_FACE = 9

export function isInspiring(state: SceneState, id: string, happened: AttitudeHappening[]): boolean {
  const c = state.characters[id]
  return !!c && !isDead(c) && hasGrant(c, 'inspiringDeed') && happened.some((h) => h.event === 'die' && h.face === INSPIRING_FACE)
}

// ---------------------------------------------------------------------------
// Mercy

// abilities.tex "Mercy": whose intimidation, said in the round before, stood
// behind the limit stress action the character's morale test activated: the
// enemies who have Mercy among those who intimidated them.
export function getMercifulTo(state: SceneState, id: string): string[] {
  const said = state.pressure.filter((p) => p.target === id && p.kind === 'intimidate' && p.round === state.round - 1)
  return [...new Set(said.map((p) => p.from))].filter((from) => isEnemyOf(state, from, id) && hasGrant(state.characters[from], 'mercy') && !isDead(state.characters[from]))
}
