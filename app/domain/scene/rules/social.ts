import type { SocialAction } from '../../tables'
import type { SceneState } from '../types'
import { getAfflictions } from '../../character/rules/afflictions'
import { canAffordRest } from '../../character/rules/rest'
import { getPressureKey } from './morale'
import { getOpenAction } from './log'
import { getSituationalAfflictions } from './situational'
import { getStressSocial } from './stress'
import { getIncomingAP, getRoundChangeActBar } from './roundChange'

// Who anything is said to: others in the fight, once each.
export function getOthers(state: SceneState, id: string, targets: string[]): string[] {
  return targets.filter((t, i) => t !== id && state.characters[t] && targets.indexOf(t) === i)
}

// Everyone in the fight in another party than the character's: their
// enemies.
export function getEnemies(state: SceneState, id: string): string[] {
  const party = getPressureKey(state, id)
  return Object.keys(state.characters).filter((t) => getPressureKey(state, t) !== party)
}

// Who a social action is said to. With a pick (the table's, per character)
// it is the pick. Without one, combat.tex "Intimidation": "all enemies";
// "Rally": "allies" (the rest of the party); creating.tex "Limit Stress
// Actions" (abusive): the insult is for "the team" it is said to, so all
// enemies. A taunt names its enemy and has no default.
export function getSocialTargets(state: SceneState, id: string, kind: SocialAction | 'insult', targets: string[]): string[] {
  const said = getOthers(state, id, targets)
  if (said.length > 0) return kind === 'taunt' ? said.slice(0, 1) : said
  if (kind === 'taunt') return []
  if (kind === 'rally') return Object.keys(state.characters).filter((t) => t !== id && getPressureKey(state, t) === getPressureKey(state, id))
  return getEnemies(state, id)
}

// combat.tex "Social actions": "Every social action costs 5 AP and counts as
// a Rest action, which can be done at the end of the round". Why the character
// cannot take one now, or null: like a rest, in or out of their turn and
// allowed to overdraw AP, with nothing being played out; of the round change,
// only in its first step.
export function getSocialBar(state: SceneState, id: string): string | null {
  const c = state.characters[id]
  if (!c) return 'not in the fight'
  if (getOpenAction(state)) return 'an action is being played out'
  return getRoundChangeActBar(state) ?? (canAffordRest(c, 'socialAction', getIncomingAP(state)) ? null : 'not enough AP')
}

export function getSayBar(state: SceneState, id: string, kind: SocialAction, targets: string[]): string | null {
  return getSocialBar(state, id) ?? (getSocialTargets(state, id, kind, targets).length === 0 ? 'nobody to say it to' : null)
}

// creating.tex "Limit Stress Actions" (abusive): why the character cannot
// insult now, or null — only the abusive in their owed turn, to someone.
export function getInsultBar(state: SceneState, id: string, targets: string[]): string | null {
  if (getStressSocial(state, id) !== 'insult') return 'not compelled to insult'
  return getSocialBar(state, id) ?? (getSocialTargets(state, id, 'insult', targets).length === 0 ? 'nobody to insult' : null)
}

// combat.tex "Surrender": the flag is raised once.
export function getSurrenderBar(state: SceneState, id: string): string | null {
  return getSocialBar(state, id) ?? (state.surrendered.includes(id) ? 'already surrendered' : null)
}

// combat.tex "Surrender": the character "can unflag itself as surrendered at
// any time, as long as it is not dominated". Free, so no AP and no turn.
export function getUnsurrenderBar(state: SceneState, id: string): string | null {
  const c = state.characters[id]
  if (!c) return 'not in the fight'
  if (!state.surrendered.includes(id)) return 'not surrendered'
  return getAfflictions(c, getSituationalAfflictions(state, id)).includes('dominated') ? 'dominated' : null
}
