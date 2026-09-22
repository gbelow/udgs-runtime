import type { ActionRoll, CombatState, Coord, HitLocation } from '../types'
import type { Area, CampaignCharacter, MovementKind } from '../../types'
import { ACTIONS } from '../actionCatalog'
import { Term, sumTerms } from '../../character/lenses/terms'
import {
  ActionOption,
  ActionStep,
  ImprovementOption,
  ReactorOptions,
  SpellOption,
  areReactionsComplete,
  getCastTerms,
  getImprovementOptions,
  getReactors,
  getSOPRemaining,
  getSpellOptions,
  needsDie,
  LocationOption,
  AttackOption,
  getAttackOptions,
  getAttackTerms,
  getAvailableActions,
  getDLTerms,
  getDeclaredCost,
  getLocationOptions,
  getNextStep,
  getOpenAction,
  getReactionsTo,
  getTargetIds,
} from './action'
import { DeliveryView, getCastDeliveries } from './cast'
import { ActionCost } from '../../character/lenses/actionCosts'
import { HOPOption, getHOPOptions, getHOPRemaining, getOutcomePreviews } from './damage'
import type { Outcome } from '../../character/lenses/damage'
import { getExplosionArea } from './explosion'
import { MovementOption, ReachableCell, getBalanceDL, getBalanceTestTerms, getMoveFacts, getMovementOptions, getReachableCells } from './move'
import type { MoveStop } from '../types'

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
  // an explosion's area, and whether it is pointed where it goes off yet
  area: { shape: Area['shape']; aimed: boolean } | null
  // the declaration a cast has made so far
  spell: string
  quicken: boolean
  // the declaration a move has made so far
  movement: MovementKind
  path: Coord[]
  // how far the move will actually get and why it stops there
  walked: { cells: number; stop: MoveStop } | null
  // an opportunity attack, or a follow: what opened it
  spawned: boolean
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
  // at `declare`: the rows and variations an attack can be made with, or
  // the spells a cast can be of
  attacks: AttackOption[]
  spells: SpellOption[]
  locations: LocationOption[]
  targets: { id: string; name: string }[]
  // why the target list is empty, when it is
  noTargets: string | null
  // at `commit`: whether the declaration can be locked
  canCommit: boolean
  // whether the open action is closed by a die or by paying, and at `react`
  // whether that close is open
  die: boolean
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
  deliveries: { target: string; name: string; kind: string; test: string | null }[]
}

const EMPTY: ActionPanelView = { step: null, open: null, options: [], reactors: [], attacks: [], spells: [], locations: [], targets: [], noTargets: null, canCommit: false, die: false, canRoll: false, canPay: false, jumpPending: false, canBack: false, moves: [], reachable: [], hop: { remaining: 0, options: [] }, outcomes: [], SOP: { remaining: 0, options: [] }, deliveries: [] }

// Everything the action panel shows, in one shape off the fight. The active
// character is who declares; the open action's target is who reacts, so the
// two never need the roster switched between them.
export function getActionPanel(state: CombatState): ActionPanelView {
  const step = getNextStep(state)
  const open = getOpenAction(state)
  const active = state.activeCharacterId ? state.characters[state.activeCharacterId] : undefined

  if (!open) {
    return { ...EMPTY, options: active ? getAvailableActions(state, active.id) : [] }
  }

  const actor = state.characters[open.actorId]
  const target = open.targetId ? state.characters[open.targetId] : undefined
  const reactions = getReactionsTo(state, open.id)
  const attack = open.kind === 'strike' || open.kind === 'shoot' ? open : null
  const explosion = open.kind === 'explosion' ? open : null
  const cast = open.kind === 'cast' ? open : null
  const weaponAction = attack ?? explosion
  const area = explosion ? getExplosionArea(state, explosion) : null
  const move = open.kind === 'move' && open.status === 'declared' ? open : null
  const die = needsDie(state, open)
  const affordable = !!actor && canPay(actor, getDeclaredCost(actor, open))
  const facts = open.kind === 'move' ? (open.facts ?? getMoveFacts(state, open)) : null

  return {
    step,
    open: {
      id: open.id,
      label: ACTIONS[open.kind].label,
      actor: actor?.fightName ?? '',
      target: target?.fightName ?? null,
      targetId: open.targetId,
      weapon: weaponAction?.weaponKey ?? '',
      attack: weaponAction?.attack ?? '',
      variant: weaponAction?.variant ?? '',
      location: attack?.location ?? 'chest',
      area: area ? { shape: area.shape, aimed: area.shape === 'explosion' ? explosion!.center !== null : explosion!.direction !== null } : null,
      spell: cast && actor ? getSpellOptions(actor).find((s) => s.key === cast.key)?.name ?? '' : '',
      quicken: cast?.quicken ?? false,
      movement: open.kind === 'move' ? open.movement : 'basic',
      path: open.kind === 'move' ? open.path : [],
      walked: facts && open.kind === 'move' && open.path.length > 0 ? { cells: facts.path.length, stop: facts.stop } : null,
      spawned: open.spawnedBy !== null,
      cost: actor ? getDeclaredCost(actor, open) : null,
      reactions: reactions.map((r) => ({
        actor: state.characters[r.actorId]?.fightName ?? '',
        label: ACTIONS[r.kind].label,
        cost: state.characters[r.actorId] ? getDeclaredCost(state.characters[r.actorId], r) : null,
        roll: r.roll,
      })),
      score: breakdown(attack && actor ? getAttackTerms(actor, attack) : cast && actor ? getCastTerms(actor, cast) : open.kind === 'move' && actor && die ? getBalanceTestTerms(actor) : []),
      DL: breakdown(attack || explosion || cast ? getDLTerms(state, open) : open.kind === 'move' && die ? [{ label: 'terrain', value: getBalanceDL(state, open) }] : []),
      roll: open.roll,
    },
    options: [],
    reactors: step === 'react' ? getReactors(state, open) : [],
    attacks: weaponAction && step === 'declare' && actor ? getAttackOptions(actor, weaponAction.kind) : [],
    spells: cast && step === 'declare' && actor ? getSpellOptions(actor) : [],
    locations: attack ? getLocationOptions() : [],
    targets: step === 'target' ? getTargetIds(state, open).map((id) => ({ id, name: state.characters[id].fightName ?? '' })) : [],
    noTargets: step === 'target' && getTargetIds(state, open).length === 0
      ? (Object.keys(state.characters).length > 1 ? 'nobody in reach' : 'nobody else in the fight')
      : null,
    canCommit: step === 'commit' && affordable,
    die,
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
    SOP: cast && cast.status === 'rolled' ? { remaining: getSOPRemaining(cast), options: getImprovementOptions(cast) } : { remaining: 0, options: [] },
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
