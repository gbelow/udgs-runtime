import type { SceneState } from '../types'
import type { RollMode } from '../../play/dice'
import { describeThrow } from '../../character/rules/terms'
import { getContestBar, getContenders, getContestMode, getContestModes, getEndTurnBar, getNextRoundBar, getRollContestBar, getStartTurnBar, getSurgeTurnBar, getTurnHolder, hasAgreedToEnd, isInTurn } from '../rules/turn'
import { getOpenAction } from '../rules/log'
import { getEndCombatBar } from '../rules/fight'
import { perState } from '../../perState'
import { getAwaited } from '../rules/options'
import { getActionNoun } from './labels'
import { getFightName } from '../rules/fighters'
import { getCompelledSurge, getStressDuty } from '../rules/stress'
import { getGivesLine, getRulesLine, getSurgeFacts, getSurgeOptions, SurgeOption } from '../../character/lenses/surge'
import { getFollowOptions } from '../rules/follow'
import { getStealthScore, getStealthTurn } from '../rules/stealth'
import { canSurge, getSurgeAP, hasAPLeft } from '../../character/rules/surge'
import { isCombatStarted } from '../rules/started'
import { getRoundChangeBar } from '../rules/roundChange'
import { surgeKinds } from '../../lists'
import { hasAffliction, isDead } from '../../character/rules/afflictions'
import { getPreparedRows } from './prepare'

// The turn buttons as the character sees them: whose turn it is, who asked
// to contest it, whether they agree to end the round, and why each button is
// closed, null where it is open. Flat primitives, so a hook can gate on them
// shallowly.
export type TurnControls = {
  holder: string
  inTurn: boolean
  start: string | null
  contesting: boolean
  contest: string | null
  contenders: string
  // how the character throws their cunning in the contest
  contestMode: RollMode
  roll: string | null
  end: string | null
  result: string
  // said to whoever would act outside their turn: that they must start one, and
  // why they cannot now; '' when nothing asks it of them
  mustStart: string
  // combat.tex "Actions in stealth": whom the holder began the turn hidden
  // from, and their stealth as the turn has left it; '' when hidden from nobody
  stealth: string
  // creating.tex "Limit Stress Actions": what the holder's limit stress turn
  // has them do; '' when the turn is no limit stress action
  duty: string
}

export function getTurnControls(state: SceneState, id: string): TurnControls {
  const holder = getTurnHolder(state)
  return {
    holder: holder ? getFightName(state, holder) : '',
    inTurn: isInTurn(state, id),
    start: getStartTurnBar(state, id),
    contesting: state.contenders.includes(id),
    contest: getContestBar(state, id),
    contenders: getContenders(state).map((c) => getFightName(state, c)).join(', '),
    contestMode: getContestMode(state, id),
    roll: getRollContestBar(state),
    end: getEndTurnBar(state),
    result: getContestResult(state),
    mustStart: getMustStart(state, id),
    stealth: getStealthLine(state),
    duty: getStressDuty(state),
  }
}

// What is said to whoever would act outside their turn; '' when nothing is.
export function getMustStart(state: SceneState, id: string): string {
  if (!isCombatStarted(state) || !state.characters[id] || isInTurn(state, id) || getOpenAction(state) || getRoundChangeBar(state)) return ''
  const bar = getStartTurnBar(state, id)
  const name = getFightName(state, id)
  return bar ? `${name} cannot act now: ${bar}` : `start ${name}'s turn to act`
}

// Whose turn it is, for all to see: nobody's while the next is still to be
// asked for; null outside a fight and while the round changes.
export type TurnBanner = { turn: number; holder: { id: string; name: string; flees: boolean } | null }

export const getTurnBanner = perState((state: SceneState): TurnBanner | null => {
  const holder = getTurnHolder(state)
  if (!isCombatStarted(state) || (!holder && getRoundChangeBar(state))) return null
  return { turn: state.turnsBegun, holder: holder ? { id: holder, name: getFightName(state, holder), flees: state.fleeing } : null }
})

// The ways the character may throw their cunning in the contest for the turn,
// a single one where there is no choice.
export function getContestModeOptions(state: SceneState, id: string): RollMode[] {
  return getContestModes(state, id)
}

// The turn's stealth, as one line: whom its holder is hidden from, their
// score less the turn's noise, and less again to an ear when they are noisy.
function getStealthLine(state: SceneState): string {
  const turn = getStealthTurn(state)
  const score = turn ? getStealthScore(state, turn.id) : null
  if (!turn || score === null || turn.hiddenFrom.length === 0) return ''
  const names = turn.hiddenFrom.map((id) => getFightName(state, id)).join(', ')
  const heard = turn.heardAP > 0 ? `, ${score - turn.AP - turn.heardAP} to an ear` : ''
  return `${getFightName(state, turn.id)} began the turn hidden from ${names} · stealth ${score - turn.AP}${heard}`
}

// The contest rolled for this turn, as one line: each roll, then who took
// the turn; '' before one is rolled.
function getContestResult(state: SceneState): string {
  const contest = state.lastContest
  if (!contest) return ''
  const rolls = contest.rolls.map((r) => `${getFightName(state, r.id)} ${r.score} (${describeThrow(r.die, r.skill, r.skillTerms, 'cunning', r.score)}${r.mode === 'normal' ? '' : `, ${r.mode}`})`).join(' · ')
  return `cunning contest: ${rolls} → ${getFightName(state, contest.winner)} takes the turn`
}

// combat.tex "Action surge" — the surge buttons in the fight: the
// character's own, with a movement or combat surge closed outside their
// turn.
export function getCombatSurgeOptions(state: SceneState, id: string): SurgeOption[] {
  const c = state.characters[id]
  if (!c) return []
  return getSurgeOptions(c, getCompelledSurge(state, id)).map((o) => (getSurgeTurnBar(state, id, o.kind) ? { ...o, available: false } : o))
}

// The surge buttons with what each gives the character and what it bars
// (`getSurgeFacts`), and why one is closed by when it may be made.
export type SurgeView = SurgeOption & { gives: string; rules: string; bar: string | null }

export function getSurgeViews(state: SceneState, id: string): SurgeView[] {
  const c = state.characters[id]
  if (!c) return []
  return getCombatSurgeOptions(state, id).map((o) => {
    const read = getSurgeFacts(c, o.kind)
    return { ...o, gives: getGivesLine(read), rules: getRulesLine(read), bar: getSurgeTurnBar(state, id, o.kind) }
  })
}

// combat.tex "Follow" — whom the character follows this round, and each one
// they may mark with why not.
export type FollowControls = { marked: string; options: { id: string; name: string; bar: string | null }[] }

export function getFollowControls(state: SceneState, id: string): FollowControls {
  return { marked: state.following[id] ?? '', options: getFollowOptions(state, id) }
}

// What the follow entry of the action list says: the name of whoever the
// character has marked, or '', and why nothing can be marked now, null while
// something can be or a mark can be taken back.
export type FollowOffer = { marked: string; bar: string | null }

export function getFollowOffer(state: SceneState, id: string): FollowOffer | null {
  const { marked, options } = getFollowControls(state, id)
  if (options.length === 0) return null
  const name = options.find((o) => o.id === marked)?.name ?? ''
  return { marked: name, bar: name || options.some((o) => o.bar === null) ? null : options[0].bar }
}

// Why the round cannot pass, as the button says it: an action under way is
// named with whoever it still waits on to react or pass.
export const getNextRoundNote = perState((state: SceneState): string | null => getOpenNote(state) ?? getNextRoundBar(state))

// combat.tex "End of the round": agreeing to end it for all of the characters
// at once: whether all have agreed, whether that can be taken back, why
// neither can be pressed now, and the AP each would leave unspent (what a
// surge they have not made would give them with it, where one gives any).
export type EndRoundView = { bar: string | null; agreed: boolean; canTakeBack: boolean; lost: { id: string; name: string; AP: number; surge: boolean }[] }

export function getEndRoundView(state: SceneState, ids: readonly string[]): EndRoundView {
  const own = ids.filter((id) => state.characters[id])
  const waiting = own.filter((id) => !hasAgreedToEnd(state, id))
  const agreed = waiting.length === 0
  const canTakeBack = agreed && own.some((id) => state.agreedToEnd.includes(id))
  const bar = !isCombatStarted(state) ? 'combat has not started' : own.length === 0 ? 'none of your characters is in the fight' : getRoundChangeBar(state) ?? (agreed && !canTakeBack ? 'none of your characters has anything left this round' : null)
  return {
    bar, agreed, canTakeBack,
    lost: waiting.map((id) => {
      const c = state.characters[id]
      return { id, name: getFightName(state, id), AP: Math.max(0, c.resources.AP), surge: surgeKinds.some((kind) => canSurge(kind)(c) && getSurgeAP(kind)(c) > 0) }
    }),
  }
}

// What passing the round leaves nobody able to do, a line each, so that
// nobody misses a chance by it: turns, for whoever agreed to end the round
// with AP or a surge left, and the preparations, which lapse with it.
export const getNextRoundClosing = perState((state: SceneState): string[] => {
  if (state.round === 0) return []
  const unspent = state.agreedToEnd.flatMap((id) => {
    const c = state.characters[id]
    if (!c || isDead(c) || hasAffliction(c, 'unconscious') || !hasAPLeft(c)) return []
    return [`${getFightName(state, id)} takes no more turns this round, with ${c.resources.AP > 0 ? `${c.resources.AP} AP` : 'a surge'} left`]
  })
  return [...unspent, ...getPreparedRows(state).map((p) => `${p.actor}'s preparation lapses: ${p.text}`)]
})

// Why the combat cannot end, said the same way.
export const getEndCombatNote = perState((state: SceneState): string | null => {
  const bar = getEndCombatBar(state)
  return bar && (getOpenNote(state) ?? bar)
})

function getOpenNote(state: SceneState): string | null {
  const open = getOpenAction(state)
  if (!open) return null
  const what = `${getFightName(state, open.actorId)}'s ${getActionNoun(open)}`
  const awaited = getAwaited(state)
  return awaited.length > 0 ? `${what} waits on ${awaited.map((id) => getFightName(state, id)).join(', ')} to react or pass` : `${what} is being played out`
}
