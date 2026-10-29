import type { SceneState, SeenScene } from '../types'
import { perState } from '../../perState'
import { getActiveSpellKeys } from '../../character/rules/effects'
import { getSustainedAbilities } from '../../character/rules/concentration'
import { ROUND_PHASES, getContinueBar, getHoldOnBar, getLetGoBar, getRoundPhase, holdsThroughRound, needsFocusToHold, type RoundPhase } from '../rules/roundChange'
import { getStressOwed } from '../rules/stress'
import { describeChangeTo } from './episode'
import { getMoraleRows, type MoraleRow } from './morale'
import { getSceneCards, type SceneCard } from './cards'
import { ROUND_AP } from '../../tables'
import { isDead } from '../../character/rules/afflictions'
import { getAvailableActions } from '../rules/options'
import { getActionDef } from '../rules/actionCatalog'
import { getFightName, getMembers, getPartyName } from '../rules/fighters'
import { isParkedParty } from '../rules/parked'

const PHASE_LABELS: Record<RoundPhase, string> = {
  rest: 'rest and speak',
  concentration: 'hold on or let go',
  join: 'join the fight',
  morale: 'morale tests',
  stress: 'limit stress actions',
  chase: 'start a chase',
}

// What the button moving the round change on does, at each step it waits at.
const CONTINUE_LABELS: Record<RoundPhase, string> = {
  rest: 'bleed and burn',
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
  // what moving the round change on leaves nobody able to do, a line each
  closing: string[]
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

// What the step the round change waits at still lets someone do and moving
// it on takes away, so that nobody misses a chance by it: resting and
// speaking, and the AP above the round's, once the rest step is left; joining
// once the join step is; running away or giving chase, for a party that chose
// neither, once the round begins.
function getClosing(state: SceneState, phase: RoundPhase): string[] {
  switch (phase) {
    case 'rest':
      return Object.values(state.characters).filter((c) => !isDead(c)).flatMap((c) => {
        const lost = [
          getAvailableActions(state, c.id).some((o) => o.available && getActionDef(o.draft.kind).rest) ? 'can no longer rest or speak' : null,
          c.resources.AP > ROUND_AP ? `loses ${c.resources.AP - ROUND_AP} unspent AP` : null,
        ].filter((x) => x !== null)
        return lost.length > 0 ? [`${getFightName(state, c.id)} ${lost.join(' and ')}`] : []
      })
    case 'join': return ['nobody can join the fight until the next round change']
    case 'chase':
      if (state.chase) return []
      return Object.keys(state.parties)
        .filter((p) => !state.chaseIntents[p] && !isParkedParty(state, p) && getMembers(state, p).length > 0)
        .map((p) => `${getPartyName(state, p)} can no longer run away or give chase until the next round change`)
    default: return []
  }
}

// The round change as the middle of the run screen shows it: its steps, where
// it stands, and each character, by party, with what it has done to them and
// what they still have to choose in it.
function buildRoundChange(state: SeenScene): RoundChangeView | null {
  const phase = getRoundPhase(state)
  if (!phase) return null
  const at = ROUND_PHASES.indexOf(phase)
  const morale = getMoraleRows(state)
  return {
    phase,
    steps: ROUND_PHASES.map((p, i) => ({ phase: p, label: PHASE_LABELS[p], status: i < at ? 'done' : i === at ? 'current' : 'next' })),
    continueBar: getContinueBar(state),
    continueLabel: CONTINUE_LABELS[phase],
    closing: getClosing(state, phase),
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

export const getRoundChangeDigest = perState((state: SeenScene) => JSON.stringify(getRoundChange(state)))
