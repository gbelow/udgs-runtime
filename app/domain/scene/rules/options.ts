import { getDiceBar } from '../../play/calls'
import { isCombatStarted } from './started'
import { ABILITIES } from '../../abilities'
import { COUNTERSPELL, getCounterspellBar } from './counterspell'
import type { CampaignCharacter, SurgeKind } from '../../types'
import { getMedicineBar, getMedicineCost } from './medicine'
import { getTakeableHeld } from '../../item/rules/doses'
import { getGearMoveBlock, getGearMoveCost, getGearMoves } from '../../item/rules/moves'
import type { Action, ActionDraft, ActionKind, ActionOf, SceneState, DeclarableKind, RootAction, SocialSay } from '../types'
import { getSocialCost, getSocialSayBar, getTauntBar } from './social'
import { getStressSocial } from './stress'
import { ACTIONS, getActionDef, reactsTo } from './actionCatalog'
import { hasAffliction, isDead } from '../../character/rules/afflictions'
import { ActionCost, getActionCost } from '../../character/rules/actionCosts'
import { canAfford, CANNOT_AFFORD, NOT_ENOUGH_AP } from '../../character/rules/cost'
import { getActiveSpellKeys, hasGrant } from '../../character/rules/effects'
import { getMovementOptions, hasJumpSpace, isMidJump } from './move'
import { getHangingFall } from './board/cliff'
import { isProne } from './board/ground'
import { getPushAnswerCost } from './drag'
import { getTriggersFor } from './reactions'
import { getHoldBackTargets, getManeuverCost, getManeuversOf, getManeuverTargets, getReleaseTargets } from './grapple'
import { getPartners, getGrapples, isHeld, isTether } from './partners'
import { getPullTargets, getSlipCost, getSlipTargets } from './tether'
import { getFeintBar } from './feint'
import { getExtinguishCells } from './extinguish'
import { getPlantableShields } from './plant'
import { canPickUp } from './floor'
import { getLootCost, getOpenables, getReachableLoot } from './loot'
import { getStealable } from './steal'
import { canThrowItem, getThrowCost, getThrowables } from './throw'
import { getOpportunityBar, getOpportunityCheck, getOwnCost, getPayableCost, isAnswerable, isDeclarationComplete, isUsedOutsideGrapple, canPayAll, withoutReserve, withRefund } from './action'
import { getAnswerDrafts, getModifierToggles } from './modifiers'
import { isGuardPlaced, isStandingGuard } from './protect'
import { getCombinedOf } from './combinedMove'
import { makeAction } from '../factories'
import { perState } from '../../perState'
import { getFightName } from './fighters'
import { canAnswer, getLiveActions, getLiveReactionsTo, getOpenAction, getReactionsTo, withLiveActions } from './log'
import { defRows, explosionBlockRows, getFreeAttackOptions, guardRows, getRowBar } from './attack'
import { getReloadBar, getReloadRows } from './reload'
import { getHeldOf } from './hold'
import { getReloadCost } from '../../character/rules/gear'
import { getSpellOptions } from './cast'
import { isSpellKey } from '../../spells'
import { getFireAgainBar, getFireAgainOptions, getRepeatCost } from './fireAgain'
import { bettersAnswer, getFleeBarFor, getSurgeBarFor, getSurgeProbes, getSurgeVariant, withoutAnswerSurge } from './surge'
import { getFleeBar, getFleeCost } from './flee'
import { isJoinInRange } from './coordinated'
import { findPrepared, getPreparedBar } from './prepared'
import { SHOTS, SURGES } from '../../tables'
import { isInTurn } from './turn'
import { isConcentrating } from '../../character/rules/concentration'
import { NEEDS_FOCUS, getBindingSurge, getSurgeBar, getSurgeGivenUp, isLearnedSurge, type EarmarkedSurge } from '../../character/rules/surge'
import { canAffordRest } from '../../character/rules/rest'
import { getIncomingAP, getRoundChangeActBar, getRoundPhase } from './roundChange'
import { getChaseRestBar } from './chase'
import { hasFightAffliction, isCollapsed, isImmobile, isSuffocating } from './situational'
import { getSidestepBar } from './sidestep'
import { getPrepareCost } from './cunning'

// What can be declared: every action and reaction open to a character right
// now, each available or closed with the reason, so a command can refuse
// exactly what the list shows as closed.

export type ActionOption = {
  draft: ActionDraft
  cost: ActionCost | null
  available: boolean
  reason: string | null
  // the open action this option answers, for a reaction; null for an action
  reactionTo: string | null
  // a reaction the character has already declared
  chosen: boolean
  // the surge that opens it, where only a surge does: made first, for a
  // reaction; to be made by the character, for an action of their own
  surge: SurgeKind | null
  // the earmarked surge whose AP left it gives up as it is declared, being
  // something that surge does not allow
  givesUp: EarmarkedSurge | null
}

function option(draft: ActionDraft, cost: ActionCost | null, reason: string | null, reactionTo: string | null = null, chosen = false): ActionOption {
  return { draft, cost, available: reason === null, reason, reactionTo, chosen, surge: null, givesUp: null }
}

// combat.tex "Grapple" — "Attack and Defend": "It is not possible to evade or
// block attacks, only intercept." — between the partners; a grapple stops
// movement, so a grappled defender cannot jump from anyone. combat.tex
// "Evasive Jump": "only ... if there is space to jump"; "jumping": a jump "cannot be voluntarily
// interrupted in the middle". combat.tex "Prone": "Can only crawl and stand
// up"; "Lame": "Cannot ... jump". abilities.tex "Technical Lift": an
// evasive jump made from the ground as one (`lifting`).
function defenseGate(state: SceneState, defender: CampaignCharacter, root: Action, kind: ActionKind, cost: ActionCost, lifting = false): string | null {
  if (!canAfford(defender, cost, isCombatStarted(state))) return CANNOT_AFFORD
  if (hasAffliction(defender, 'unconscious')) return 'unconscious'
  if (isImmobile(state, defender)) return 'immobile'
  if (reactsTo(kind, 'strike') && kind !== 'intercept' && kind !== 'counterattack' && getPartners(state, defender.id).includes(root.actorId)) return 'grappled'
  if (kind === 'evasiveJump' && hasFightAffliction(state, defender, 'grappled')) return 'grappled'
  if (kind === 'evasiveJump' && isProne(state, defender.id) && !lifting) return 'prone'
  if (kind === 'evasiveJump' && hasAffliction(defender, 'lame')) return 'lame'
  if (kind === 'evasiveJump' && isMidJump(state, defender.id)) return 'mid-jump'
  if (kind === 'evasiveJump' && !hasJumpSpace(state, defender.id, root.actorId)) return 'no space to jump'
  return null
}

// A block or an intercept as it may be made against a strike: whether it
// can be made from where its defender stands, or from where the move it
// carries before its die will take them (rules/combinedMove.ts), and its
// price. Against anything else, as it stands.
function guardOption(state: SceneState, c: CampaignCharacter, root: Action, guard: ActionOf<'block'> | ActionOf<'intercept'>, gate: string | null): { cost: ActionCost; reason: string | null } {
  const cost = getOwnCost(state, guard) ?? getActionCost(c, guard.kind)
  if (root.kind !== 'strike') return { cost, reason: gate }
  const placed = getCombinedOf(c, guard)?.recipe.order === 'before' || isGuardPlaced(state, root, guard)
  const reason = gate ?? (!canAfford(c, cost, isCombatStarted(state)) ? CANNOT_AFFORD : placed ? null : guard.kind === 'intercept' ? 'out of short range' : 'off the line')
  return { cost, reason }
}

// Whether anyone, among `ids` (everyone by default), has an answer open to
// the committed action. With none, the table owes it nothing before its die.
export function hasOpenAnswer(state: SceneState, ids: readonly string[] = Object.keys(state.characters)): boolean {
  return ids.some((id) => getAvailableActions(state, id).some((o) => o.available))
}

// Whether the answer, once given, leaves its actor something to choose: what
// it strikes or shoots with and where it aims, or what it may be declared as
// besides.
function hasAnswerChoice(state: SceneState, answer: Action): boolean {
  return answer.kind === 'opportunityAttack' || answer.kind === 'counterattack' || answer.kind === 'joinShot' || getModifierToggles(state, answer).length > 0
}

// The answers to the committed action whose actors have something to choose in
// them and have not said they are done (`confirmed`).
export const getUnconfirmedAnswers = perState((state: SceneState): Action[] => {
  const open = getOpenAction(state)
  if (!open || !isAnswerable(state, open)) return []
  return getLiveReactionsTo(state, open.id).filter((r) => !r.confirmed && hasAnswerChoice(state, r))
})

// Those of them with everything declared that they ask for, which their actors
// may confirm.
export function getConfirmable(state: SceneState): Action[] {
  return getUnconfirmedAnswers(state).filter((r) => isDeclarationComplete(state, state.characters[r.actorId], r))
}

// Who the committed action still waits on before its die is thrown or its
// price paid: everyone with an answer open to it who has neither declared
// one nor said they will not (`passed`), or who is not done with theirs
// (`getUnconfirmedAnswers`).
export const getAwaited = perState((state: SceneState): string[] => {
  const open = getOpenAction(state)
  if (!open || !isAnswerable(state, open)) return []
  const answered = new Set(getLiveReactionsTo(state, open.id).map((r) => r.actorId))
  const unconfirmed = new Set(getUnconfirmedAnswers(state).map((r) => r.actorId))
  return Object.keys(state.characters).filter((id) => unconfirmed.has(id) || (!answered.has(id) && !open.passed.includes(id) && hasOpenAnswer(state, [id])))
})

// Why the committed action cannot be rolled or paid for yet, or null: a die
// the table has called for, someone who has not answered, a reaction not yet
// finished, or an action nobody can pay for.
export function getGoBar(state: SceneState, root: Action): string | null {
  const dice = getDiceBar(state.calls)
  if (dice) return dice
  const unfinished = getUnfinishedAnswers(state, root)[0]
  if (unfinished) return `${getFightName(state, unfinished.actorId)}'s ${getActionDef(unfinished.kind).label} is not finished${unfinished.kind === 'opportunityAttack' ? `: ${getOpportunityBar(state, state.characters[unfinished.actorId], unfinished)}` : ''}`
  const awaited = getAwaited(state)
  if (awaited.length > 0) return `waiting on ${awaited.map((id) => getFightName(state, id)).join(', ')}: each answers and is done, or picks nothing`
  const reactions = getReactionsTo(state, root.id)
  // whoever is shown only as a token has no AP to read: whether they can pay is
  // the table's to say
  const broke = [root, ...reactions].find((a) => !state.characters[a.actorId]?.shown && getPayableCost(state, a) === null)
  return broke ? `${getFightName(state, broke.actorId)} cannot pay for the ${getActionDef(broke.kind).label}` : null
}

// The answers to the root declared and not finished: who gave them still owes
// the table the rest. Whoever is shown only as a token has no sheet to judge
// theirs by, and one they said they are done with was finished on the table's.
export function getUnfinishedAnswers(state: SceneState, root: Action): Action[] {
  return getReactionsTo(state, root.id).filter((r) => {
    const c = state.characters[r.actorId]
    return !(c?.shown && r.confirmed) && !isDeclarationComplete(state, c, r)
  })
}

// Whose answer holds the action at `react`: not given yet, or given and not
// finished.
export const getAnswersOwed = perState((state: SceneState): string[] => {
  const open = getOpenAction(state)
  if (open?.step !== 'react') return []
  return [...new Set([...getAwaited(state), ...getUnfinishedAnswers(state, open).map((r) => r.actorId)])]
})

// Everything the character may declare right now: their own actions while no
// action is open and it is their turn, and their reactions while a committed
// action triggers something in them and is still waiting for its die. A
// reaction's options are one per thing it can be done with, so a block names
// the weapon it blocks with. While a surge's AP is left, only what it allows
// is open.
export function getAvailableActions(state: SceneState, characterId: string): ActionOption[] {
  const byCharacter = listed.get(state) ?? new Map<string, ActionOption[]>()
  const known = byCharacter.get(characterId)
  if (known) return known
  const options = computeAvailableActions(state, characterId)
  byCharacter.set(characterId, options)
  listed.set(state, byCharacter)
  return options
}

// A state is replaced, never changed, so what a character may declare in it is
// worked out once; the panel, the commands that refuse what it shows closed and
// whoever asks "can anyone answer" all read the same list.
const listed = new WeakMap<SceneState, Map<string, ActionOption[]>>()

// The options open to the character now, as the buttons offer them: what
// `getAvailableActions` lists open, without listing what it would only show
// closed. With no action open, a surge opens none of their own (it only marks
// one as needing it), and out of their turn only what is open out of turn
// can be.
export function getOpenOptions(state: SceneState, characterId: string): ActionOption[] {
  const known = listed.get(state)?.get(characterId)
  if (known) return known.filter((o) => o.available)
  const c = state.characters[characterId]
  if (!c) return []
  if (getOpenAction(state)) return getAvailableActions(state, characterId).filter((o) => o.available)
  const kinds = isCombatStarted(state) && !isInTurn(state, c.id) ? OPEN_OUT_OF_TURN : undefined
  return closeWhileDiceWait(state, listOwn(state, c, kinds)).filter((o) => o.available)
}

function computeAvailableActions(state: SceneState, characterId: string): ActionOption[] {
  return closeWhileDiceWait(state, listAvailableActions(state, characterId))
}

function listAvailableActions(state: SceneState, characterId: string): ActionOption[] {
  const c = state.characters[characterId]
  if (!c) return []
  const open = getOpenAction(state)

  if (!open) return withSurges(state, c, c, listOwn(state, c), (on, surged, kinds) => listOwn(on, surged, kinds), false)

  if (!isAnswerable(state, open) || !canAnswer(open, characterId) || isDead(c)) return []
  // an answer already given is weighed against any other as if its surge were
  // yet to be made
  const before = withoutAnswerSurge(state, open.id, characterId)
  const own = before.characters[characterId]
  const made = getReactionsTo(state, open.id).find((r) => r.actorId === characterId)?.surged?.kind ?? null
  const answers = withSurges(before, own, withRefund(before, withoutReserve(before, own, open.id), open.id), getAnswers(before, own, open), (on, surged, kinds) => getAnswers(on, surged, open, kinds), true)
    .map((o) => (o.chosen && before !== state && o.surge !== made ? { ...o, chosen: false } : o))
  // the user's ruling: an action being held over draws only the opportunity
  // attacks its declaring triggers (combat.tex "Opportunity Attack": "any
  // actions that require concentration"); it is defended against once it is
  // taken up, released or finished
  return 'holding' in open && open.holding ? answers.filter((o) => o.draft.kind === 'opportunityAttack') : answers
}

// Each answer once, with every way it may be made: with no surge, or on one.
// It is made, unless another way is picked, the way it was given, else the
// first way open, no surge before any surge. A surge only an ability gives
// makes the answer with the move its recipe carries (abilities.tex
// "Protection Surge"), so that way is the same answer as the one without it.
export type AnswerWays = { answer: ActionOption; ways: ActionOption[] }

function answerOf(o: ActionOption): ActionDraft {
  return o.surge && isLearnedSurge(o.surge) && 'recipe' in o.draft ? { ...o.draft, recipe: undefined } : o.draft
}

export function getAnswerWays(options: readonly ActionOption[]): AnswerWays[] {
  const answers: ActionOption[][] = []
  for (const o of options) {
    const same = answers.find((ways) => sameDraft(answerOf(ways[0]), answerOf(o)))
    if (same) same.push(o)
    else answers.push([o])
  }
  return answers.map((found) => {
    const ways = [...found].sort((a, b) => Number(a.surge !== null) - Number(b.surge !== null))
    return { answer: ways.find((o) => o.chosen) ?? ways.find((o) => o.available) ?? ways[0], ways }
  })
}

// The answers with each listed once, made the way it is unless another is
// picked.
export function getDefaultAnswers(options: readonly ActionOption[]): readonly ActionOption[] {
  return getAnswerWays(options).map((a) => a.answer)
}

// The character's own options, of the kinds named (all of them by default).
function listOwn(state: SceneState, c: CampaignCharacter, kinds?: ReadonlySet<ActionKind>): ActionOption[] {
  const own = (Object.keys(OWN_OPTIONS) as DeclarableKind[]).filter((kind) => !kinds || kinds.has(kind))
  return withGivingUp(state, c, closeOwn(state, c, own.flatMap((kind) => OWN_OPTIONS[kind](state, c))), (on, givenUp, barred) => listOwn(on, givenUp, barred))
}

// The table's ruling: what an earmarked surge's AP left do not allow is not
// closed by them, but declared on what the character holds besides, the
// surge given up as it is (`givesUp`). Each such option is listed again on the
// fight with the surge given up, and stays closed where it is closed there.
function withGivingUp(state: SceneState, c: CampaignCharacter, now: ActionOption[], list: ListFor): ActionOption[] {
  const surge = getBindingSurge(c)
  const bar = getSurgeBar(c)
  const barred = now.filter((o) => !o.available && o.reason === bar)
  if (!surge || barred.length === 0) return now
  const givenUp = getSurgeGivenUp(c)
  const relisted = list({ ...state, characters: { ...state.characters, [c.id]: givenUp } }, givenUp, new Set(barred.map((o) => o.draft.kind)))
  return now.map((o) => {
    if (!barred.includes(o)) return o
    const found = relisted.find((a) => a.available && a.surge === o.surge && sameDraft(a.draft, o.draft))
    return found ? { ...found, chosen: o.chosen, givesUp: surge } : o
  })
}

// What stands closed among the character's own actions: who they are, what they
// are doing, what surge is in hand, whose turn it is.
function closeOwn(state: SceneState, c: CampaignCharacter, options: ActionOption[]): ActionOption[] {
  return closeWhileDiceWait(state, closeByRoundChange(state, closeOutOfTurn(state, c, closeWhileFleeing(state, c, closeBySurge(state, c, closeWhileForced(state, c, closeWhileHolding(state, c, closeWhileConcentrating(c, closeIfCollapsed(state, c, closeIfImmobile(state, c, closeIfUnconscious(c, options)))))))))))
}

// The table's ruling: while the scene waits on a die it called for, nothing
// else is declared.
function closeWhileDiceWait(state: SceneState, options: ActionOption[]): ActionOption[] {
  const bar = getDiceBar(state.calls)
  return bar ? closeWith(options, () => bar) : options
}

// combat.tex "Feint": the one a feint forced to take their turn chooses
// their action surge before anything else.
const CHOOSE_A_SURGE = 'choose an action surge first'

function closeWhileForced(state: SceneState, c: CampaignCharacter, options: ActionOption[]): ActionOption[] {
  return state.forcedSurge === c.id && c.usedSurge === null ? closeWith(options, () => CHOOSE_A_SURGE) : options
}

// combat.tex "Actions": "Only one action can be done at a time", and
// "Concentration": "Concentration is maintained while the action is not
// finished" — a character holding an action over to the next round does
// nothing else; their reactions give it up (combat.tex "Interruption").
function closeWhileHolding(state: SceneState, c: CampaignCharacter, options: ActionOption[]): ActionOption[] {
  const held = getHeldOf(state, c.id)
  return held ? closeWith(options, () => `holding ${getActionDef(held.kind).label}`) : options
}

// combat.tex "Action surge": an option closed now that a surge the character
// may make now would open is marked with that surge (`getSurgeProbes`). A
// reaction so marked is open — the surge made first, then the reaction; an
// action of their own stays closed until they make it. A surge only an
// ability gives may give an answer nothing else does (abilities.tex
// "Protection Surge": the defense that repositions for it), which is listed
// with it; and the protection surge opens nothing but that defense
// (`isSurgeFor`).
//
// A surge changes nothing but the character (`getSurged`): their AP and STA,
// and which surge they have made. So an option is asked about only where a
// surge could open it: closed for its price (one the payer cannot pay, or
// no single price to tell by), or until a surge is made; never one closed
// by whose turn it is, a die the table waits on, the round change, or the
// character immobile, collapsed or unconscious. Each surge is asked on this same fight,
// with the character as it would leave them, and only of the kinds with
// such an option. A surge only an ability gives is asked on the fight with
// the surge made, of every kind: what it gives is read off the character in
// the fight (`getAnswerDrafts`). `payer` is the character as they pay.
type ListFor = (on: SceneState, surged: CampaignCharacter, kinds?: ReadonlySet<ActionKind>) => ActionOption[]

// the closures a surge may lift whatever the option's price reads: a price
// paid by a stricter reckoning than its cost (rest, social), and what stays
// closed until a surge is made
const LIFTED_BY_A_SURGE: ReadonlySet<string | null> = new Set([CANNOT_AFFORD, NOT_ENOUGH_AP, CHOOSE_A_SURGE, NEEDS_FOCUS])

// An answer is listed once for each surge that would open it (a movement
// surge and a reaction surge both may), the surge it is pressed with, the
// reaction surge's first and the movement surge's last; an action of their own
// is marked with the first. An answer that is open without one is listed on
// each surge that betters it too, after itself (`bettersAnswer`).
function withSurges(state: SceneState, c: CampaignCharacter, payer: CampaignCharacter, now: ActionOption[], list: ListFor, opens: boolean): ActionOption[] {
  const probed = getSurgeProbes(state, c, opens)
  const rank = (p: { kind: SurgeKind }) => (p.kind === 'reaction' ? 0 : p.kind === 'movement' ? 2 : 1)
  const surges = opens ? [...probed].sort((a, b) => rank(a) - rank(b)) : probed
  const giving = opens && surges.some((p) => isLearnedSurge(p.kind))
  const bettered = opens ? surges.filter((p) => !isLearnedSurge(p.kind)).flatMap((p): ActionOption[] => {
    const surged = p.state.characters[c.id]
    const kinds = new Set(now.filter((o) => o.available && bettersAnswer(c, surged, o.draft.kind)).map((o) => o.draft.kind))
    return kinds.size === 0 ? [] : list(state, surged, kinds).filter((a) => a.available && now.some((o) => o.available && sameDraft(o.draft, a.draft))).map((a) => ({ ...a, surge: p.kind }))
  }) : []
  const withBettered = (o: ActionOption): ActionOption[] => (o.available ? [o, ...bettered.filter((b) => sameDraft(b.draft, o.draft))] : [o])
  if (now.every((o) => o.available) && !giving) return now.flatMap(withBettered)
  const fixed = new Set([NOT_YOUR_TURN, IMMOBILE, COLLAPSED, UNCONSCIOUS, getDiceBar(state.calls), getRoundChangeActBar(state)])
  const charged = isCombatStarted(state)
  const liftable = (o: ActionOption) => !o.available && !fixed.has(o.reason) && (o.cost === null || !canAfford(payer, o.cost, charged) || LIFTED_BY_A_SURGE.has(o.reason))
  const closed = new Set(now.filter(liftable).map((o) => o.draft.kind))
  if (closed.size === 0 && !giving) return now.flatMap(withBettered)
  const probes = surges.map((p) => {
    const surged = p.state.characters[c.id]
    const listed = opens && isLearnedSurge(p.kind) ? list(p.state, surged) : list(state, surged, closed)
    return { kind: p.kind, options: listed.filter((a) => a.available && isSurgeFor(c, p.kind, a.draft)) }
  })
  const opened = now.flatMap((o): ActionOption[] => {
    if (o.available) return withBettered(o)
    const via = probes.flatMap(({ kind, options }) => options.filter((a) => sameDraft(a.draft, o.draft)).slice(0, 1).map((a) => ({ ...a, surge: kind })))
    if (via.length === 0) return [o]
    return opens ? via : [{ ...o, surge: via[0].surge, reason: 'needs a surge' }]
  })
  if (!giving) return opened
  const given = probes.filter((p) => isLearnedSurge(p.kind)).flatMap(({ kind, options }) => options.map((a) => ({ ...a, surge: kind })))
  return [...opened, ...given.filter((a, i) => !now.some((o) => sameDraft(o.draft, a.draft)) && given.findIndex((b) => sameDraft(b.draft, a.draft)) === i)]
}

// abilities.tex "Protection Surge": the surge is made with the defense that
// repositions for it, and nothing else (the table's ruling: the move is what
// makes it one). Any other surge opens whatever it opens.
function isSurgeFor(c: CampaignCharacter, kind: SurgeKind, draft: ActionDraft): boolean {
  return kind !== 'protection' || getCombinedOf(c, draft)?.recipe.openWhen === 'protectionSurge'
}

function getAnswers(state: SceneState, answerer: CampaignCharacter, open: RootAction, kinds?: ReadonlySet<ActionKind>): ActionOption[] {
  const options = listAnswers(state, answerer, open, kinds)
  const closed = open.kind === 'drag' ? closeIfPushUnpayable(state, answerer.id, open, options) : options
  return withGivingUp(state, answerer, closed, (on, givenUp, barred) => getAnswers(on, givenUp, open, barred))
}

// combat.tex "Push and drag": what the pusher pays for walking the block
// depends on what the others declare, so a help or a resist that would leave
// the push or any answer to it beyond its payers is not open.
function closeIfPushUnpayable(state: SceneState, characterId: string, open: RootAction, options: ActionOption[]): ActionOption[] {
  if (!canPayAll(state, open)) return options
  const others = getLiveActions(state).filter((a) => !(a.reactionTo === open.id && a.actorId === characterId))
  return options.map((o) => {
    if (!o.available) return o
    const probe = makeAction(o.draft.kind, { ...o.draft, id: '', actorId: characterId, reactionTo: open.id })
    return canPayAll(withLiveActions(state, [...others, probe]), open) ? o : { ...o, available: false, reason: 'the push could not pay for it' }
  })
}

function listAnswers(state: SceneState, answerer: CampaignCharacter, open: RootAction, kinds?: ReadonlySet<ActionKind>): ActionOption[] {
  const reserved = withoutReserve(state, answerer, open.id)
  const refunded = withRefund(state, reserved, open.id)
  const characterId = refunded.id
  const charged = isCombatStarted(state)
  const declared = getReactionsTo(state, open.id).find((r) => r.actorId === characterId) ?? null
  const chosen = (draft: ActionDraft) => declared !== null && sameDraft(draft, declared)

  return closeBySurge(state, refunded, closeIfCollapsed(state, refunded, closeIfImmobile(state, refunded, closeIfUnconscious(refunded, getTriggersFor(state, open, characterId).filter((trigger) => !kinds || kinds.has(trigger.kind)).flatMap((trigger): ActionOption[] => {
    const kind = trigger.kind
    // what giving up an action of their own refunds, for the answers that give it up
    const c = withRefund(state, reserved, open.id, kind)
    const price = ACTIONS[kind].price
    const cost = open.kind === 'drag' ? getPushAnswerCost(state, open, { kind, actorId: c.id }) : price ? getActionCost(c, price) : { AP: 0, STA: 0 }
    const gate = defenseGate(state, c, open, kind, cost)
    const answer = (draft: ActionDraft, own: ActionCost | null = cost, reason: string | null = gate): ActionOption =>
      option(draft, own, reason, open.id, chosen(draft))
    // the answer as each modifier offered as an answer of its own makes it
    // (rules/modifiers.ts)
    const modified = (plain: ActionDraft): ActionOption[] => getAnswerDrafts(state, c.id, open.id, plain).map((draft) => {
      const own = getOwnCost(state, makeAction(draft.kind, { ...draft, id: '', actorId: c.id, reactionTo: open.id } as Parameters<typeof makeAction>[1])) ?? cost
      return answer(draft, own, defenseGate(state, c, open, kind, own, getCombinedOf(c, draft)?.recipe.movement === 'stand'))
    })
    // combat.tex "Protect", "Guard": a defense prepared for an ally, made with
    // the row it was prepared with, from where the movement it carries has put
    // its preparer — which is walked before the die, not now
    if (trigger.preparedId && (kind === 'block' || kind === 'intercept' || kind === 'guard')) {
      const prepared = findPrepared(state, trigger.preparedId)
      if (!prepared) return []
      const draft = { kind, weaponKey: prepared.weaponKey, attack: prepared.attack, preparedId: prepared.id }
      return [answer(draft, cost, gate ?? getPreparedBar(state, c, prepared) ?? seizedReason(state, makeAction(kind, { ...draft, id: '', actorId: c.id, reactionTo: open.id })))]
    }
    switch (kind) {
      case 'block':
      case 'intercept':
        return defRows(c).flatMap((row) => {
          const plain: ActionDraft = { kind, weaponKey: row.wielded.key, attack: row.atk.name }
          return [plain, ...getAnswerDrafts(state, c.id, open.id, plain)].map((draft) => {
            const guard = makeAction(kind, { ...draft, id: '', actorId: c.id, reactionTo: open.id } as Parameters<typeof makeAction>[1])
            const { cost: own, reason } = guardOption(state, c, open, guard, gate)
            return answer(draft, own, reason ?? seizedReason(state, guard))
          })
        })
      // A guard that carries a move (rules/combinedMove.ts) is made from
      // where it ends; any other from where its guard stands.
      case 'guard':
        return guardRows(state, c, open).flatMap((row) => {
          const plain: ActionDraft = { kind, weaponKey: row.wielded.key, attack: row.atk.name }
          return [plain, ...getAnswerDrafts(state, c.id, open.id, plain)].map((draft) => {
            const guard = makeAction(kind, { ...draft, id: '', actorId: c.id, reactionTo: open.id } as Parameters<typeof makeAction>[1])
            const own = getOwnCost(state, guard) ?? cost
            const placed = getCombinedOf(c, guard)?.recipe.order === 'before' || isStandingGuard(state, open, c.id)
            return answer(draft, own, defenseGate(state, c, open, kind, own) ?? (placed ? null : 'not beside the target') ?? seizedReason(state, guard))
          })
        })
      // combat.tex "Explosion Block": only with a shield
      case 'blockExplosion':
        return explosionBlockRows(c).map((row) => {
          const draft = { kind, weaponKey: row.wielded.key, attack: row.atk.name }
          return answer(draft, cost, gate ?? seizedReason(state, makeAction(kind, { ...draft, id: '', actorId: c.id, reactionTo: open.id })))
        })
      // an evade of a trample opens a step, picked on the board once the
      // trample is paid; closed to one the mover ends on with nowhere to go
      case 'evade':
        return [answer({ kind }, cost, gate ?? getSidestepBar(state, open, c.id, cost.AP)), ...modified({ kind })]
      // nothing to pick among; where an evasive jump lands is picked on the
      // board, not here
      case 'evasiveJump':
        return [answer({ kind }), ...modified({ kind })]
      case 'brace':
      case 'evasion':
      case 'avoidExplosion':
      case 'resist':
        return [answer({ kind })]
      // combat.tex "Push and drag": a helper walks with the block, and may
      // "spend 2 AP to gain 5 force" besides
      case 'assist': {
        if (open.kind !== 'drag') return []
        const boosted = getPushAnswerCost(state, open, { kind, actorId: c.id, boost: true })
        return [answer({ kind }), answer({ kind, boost: true }, boosted, gate ?? (canAfford(c, boosted, charged) ? null : CANNOT_AFFORD))]
      }
      // combat.tex "Opportunity Attack": "The attack requires the normal AP
      // cost" — open to someone with a strike, or, against a grapple partner,
      // a maneuver, that can be fought as declared from where the mover will
      // be: each is tried as the reaction it would be declared as, and when
      // none passes the one that came nearest says why
      case 'opportunityAttack': {
        const probe = (fields: Partial<ActionOf<'opportunityAttack'>>) => makeAction('opportunityAttack', { id: '', actorId: c.id, targetId: trigger.against ?? open.actorId, reactionTo: open.id, at: trigger.at, ...fields })
        const catching = { sweep: false, catch: trigger.catchOnly === true, martialSpirit: false, tackle: false }
        const strikes = getFreeAttackOptions(state, c, 'strike').map((s) => probe({ weaponKey: s.weaponKey, attack: s.attack, variant: s.variant, modifiers: catching }))
        const maneuvers = getPartners(state, c.id).includes(open.actorId) ? getManeuversOf(c).map((maneuver) => probe({ mode: 'grapple', maneuver })) : []
        const checks = [...strikes, ...maneuvers].map((a) => getOpportunityCheck(state, c, a))
        const reason = checks.length === 0 ? 'no melee weapon in hand' : checks.some((k) => k.bar === null) ? null : checks.reduce((best, k) => (k.stage > best.stage ? k : best)).bar
        return [answer({ kind, at: trigger.at }, null, reason)]
      }
      // combat.tex "Push and drag": tagging along is paid in the movement of
      // the block; one with no AP to move stays put and counts passively,
      // or, held by nobody, lets go
      case 'carry':
        return [answer({ kind }, cost, gate ?? (canAfford(c, cost, charged) ? null : CANNOT_AFFORD))]
      case 'letGo': {
        return [answer({ kind }, cost, gate ?? (isHeld(getGrapples(state), c.id) ? 'held' : null))]
      }
      // a held spray aimed anew: open to whoever could fire it again, paid
      // from their own AP — the focus surge holding it took is the only
      // surge it needs
      case 'retarget': {
        const key = trigger.key
        if (!key || !isSpellKey(key)) return []
        return [answer({ kind, key, at: trigger.at }, getRepeatCost(key), isImmobile(state, c) ? 'immobile' : getFireAgainBar(state, c, key))]
      }
      // abilities.tex "Counterspell": the ability's price, open to whoever can
      // pay it and the Spiritual Strike it casts
      case 'counterspell': {
        const own = { AP: ABILITIES[COUNTERSPELL].cost.AP, STA: ABILITIES[COUNTERSPELL].cost.STA }
        return [answer({ kind, at: trigger.at }, own, gate ?? getCounterspellBar(c, isCombatStarted(state)))]
      }
      // combat.tex "Coordinated Shots": a shot of their own, so it is open
      // only to someone who can pay for one that reaches the target
      case 'joinShot': {
        const shots = getFreeAttackOptions(state, c, 'shoot')
        const reaching = shots.filter((s) => isJoinInRange(state, c.id, s, trigger.against ?? ''))
        const reason = shots.length === 0 ? getRowBar(c, 'shoot', charged)
          : reaching.length === 0 ? 'out of range'
          : reaching.some((s) => canAfford(c, { AP: s.AP, STA: s.STA }, charged)) ? null : 'cannot afford a shot'
        return [answer({ kind }, null, gate ?? reason)]
      }
      // abilities.tex "Counterattack": a strike of their own, so it is open
      // only to someone who can pay for one; "Archer's Reflexes": to a shot, a
      // quick shot of their own
      case 'counterattack': {
        if (open.kind === 'shoot') {
          const quick = getFreeAttackOptions(state, c, 'shoot').filter((s) => s.variant === SHOTS.quickShot.variant)
          const reason = quick.length === 0 ? 'no quick shot in hand' : quick.some((s) => canAfford(c, { AP: s.AP, STA: s.STA }, charged)) ? null : 'cannot afford a quick shot'
          return [answer({ kind, mode: 'shoot' }, null, gate ?? reason)]
        }
        const strikes = getFreeAttackOptions(state, c, 'strike')
        const reason = strikes.length === 0 ? 'no melee weapon in hand' : strikes.some((s) => canAfford(c, { AP: s.AP, STA: s.STA }, charged)) ? null : 'cannot afford a strike'
        return [answer({ kind }, null, gate ?? reason)]
      }
      // combat.tex "Flee": paid with the movement surge, made as it is
      // paid
      case 'flee':
        return [answer({ kind, at: trigger.at }, getFleeCost(c) ?? { AP: 0, STA: SURGES.movement.STA }, getFleeBar(state, c))]
      // combat.tex "Preparing a reaction": the action it was prepared as, paid
      // for as it is made, so it is open only to someone who can make it now
      case 'prepared': {
        const prepared = trigger.preparedId ? findPrepared(state, trigger.preparedId) : null
        if (!prepared) return []
        return [answer({ kind, preparedId: prepared.id, at: trigger.at }, null, getPreparedBar(state, c, prepared))]
      }
      // combat.tex "Follow": a move of the follower's own, so it is open only
      // to someone who can pay for one
      case 'follow': {
        const reason = getMovementOptions(state, c).some((m) => m.available && canAfford(c, m.block, charged)) ? null : 'cannot afford a move'
        return [answer({ kind }, null, reason)]
      }
    }
  })))))
}

// The actions a character may take on their own initiative, one entry per
// kind a player declares (`DeclarableKind`), each listing its options in
// the order the panel shows them.
type OwnOptions = (state: SceneState, c: CampaignCharacter) => ActionOption[]

const OWN_OPTIONS: { [K in DeclarableKind]: OwnOptions } = {
  strike: (state, c) => [option({ kind: 'strike' }, null, getFreeAttackOptions(state, c, 'strike').length > 0 ? null : 'no melee weapon in hand')],
  shoot: (state, c) => {
    const shots = getFreeAttackOptions(state, c, 'shoot')
    const reason = shots.length > 0 ? null : getRowBar(c, 'shoot', isCombatStarted(state))
    return [option({ kind: 'shoot' }, null, reason)]
  },
  move: (state, c) => {
    const movable = getMovementOptions(state, c).some((m) => m.available)
    return [option({ kind: 'move' }, null, !isPlaced(state, c) ? 'not on the board' : movable ? null : getMovementOptions(state, c).find((m) => m.reason)?.reason ?? 'cannot move')]
  },
  // a held spell fired again without the casting test (the table's ruling)
  fireAgain: (state, c) => getFireAgainOptions(state, c).map(({ key, reason }) => option({ kind: 'fireAgain', key }, getRepeatCost(key), reason)),
  // spells.tex "Sustained Spells": each held spell is let go of at will, for nothing
  releaseSpell: (_, c) => getActiveSpellKeys(c).map((key) => option({ kind: 'releaseSpell', key }, { AP: 0, STA: 0 }, null)),
  cast: (state, c) => {
    const spells = getSpellOptions(state, c)
    const castable = spells.some((s) => s.castable || s.quickenable)
    return [option({ kind: 'cast' }, null, castable ? null : spells.length > 0 ? 'no spell castable now' : 'no spell learned')]
  },
  // combat.tex "Grapple": what a character in a grapple can do about it — the
  // maneuvers, open to "any of the participants" whatever they hold; getting
  // up, which in a grapple is an escape; pushing or dragging; letting go of a
  // partner who does not hold back; grappling back one held with nothing, once
  // a grapple row is in hand. Nothing, outside of one.
  grapple: (state, c) => {
    if (!isInAnyGrapple(state, c)) return []
    return [
      ...getManeuversOf(c).map((m) => {
        const cost = getManeuverCost(c, m)
        return option({ kind: 'grapple', maneuver: m }, cost, getManeuverTargets(state, c.id, m).length === 0 ? 'nobody holds you' : afford(state, c, cost))
      }),
    ]
  },
  // combat.tex "Prone": "cannot push nor drag"
  // gear.tex "Net": a tether is pulled by either end, a grapple pushed or dragged
  drag: (state, c) => {
    const reason = !isPlaced(state, c) ? 'not on the board' : isProne(state, c.id) ? 'prone' : null
    return [
      ...(isInAnyGrapple(state, c) ? [option({ kind: 'drag' }, null, reason)] : []),
      ...(getPullTargets(state, c.id).length > 0 ? [option({ kind: 'drag', pull: true }, null, reason)] : []),
    ]
  },
  // combat.tex "Balance": a climber hanging on a face lets go and falls from
  // where they hang
  fall: (state, c) => {
    const fall = getHangingFall(state, c.id)
    return fall ? [option({ kind: 'fall', height: fall.height, to: fall.to }, { AP: 0, STA: 0 }, null)] : []
  },
  release: (state, c) => {
    if (!isInAnyGrapple(state, c)) return []
    return [option({ kind: 'release' }, { AP: 0, STA: 0 }, getReleaseTargets(state, c.id).length > 0 ? null : 'held back')]
  },
  // gear.tex "Equipment Breakage": a net is cut with a melee weapon in hand
  cut: (state, c) => {
    if (!state.binds.some(isTether)) return []
    return [option({ kind: 'cut' }, null, getFreeAttackOptions(state, c, 'strike').length > 0 ? null : 'no melee weapon in hand')]
  },
  // gear.tex "Net": a tethered character slips the net it was caught in
  slip: (state, c) => {
    if (getSlipTargets(state, c.id).length === 0) return []
    const cost = getSlipCost(c)
    return [option({ kind: 'slip' }, cost, afford(state, c, cost))]
  },
  // combat.tex "Turns and Actions" ("Feint"): a test against someone in melee
  feint: (state, c) => [option({ kind: 'feint' }, { AP: 0, STA: 0 }, getFeintBar(state, c))],
  holdBack: (state, c) => {
    if (!isInAnyGrapple(state, c) || getHoldBackTargets(state, c.id).length === 0) return []
    return [option({ kind: 'holdBack' }, { AP: 0, STA: 0 }, null)]
  },
  // combat.tex "Standard Action": "This is used to pick up items from the
  // floor".
  pickUp: (state, c) => {
    const cost = getActionCost(c, 'standardAction')
    const loot = getReachableLoot(state, c.id)
    const reason = state.floor.length === 0 && !Object.values(state.characters).some(isDead) ? 'nothing on the floor'
      : !loot.some((l) => canPickUp(c, l.item) && getLootCost(state, c, l) !== null) ? (loot.length > 0 ? 'no free hand' : 'nothing within reach')
      : canAfford(c, cost, isCombatStarted(state)) ? null : CANNOT_AFFORD
    return [option({ kind: 'pickUp' }, cost, reason)]
  },
  // combat.tex "Theft": "A standard action can be used to steal an item from
  // someone's body", with a hand free
  steal: (state, c) => {
    const cost = getActionCost(c, 'standardAction')
    const reachable = Object.keys(state.characters).flatMap((id) => getStealable(state, c.id, id))
    const reason = reachable.length === 0 ? 'nobody within reach carries anything'
      : !reachable.some((l) => canPickUp(c, l.item)) ? 'no free hand'
      : canAfford(c, cost, isCombatStarted(state)) ? null : CANNOT_AFFORD
    return [option({ kind: 'steal' }, cost, reason)]
  },
  // combat.tex "Standard Action": "open doors ... and perform other kinds of
  // object interactions" — a container lying within reach, or one a body wears
  open: (state, c) => {
    const cost = getActionCost(c, 'standardAction')
    const openable = getOpenables(state, c.id)
    const reason = openable.length === 0 ? 'nothing to open within reach'
      : openable.every((o) => o.opened) ? 'everything within reach is open'
      : canAfford(c, cost, isCombatStarted(state)) ? null : CANNOT_AFFORD
    return [option({ kind: 'open' }, cost, reason)]
  },
  // combat.tex "Throw", "Standard Action": something held or on the floor
  // in reach, at its throwing row's price or a standard action's
  throw: (state, c) => {
    const throwable = getThrowables(state, c).filter((item) => canThrowItem(c, item, isCombatStarted(state)))
    const reason = !isPlaced(state, c) ? 'not on the board'
      : throwable.length === 0 ? 'nothing it can throw'
      : throwable.some((item) => canAfford(c, getThrowCost(c, item.id, isCombatStarted(state)), isCombatStarted(state))) ? null : CANNOT_AFFORD
    return [option({ kind: 'throw' }, null, reason)]
  },
  // gear.tex "Potions and Medicine": "Potions require a standard action to
  // be consumed"
  drink: (state, c) => {
    const cost = getActionCost(c, 'standardAction')
    const reason = getTakeableHeld(c).bar ?? (canAfford(c, cost, isCombatStarted(state)) ? null : CANNOT_AFFORD)
    return [option({ kind: 'drink' }, cost, reason)]
  },
  // abilities.tex "Medicine": aimed at someone bleeding, self included
  firstAid: (state, c) => [option({ kind: 'firstAid' }, getMedicineCost('firstAid'), getMedicineBar(state, c, 'firstAid'))],
  cauterize: (state, c) => [option({ kind: 'cauterize' }, getMedicineCost('cauterize'), getMedicineBar(state, c, 'cauterize'))],
  // gear.tex "Reload": each row in hand that is reloaded, at its own price
  reload: (state, c) => getReloadRows(c).map((row) =>
    option({ kind: 'reload', weaponKey: row.wielded.key, attack: row.atk.name }, getReloadCost(row.atk, c), getReloadBar(state, c, row))),
  // combat.tex "Fire": a burning space the actor stands in or is next to
  extinguish: (state, c) => {
    const cost = getActionCost(c, 'extinguish')
    const reason = !isPlaced(state, c) ? 'not on the board'
      : getExtinguishCells(state, c.id).length === 0 ? 'nothing burning within reach'
      : afford(state, c, cost)
    return [option({ kind: 'extinguish' }, cost, reason)]
  },
  // abilities.tex "Crossbow and Shield": each body shield in hand, for a
  // standard action, by one who has learned to plant it
  plant: (state, c) => {
    if (!hasGrant(c, 'plantShield')) return []
    const cost = getActionCost(c, 'standardAction')
    const shields = getPlantableShields(c)
    if (shields.length === 0) return [option({ kind: 'plant' }, cost, 'no body shield in hand')]
    return shields.map((shield) => option({ kind: 'plant', itemId: shield.id }, cost, !isPlaced(state, c) ? 'not on the board' : afford(state, c, cost)))
  },
  // combat.tex "Drawing items in combat", "Putting items away": each move the
  // actor's gear offers that nothing but its price stands in the way of
  // (item/rules/moves.ts), at that price
  gear: (state, c) => {
    const charged = isCombatStarted(state)
    return getGearMoves(c).flatMap((move) => {
      if (getGearMoveBlock(c, move, charged) !== null) return []
      const cost = getGearMoveCost(c, move)
      return cost ? [option({ kind: 'gear', move }, cost, afford(state, c, cost))] : []
    })
  },
  // combat.tex "Preparing a reaction": 1 AP, whatever is prepared (free by
  // Strategist); it needs a board to be triggered on
  prepare: (state, c) => {
    const cost = getPrepareCost(state, c)
    return [option({ kind: 'prepare' }, cost, !isPlaced(state, c) ? 'not on the board' : afford(state, c, cost))]
  },
  // combat.tex "Rest"
  rest: (state, c) => {
    const cost = getActionCost(c, 'rest')
    return [option({ kind: 'rest' }, cost, isSuffocating(state, c) ? 'cannot breathe' : getChaseRestBar(state, c.id) ?? (canAffordRest(c, 'rest', isCombatStarted(state), getIncomingAP(state)) ? null : CANNOT_AFFORD))]
  },
  // combat.tex "Social actions": an insult only for the abusive compelled to
  // it, and the surrender flag raised or lowered, whichever it stands at
  social: (state, c) => {
    const says: SocialSay[] = ['intimidate', 'rally', 'negotiate', ...(getStressSocial(state, c.id) === 'insult' ? ['insult' as const] : []), state.surrendered.includes(c.id) ? 'unsurrender' : 'surrender']
    return says.map((say) => option({ kind: 'social', say }, getSocialCost(c, say), getSocialSayBar(state, c, say)))
  },
  taunt: (state, c) => [option({ kind: 'taunt' }, getActionCost(c, 'socialAction'), getTauntBar(state, c))],
}

function isPlaced(state: SceneState, c: CampaignCharacter): boolean {
  return state.board?.placements[c.id] !== undefined
}

function isInAnyGrapple(state: SceneState, c: CampaignCharacter): boolean {
  return getPartners(state, c.id).length > 0
}

function seizedReason(state: SceneState, action: Action): string | null {
  return isUsedOutsideGrapple(state, action) ? 'held in a grapple' : null
}

function afford(state: SceneState, c: CampaignCharacter, cost: ActionCost): string | null {
  return canAfford(c, cost, isCombatStarted(state)) ? null : CANNOT_AFFORD
}

const IMMOBILE = 'immobile'
const COLLAPSED = 'collapsed'
const UNCONSCIOUS = 'unconscious'

// combat.tex "Immobile": "Cannot move and cannot use any combat or movement
// skills other than escape."
function closeIfImmobile(state: SceneState, c: CampaignCharacter, options: ActionOption[]): ActionOption[] {
  if (!isImmobile(state, c)) return options
  return options.map((o) => (o.draft.kind === 'releaseSpell' || (o.draft.kind === 'grapple' && o.draft.maneuver === 'escape')) ? o : { ...o, available: false, reason: IMMOBILE })
}

// combat.tex "Collapsed": "cannot use any of the combat skills nor force"; how they
// may move is the move's own (rules/move.ts).
function closeIfCollapsed(state: SceneState, c: CampaignCharacter, options: ActionOption[]): ActionOption[] {
  return isCollapsed(state, c) ? closeWith(options, (o) => (getActionDef(o.draft.kind).combatOrForce ? COLLAPSED : null)) : options
}

// The unconscious do nothing but rest.
function closeIfUnconscious(c: CampaignCharacter, options: ActionOption[]): ActionOption[] {
  return hasAffliction(c, 'unconscious') ? closeWith(options, (o) => (o.draft.kind === 'rest' ? null : UNCONSCIOUS)) : options
}

function closeWith(options: ActionOption[], reasonFor: (o: ActionOption) => string | null): ActionOption[] {
  return options.map((o) => {
    const reason = o.available ? reasonFor(o) : null
    return reason ? { ...o, available: false, reason } : o
  })
}

// combat.tex "Action surge": an earmarked surge's AP is spent only on what
// the surge allows, and until it is, nothing else can be done.
// spells.tex "Sustained Spells": a caster holding a spell does nothing but
// cast what it lets them (rules/cast.ts `getSpellOptions` says which), or
// fire what they hold again, and no moving. A
// reaction is their own to give the spell up for (combat.tex "Give up
// action").
function closeWhileConcentrating(c: CampaignCharacter, options: ActionOption[]): ActionOption[] {
  return isConcentrating(c) ? closeWith(options, (o) => (o.draft.kind === 'cast' || o.draft.kind === 'fireAgain' || o.draft.kind === 'retarget' || o.draft.kind === 'releaseSpell' ? null : 'concentrating')) : options
}

function closeBySurge(state: SceneState, c: CampaignCharacter, options: ActionOption[]): ActionOption[] {
  return closeWith(options, (o) => getSurgeBarFor(state, c, o.draft.kind, getSurgeVariant(o.draft)))
}

// combat.tex "Flee": a flee turn allows only what the movement surge does.
function closeWhileFleeing(state: SceneState, c: CampaignCharacter, options: ActionOption[]): ActionOption[] {
  return closeWith(options, (o) => getFleeBarFor(state, c, o.draft.kind, getSurgeVariant(o.draft)))
}

// play.tex "Combat": a character acts in their own turn; outside it, only
// reactions and what they open — and a rest at the round change, the table's
// ruling. Before the combat has started there are no turns, and anyone acts.
const NOT_YOUR_TURN = 'not your turn'

// the kinds of one's own that `closeOutOfTurn` may leave open
const OPEN_OUT_OF_TURN: ReadonlySet<ActionKind> = new Set((Object.keys(OWN_OPTIONS) as DeclarableKind[]).filter((kind) => getActionDef(kind).rest || kind === 'social'))

function closeOutOfTurn(state: SceneState, c: CampaignCharacter, options: ActionOption[]): ActionOption[] {
  return !isCombatStarted(state) || isInTurn(state, c.id) ? options : closeWith(options, (o) => (getActionDef(o.draft.kind).rest && getRoundPhase(state) === 'rest') || isUnsurrender(o.draft) ? null : NOT_YOUR_TURN)
}

// combat.tex "Surrender": unflagged "at any time".
function isUnsurrender(draft: ActionDraft): boolean {
  return draft.kind === 'social' && draft.say === 'unsurrender'
}

function closeByRoundChange(state: SceneState, options: ActionOption[]): ActionOption[] {
  const bar = getRoundChangeActBar(state)
  return bar ? closeWith(options, () => bar) : options
}

// The option a draft would take, so a command can refuse exactly what the
// list shows as closed.
// The evasive jump open to the character: the one they have declared, or the
// first, made as whatever it may be made as (abilities.tex "Technical Lift"),
// if any.
export function findOpenJump(state: SceneState, characterId: string): ActionOption | null {
  const jumps = getAvailableActions(state, characterId).filter((o) => o.draft.kind === 'evasiveJump' && o.available)
  return jumps.find((o) => o.chosen) ?? jumps[0] ?? null
}

// The option the draft declares; `surge`, for an answer listed once per
// surge that opens it, the one pressed (any, when not said).
export function findOption(state: SceneState, characterId: string, draft: ActionDraft, surge?: SurgeKind | null): ActionOption | null {
  const c = state.characters[characterId]
  if (c && !getOpenAction(state) && draft.kind in OWN_OPTIONS) {
    return listOwn(state, c, new Set([draft.kind])).find((o) => sameDraft(o.draft, draft)) ?? null
  }
  return getAvailableActions(state, characterId).find((o) => sameDraft(o.draft, draft) && (surge === undefined || o.surge === surge)) ?? null
}

// A field holding a value made of fields (a gear move) is the same where it
// says the same.
function sameValue(a: unknown, b: unknown): boolean {
  return a === b || (a !== null && b !== null && typeof a === 'object' && typeof b === 'object' && JSON.stringify(a) === JSON.stringify(b))
}

// Two drafts are the same option when they are of one kind and agree on
// every field the catalog names as telling that kind's options apart.
function sameDraft(option: ActionDraft, draft: ActionDraft): boolean {
  if (option.kind !== draft.kind) return false
  return sameFields(option, draft, getActionDef(option.kind).identity ?? {})
}

// An identity field holding fields of its own (`modifiers`) is the same
// where each of those is; one holding a list, where both hold the same items.
function sameFields(a: unknown, b: unknown, identity: object): boolean {
  const field = (from: unknown, key: string): unknown => (from && typeof from === 'object' ? (from as Record<string, unknown>)[key] : undefined)
  const items = (from: unknown, unset: unknown[]): string => JSON.stringify([...((from as unknown[] | undefined) ?? unset)].sort())
  return Object.entries(identity).every(([key, unset]) => Array.isArray(unset)
    ? items(field(a, key), unset) === items(field(b, key), unset)
    : unset && typeof unset === 'object'
    ? sameFields(field(a, key), field(b, key), unset)
    : sameValue(field(a, key) ?? unset, field(b, key) ?? unset))
}
