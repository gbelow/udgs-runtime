import type { Action, ActionRoll, CombatState, StrikeAction, Coord, Deliveries, DragAction, GrappleManeuver, HitLocation, MoveStop } from '../types'

import type { Area, MoveKind } from '../../types'
import { getActionName } from '../rules/actionCatalog'
import { getFightName } from '../rules/activeCharacter'
import { Term, sumTerms } from '../../character/rules/terms'
import { ActionOption, getAvailableActions, getCancellableLabel } from '../rules/options'
import { ActionStep, areReactionsComplete, needsDie, getDeclaredCost, getNextStep, getOwnCost, getTargetIds, isDeclarationComplete } from '../rules/action'
import { canAnswer, getOpenAction, getReactionsTo } from '../rules/log'
import { GRAZE_SAVE_COST, ImprovementOption, SpellOption, getImprovementOptions, canSaveGraze, getCastHOPRemaining, getSpellOptions } from '../rules/cast'
import { AttackOption, getAttackOptions, isAttackAction, isVariantOpen, getDLTerms, getRootTestTerms } from '../rules/attack'
import { LOCATIONS } from '../../tables'
import { SPELLS, isSpellKey } from '../../spells'
import { ActionCost } from '../../character/rules/actionCosts'
import { canAfford } from '../../character/rules/cost'
import { HOPOption, getHOPOptions, getHOPRemaining } from '../rules/damage'
import { ActionReport, getGrappleNotes, getLastReport, getOutcomes } from './outcomes'
import { isVoided } from '../rules/opportunity'
import { getSettled } from '../rules/settle'
import type { Outcome } from '../../character/rules/damage'
import { ChargeOption, getBlastOf, getChargeOptions, getExplosionAreas, isAimable, isSpray } from '../rules/explosion'
import { MovementOption, ReachableCell, getMovementOptions, getReachableCells } from '../rules/move'
import { canGrab, getDisarmOptions, getDragChoices, getDragOutcome, getDragSides, getManeuverTargets, isGrappleRowOf, isManeuverWon, needsDragAim } from '../rules/grapple'
import { findGrapple } from '../rules/partners'
import { getOpeningCounter } from '../rules/counter'
import { getRiposteDefense } from '../rules/riposte'
import { canPickUp, getReachableFloor } from '../rules/floor'
import { getPendingGuardStep } from '../rules/protect'
import { GRAPPLE_MANEUVERS, HIT_LOCATIONS } from '../../lists'

export type LocationOption = { location: HitLocation; penalty: number }

// combat.tex "Localized damage", as a picker: each location and what aiming
// there costs the attack test.
function getLocationOptions(): LocationOption[] {
  return HIT_LOCATIONS.map((location) => ({ location, penalty: LOCATIONS[location].penalty }))
}

// Everyone with a reaction to the open action, each with their options —
// and, for one who has chosen an opportunity attack, the strike it opens
// still to be declared: its rows and where it aims.
export type ReactorOptions = {
  id: string
  name: string
  options: ActionOption[]
  strike: {
    options: AttackOption[]
    locations: LocationOption[]
    attack: string
    variant: string
    location: HitLocation
    complete: boolean
    grab: boolean
    grabbable: boolean
    // combat.tex "Grapple Maneuvers", "Push and drag": against a grapple
    // partner, a maneuver or a push instead of the strike
    mode: 'strike' | 'grapple' | 'drag'
    partner: boolean
    maneuvers: GrappleManeuver[]
    maneuver: GrappleManeuver
  } | null
  // combat.tex "Opportunity Attack": the action of theirs the attack answers,
  // which answering with anything but the SD gives up (`getGivenUpFor`);
  // null when there is none
  cancellable: string | null
}

function getReactors(state: CombatState, open: Action): ReactorOptions[] {
  return Object.values(state.characters)
    .filter((c) => canAnswer(open, c.id))
    .map((c) => {
      const declared = getReactionsTo(state, open.id).find((r) => r.actorId === c.id)
      const strike = declared?.kind === 'opportunityAttack' || declared?.kind === 'counterattack'
        ? {
            options: getAttackOptions(c, 'strike').filter((o) => isVariantOpen(state, declared, o.variant)),
            locations: getLocationOptions(),
            attack: declared.attack,
            variant: declared.variant,
            location: declared.location,
            complete: isDeclarationComplete(state, c, declared),
            grab: declared.kind === 'opportunityAttack' && declared.grab,
            grabbable: declared.kind === 'opportunityAttack' && canGrab(state, declared, declared.targetId ?? ''),
            mode: declared.kind === 'opportunityAttack' ? declared.mode : 'strike' as const,
            partner: findGrapple(state.grapples, c.id, declared.targetId ?? '') !== null,
            maneuvers: GRAPPLE_MANEUVERS.filter((m) => getManeuverTargets(state, c.id, m).includes(declared.targetId ?? '')),
            maneuver: declared.kind === 'opportunityAttack' ? declared.maneuver : 'immobilize' as const,
          }
        : null
      return { id: c.id, name: getFightName(state, c.id), options: getAvailableActions(state, c.id), strike, cancellable: getCancellableLabel(state, open, c.id) }
    })
    .filter((r) => r.options.length > 0)
}

// What the open action is called: a strike a counterattack or a riposte
// opened goes by that name (abilities.tex "Counterattack", "Riposte").
function getOpenLabel(state: CombatState, open: Action): string {
  if (open.kind === 'strike' && getOpeningCounter(state, open)) return 'counterattack'
  if (open.kind === 'strike' && getRiposteDefense(state, open)) return 'riposte'
  return getActionName(open)
}

// The deliveries a cast will make as it stands, for the panel: who takes
// what, and the test it leaves them.
type DeliveryView = { target: string; name: string; kind: string; test: string | null }

function getCastDeliveries(state: CombatState, facts: Deliveries): DeliveryView[] {
  return Object.entries(facts).flatMap(([id, deliveries]) =>
    deliveries.map((d) => ({ target: getFightName(state, id), name: d.effect.name, kind: d.effect.type, test: d.test ? `${d.test.roll} vs ${d.test.DL}` : null })))
}

// The open action as the panel reads it, every field final.
export type OpenActionView = {
  id: string
  label: string
  actor: string
  target: string | null
  targetId: string | null
  // the declaration a strike, a shot or an explosion has made so far
  weapon: string
  attack: string
  variant: string
  location: HitLocation
  // an explosion's area, whether it is pointed where it goes off yet, and
  // whether it can still be pointed somewhere else
  area: { shape: Area['shape']; aimed: boolean; aimable: boolean } | null
  // where the explosion comes from, and the charged object it is set off in
  source: 'thrown' | 'cast' | 'detonate' | null
  itemId: string
  // the declaration a cast has made so far
  spell: string
  quicken: boolean
  // the declaration a move has made so far
  movement: MoveKind
  path: Coord[]
  // how far the move will actually get and why it stops there
  walked: { cells: number; stop: MoveStop } | null
  // opened by a reaction — an opportunity attack, a follow, a riposte —
  // and whether it is the attack an opportunity attack opens
  spawned: boolean
  opportunity: boolean
  // combat.tex "Grapple": a strike made as a grab; the maneuver declared and
  // whether a hit is to be bought by the attacker's own commitment (null
  // where the maneuver has none); where a push goes, whether it has been
  // pointed yet, and how far it means to
  grab: boolean
  maneuver: GrappleManeuver | null
  // once a knockdown or an immobilization has hit: whether the attacker
  // commits themselves along (null: nothing to choose)
  along: boolean | null
  push: PushView | null
  // a disarm's hit: what it can go for, and what it went for
  disarm: { itemId: string; name: string }[]
  item: string
  // a pick up: what lies within reach, and what was picked
  floor: { itemId: string; name: string; available: boolean }[]
  // once rolled or compared: what it does to the grapple
  grapple: { target: string; text: string }[]
  cost: ActionCost | null
  // every reaction declared so far, by whom, and its own test once thrown
  reactions: { actor: string; label: string; cost: ActionCost | null; roll: ActionRoll | null }[]
  // the test as it stands: the attacker's side and the defender's
  score: { terms: Term[]; total: number }
  DL: { terms: Term[]; total: number }
  roll: ActionRoll | null
}

// combat.tex "Push and drag", once settled: who won, what the winner may
// choose, what they chose and how far, whether that is pointed yet, and
// whether it can still be changed.
export type PushView = {
  winner: 'attacker' | 'defender' | 'draw'
  choices: { choice: 'push' | 'circle' | 'stay'; available: boolean }[]
  choice: 'push' | 'circle' | 'stay' | null
  distances: number[]
  steps: number
  aimed: boolean
}

export type ActionPanelView = {
  step: ActionStep | null
  open: OpenActionView | null
  // with nothing open: what the active character can declare
  options: ActionOption[]
  // at `react`: everyone the open action triggers something in, with their
  // options; the target's defenses are among them
  reactors: ReactorOptions[]
  // at `declare`: the rows and variations an attack can be made with, the
  // spells a cast can be of, or the charges that can be set off
  attacks: AttackOption[]
  spells: SpellOption[]
  charges: ChargeOption[]
  locations: LocationOption[]
  targets: { id: string; name: string }[]
  // why the target list is empty, when it is
  noTargets: string | null
  // at `commit`: whether the declaration can be locked
  canCommit: boolean
  // whether the open action is closed by a die or by paying, and at `react`
  // whether that close is open
  die: boolean
  // a comparison with no die (combat.tex "Push and drag"): both sides shown
  compare: boolean
  canRoll: boolean
  canPay: boolean
  // an evasive jump is declared but has not picked its landing yet
  jumpPending: boolean
  // who still has to pick on the board where they step to block or
  // intercept; null when nobody does
  stepPending: string | null
  // at `react`: a reaction has been declared and can be taken back
  canBack: boolean
  // for a move being declared: the kinds of movement open to the actor and
  // every cell the declared kind can reach
  moves: MovementOption[]
  reachable: ReachableCell[]
  // once rolled: what the hit's overflow can buy, and what the action does
  // to everyone it lands on as they stand
  hop: { remaining: number; options: HOPOption[] }
  outcomes: { target: string; outcome: Outcome }[]
  // once a cast is rolled: what its overflow can buy, and what it will
  // deliver to whom
  castHOP: { remaining: number; options: ImprovementOption[] }
  // once a cast is rolled: the price of buying its graze up to a hit, when
  // that is open
  grazeSave: { AP: number; STA: number } | null
  deliveries: DeliveryView[]
  // with nothing open: what the last action played out came to
  report: ActionReport | null
}

const EMPTY: ActionPanelView = { step: null, open: null, options: [], reactors: [], attacks: [], spells: [], charges: [], locations: [], targets: [], noTargets: null, canCommit: false, die: false, compare: false, canRoll: false, canPay: false, jumpPending: false, stepPending: null, canBack: false, moves: [], reachable: [], hop: { remaining: 0, options: [] }, outcomes: [], castHOP: { remaining: 0, options: [] }, grazeSave: null, deliveries: [], report: null }

// Everything the action panel shows, in one shape off the fight. The active
// character is who declares; the open action's target is who reacts, so the
// two never need the roster switched between them.
export function getActionPanel(state: CombatState): ActionPanelView {
  const step = getNextStep(state)
  const open = getOpenAction(state)
  const active = state.activeCharacterId ? state.characters[state.activeCharacterId] : undefined

  if (!open) {
    return { ...EMPTY, options: active ? getAvailableActions(state, active.id) : [], report: getLastReport(state) }
  }

  const actor = state.characters[open.actorId]
  const target = open.targetId ? state.characters[open.targetId] : undefined
  const reactions = getReactionsTo(state, open.id)
  const attack = isAttackAction(open) ? open : null
  const explosion = open.kind === 'explosion' ? open : null
  const cast = open.kind === 'cast' ? open : null
  const weaponAction = attack ?? explosion
  const blast = open.kind === 'blast' ? open : null
  const laid = explosion ? getBlastOf(state, explosion) : blast
  const area = laid && getExplosionAreas(laid).length > 0 ? { shape: isSpray(laid) ? 'spray' as const : 'explosion' as const, laid } : null
  const move = open.kind === 'move' && open.step === 'define' ? open : null
  const die = needsDie(state, open)
  // a settled push was paid for already; what is left is opening its attacks
  const cost = actor ? getDeclaredCost(actor, open) : null
  const affordable = !!actor && (open.step !== 'react' || (cost !== null && canAfford(actor, cost)))
  // the action as the resolve would settle it now: what a move will walk, what
  // a rolled action will land
  const settled = open.step === 'post' || open.kind === 'move' ? getSettled(state, open) : null
  const facts = settled?.kind === 'move' ? settled.facts : null
  const grapple = open.kind === 'grapple' ? open : null
  const drag = open.kind === 'drag' ? open : null
  const dragTerms = drag ? getDragSides(state, drag) : null
  const rootTerms = open.kind !== 'move' || die ? getRootTestTerms(state, open) : null
  const hit = grapple?.step === 'post' && isManeuverWon(grapple)

  return {
    step,
    open: {
      id: open.id,
      label: getOpenLabel(state, open),
      actor: getFightName(state, open.actorId),
      target: target?.fightName ?? null,
      targetId: open.targetId,
      weapon: weaponAction?.weaponKey ?? '',
      attack: weaponAction?.attack ?? '',
      variant: weaponAction?.variant ?? '',
      location: attack?.location ?? 'chest',
      area: area ? { shape: area.shape, aimed: area.shape === 'explosion' ? area.laid.center !== null : area.laid.direction !== null, aimable: isAimable(state, (explosion ?? blast)!) } : null,
      source: explosion?.source ?? null,
      itemId: explosion?.itemId ?? '',
      spell: cast && isSpellKey(cast.key) ? SPELLS[cast.key].name : '',
      quicken: cast?.quicken ?? false,
      movement: open.kind === 'move' ? open.movement : 'basic',
      path: open.kind === 'move' ? open.path : [],
      walked: facts && open.kind === 'move' && open.path.length > 0 ? { cells: facts.path.length, stop: facts.stop } : null,
      spawned: open.spawnedBy !== null,
      opportunity: open.kind === 'strike' && open.opportunity,
      grab: open.kind === 'strike' && open.grab,
      maneuver: grapple?.maneuver ?? null,
      along: grapple && hit && !grapple.hook && grapple.roll?.degree === 'hit' && (grapple.maneuver === 'knockdown' || grapple.maneuver === 'immobilize') ? grapple.along : null,
      disarm: grapple && hit && grapple.maneuver === 'disarm' ? getDisarmOptions(state, grapple) : [],
      item: grapple?.item ?? (open.kind === 'pickUp' ? open.itemId : ''),
      floor: open.kind === 'pickUp' && open.step === 'define' && actor
        ? getReachableFloor(state, actor.id).map((f) => ({ itemId: f.item.id, name: f.item.name, available: canPickUp(actor, f.item) }))
        : [],
      push: drag && drag.step === 'post' ? getPushView(state, drag) : null,
      grapple: settled && (grapple || drag || isVoided(state, open)) ? getGrappleNotes(state, settled) : [],
      cost,
      reactions: reactions.map((r) => ({
        actor: getFightName(state, r.actorId),
        label: getActionName(r),
        cost: getOwnCost(state, r),
        roll: r.roll,
      })),
      score: breakdown(rootTerms ? rootTerms.skill : dragTerms ? dragTerms.attacker : []),
      DL: breakdown(rootTerms ? rootTerms.DL : explosion ? getDLTerms(state, open) : dragTerms ? dragTerms.defender ?? [] : []),
      roll: open.roll,
    },
    report: null,
    options: [],
    reactors: step === 'react' ? getReactors(state, open) : [],
    attacks: weaponAction && step === 'declare' && actor && !(explosion && explosion.source !== 'thrown')
      ? getAttackOptions(actor, weaponAction.kind).filter((o) => isVariantOpen(state, open, o.variant) && (!(open.kind === 'strike' && open.grab) || isGrappleRowOf(actor, o.weaponKey, o.attack)))
      : [],
    spells: cast && step === 'declare' && actor ? getSpellOptions(actor) : [],
    charges: explosion?.source === 'detonate' && step !== 'react' && explosion.step === 'define' ? getChargeOptions(state) : [],
    locations: attack ? getLocationOptions() : [],
    targets: step === 'target' ? getTargetIds(state, open).map((id) => ({ id, name: getFightName(state, id) })) : [],
    noTargets: step === 'target' && getTargetIds(state, open).length === 0
      ? (Object.keys(state.characters).length > 1 ? 'nobody in reach' : 'nobody else in the fight')
      : null,
    canCommit: step === 'commit' && affordable,
    die,
    compare: drag !== null,
    canRoll: step === 'react' && die && areReactionsComplete(state, open),
    canPay: step === 'react' && !die && affordable && areReactionsComplete(state, open),
    jumpPending: step === 'react' && reactions.some((r) => r.kind === 'evasiveJump' && r.to === null) && !areReactionsComplete(state, open),
    stepPending: step === 'react' && open.kind === 'strike' ? stepPendingName(state, open) : null,
    canBack: step === 'react' && reactions.length > 0,
    moves: move && actor ? getMovementOptions(state, actor, move) : [],
    reachable: move ? getReachableCells(state, move) : [],
    hop: attack && target && attack.step === 'post' && !isVoided(state, attack)
      ? { remaining: getHOPRemaining(attack, target), options: getHOPOptions(state, attack) }
      : { remaining: 0, options: [] },
    outcomes: open.step === 'post' && settled ? getOutcomes(state, settled).map(({ id, outcome }) => ({ target: getFightName(state, id), outcome })) : [],
    castHOP: cast && cast.step === 'post' ? { remaining: getCastHOPRemaining(cast), options: getImprovementOptions(state, cast) } : { remaining: 0, options: [] },
    grazeSave: cast && canSaveGraze(state, cast) ? GRAZE_SAVE_COST : null,
    deliveries: settled?.kind === 'cast' ? getCastDeliveries(state, settled.facts ?? {}) : [],
  }
}

function breakdown(terms: Term[]): { terms: Term[]; total: number } {
  return { terms, total: sumTerms(terms) }
}

export function getActionPanelDigest(state: CombatState): string {
  return JSON.stringify(getActionPanel(state))
}

function getPushView(state: CombatState, drag: DragAction): PushView {
  const outcome = getDragOutcome(state, drag)
  const diff = outcome?.diff ?? 0
  return {
    winner: diff > 0 ? 'attacker' : diff < 0 ? 'defender' : 'draw',
    choices: getDragChoices(state, drag),
    choice: drag.choice,
    distances: Array.from({ length: outcome?.push ?? 0 }, (_, i) => i + 1),
    steps: drag.steps,
    aimed: !needsDragAim(state, drag),
  }
}

// Who still has to pick where they step to block or intercept the strike.
function stepPendingName(state: CombatState, open: StrikeAction): string | null {
  const guard = getPendingGuardStep(state, open)
  return guard ? getFightName(state, guard.reaction.actorId) : null
}
