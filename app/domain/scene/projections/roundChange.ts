import type { SceneState } from '../types'
import { perState } from '../../perState'
import { getActiveSpellKeys } from '../../character/rules/effects'
import { getSustainedAbilities } from '../../character/rules/concentration'
import { ROUND_PHASES, getContinueBar, getHoldOnBar, getLetGoBar, getRoundPhase, holdsThroughRound, needsFocusToHold, type RoundPhase } from '../rules/roundChange'
import { getStressOwed } from '../rules/stress'
import { describeChangeTo } from './episode'
import { getMoraleRows, type MoraleRow } from './morale'
import { getSceneCards, type SceneCard } from './cards'

const PHASE_LABELS: Record<RoundPhase, string> = {
  rest: 'rest and speak',
  bleed: 'bleeding',
  environment: 'environment',
  concentration: 'hold on or let go',
  join: 'join the fight',
  morale: 'morale tests',
  stress: 'limit stress actions',
  chase: 'start a chase',
}

// What the button moving the round change on does, at each step it waits at.
const CONTINUE_LABELS: Record<RoundPhase, string> = {
  rest: 'bleed and burn',
  bleed: 'continue',
  environment: 'continue',
  concentration: 'on to joining',
  join: 'on to the morale tests',
  morale: 'continue',
  stress: 'continue',
  chase: 'start the round',
}

export type RoundStepView = { phase: RoundPhase; label: string; status: 'done' | 'current' | 'next' }

export type RoundConcentration = {
  // what the character keeps going, by name
  holds: string[]
  // whether holding on takes the focus surge
  focus: boolean
  holdBar: string | null
  letGoBar: string | null
  // what they chose, null while they have not
  chose: 'held on' | 'let go' | null
}

export type RoundCard = SceneCard & {
  // what the round change has done to the character so far, a line each
  happened: string[]
  // null for whoever keeps nothing going through it
  concentration: RoundConcentration | null
  morale: MoraleRow | null
  stress: string | null
}

export type RoundChangeView = {
  phase: RoundPhase
  steps: RoundStepView[]
  continueBar: string | null
  continueLabel: string
  parties: { id: string; name: string; cards: RoundCard[] }[]
}

function getHappened(state: SceneState, id: string): string[] {
  return state.edits
    .filter((e) => e.round === state.round)
    .flatMap((e) => e.changes.filter((c) => c.id === id).map((c) => `${e.cause}: ${describeChangeTo(c)}`))
}

function getConcentration(state: SceneState, id: string): RoundConcentration | null {
  const chose = state.concentration.find((x) => x.id === id)
  if (!chose && !holdsThroughRound(state, id)) return null
  const c = state.characters[id]
  return {
    holds: [...getActiveSpellKeys(c), ...getSustainedAbilities(c)],
    focus: needsFocusToHold(state, id),
    holdBar: getHoldOnBar(state, id),
    letGoBar: getLetGoBar(state, id),
    chose: chose ? (chose.hold ? 'held on' : 'let go') : null,
  }
}

// The round change as the middle of the run screen shows it: its steps, where
// it stands, and each character, by party, with what it has done to them and
// what they still have to choose in it.
function buildRoundChange(state: SceneState): RoundChangeView | null {
  const phase = getRoundPhase(state)
  if (!phase) return null
  const at = ROUND_PHASES.indexOf(phase)
  const morale = getMoraleRows(state)
  return {
    phase,
    steps: ROUND_PHASES.map((p, i) => ({ phase: p, label: PHASE_LABELS[p], status: i < at ? 'done' : i === at ? 'current' : 'next' })),
    continueBar: getContinueBar(state),
    continueLabel: CONTINUE_LABELS[phase],
    parties: getSceneCards(state).map((party) => ({
      ...party,
      cards: party.cards.map((card) => ({
        ...card,
        happened: getHappened(state, card.id),
        concentration: state.roundStep === 'concentration' ? getConcentration(state, card.id) : null,
        morale: morale.find((r) => r.id === card.id) ?? null,
        stress: getStressOwed(state, card.id),
      })),
    })),
  }
}

export const getRoundChange = perState(buildRoundChange)

export const getRoundChangeDigest = perState((state) => JSON.stringify(getRoundChange(state)))
