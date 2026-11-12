import type { Action, SceneState } from '../types'
import { isDead } from '../../character/rules/afflictions'
import { meetAttitudes } from '../../character/commands/attitudes'
import { getAttackOnSurrendered, getBravedBy, isSurrenderSpared } from '../rules/providence'
import { isCombatStarted } from '../rules/started'
import { updateCharacter } from './characters'

// The Providentialism abilities (abilities.tex "Providentialism") on the
// fight: what Justice answers, the AP Against the Odds gives and the
// surrender Mercy compels.

// combat.tex "Surrender": the flag raised once, and written down for Justice
// as long as the fight lasts.
export function raiseSurrenderFlag(state: SceneState, id: string): SceneState {
  return {
    ...state,
    surrendered: state.surrendered.includes(id) ? state.surrendered : [...state.surrendered, id],
    surrenderers: state.surrenderers.includes(id) ? state.surrenderers : [...state.surrenderers, id],
  }
}

// abilities.tex "Mercy": the enemy is "compelled to surrender until the end of
// the round" (`endRoundOfMercy`).
export function compelSurrender(state: SceneState, id: string): SceneState {
  const flagged = raiseSurrenderFlag(state, id)
  return { ...flagged, compelledSurrender: flagged.compelledSurrender.includes(id) ? flagged.compelledSurrender : [...flagged.compelledSurrender, id] }
}

// abilities.tex "Mercy": the round is over: the surrender it compelled is
// lifted, the flag with it (the table's ruling: they did not choose it).
export function endRoundOfMercy(state: SceneState): SceneState {
  if (state.compelledSurrender.length === 0) return state
  return { ...state, surrendered: state.surrendered.filter((id) => !state.compelledSurrender.includes(id)), compelledSurrender: [] }
}

// abilities.tex "Against the Odds": "Gains +1 AP in any round an opponent
// uses intimidation", once in the round. Before the combat starts there are
// no rounds and no AP to gain.
export function braveTheOdds(state: SceneState, speaker: string): SceneState {
  if (!isCombatStarted(state)) return state
  return getBravedBy(state, speaker).reduce(
    (s, id) => updateCharacter(id, (c) => ({ ...c, resources: { ...c.resources, AP: c.resources.AP + 1 } }), 'Against the Odds')({ ...s, braved: [...s.braved, id] }),
    state,
  )
}

// abilities.tex "Justice": "Loses 4 XP if they attack someone who has
// surrendered. Loses 1 XP if anyone else on the team attacks someone who has
// surrendered", once the attack lands.
export function meetAttackOnSurrendered(state: SceneState, landed: Action): SceneState {
  const on = getAttackOnSurrendered(state, landed)
  if (!on) return state
  const attacked = updateCharacter(on.attacker, meetAttitudes({ event: 'attackedSurrendered' }), 'conviction attitude')(state)
  return on.team.reduce((s, id) => updateCharacter(id, meetAttitudes({ event: 'allyAttackedSurrendered' }), 'conviction attitude')(s), attacked)
}

// abilities.tex "Justice": "Gains 2 XP at the end of a combat where everyone
// that surrendered survives", met by everyone still standing in the scene.
export function meetSurrendersSpared(state: SceneState): SceneState {
  if (!isSurrenderSpared(state)) return state
  return Object.values(state.characters).filter((c) => !isDead(c)).reduce((s, c) => updateCharacter(c.id, meetAttitudes({ event: 'surrendersSpared' }), 'conviction attitude')(s), state)
}
