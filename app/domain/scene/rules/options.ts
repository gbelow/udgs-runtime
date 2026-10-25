import { getDiceBar } from '../../play/calls'
import { isCombatStarted } from './started'
import type { CampaignCharacter, SurgeKind } from '../../types'
import { getMedicineBar, getMedicineCost } from './medicine'
import { getTakeableHeld } from '../../item/rules/doses'
import type { Action, ActionDraft, ActionKind, ActionOf, SceneState, DeclarableKind, RootAction, SocialSay } from '../types'
import { getSocialCost, getSocialSayBar, getTauntBar } from './social'
import { getStressSocial } from './stress'
import { ACTIONS, getActionDef, reactsTo } from './actionCatalog'
import { hasAffliction, isDead } from '../../character/rules/afflictions'
import { ActionCost, getActionCost } from '../../character/rules/actionCosts'
import { canAfford } from '../../character/rules/cost'
import { getActiveSpellKeys, hasGrant } from '../../character/rules/effects'
import { getMovementOptions, hasJumpSpace, isMidJump } from './move'
import { getHangingFall } from './board/cliff'
import { isInLiquid, isProne } from './board/ground'
import { getPushAnswerCost } from './drag'
import { getTriggersFor } from './reactions'
import { getHoldBackTargets, getManeuverCost, getManeuversOf, getManeuverTargets, getReleaseTargets } from './grapple'
import { getPartners, getGrapples, isHeld, isTether } from './partners'
import { getPullTargets, getSlipCost, getSlipTargets } from './tether'
import { getFeintBar } from './feint'
import { getExtinguishCells } from './extinguish'
import { getPlantableShields } from './plant'
import { canPickUp, getReachableFloor } from './floor'
import { canThrowItem, getThrowCost, getThrowables } from './throw'
import { getEvadeCost, getEvasiveJumpCost, getOpportunityBar, getOpportunityCheck, getPayableCost, isAnswerable, isDeclarationComplete, isUsedOutsideGrapple, canPayAll, withGuardStep, withoutReserve, withRefund } from './action'
import { getGuardSteps, isGuardPlaced, needsGuardStep } from './protect'
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
import { getFleeBarFor, getSurgeBarFor, getSurgeProbes } from './surge'
import { getFleeBar, getFleeCost } from './flee'
import { isJoinInRange } from './coordinated'
import { findPrepared, getPreparedBar } from './prepared'
import { SURGES } from '../../tables'
import { isInTurn } from './turn'
import { isConcentrating } from '../../character/rules/concentration'
import { canAffordRest } from '../../character/rules/rest'
import { getIncomingAP, getRoundChangeActBar, getRoundPhase } from './roundChange'
import { getChaseRestBar } from './chase'
import { hasFightAffliction, isImmobile, isSuffocating } from './situational'
import { getSidestepBar } from './sidestep'

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
}

function option(draft: ActionDraft, cost: ActionCost | null, reason: string | null, reactionTo: string | null = null, chosen = false): ActionOption {
  return { draft, cost, available: reason === null, reason, reactionTo, chosen, surge: null }
}

// combat.tex "Grapple" — "Attack and Defend": "It is not possible to evade or
// block attacks, only intercept." — between the partners; a grapple stops
// movement, so a grappled defender cannot jump from anyone. combat.tex
// "Evasive Jump": "only ... if there is space to jump"; "jumping": a jump "cannot be voluntarily
// interrupted in the middle". combat.tex "Prone": "Can only crawl and stand
// up"; "Lame": "Cannot ... jump".
// abilities.tex "Technical Lift": an evasive jump from the ground, which
// stands its jumper up; the water's surface is no ground to stand up from.
function canTechnicalLift(state: SceneState, c: CampaignCharacter): boolean {
  return hasGrant(c, 'technicalLift') && hasAffliction(c, 'prone') && !isInLiquid(state, c)
}

function defenseGate(state: SceneState, defender: CampaignCharacter, root: Action, kind: ActionKind, cost: ActionCost): string | null {
  if (!canAfford(defender, cost, isCombatStarted(state))) return 'cannot afford'
  if (hasAffliction(defender, 'unconscious')) return 'unconscious'
  if (isImmobile(state, defender)) return 'immobile'
  if (reactsTo(kind, 'strike') && kind !== 'intercept' && kind !== 'counterattack' && getPartners(state, defender.id).includes(root.actorId)) return 'grappled'
  if (kind === 'evasiveJump' && hasFightAffliction(state, defender, 'grappled')) return 'grappled'
  if (kind === 'evasiveJump' && isProne(state, defender.id) && !canTechnicalLift(state, defender)) return 'prone'
  if (kind === 'evasiveJump' && hasAffliction(defender, 'lame')) return 'lame'
  if (kind === 'evasiveJump' && isMidJump(state, defender.id)) return 'mid-jump'
  if (kind === 'evasiveJump' && !hasJumpSpace(state, defender.id, root.actorId)) return 'no space to jump'
  return null
}

// A block or an intercept as it may be made against a strike: whether it
// can be made from where its defender stands, or from a step they can
// still take (`needsGuardStep`), and its price with that step. Against
// anything else, as it stands.
function guardOption(state: SceneState, c: CampaignCharacter, root: Action, guard: ActionOf<'block'> | ActionOf<'intercept'>, gate: string | null): { cost: ActionCost; reason: string | null } {
  const cost = withGuardStep(c, guard, getActionCost(c, guard.kind))
  if (root.kind !== 'strike') return { cost, reason: gate }
  const stepping = needsGuardStep(state, root, guard)
  const placed = stepping || isGuardPlaced(state, root, guard)
  const priced = stepping && !(guard.kind === 'intercept' && guard.advance) ? withGuardStep(c, { ...guard, to: getGuardSteps(state, root, guard)[0] }, getActionCost(c, guard.kind)) : cost
  const reason = gate ?? (!canAfford(c, priced, isCombatStarted(state)) ? 'cannot afford' : placed ? null : guard.kind === 'intercept' ? 'out of short range' : 'off the line')
  return { cost: priced, reason }
}

// Whether anyone, among `ids` (everyone by default), has an answer open to
// the committed action. With none, the table owes it nothing before its die.
export function hasOpenAnswer(state: SceneState, ids: readonly string[] = Object.keys(state.characters)): boolean {
  return ids.some((id) => getAvailableActions(state, id).some((o) => o.available))
}

// Who the committed action still waits on before its die is thrown or its
// price paid: everyone with an answer open to it who has neither declared
// one nor said they will not (`passed`).
export const getAwaited = perState((state: SceneState): string[] => {
  const open = getOpenAction(state)
  if (!open || !isAnswerable(state, open)) return []
  const answered = new Set(getLiveReactionsTo(state, open.id).map((r) => r.actorId))
  return Object.keys(state.characters).filter((id) => !answered.has(id) && !open.passed.includes(id) && hasOpenAnswer(state, [id]))
})

// Why the committed action cannot be rolled or paid for yet, or null: a die
// the table has called for, someone who has not answered, a reaction not yet
// finished, or an action nobody can pay for.
export function getGoBar(state: SceneState, root: Action): string | null {
  const dice = getDiceBar(state.calls)
  if (dice) return dice
  const awaited = getAwaited(state)
  if (awaited.length > 0) return `waiting on ${awaited.map((id) => getFightName(state, id)).join(', ')}: each answers or picks nothing`
  const reactions = getReactionsTo(state, root.id)
  const unfinished = reactions.find((r) => !isDeclarationComplete(state, state.characters[r.actorId], r))
  if (unfinished) return `${getFightName(state, unfinished.actorId)}'s ${getActionDef(unfinished.kind).label} is not finished${unfinished.kind === 'opportunityAttack' ? `: ${getOpportunityBar(state, state.characters[unfinished.actorId], unfinished)}` : ''}`
  const broke = [root, ...reactions].find((a) => getPayableCost(state, a) === null)
  return broke ? `${getFightName(state, broke.actorId)} cannot pay for the ${getActionDef(broke.kind).label}` : null
}

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

function computeAvailableActions(state: SceneState, characterId: string): ActionOption[] {
  return closeWhileDiceWait(state, listAvailableActions(state, characterId))
}

function listAvailableActions(state: SceneState, characterId: string): ActionOption[] {
  const c = state.characters[characterId]
  if (!c) return []
  const open = getOpenAction(state)

  if (!open) return withSurges(state, c, listOwn(state, c), (s) => listOwn(s, s.characters[c.id]), false)

  if (!isAnswerable(state, open) || !canAnswer(open, characterId) || isDead(c)) return []
  return withSurges(state, c, getAnswers(state, c, open), (s) => getAnswers(s, s.characters[c.id], open), true)
}

function listOwn(state: SceneState, c: CampaignCharacter): ActionOption[] {
  return closeOwn(state, c, Object.values(OWN_OPTIONS).flatMap((own) => own(state, c)))
}

// What stands closed among the character's own actions: who they are, what they
// are doing, what surge is in hand, whose turn it is.
function closeOwn(state: SceneState, c: CampaignCharacter, options: ActionOption[]): ActionOption[] {
  return closeWhileDiceWait(state, closeByRoundChange(state, closeOutOfTurn(state, c, closeWhileFleeing(state, c, closeBySurge(state, c, closeWhileForced(state, c, closeWhileHolding(state, c, closeWhileConcentrating(c, closeIfImmobile(state, c, closeIfUnconscious(c, options))))))))))
}

// The table's ruling: while the scene waits on a die it called for, nothing
// else is declared.
function closeWhileDiceWait(state: SceneState, options: ActionOption[]): ActionOption[] {
  const bar = getDiceBar(state.calls)
  return bar ? closeWith(options, () => bar) : options
}

// combat.tex "Feint": the one a feint forced to take their turn chooses
// their action surge before anything else.
function closeWhileForced(state: SceneState, c: CampaignCharacter, options: ActionOption[]): ActionOption[] {
  return state.forcedSurge === c.id && c.usedSurge === null ? closeWith(options, () => 'choose an action surge first') : options
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
// action of their own stays closed until they make it.
function withSurges(state: SceneState, c: CampaignCharacter, now: ActionOption[], list: (state: SceneState) => ActionOption[], opens: boolean): ActionOption[] {
  if (now.every((o) => o.available)) return now
  const probes = getSurgeProbes(state, c).map((p) => ({ kind: p.kind, options: list(p.state) }))
  return now.map((o) => {
    if (o.available) return o
    for (const { kind, options } of probes) {
      const viaSurge = options.find((a) => a.available && sameDraft(a.draft, o.draft))
      if (viaSurge) return opens ? { ...viaSurge, surge: kind } : { ...o, surge: kind, reason: 'needs a surge' }
    }
    return o
  })
}

function getAnswers(state: SceneState, answerer: CampaignCharacter, open: RootAction): ActionOption[] {
  const options = listAnswers(state, answerer, open)
  return open.kind === 'drag' ? closeIfPushUnpayable(state, answerer.id, open, options) : options
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

function listAnswers(state: SceneState, answerer: CampaignCharacter, open: RootAction): ActionOption[] {
  const c = withRefund(state, withoutReserve(state, answerer, open.id), open.id)
  const characterId = c.id
  const charged = isCombatStarted(state)
  const declared = getReactionsTo(state, open.id).find((r) => r.actorId === characterId) ?? null
  const chosen = (draft: ActionDraft) => declared !== null && sameDraft(draft, declared)

  return closeBySurge(state, c, closeWhileConcentrating(c, closeIfImmobile(state, c, closeIfUnconscious(c, getTriggersFor(state, open, characterId).flatMap((trigger): ActionOption[] => {
    const kind = trigger.kind
    const price = ACTIONS[kind].price
    const cost = open.kind === 'drag' ? getPushAnswerCost(state, open, { kind, actorId: c.id }) : price ? getActionCost(c, price) : { AP: 0, STA: 0 }
    const gate = defenseGate(state, c, open, kind, cost)
    const answer = (draft: ActionDraft, own: ActionCost | null = cost, reason: string | null = gate): ActionOption =>
      option(draft, own, reason, open.id, chosen(draft))
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
          const base = { id: '', actorId: c.id, reactionTo: open.id, weaponKey: row.wielded.key, attack: row.atk.name }
          const guards = [makeAction(kind, base), ...(kind === 'intercept' && hasGrant(c, 'advancingIntercept') ? [makeAction('intercept', { ...base, advance: true })] : [])]
          return guards.map((guard) => {
            const { cost: own, reason } = guardOption(state, c, open, guard, gate)
            const draft: ActionDraft = guard.kind === 'intercept' && guard.advance ? { kind: 'intercept', weaponKey: base.weaponKey, attack: base.attack, advance: true } : { kind, weaponKey: base.weaponKey, attack: base.attack }
            return answer(draft, own, reason ?? seizedReason(state, guard))
          })
        })
      // combat.tex "Cover": a guard with a body shield may take total cover
      // behind it
      case 'guard':
        return guardRows(state, c, open).flatMap((row) => {
          const draft = { kind, weaponKey: row.wielded.key, attack: row.atk.name }
          const reason = gate ?? seizedReason(state, makeAction(kind, { ...draft, id: '', actorId: c.id, reactionTo: open.id }))
          return [draft, ...(row.weapon.shield?.body ? [{ ...draft, cover: true }] : [])].map((d) => answer(d, cost, reason))
        })
      // combat.tex "Explosion Block": only with a shield
      case 'blockExplosion':
        return explosionBlockRows(c).map((row) => {
          const draft = { kind, weaponKey: row.wielded.key, attack: row.atk.name }
          return answer(draft, cost, gate ?? seizedReason(state, makeAction(kind, { ...draft, id: '', actorId: c.id, reactionTo: open.id })))
        })
      // an evade of a trample opens a step, picked on the board once the
      // trample is paid; closed to one the mover ends on with nowhere to go
      // abilities.tex "Precise Evasion": an evade of a strike for 1 AP at -3;
      // a trample's evade is not tested, and its AP is the step it opens
      case 'evade': {
        const precise = getEvadeCost(c, true)
        return [
          answer({ kind }, cost, gate ?? getSidestepBar(state, open, c.id, cost.AP)),
          ...(open.kind === 'strike' && hasGrant(c, 'preciseEvade') ? [answer({ kind, precise: true }, precise, defenseGate(state, c, open, kind, precise))] : []),
        ]
      }
      // nothing to pick among; where an evasive jump lands is picked on the
      // board, not here
      case 'evasiveJump': {
        if (!canTechnicalLift(state, c)) return [answer({ kind })]
        const lift = getEvasiveJumpCost(c, true)
        return [answer({ kind, lift: true }, lift, defenseGate(state, c, open, kind, lift))]
      }
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
        return [answer({ kind }), answer({ kind, boost: true }, boosted, gate ?? (canAfford(c, boosted, charged) ? null : 'cannot afford'))]
      }
      // combat.tex "Opportunity Attack": "The attack requires the normal AP
      // cost" — open to someone with a strike, or, against a grapple partner,
      // a maneuver, that can be fought as declared from where the mover will
      // be: each is tried as the reaction it would be declared as, and when
      // none passes the one that came nearest says why
      case 'opportunityAttack': {
        const probe = (fields: Partial<ActionOf<'opportunityAttack'>>) => makeAction('opportunityAttack', { id: '', actorId: c.id, targetId: trigger.against ?? open.actorId, reactionTo: open.id, at: trigger.at, catch: trigger.catchOnly === true, ...fields })
        const strikes = getFreeAttackOptions(state, c, 'strike').map((s) => probe({ weaponKey: s.weaponKey, attack: s.attack, variant: s.variant }))
        const maneuvers = getPartners(state, c.id).includes(open.actorId) ? getManeuversOf(c).map((maneuver) => probe({ mode: 'grapple', maneuver })) : []
        const checks = [...strikes, ...maneuvers].map((a) => getOpportunityCheck(state, c, a))
        const reason = checks.length === 0 ? 'no melee weapon in hand' : checks.some((k) => k.bar === null) ? null : checks.reduce((best, k) => (k.stage > best.stage ? k : best)).bar
        return [answer({ kind, at: trigger.at }, null, reason)]
      }
      // combat.tex "Push and drag": tagging along is paid in the movement of
      // the block; one with no AP to move stays put and counts passively,
      // or, held by nobody, lets go
      case 'carry':
        return [answer({ kind }, cost, gate ?? (canAfford(c, cost, charged) ? null : 'cannot afford'))]
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
      // only to someone who can pay for one
      case 'counterattack': {
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
    const reachable = getReachableFloor(state, c.id).filter((f) => canPickUp(c, f.item))
    const reason = state.floor.length === 0 ? 'nothing on the floor'
      : reachable.length === 0 ? (getReachableFloor(state, c.id).length > 0 ? 'no free hand' : 'nothing within reach')
      : canAfford(c, cost, isCombatStarted(state)) ? null : 'cannot afford'
    return [option({ kind: 'pickUp' }, cost, reason)]
  },
  // combat.tex "Throw", "Standard Action": something held or on the floor
  // in reach, at its throwing row's price or a standard action's
  throw: (state, c) => {
    const throwable = getThrowables(state, c).filter((item) => canThrowItem(c, item, isCombatStarted(state)))
    const reason = !isPlaced(state, c) ? 'not on the board'
      : throwable.length === 0 ? 'nothing it can throw'
      : throwable.some((item) => canAfford(c, getThrowCost(c, item.id, isCombatStarted(state)), isCombatStarted(state))) ? null : 'cannot afford'
    return [option({ kind: 'throw' }, null, reason)]
  },
  // gear.tex "Potions and Medicine": "Potions require a standard action to
  // be consumed"
  drink: (state, c) => {
    const cost = getActionCost(c, 'standardAction')
    const reason = getTakeableHeld(c).bar ?? (canAfford(c, cost, isCombatStarted(state)) ? null : 'cannot afford')
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
  // combat.tex "Preparing a reaction": 1 AP, whatever is prepared; it needs a
  // board to be triggered on
  prepare: (state, c) => {
    const cost = getActionCost(c, 'prepare')
    return [option({ kind: 'prepare' }, cost, !isPlaced(state, c) ? 'not on the board' : afford(state, c, cost))]
  },
  // combat.tex "Rest"
  rest: (state, c) => {
    const cost = getActionCost(c, 'rest')
    return [option({ kind: 'rest' }, cost, isSuffocating(state, c) ? 'cannot breathe' : getChaseRestBar(state, c.id) ?? (canAffordRest(c, 'rest', isCombatStarted(state), getIncomingAP(state)) ? null : 'cannot afford'))]
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
  return canAfford(c, cost, isCombatStarted(state)) ? null : 'cannot afford'
}

// combat.tex "Immobile": "Cannot move and cannot use any combat or movement
// skills other than escape."
function closeIfImmobile(state: SceneState, c: CampaignCharacter, options: ActionOption[]): ActionOption[] {
  if (!isImmobile(state, c)) return options
  return options.map((o) => (o.draft.kind === 'releaseSpell' || (o.draft.kind === 'grapple' && o.draft.maneuver === 'escape')) ? o : { ...o, available: false, reason: 'immobile' })
}

// The unconscious do nothing but rest.
function closeIfUnconscious(c: CampaignCharacter, options: ActionOption[]): ActionOption[] {
  return hasAffliction(c, 'unconscious') ? closeWith(options, (o) => (o.draft.kind === 'rest' ? null : 'unconscious')) : options
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
// fire what they hold again — no
// moving, no answering (abilities.tex "Battle Mage" is what would allow
// either).
function closeWhileConcentrating(c: CampaignCharacter, options: ActionOption[]): ActionOption[] {
  return isConcentrating(c) ? closeWith(options, (o) => (o.draft.kind === 'cast' || o.draft.kind === 'fireAgain' || o.draft.kind === 'retarget' || o.draft.kind === 'releaseSpell' ? null : 'concentrating')) : options
}

function closeBySurge(state: SceneState, c: CampaignCharacter, options: ActionOption[]): ActionOption[] {
  return closeWith(options, (o) => getSurgeBarFor(state, c, o.draft.kind))
}

// combat.tex "Flee": a flee turn allows only what the movement surge does.
function closeWhileFleeing(state: SceneState, c: CampaignCharacter, options: ActionOption[]): ActionOption[] {
  return closeWith(options, (o) => getFleeBarFor(state, c, o.draft.kind))
}

// play.tex "Combat": a character acts in their own turn; outside it, only
// reactions and what they open — and a rest at the round change, the table's
// ruling. Before the combat has started there are no turns, and anyone acts.
function closeOutOfTurn(state: SceneState, c: CampaignCharacter, options: ActionOption[]): ActionOption[] {
  return !isCombatStarted(state) || isInTurn(state, c.id) ? options : closeWith(options, (o) => (getActionDef(o.draft.kind).rest && getRoundPhase(state) === 'rest') || isUnsurrender(o.draft) ? null : 'not your turn')
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
export function findOption(state: SceneState, characterId: string, draft: ActionDraft): ActionOption | null {
  const c = state.characters[characterId]
  if (c && !getOpenAction(state) && draft.kind in OWN_OPTIONS) {
    return closeOwn(state, c, OWN_OPTIONS[draft.kind as DeclarableKind](state, c)).find((o) => sameDraft(o.draft, draft)) ?? null
  }
  return getAvailableActions(state, characterId).find((o) => sameDraft(o.draft, draft)) ?? null
}

// Two drafts are the same option when they are of one kind and agree on
// every field the catalog names as telling that kind's options apart.
function sameDraft(option: ActionDraft, draft: ActionDraft): boolean {
  if (option.kind !== draft.kind) return false
  const identity: Record<string, unknown> = getActionDef(option.kind).identity ?? {}
  const a: Record<string, unknown> = option
  const b: Record<string, unknown> = draft
  return Object.entries(identity).every(([field, unset]) => (a[field] ?? unset) === (b[field] ?? unset))
}
