import { isCombatStarted } from './started'
import type { LimitStressAction } from '../../lists'
import type { SurgeKind } from '../../types'
import { SURGES } from '../../tables'
import { getAfflictions, isDead } from '../../character/rules/afflictions'
import { getSTARegen } from '../../character/rules/characteristics'
import { canAffordRest } from '../../character/rules/rest'
import { canSurge } from '../../character/rules/surge'
import type { Coord } from '../../types'
import type { Compulsion, MoveAction, SceneState } from '../types'
import { getFightName } from './fighters'
import { getFootprint, getPlacedFootprint } from './board/board'
import { setDistance } from './board/geometry'
import { getEndingAt, getMoveOrigin } from './board/waypoint'
import { getSituationalAfflictions, hasFightAffliction, isSuffocating } from './situational'

// creating.tex "Limit Stress Actions": what each compels. The coward, the
// violent and the martyr are compelled to a surge, the abusive and the traitor
// to a social action; tanatosis is no turn at all.
type StressDuty = { kind: 'surge'; surge: SurgeKind } | { kind: 'social'; say: 'insult' | 'negotiate' }

// Tanatosis has none: it is no turn.
const STRESS_DUTIES: Partial<Record<LimitStressAction, StressDuty>> = {
  coward: { kind: 'surge', surge: 'movement' },
  violent: { kind: 'surge', surge: 'combat' },
  abusive: { kind: 'social', say: 'insult' },
  traitor: { kind: 'social', say: 'negotiate' },
  martyr: { kind: 'surge', surge: 'reaction' },
}

// creating.tex "Limit Stress Actions": what each compels, as the screen
// tells the one taking it.
const STRESS_INSTRUCTIONS: Record<LimitStressAction, string> = {
  coward: 'make your movement surge and run',
  violent: 'make your combat surge and attack, even while afraid',
  tanatosis: 'fall unconscious until the next turn',
  abusive: 'use a social action to insult your allies',
  traitor: 'use a social action to negotiate with the opponent',
  martyr: 'make your reaction surge to protect an ally',
}

function getInstruction(state: SceneState, turn: Compulsion): string {
  return `${STRESS_INSTRUCTIONS[turn.action]}${getBondLine(state, turn)}`
}

// What the limit stress action the holder's turn is owed for tells them to
// do, as a line: the duty while it is due (resting first when only a rest
// makes the surge payable), and that the rest of the turn is theirs once
// nothing more is due. '' when the turn is no limit stress action.
export function getStressDuty(state: SceneState): string {
  const turn = getStressTurn(state)
  if (!turn) return ''
  const due = getStressDue(state)
  if (!due) return `Limit stress: ${turn.action}, done. The rest of the turn is yours; end it when you're ready.`
  const rest = due.kind === 'surge' && due.restFirst ? 'Rest first, then ' : ''
  return `Limit stress: ${turn.action}. ${capitalize(`${rest}${getInstruction(state, turn)}`)}.`
}

function capitalize(line: string): string {
  return line.charAt(0).toUpperCase() + line.slice(1)
}

// creating.tex "Limit Stress Actions": the action the character's miss
// activates, or null for one who chose none. The table's ruling: a martyr
// who is enraged cannot make the reaction surge, so is violent instead.
export function getStressAction(state: SceneState, id: string): LimitStressAction | null {
  const c = state.characters[id]
  if (!c) return null
  if (c.limitStress !== 'martyr') return c.limitStress
  return getAfflictions(c, getSituationalAfflictions(state, id)).includes('enraged') ? 'violent' : 'martyr'
}

// Whether the owed action needs no turn: tanatosis, and a martyr who can pay
// for the reaction surge, which is no turn's to make (the table's ruling: it is
// made at once, and "no turn can be started" after it).
export function isStressAutomatic(state: SceneState, id: string, action: LimitStressAction): boolean {
  return action === 'tanatosis' || (action === 'martyr' && canSurge('reaction')(state.characters[id]))
}

// The limit stress actions the round's morale tests activated, the worst test
// first (the table's ruling: by how far the score fell short of the DL), the
// order the tests were made in between equals. Whoever has no turn to take
// for it is already taken.
export function getStressTurns(state: SceneState): Compulsion[] {
  return state.morale
    .flatMap(({ id, roll }) => {
      const action = roll?.limitStress ? getStressAction(state, id) : null
      return roll && action ? [{ margin: roll.score - roll.DL, turn: { id, action, acted: false, taken: isStressAutomatic(state, id, action), by: '', constraint: null, overruledBy: '', contested: [] } }] : []
    })
    .sort((a, b) => a.margin - b.margin)
    .map(({ turn }) => turn)
}

// Whether the limit stress action is still owed: not taken, and its character
// still in the fight to take it. combat.tex "Morale", "Out of the fight":
// "Collapsed and unconscious characters do not take morale tests"; the table's
// ruling: one who dies or collapses while owing it has it cancelled.
function isOwed(state: SceneState, t: Compulsion): boolean {
  const c = state.characters[t.id]
  return !t.taken && !!c && !isDead(c) && !hasFightAffliction(state, c, 'collapsed') && !hasFightAffliction(state, c, 'unconscious')
}

export function getNextStress(state: SceneState): Compulsion | null {
  return state.compulsions.find((t) => isOwed(state, t)) ?? null
}

// The owed turn the holder is in, if that is what it is.
export function getStressTurn(state: SceneState): Compulsion | null {
  const holder = state.inTurnCharacter
  return state.fleeing ? null : state.compulsions.find((t) => t.id === holder && isOwed(state, t)) ?? null
}

// Whether the character owes a limit stress action still to be taken.
export function owesStressTurn(state: SceneState, id: string): boolean {
  return state.compulsions.some((t) => t.id === id && isOwed(state, t))
}

// The surge the holder's turn compels, if it does.
export function getCompelledSurge(state: SceneState, id: string): SurgeKind | null {
  const turn = getStressTurn(state)
  const duty = turn && turn.id === id ? STRESS_DUTIES[turn.action] : null
  return duty?.kind === 'surge' ? duty.surge : null
}

// The social action the holder's turn compels and has yet to take, if any.
export function getStressSocial(state: SceneState, id: string): 'insult' | 'negotiate' | null {
  const turn = getStressTurn(state)
  const duty = turn && turn.id === id && !turn.acted ? STRESS_DUTIES[turn.action] : null
  return duty?.kind === 'social' ? duty.say : null
}

// Why a turn cannot be started by the character now, or null: whoever the
// morale tests left owing a limit stress action takes it before anyone else.
export function getStressStartBar(state: SceneState, id: string): string | null {
  return getNextStress(state)?.id === id ? null : getStressRoundBar(state)
}

// Why the round cannot be passed now, or null.
export function getStressRoundBar(state: SceneState): string | null {
  const next = getNextStress(state)
  return next ? `${getFightName(state, next.id)} owes their limit stress action` : null
}

function hasRestedThisTurn(state: SceneState, id: string): boolean {
  return state.turnsTaken.some((t) => t.turn === state.turn && t.rested.includes(id))
}

// What the holder's owed turn still makes them do before it may end: the
// surge (after a rest, when only a rest makes it payable), or the social
// action. Null once it is done or cannot be.
export type StressDue = { kind: 'surge'; surge: SurgeKind; restFirst: boolean } | { kind: 'social'; say: 'insult' | 'negotiate' }

// creating.tex "Limit Stress Actions" and combat.tex "Compulsions": "They
// must occur immediately if there are enough AP. If not, they force action
// surges. If even that is not possible, ... the compulsion ends".
export function getStressDue(state: SceneState): StressDue | null {
  const turn = getStressTurn(state)
  const c = turn ? state.characters[turn.id] : undefined
  if (!turn || !c) return null
  const duty = STRESS_DUTIES[turn.action]
  switch (duty?.kind) {
    case 'surge': {
      if (c.usedSurge !== null) return null
      if (canSurge(duty.surge, true)(c)) return { ...duty, restFirst: false }
      const short = SURGES[duty.surge].STA > c.resources.STA
      const restHelps = short && c.resources.STA + getSTARegen(c) >= SURGES[duty.surge].STA
      return restHelps && canAffordRest(c, 'rest', isCombatStarted(state)) && !isSuffocating(state, c) && !hasRestedThisTurn(state, c.id) ? { ...duty, restFirst: true } : null
    }
    case 'social':
      return turn.acted || !canAffordRest(c, 'socialAction', isCombatStarted(state)) ? null : duty
    default:
      return null
  }
}

// Why the holder's owed turn cannot end yet, or null.
export function getStressEndBar(state: SceneState): string | null {
  const due = getStressDue(state)
  if (!due) return null
  if (due.kind === 'social') return `forced to ${due.say}`
  return due.restFirst ? `forced to rest, then use the ${due.surge} surge` : `forced to use the ${due.surge} surge`
}

// Whether the character holds the reaction surge a martyr's limit stress
// action made, until the round ends.
export function isMartyrGuard(state: SceneState, id: string): boolean {
  const c = state.characters[id]
  return !!c && c.usedSurge === 'reaction' && state.compulsions.some((t) => t.id === id && t.action === 'martyr' && t.taken)
}

// What the character still owes of their limit stress action this round, as a
// line, or null.
export function getStressOwed(state: SceneState, id: string): string | null {
  const turn = state.compulsions.find((t) => t.id === id && isOwed(state, t)) ?? state.compulsions.find((t) => t.id === id)
  if (!turn) return null
  if (isOwed(state, turn)) return `Limit stress: ${turn.action}. ${capitalize(getInstruction(state, turn))}.`
  return isMartyrGuard(state, id) ? 'martyr: holds the reaction surge to protect an ally' : null
}

function getBondLine(state: SceneState, turn: Compulsion): string {
  if (turn.constraint === 'attack') return `, attacking only ${getFightName(state, turn.by)}`
  if (turn.constraint === 'flee') return `, running from ${getFightName(state, turn.by)}`
  return ''
}

// The caster the holder's compelled turn binds them to, and how, or null.
function getBond(state: SceneState, id: string): Pick<Compulsion, 'by' | 'constraint'> | null {
  const turn = getStressTurn(state)
  return turn && turn.id === id && turn.constraint !== null && state.characters[turn.by] ? turn : null
}

// spells.tex "Provocative Mockery": "They are compelled to attack the caster
// on a limit stress action" — in that turn, the caster is the only one the
// compelled may aim at.
export function isCompelledTarget(state: SceneState, actorId: string, targetId: string): boolean {
  const bond = getBond(state, actorId)
  return bond?.constraint !== 'attack' || targetId === bond.by
}

// spells.tex "Overwhelming Terror": "They are compelled to run away from the
// caster on a limit stress action" — in that turn, a move of theirs ends no
// nearer the caster than it set out. Without a board, any move does.
export function isCompelledAway(state: SceneState, move: MoveAction, cell: Coord | undefined): boolean {
  const bond = getBond(state, move.actorId)
  const c = state.characters[move.actorId]
  const origin = getMoveOrigin(state, move)
  const caster = bond?.constraint === 'flee' ? getPlacedFootprint(state, bond.by) : null
  const end = cell ? getEndingAt(state, move, cell) : null
  if (!c || !origin || !caster || !end) return true
  return setDistance(getFootprint(c, end), caster) >= setDistance(getFootprint(c, origin), caster)
}
