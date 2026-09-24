import type { Action, ActionRoll, CastAction, CombatState, Coord, GrappleManeuver, HitLocation, MoveStop } from '../types'

// The six hex directions as arrows, for a push declared off the board.
export function getDirectionOptions(): { index: number; arrow: string }[] {
  const arrows = ['→', '↘', '↓', '↙', '←', '↖', '↑', '↗']
  return DIRECTIONS.map((d, index) => {
    const { x, y } = toPlane(d)
    const octant = Math.round(Math.atan2(y, x) / (Math.PI / 4))
    return { index, arrow: arrows[(octant + 8) % 8] }
  })
}
import type { Area, CampaignCharacter, MoveKind } from '../../types'
import { ACTIONS } from '../actionCatalog'
import { Term, sumTerms } from '../../character/rules/terms'
import {
  ActionOption,
  ActionStep,
  ImprovementOption,
  SpellOption,
  areReactionsComplete,
  getCastTerms,
  getImprovementOptions,
  canSaveGraze,
  getSOPRemaining,
  getSpellOptions,
  needsDie,
  LocationOption,
  AttackOption,
  getAttackOptions,
  isVariantOpen,
  getAttackTerms,
  getManeuverTerms,
  getAvailableActions,
  getDLTerms,
  getDeclaredCost,
  getLocationOptions,
  getNextStep,
  getOpenAction,
  getReactionsTo,
  getTargetIds,
  getCancellableLabel,
  isDeclarationComplete,
} from '../rules/action'
import { getCastFacts } from '../rules/cast'
import { GRAZE_SAVE } from '../../tables'
import { ActionCost } from '../../character/rules/actionCosts'
import { HOPOption, getHOPOptions, getHOPRemaining } from '../rules/damage'
import { ActionReport, getLastReport, getOutcomePreviews } from './outcomes'
import type { Outcome } from '../../character/rules/damage'
import { ChargeOption, getChargeOptions, getExplosionAreas, isAimable, isSpray } from '../rules/explosion'
import { MovementOption, ReachableCell, getBalanceDL, getBalanceTestTerms, getMoveFacts, getMovementOptions, getReachableCells } from '../rules/move'
import { canGrab, findGrapple, getDisarmOptions, getDragFacts, getDragSides, getManeuverFacts, getManeuverTargets, isGrappleRowOf } from '../rules/grapple'
import { canPickUp, getReachableFloor } from '../rules/floor'
import { DIRECTIONS } from '../geometry'
import { toPlane } from '../rules/board'
import { GRAPPLE_MANEUVERS } from '../../lists'
import { getGrappleNotes } from './outcomes'

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
    direction: number | null
    steps: number
  } | null
  // combat.tex "Opportunity Attack": the action of theirs the attack answers,
  // still theirs to give up to answer with anything but the SD
  // (`cancelTriggeringAction`); null when there is none
  cancellable: string | null
}

export function getReactors(state: CombatState, open: Action): ReactorOptions[] {
  return Object.values(state.characters)
    .filter((c) => c.id !== open.actorId || open.kind === 'explosion')
    .map((c) => {
      const declared = getReactionsTo(state, open.id).find((r) => r.actorId === c.id)
      const strike = declared?.kind === 'opportunityAttack'
        ? {
            options: getAttackOptions(c, 'strike').filter((o) => isVariantOpen(state, declared, o.variant)),
            locations: getLocationOptions(),
            attack: declared.attack,
            variant: declared.variant,
            location: declared.location,
            complete: isDeclarationComplete(state, c, declared),
            grab: declared.grab,
            grabbable: canGrab(state, declared, declared.targetId ?? ''),
            mode: declared.mode,
            partner: findGrapple(state.grapples, c.id, declared.targetId ?? '') !== null,
            maneuvers: GRAPPLE_MANEUVERS.filter((m) => getManeuverTargets(state, c.id, m).includes(declared.targetId ?? '')),
            maneuver: declared.maneuver,
            direction: declared.direction,
            steps: declared.steps,
          }
        : null
      return { id: c.id, name: c.fightName ?? '', options: getAvailableActions(state, c.id), strike, cancellable: getCancellableLabel(state, open, c.id) }
    })
    .filter((r) => r.options.length > 0)
}

// The deliveries a cast will make as it stands, for the panel: who takes
// what, and the test it leaves them.
export type DeliveryView = { id: string; name: string; kind: string; test: { roll: string; DL: number } | null }

export function getCastDeliveries(state: CombatState, root: CastAction): DeliveryView[] {
  return Object.entries(root.facts ?? getCastFacts(state, root)).flatMap(([id, deliveries]) =>
    deliveries.map((d) => ({ id, name: d.effect.name, kind: d.effect.type, test: d.test ? { roll: d.test.roll, DL: d.test.DL } : null })))
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
  // an opportunity attack, or a follow: what opened it
  spawned: boolean
  // combat.tex "Grapple": a strike made as a grab; the maneuver declared and
  // whether a hit is to be bought by the attacker's own commitment (null
  // where the maneuver has none); where a push goes, whether it has been
  // pointed yet, and how far it means to
  grab: boolean
  maneuver: GrappleManeuver | null
  // once a knockdown or an immobilization has hit: whether the attacker
  // commits themselves along (null: nothing to choose)
  along: boolean | null
  push: { aimed: boolean; steps: number } | null
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
  SOP: { remaining: number; options: ImprovementOption[] }
  // once a cast is rolled: the price of buying its graze up to a hit, when
  // that is open
  grazeSave: { AP: number; STA: number } | null
  deliveries: { target: string; name: string; kind: string; test: string | null }[]
  // with nothing open: what the last action played out came to
  report: ActionReport | null
}

const EMPTY: ActionPanelView = { step: null, open: null, options: [], reactors: [], attacks: [], spells: [], charges: [], locations: [], targets: [], noTargets: null, canCommit: false, die: false, compare: false, canRoll: false, canPay: false, jumpPending: false, canBack: false, moves: [], reachable: [], hop: { remaining: 0, options: [] }, outcomes: [], SOP: { remaining: 0, options: [] }, grazeSave: null, deliveries: [], report: null }

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
  const attack = open.kind === 'strike' || open.kind === 'shoot' ? open : null
  const explosion = open.kind === 'explosion' ? open : null
  const cast = open.kind === 'cast' ? open : null
  const weaponAction = attack ?? explosion
  const areas = explosion ? getExplosionAreas(state, explosion) : []
  const area = areas.length > 0 ? (isSpray(state, explosion!) ? { shape: 'spray' as const } : { shape: 'explosion' as const }) : null
  const move = open.kind === 'move' && open.status === 'declared' ? open : null
  const die = needsDie(state, open)
  const affordable = !!actor && canPay(actor, getDeclaredCost(actor, open))
  const facts = open.kind === 'move' ? (open.facts ?? getMoveFacts(state, open)) : null
  const grapple = open.kind === 'grapple' ? open : null
  const drag = open.kind === 'drag' ? open : null
  const dragTerms = drag ? getDragSides(state, drag) : null
  const hit = grapple?.status === 'rolled' && (grapple.roll?.degree === 'hit' || grapple.roll?.degree === 'critical')
  const settled = grapple && grapple.status === 'rolled' ? { ...grapple, facts: getManeuverFacts(state, grapple) }
    : drag && drag.status === 'rolled' ? { ...drag, facts: getDragFacts(state, drag) }
    : null

  return {
    step,
    open: {
      id: open.id,
      label: open.kind === 'strike' && open.grab ? 'grab' : grapple ? (grapple.stand ? 'stand up' : grapple.maneuver) : ACTIONS[open.kind].label,
      actor: actor?.fightName ?? '',
      target: target?.fightName ?? null,
      targetId: open.targetId,
      weapon: weaponAction?.weaponKey ?? '',
      attack: weaponAction?.attack ?? '',
      variant: weaponAction?.variant ?? '',
      location: attack?.location ?? 'chest',
      area: area ? { shape: area.shape, aimed: area.shape === 'explosion' ? explosion!.center !== null : explosion!.direction !== null, aimable: isAimable(state, explosion!) } : null,
      source: explosion?.source ?? null,
      itemId: explosion?.itemId ?? '',
      spell: cast && actor ? getSpellOptions(actor).find((s) => s.key === cast.key)?.name ?? '' : '',
      quicken: cast?.quicken ?? false,
      movement: open.kind === 'move' ? open.movement : 'basic',
      path: open.kind === 'move' ? open.path : [],
      walked: facts && open.kind === 'move' && open.path.length > 0 ? { cells: facts.path.length, stop: facts.stop } : null,
      spawned: open.spawnedBy !== null,
      grab: open.kind === 'strike' && open.grab,
      maneuver: grapple?.maneuver ?? null,
      along: grapple && hit && grapple.roll?.degree === 'hit' && (grapple.maneuver === 'knockdown' || grapple.maneuver === 'immobilize') ? grapple.along : null,
      disarm: grapple && hit && grapple.maneuver === 'disarm' ? getDisarmOptions(state, grapple) : [],
      item: grapple?.item ?? (open.kind === 'pickUp' ? open.itemId : ''),
      floor: open.kind === 'pickUp' && open.status === 'declared' && actor
        ? getReachableFloor(state, actor.id).map((f) => ({ itemId: f.item.id, name: f.item.name, available: canPickUp(actor, f.item) }))
        : [],
      push: drag ? { aimed: drag.direction !== null, steps: drag.steps } : null,
      grapple: settled ? getGrappleNotes(state, settled) : [],
      cost: actor ? getDeclaredCost(actor, open) : null,
      reactions: reactions.map((r) => ({
        actor: state.characters[r.actorId]?.fightName ?? '',
        label: ACTIONS[r.kind].label,
        cost: state.characters[r.actorId] ? getDeclaredCost(state.characters[r.actorId], r) : null,
        roll: r.roll,
      })),
      score: breakdown(attack ? getAttackTerms(state, attack) : cast && actor ? getCastTerms(actor, cast) : grapple && actor ? getManeuverTerms(actor) : dragTerms ? dragTerms.attacker : open.kind === 'move' && actor && die ? getBalanceTestTerms(actor) : []),
      DL: breakdown(attack || explosion || cast || grapple ? getDLTerms(state, open) : dragTerms ? dragTerms.defender ?? [] : open.kind === 'move' && die ? [{ label: 'terrain', value: getBalanceDL(state, open) }] : []),
      roll: open.roll,
    },
    report: null,
    options: [],
    reactors: step === 'react' ? getReactors(state, open) : [],
    attacks: weaponAction && step === 'declare' && actor && !(explosion && explosion.source !== 'thrown')
      ? getAttackOptions(actor, weaponAction.kind).filter((o) => isVariantOpen(state, open, o.variant) && (!(open.kind === 'strike' && open.grab) || isGrappleRowOf(actor, o.weaponKey, o.attack)))
      : [],
    spells: cast && step === 'declare' && actor ? getSpellOptions(actor) : [],
    charges: explosion?.source === 'detonate' && step !== 'react' && explosion.status === 'declared' ? getChargeOptions(state) : [],
    locations: attack ? getLocationOptions() : [],
    targets: step === 'target' ? getTargetIds(state, open).map((id) => ({ id, name: state.characters[id].fightName ?? '' })) : [],
    noTargets: step === 'target' && getTargetIds(state, open).length === 0
      ? (Object.keys(state.characters).length > 1 ? 'nobody in reach' : 'nobody else in the fight')
      : null,
    canCommit: step === 'commit' && affordable,
    die,
    compare: drag !== null,
    canRoll: step === 'react' && die && areReactionsComplete(state, open),
    canPay: step === 'react' && !die && affordable && areReactionsComplete(state, open),
    jumpPending: step === 'react' && reactions.some((r) => r.kind === 'evasiveJump' && r.to === null) && !areReactionsComplete(state, open),
    canBack: step === 'react' && reactions.length > 0,
    moves: move && actor ? getMovementOptions(state, actor, move) : [],
    reachable: move ? getReachableCells(state, move) : [],
    hop: attack && target && attack.status === 'rolled'
      ? { remaining: getHOPRemaining(attack, target), options: getHOPOptions(state, attack) }
      : { remaining: 0, options: [] },
    outcomes: open.status === 'rolled' ? getOutcomePreviews(state, open).map(({ id, outcome }) => ({ target: state.characters[id]?.fightName ?? '', outcome })) : [],
    SOP: cast && cast.status === 'rolled' ? { remaining: getSOPRemaining(cast), options: getImprovementOptions(state, cast) } : { remaining: 0, options: [] },
    grazeSave: cast && canSaveGraze(state, cast) ? { AP: GRAZE_SAVE.AP, STA: 0 } : null,
    deliveries: cast && cast.status === 'rolled'
      ? getCastDeliveries(state, cast).map((d: DeliveryView) => ({ target: state.characters[d.id]?.fightName ?? '', name: d.name, kind: d.kind, test: d.test ? `${d.test.roll} vs ${d.test.DL}` : null }))
      : [],
  }
}

function canPay(c: CampaignCharacter, cost: ActionCost | null): boolean {
  return cost !== null && c.resources.AP >= cost.AP && c.resources.STA >= cost.STA
}

function breakdown(terms: Term[]): { terms: Term[]; total: number } {
  return { terms, total: sumTerms(terms) }
}

export function getActionPanelDigest(state: CombatState): string {
  return JSON.stringify(getActionPanel(state))
}
