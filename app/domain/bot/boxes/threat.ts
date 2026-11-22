import { OutcomeSchema, type Coord, type MovementKind, type SurgeKind } from '../../types'
import { getBindingSurge, getSurgeAPLeft, getSurgeRecovery, isLearnedSurge, NEEDS_FOCUS } from '../../character/rules/surge'
import { getRecoveredSTA } from '../../character/rules/characteristics'
import type { Action, ActionDraft, MoveAction, SceneState, StrikeAction } from '../../scene/types'
import { toUpdater, type CommandContext, type SceneCommand } from '../../scene/commands/registry'
import { getLiveActions, getOpenAction, getReactionsTo, withLiveActions } from '../../scene/rules/log'
import { getRootTest } from '../../scene/rules/attack'
import { getHeavyDegree } from '../../scene/rules/heavy'
import { getHeavyName } from '../../character/rules/gear'
import { getAvailableActions, getUnfinishedAnswers } from '../../scene/rules/options'
import { getOpenChoices } from '../../scene/projections/choices'
import { getMovementOptions } from '../../scene/rules/move'
import { getKeptWalk } from '../walks'
import { getReachableCells } from '../../scene/rules/board/reach'
import { isClearWalk } from '../reach'
import { distance, extentCells, sameCell } from '../../scene/rules/board/geometry'
import { firesAcross, getEyes, getEyesToward, placeAt, seesAcross, withPlacements } from '../../scene/rules/board/board'
import { isOnProtectLine } from '../../scene/rules/protect'
import { makeAction } from '../../scene/factories'
import { declare, type Intent, type Pick } from '../declare'
import { getApproachDrawn, getStandingCost, type Drawn } from '../approach'
import { getSides } from '../table'
import { getHarm, getPair, type PairAttack, type PairDefence } from '../pairs'
import { cellOf, getAttackRoute, getTargetSpend, getRoundValue, getDanger, getDefendedHarm, getStrikeCells, getHarmAgainst, getHarmTaken, getDefencePerAP, getImmediateThreat, getMeans, getPotentialThreat, getSpendPrice, getAPValue, getSTAWorth, getOutcome, getPresence, getTeam, getThreatened, getThreatening, threatValue, type SpendCost } from '../threat'
import { carryOn, endTurn, finding, settleWait, type Find, type Press } from './nearest'
import { REST_TUNING, type RestTuning } from '../rest'
import { getStressDue, getStressSocial, getStressTurn } from '../../scene/rules/stress'
import type { Box, Decision, Pass, SeatInput } from '../decision'
import { getTurnHolder, keepsSurgeAP } from '../../scene/rules/turn'
import { isCollapsed } from '../../scene/rules/situational'
import { getMedicineAbility, getMedicineBar } from '../../scene/rules/medicine'
import { hasAbility } from '../../abilities'
import { getObjective, getRoundsToAttack, isRuinous } from '../objective'
import { ROUND_AP } from '../../tables'

// Moves by potential threat and attacks by immediate threat (bot/threat.ts),
// every term weighed by a tweakable. A turn asks two questions (the user's
// ruling): what to do now (an attack worth making, or a run from a danger
// above `flee`), and only when no member has anything to do now, how to
// better its position (a walk, a search). A turn is asked
// for, and anyone else's contested, for what the member would do now; once
// the turn is its own it goes on acting, asking both again after each action:
//
// - an attack, from where the character stands or from a cell it can walk to
//   this turn, is worth the harm it leaves the target answering as it is
//   believed to (`getDefendedHarm`; the user's ruling: gain and cost alike in
//   harm, nothing of what the defence costs the target), made more by how threatened the target is
//   by the whole team and how threatening it is to anyone in the team, as a
//   share of a life; less the defence it loses (the user's ruling,
//   2026-11-22): what a round's AP saves answering the foes' strikes at the
//   cell, over the round's AP, for every AP of its own the attack spends
//   (`getDefencePerAP`); with a walk in, plus the walk's score over standing
//   still, as a walk is scored (the user's ruling, 2026-11-22); from the
//   cheapest cell that reaches, or one that draws fewer opportunity attacks;
//   made where that comes out above nothing;
// - with no attack worth making, a walk is worth the potential harm the
//   character could do from the cell to the foe it threatens most, counting
//   every attack a fresh round pays for once the walk in is paid, so that
//   closing on a foe is worth the attacks it frees (the user's ruling), and,
//   for every cell it closes on a foe too far off to have a potential threat
//   on, `aggression` (the user's ruling: a foe it cannot yet hurt is still gone after),
//   less `company` for every metre from the nearest ally beyond the next
//   cell (the user's ruling: everyone is safer close to allies), less the
//   walk at its price and the foes' immediate threat on it at the cell, with
//   what it has left to defend once it has walked there, the only exposure
//   it counts (the user's ruling: exposure counted once); standing still the
//   same, with all it holds; it walks when that beats standing by a margin;
// - with nothing worth doing, its objective tips the scale (the user's
//   ruling): of the attacks on the foe it threatens most and the walks, those
//   that bring it fewer rounds from attacking that foe than standing still and
//   do not leave it believed collapsed by the round's end, the best scored,
//   where it loses less against standing still than standing still costs
//   this round (`planObjective`, bot/objective.ts);
// - with no foe in sight, or none it notices (the user's ruling: a foe it
//   cannot aim at is looked for), it searches (`planSearch`): it walks where
//   it would see most of what its side does not, drawn towards the board's
//   middle;
// - a walk, to attack or not, costs the opportunity attacks it draws from the
//   foes it closes on within their reach, read step by step along the cells
//   it is walked through, and a shot those of the foes whose melee weapons
//   reach where it is fired from (bot/approach.ts); what answering them
//   costs is paid out of the AP the attack after the walk leaves, and the
//   danger the character ends in is read with that much less to defend with;
// - a walk and standing still are each worth what the AP they
//   leave the character is worth to its allies (`getProtections`): the most
//   a block or an intercept it still holds the AP for would save an ally a
//   foe threatens, from a cell on the line it is made from, by `guardian`
//   (the user's ruling: a defender whose defence takes off much is rather
//   passive);
// - in the immediate danger of a foe above `flee` where it stands, unless a
//   walk of its own brought it there this round or the last expecting as much
//   (the user's ruling), it runs
//   where that danger, with what the walk leaves it to defend, is least,
//   where what it takes off beats the walk at its price by `margin`; the run
//   or the attack, whichever is worth more;
// - an attack or a walk may be paid for after a combat or a movement surge;
//   every AP of its own spent is priced, and of a surge its STA, not its AP,
//   which is lost at the turn's end (the user's ruling, 2026-11-22);
// - attacked, it answers with the defence (or none) that leaves the least
//   harm and price together, after the opportunity attack a shot at it draws
//   where that is worth making; where someone else defends it already, its
//   own defence is weighed against the attack as that leaves it, and made
//   only where it saves more than `redundant` (the user's ruling: the one
//   attacked may still defend itself, though it generally should not);
// - an ally attacked, it defends it (combat.tex "Protect", "Guard") only
//   where the attack is a greater immediate threat to the ally than it would
//   be to the character, by `cover` (the user's ruling), and neither the ally
//   nor anyone else defends it already: with the defence offered that leaves the ally the least harm
//   and the character the least price, where that beats the ally answering
//   for itself;
// - drawn an opportunity attack, it makes the one that scores best as an
//   attack on its turn would, if that is above nothing.
//
// The rest (morale, concentration, landing what it rolled, a surge it is held
// to) it plays as the nearest box does.

export type ThreatWeights = RestTuning & {
  harm: number
  threatened: number
  threatening: number
  // a walk's worth: the potential harm the character could do from the cell, the potential danger there
  offence: number
  peril: number
  // what a walk gains for every cell it comes nearer a foe too far off to have a
  // potential threat on, and a search walk for every cell nearer the board's middle
  aggression: number
  // what a walk is worth less for the danger it leaves the character in this
  // round at the cell it walks to, with what it has left to defend
  arrival: number
  // what a walk gains, with no foe in sight, for every cell of the board it
  // shows that nobody of the side sees
  search: number
  // what a search walk gains for every remembered foe (bot/memory.ts) whose
  // cell it brings into sight, times how much of it is counted (`getPresence`)
  recall: number
  // what a walk must beat standing still by
  margin: number
  // the immediate danger the character must be in where it stands for a run
  // from it to be something to do now
  flee: number
  // what an attack on an ally must threaten it by more than it would the
  // character, for the character to defend it
  cover: number
  // what a character's own defence must save, over the defence someone
  // else already makes for it, to be made as well
  redundant: number
  // what a cell is worth less for every metre from the nearest ally beyond the next cell
  company: number
  // what keeping the AP to defend an ally, at a cell it can be defended from, is worth for every point it would save
  guardian: number
  // what an attack is worth less for every point of harm more it leaves the
  // character to take this round (`getHarmTaken`)
  reserve: number
  // what an attack is worth for every point the defence it is believed to be
  // answered with costs the target (`getTargetSpend`)
  drain: number
  // what an attack is worth less for every AP it spends, the walk in included
  spent: number
}

export const THREAT_WEIGHTS: ThreatWeights = { ...REST_TUNING, harm: 1, threatened: 0.6, threatening: 0.2, offence: 1, peril: 1, aggression: 4, arrival: 1, search: 1, recall: 20, margin: 1, flee: 10, cover: 0, redundant: 5, company: 1, guardian: 1, reserve: 1, drain: 1, spent: 1 }

const NOTHING_DRAWN: Drawn = { worth: 0, harm: 0, AP: 0, STA: 0 }

const TRIAL: CommandContext = { thrower: () => 0, newId: () => 'trial' }
const trial = (state: SceneState, command: SceneCommand) => toUpdater(command, TRIAL)(state)
const argOf = (command: SceneCommand): unknown => (command.args as readonly unknown[])[0]

// `elevation`: the floor the walk ends on in the cell (a cell may be come to on two)
type Walk = { movement: MovementKind; cells: { cell: Coord; AP: number; STA: number; path: Coord[]; elevation: number }[] }

// The movements open to the character this turn, fastest first.
function openMovements(state: SceneState, id: string): MovementKind[] {
  const c = state.characters[id]
  if (!c) return []
  return getMovementOptions(state, c)
    .filter((o): o is typeof o & { kind: MovementKind } => o.available && o.speed > 0)
    .sort((a, b) => b.speed - a.speed)
    .map((o) => o.kind)
}

// The cells the character can walk to this turn at `movement`, with no
// surge, through nobody standing (`isClearWalk`), what the walk costs, and
// the cells it is walked through.
function walkAt(state: SceneState, id: string, movement: MovementKind): Walk | null {
  const moving = trial(trial(state, { kind: 'declare', args: [id, { kind: 'move' }] }), { kind: 'amend', args: [{ movement }] })
  const action = getOpenAction(moving)
  if (action?.kind !== 'move' || action.actorId !== id) return null
  return { movement, cells: getReachableCells(moving, action as MoveAction, getKeptWalk).filter((r) => isClearWalk(moving, action as MoveAction, r.path)).map((r) => ({ cell: r.cell, AP: r.cost.AP, STA: r.cost.STA, path: r.path, elevation: r.elevation })) }
}

// The walk at the character's fastest movement.
function getWalk(state: SceneState, id: string): Walk | null {
  const fastest = openMovements(state, id)[0]
  return fastest ? walkAt(state, id, fastest) : null
}

// The walks a turn weighs (the user's ruling: at least walking and running):
// at each of those that is open, and at the fastest movement open, so that one
// who can only swim, climb or crawl still has a walk.
const WEIGHED_MOVEMENTS: readonly MovementKind[] = ['walk', 'run']

function getWalks(state: SceneState, id: string): Walk[] {
  const open = openMovements(state, id)
  const kinds = new Set([...open.slice(0, 1), ...WEIGHED_MOVEMENTS.filter((m) => open.includes(m))])
  return [...kinds].flatMap((m) => walkAt(state, id, m) ?? [])
}

// whether the walk runs or jumps, which a braced attack answers (combat.tex "Braced Attack")
const runs = (walk: Walk | null): boolean => walk?.movement === 'run' || walk?.movement === 'jump'

// a walk to `cell`, on the floor there at `elevation` (`getReachAt`)
const moveIntent = (id: string, movement: MovementKind, cell: Coord, elevation: number): Intent => ({ actorId: id, option: { kind: 'move' }, picks: [{ part: 'movement', value: movement }, { part: 'cell', value: { q: cell.q, r: cell.r, height: elevation } }] })

const attackIntent = (id: string, attack: PairAttack, target: string): Intent => ({
  actorId: id,
  option: { kind: attack.kind },
  picks: [
    { part: 'row', value: attack.row },
    // the degree as the strike's modifiers offer it (scene/rules/modifiers.ts)
    ...(attack.declaresHeavy ? [{ part: 'modifier' as const, value: { key: `heavy${attack.heavy}`, on: true } }] : []),
    ...(attack.ammoId ? [{ part: 'ammo' as const, value: attack.ammoId }] : []),
    { part: 'target', value: target },
  ],
})

const attackName = (attack: PairAttack) => `${attack.row.attack}${attack.heavy ? `, ${getHeavyName(attack.heavy)}` : ''}`

type Plan =
  | { kind: 'attack'; intent: Intent; score: number; why: string }
  | { kind: 'walk'; intent: Intent; score: number; why: string; expects?: Expects }
  | { kind: 'surge'; surge: SurgeKind; score: number; why: string }
  | { kind: 'care'; intent: Intent; score: number; why: string }

// What a walk expects where it ends (the user's ruling, 2026-11-22: one who
// walked in knowing the danger does not run from it): the harm a fresh round
// of the foes' strikes is believed to do it at `cell` (`getHarmTaken`,
// fresh), with a fresh round's AP and the STA the walk leaves it. Kept by the
// box, by character, for the round the walk is made in and the next.
type Expects = { cell: Coord; harm: number }

const expected = new WeakMap<ThreatWeights, Map<string, Expects & { round: number }>>()

function getExpects(view: SceneState, members: readonly string[], id: string, cell: Coord, STA: number, w: ThreatWeights): Expects {
  return { cell, harm: getHarmTaken(view, members, id, cell, { AP: ROUND_AP, STA }, w, true) }
}

function keepExpects(w: ThreatWeights, id: string, round: number, expects: Expects): void {
  const byId = expected.get(w) ?? new Map<string, Expects & { round: number }>()
  expected.set(w, byId)
  byId.set(id, { ...expects, round })
}

// Whether the character stands where a walk of its own brought it this round
// or the last, and the harm it is believed to take there is no more than the
// walk expected, by `margin`.
function isExpected(view: SceneState, id: string, here: Coord, taken: number, w: ThreatWeights): boolean {
  const kept = expected.get(w)?.get(id)
  return !!kept && sameCell(kept.cell, here) && view.round - kept.round <= 1 && taken <= kept.harm + w.margin
}

// The ways the turn may be paid for: with no surge, or after the combat or the
// movement surge (combat.tex "Action surge"), tried on the fight as a person
// presses it. What the surge costs besides the AP spent from it is its STA and
// the STA the recovery surge would have given back. The focus surge is made
// only for a shot that needs it.
type Budget = {
  surge: SurgeKind | null
  view: SceneState
  // AP and STA the character holds, a surge's included
  AP: number
  STA: number
  // the surge's AP
  surgeAP: number
  // the STA the surge takes, and what the recovery surge it gives up would have given back
  surgeSTA: number
}

function getBudgets(view: SceneState, id: string): Budget[] {
  const me = view.characters[id]
  // a surge made already: its AP still held is paid as the surge's, at no STA more
  const none: Budget = { surge: null, view, AP: me.resources.AP, STA: me.resources.STA, surgeAP: getSurgeAPLeft(me), surgeSTA: 0 }
  if (me.usedSurge !== null) return [none]
  const recovered = getRecoveredSTA(me, me.resources.STA, getSurgeRecovery('recovery')(me)) - me.resources.STA
  const surged = (['combat', 'movement'] as const).flatMap((kind): Budget[] => {
    const after = trial(view, { kind: 'surge', args: [id, kind] })
    const made = after.characters[id]
    if (after === view || !made || made.usedSurge !== kind) return []
    return [{ surge: kind, view: after, AP: made.resources.AP, STA: made.resources.STA, surgeAP: getSurgeAPLeft(made), surgeSTA: me.resources.STA - made.resources.STA + recovered }]
  })
  return [none, ...surged]
}

// Whether a walk of `move` AP and an attack of `attack` AP can be paid for
// out of all the character holds; what a surge's AP may pay for is the
// table's to say (`opensAfter`).
const canPay = (b: Budget, move: number, attack: number): boolean => move + attack <= b.AP

// The surges a walk with no attack after it may be paid for with (the user's
// rulings): none, or the movement surge for a run of at least `RUN_BLOCKS`
// blocks, never the combat surge; none at 0 STA. Each budget with the walks
// it pays for: the movement surge's the run alone.
const RUN_BLOCKS = 2

function getWalkBudgets(view: SceneState, id: string, budgets: readonly Budget[]): { b: Budget; walks: Walk[] }[] {
  const me = view.characters[id]
  return budgets.flatMap((b) => {
    if (b.surge === null) return [{ b, walks: getWalks(b.view, id) }]
    if (b.surge !== 'movement' || !me || me.resources.STA <= 0) return []
    const run = walkAt(b.view, id, 'run')
    return run ? [{ b, walks: [run] }] : []
  })
}

// Whether a walk of `AP` may be paid for out of `b` (`getWalkBudgets`): with
// the movement surge, only a run of at least `RUN_BLOCKS` blocks.
function isWalkPaid(view: SceneState, id: string, b: Budget, AP: number): boolean {
  if (!canPay(b, AP, 0)) return false
  if (b.surge !== 'movement') return true
  const me = view.characters[id]
  const block = me ? getMovementOptions(view, me).find((o) => o.kind === 'run')?.block.AP : undefined
  return block !== undefined && AP >= RUN_BLOCKS * block
}

// The fight as a walk of `AP` and `STA` to `cell` leaves the character:
// standing there with that much less, a surge's AP spent first.
function arrivedAt(state: SceneState, id: string, cell: Coord | null, AP: number, STA: number): SceneState {
  const c = state.characters[id]
  const placed = state.board?.placements[id]
  if (!c || !cell || AP + STA === 0) return state
  const moved = placed && state.board ? withPlacements(state, { [id]: placeAt(state.board, placed, cell) }) : state
  return { ...moved, characters: { ...moved.characters, [id]: { ...c, resources: { ...c.resources, AP: c.resources.AP - AP, STA: c.resources.STA - STA } } } }
}

// The fight once the character gives up what is left of a surge's AP
// (the "end surge" press of its panel).
const givenUp = (state: SceneState, id: string): SceneState => trial(state, { kind: 'edit', args: [id, { kind: 'endSurge', args: [] }, false] })

// Whether the table takes `intent` in `state`: as it stands ('open'), or
// once what is left of a surge's AP is given up ('givingUp'); null when it
// takes it neither way. A surge's AP pays for what the surge allows, and for
// what an ability learned lets it (abilities.tex "Charge"), as the table says.
function opensAfter(state: SceneState, id: string, intent: Intent): 'open' | 'givingUp' | null {
  if (declare(state, intent, TRIAL).ok) return 'open'
  const c = state.characters[id]
  return c && getBindingSurge(c) && declare(givenUp(state, id), intent, TRIAL).ok ? 'givingUp' : null
}

// The walks worth weighing (the user's ruling): towards each foe, the cells
// that come nearest it, and for every block of the walk the cell of that
// block that comes nearest it, so that a walk may stop short; away from the
// foe whose threat is worst, the cells that get furthest from it; towards
// each ally, standing at `friends`, the cells that come nearest it. `TOWARDS`
// and `AWAY` of each.
const TOWARDS = 3
const AWAY = 3

type WalkCell = Walk['cells'][number]

function getDirectedCells(view: SceneState, id: string, here: Coord, walk: Walk, foes: readonly string[], worst: string | null, friends: readonly Coord[]): WalkCell[] {
  const picked = new Map<string, WalkCell>()
  const add = (cells: WalkCell[]) => cells.forEach((c) => picked.set(`${c.cell.q},${c.cell.r}`, c))
  const cheaper = (a: WalkCell, b: WalkCell) => a.AP + a.STA - (b.AP + b.STA)
  const closest = (cells: WalkCell[], left: (c: WalkCell) => number) => {
    const closing = [...cells].sort((a, b) => left(a) - left(b) || cheaper(a, b))
    add(closing.slice(0, TOWARDS))
    const byBlock = new Map<number, WalkCell>()
    closing.forEach((c) => byBlock.has(c.AP) || byBlock.set(c.AP, c))
    add([...byBlock.values()])
  }
  for (const foe of foes) {
    const at = cellOf(view, foe)
    if (!at) continue
    const now = distance(here, at)
    closest(walk.cells.filter((c) => distance(c.cell, at) < now), (c) => distance(c.cell, at))
    // along the way to attacking it, however round about (`getAttackRoute`)
    const route = getAttackRoute(view, id, foe)
    if (!route || route.steps === 0) continue
    const along = new Map(route.path.map((cell, i) => [`${cell.q},${cell.r}`, i + 1]))
    closest(walk.cells.filter((c) => along.has(`${c.cell.q},${c.cell.r}`)), (c) => route.steps - along.get(`${c.cell.q},${c.cell.r}`)!)
  }
  const from = worst ? cellOf(view, worst) : null
  if (from) {
    const now = distance(here, from)
    add(walk.cells.filter((c) => distance(c.cell, from) > now).sort((a, b) => distance(b.cell, from) - distance(a.cell, from) || cheaper(a, b)).slice(0, AWAY))
  }
  for (const at of friends) {
    const now = distance(here, at)
    add(walk.cells.filter((c) => distance(c.cell, at) < now).sort((a, b) => distance(a.cell, at) - distance(b.cell, at) || cheaper(a, b)).slice(0, TOWARDS))
  }
  return [...picked.values()]
}

// Where an attack with `reach` on a target standing at `at` is made from (the
// user's ruling: of the walk, only the cheapest route towards the target
// matters, with the opportunity attacks it draws as the caveat): where the
// character stands, if it reaches from there; otherwise the cheapest cell of
// the walk that reaches, and where walking there draws opportunity attacks
// (`draws`), the cheapest of the next `ATTACK_SCAN` that draws the least.
// Only the cells `clear` keeps (a shot's: a line of fire to the target; a
// strike's: the melee gap the table measures within reach, `getStrikeCells`).
const ATTACK_SCAN = 8

type AttackCell = { cell: Coord | null; AP: number; STA: number; path: Coord[]; elevation?: number }

function getAttackCells(here: Coord | null, walk: Walk | null, at: Coord | null, reach: number, draws: (c: AttackCell) => number, clear: (cell: Coord) => boolean = () => true): AttackCell[] {
  if (!here || !at || (distance(here, at) <= reach && clear(here))) return [{ cell: here, AP: 0, STA: 0, path: [] }]
  if (!walk) return []
  const reaching = walk.cells.filter((c) => !sameCell(c.cell, here) && distance(c.cell, at) <= reach && clear(c.cell)).sort((a, b) => a.AP - b.AP || a.STA - b.STA)
  const cheapest = reaching[0]
  if (!cheapest) return []
  const drawn = draws(cheapest)
  if (drawn <= 0) return [cheapest]
  let least: { c: AttackCell; drawn: number } = { c: cheapest, drawn }
  for (const c of reaching.slice(1, 1 + ATTACK_SCAN)) {
    const d = draws(c)
    if (d < least.drawn) least = { c, drawn: d }
    if (d <= 0) break
  }
  return least.c === cheapest ? [cheapest] : [cheapest, least.c]
}

// The AP of a budget the character still holds once `spent` of it is paid
// for, the surge's paying first wherever it may: a surge's AP is dropped at
// the turn's end, so only the AP of its own is left to defend with.
const heldAP = (b: Budget, spent: number): number => Math.max(0, Math.min(b.AP - spent, b.AP - b.surgeAP))

// The AP of `spent` (a walk of `walkAP` and whatever follows it) the character
// pays out of its own, a surge's AP paying first for what it may: a movement
// surge's only the walk (combat.tex "Action surge"), any other's all of it.
// Only those are priced (the user's ruling, 2026-11-22): a surge's AP is lost
// at the turn's end, so what the surge costs is its STA.
function ownAP(view: SceneState, id: string, b: Budget, walkAP: number, spent: number): number {
  const kind = b.surge ?? view.characters[id]?.usedSurge ?? null
  return Math.max(0, spent - Math.min(b.surgeAP, kind === 'movement' ? walkAP : spent))
}

// What the AP a character keeps is worth to its allies (the user's ruling: a
// character whose defence takes off much should rather keep its AP, and stand
// where it can defend): every ally under a foe's immediate threat of a strike
// that `protect` would defend it from (the strike a greater threat to the
// ally than it would be to the character, by `cover`), with the most its
// block or intercept would save the ally, less what the defence costs. The
// harm the ally is left with is its own undefended harm, as much less as the
// character's defence takes off the strike made on itself. A guard against a
// shot is not read.
type Protection = { root: StrikeAction; AP: number; gain: number }

function getProtections(view: SceneState, members: readonly string[], id: string, w: ThreatWeights): Protection[] {
  const me = view.characters[id]
  if (!me) return []
  const means = getMeans(me, true, w)
  const { foes } = getSides(view, members)
  const found: Protection[] = []
  for (const ally of getTeam(view, members)) {
    if (ally === id || !view.characters[ally]) continue
    for (const foe of foes) {
      const attacker = view.characters[foe]
      const threat = attacker ? getImmediateThreat(view, members, foe, ally, cellOf(view, ally), w) : null
      if (!attacker || !threat || threat.attack.kind !== 'strike') continue
      const row = threat.attack.row
      const mine = getPair(attacker, me).find((a) => a.kind === 'strike' && a.row.weaponKey === row.weaponKey && a.row.attack === row.attack && a.row.variant === row.variant && a.heavy === threat.attack.heavy)
      if (!mine) continue
      const gap = mine.reach
      const toMe = getDefendedHarm(mine, gap, means, 'now', me.injuries.bleed, w)?.worth ?? 0
      if (threat.worth - toMe <= w.cover) continue
      const none = mine.defences.find((d) => d.draft === null)
      const bare = none ? getHarmAgainst(mine, none, gap) : 0
      if (bare <= 0) continue
      let best: { AP: number; gain: number } | null = null
      for (const d of mine.defences) {
        if (d.draft?.kind !== 'block' && d.draft?.kind !== 'intercept') continue
        const left = (threat.undefended * getHarmAgainst(mine, d, gap)) / bare
        const gain = threat.worth - left - getSpendPrice(d.cost, means.STA, me.injuries.bleed, 0, w)
        if (gain > 0 && (!best || gain > best.gain)) best = { AP: d.cost.AP, gain }
      }
      if (best) found.push({ root: makeAction('strike', { id: 'protected', actorId: foe, targetId: ally, ...row }) as StrikeAction, ...best })
    }
  }
  return found
}

// What keeping `AP` at a cell is worth to the character's allies, by
// `guardian`: the most any protection it holds the AP for would gain, where
// the cell is on the line it is made from (combat.tex "Protect").
function getKeeping(view: SceneState, id: string, protections: readonly Protection[], w: ThreatWeights): (cell: Coord | null, AP: number) => number {
  const placed = view.board?.placements[id]
  return (cell, AP) => {
    if (!cell || !placed || !view.board || protections.length === 0) return 0
    const placement = placeAt(view.board, placed, cell)
    const moved = withPlacements(view, { [id]: placement })
    return w.guardian * protections.reduce((most, p) => (p.AP <= AP && p.gain > most && isOnProtectLine(moved, p.root, id, placement) ? p.gain : most), 0)
  }
}

// The measures every attack the character could make in `view` is weighed
// by, on its turn or as an opportunity attack (the user's ruling): what it
// gains from the attack, less the defence it loses making it and the STA it
// spends. All of it is harm, where 100 is a life (2 per IL, death past 50 IL;
// combat.tex "Death"). The opportunity attacks it draws are its caller's to
// take off.
export type AttackScore = {
  total: number
  // the harm the attack leaves the target answering with the defence it is
  // believed to pick, `w.harm` times, made more the more the target is to the
  // team than the other foes are (`target`, over their mean)
  harm: number
  target: number
  // what that defence costs the target (`getTargetSpend`), `w.drain` times,
  // made more the more threatening the target is than the other foes are
  // (`threat`, over their mean; the user's ruling: AP burned is worth more on
  // a foe more threatening, however vulnerable it is)
  drain: number
  threat: number
  // the defence it loses: what an AP of defence is worth at the cell the
  // attack is made from (`getDefencePerAP`), for every AP of its own the
  // attack spends, `reserve` times
  defence: number
  // the STA it spends (`getSTAWorth`)
  STA: number
  // the AP of its own the attack spends, `spent` for each (the user's
  // ruling: every AP costs something, even where the defence it loses costs
  // nothing)
  AP: number
  // the walk to where the attack is made from, as a walk is scored over
  // standing still (`getPlace`; the user's ruling, 2026-11-22: an attack
  // with a walk in is the walk's score and the attack's), none from where it stands
  walk: number
}

const gainOf = (s: AttackScore): number => s.harm * s.target + s.drain * s.threat
const totalOf = (s: AttackScore): number => gainOf(s) - s.defence - s.STA - s.AP + s.walk
const showScore = (s: AttackScore): string => `gain ${gainOf(s).toFixed(1)} (harm ${s.harm.toFixed(1)} x ${s.target.toFixed(2)} + drain ${s.drain.toFixed(1)} x ${s.threat.toFixed(2)}) - defence lost ${s.defence.toFixed(1)} - STA ${s.STA.toFixed(1)} - AP ${s.AP.toFixed(1)}${s.walk ? ` + walk ${s.walk.toFixed(1)}` : ''}`

type AttackMeasures = {
  // the worst foe's threat this round on the character at `at`, with what it
  // has left to defend
  dangerLeft: (AP: number, STA: number, at: Coord | null) => number
  // every AP spent at `AP` plus `danger` times the danger left (the user's
  // ruling: any AP spent costs, more the more threatened the character is);
  // STA dearer the less is left
  price: (AP: number, STA: number, at: Coord | null) => number
  // what spending `spent` STA is worth to the character (`getSTAWorth`)
  STAWorth: (spent: number) => number
  // an attack leaving `harm` on `foe` and costing it `drain` to answer, made
  // from `at`, spending `AP` of its own and `STA`, after a walk there worth `walk`
  score: (harm: number, drain: number, foe: string, at: Coord | null, AP: number, STA: number, walk?: number) => AttackScore
}

function getAttackMeasures(view: SceneState, members: readonly string[], id: string, w: ThreatWeights): AttackMeasures {
  const me = view.characters[id]
  const left = { AP: me.resources.AP, STA: me.resources.STA }
  const dangerLeft = (AP: number, STA: number, at: Coord | null) => getDanger(view, members, id, 'immediate', at, { AP: Math.max(0, left.AP - AP), STA: Math.max(0, left.STA - STA) }, w)
  const price = (AP: number, STA: number, at: Coord | null) => {
    return getSpendPrice({ AP, STA }, left.STA, me.injuries.bleed, AP > 0 ? dangerLeft(AP, STA, at) : 0, w)
  }
  const APvalue = getAPValue(view, members, id, cellOf(view, id), w)
  const STAWorth = (spent: number) => getSTAWorth(me, spent, left.STA, APvalue, w)
  // what each foe is to the team (how threatened by the whole team, how
  // threatening to anyone in it), and how threatening, over the foes' mean
  const { foes } = getSides(view, members)
  const relative = (read: (foe: string) => number) => {
    const all = new Map(foes.map((foe) => [foe, read(foe)]))
    const mean = foes.length ? [...all.values()].reduce((sum, x) => sum + x, 0) / foes.length : 0
    return (foe: string) => (mean > 0 ? (all.get(foe) ?? 0) / mean : 1)
  }
  let target: ((foe: string) => number) | null = null
  let threat: ((foe: string) => number) | null = null
  const perAP = (at: Coord | null) => getDefencePerAP(view, members, id, at, left, w)
  const score = (harm: number, drain: number, foe: string, at: Coord | null, AP: number, STA: number, walk = 0): AttackScore => {
    target ??= relative((f) => w.threatened * getThreatened(view, members, f, w) + w.threatening * getThreatening(view, members, f, w))
    threat ??= relative((f) => getThreatening(view, members, f, w))
    const parts = { harm: w.harm * harm, target: target(foe), drain: w.drain * drain, threat: threat(foe), defence: AP > 0 ? w.reserve * perAP(at) * AP : 0, STA: STAWorth(STA), AP: w.spent * AP, walk }
    return { ...parts, total: totalOf({ ...parts, total: 0 }) }
  }
  return { dangerLeft, price, STAWorth, score }
}

// With no foe in sight, the search widens (the user's ruling). Where the side
// knows a foe stands (an ally sees it, or the seat remembers where it was last
// noticed, heard among others), the search is for that place (the user's
// ruling): `recall` for every such foe whose cell comes into sight, `offence`
// for the potential threat it gains there on those it would see (the user's
// ruling: a cell an archer sees a foe from is one it can shoot from), and
// `aggression` for every cell nearer the nearest. Where it knows of none, a
// walk to where the character sees the most of the board its side sees none
// of now, and the nearer the board's middle the better, `search` for every
// such cell and `aggression` for every cell nearer the middle. Either way, less
// the walk's AP and STA at their price with no danger read, and `peril` for
// every point of a fresh round's danger the cell holds more than where it
// stands, as a walk's standing reads it (remembered foes counted where they
// were noticed). A search is weighed for the round to come, never this one's
// danger (the user's ruling: a foe stumbled on unseen is detection's matter).
// The cells weighed are `SEARCH_CELLS` of the walk's, spread from the
// furthest in, and the board is read at most `SEARCH_SPREAD` cells of it.
const SEARCH_CELLS = 12
const SEARCH_SPREAD = 240

function planSearch(view: SceneState, members: readonly string[], id: string, w: ThreatWeights): Plan | null {
  const board = view.board
  const me = view.characters[id]
  const here = cellOf(view, id)
  if (!board || !me || !here) return null
  const eyes = getEyesToward(view, id, 0)
  const sees = (from: Coord, cell: Coord) => seesAcross(board, [from], [cell], eyes)
  const team = members.flatMap((m) => cellOf(view, m) ?? [])
  // where the side knows a foe the character does not notice stands: seen by
  // an ally, or remembered where it was last noticed (heard, among others)
  const known = getSides(view, members).foes.flatMap((foe) => {
    const at = cellOf(view, foe)
    return at ? [{ foe, at, presence: getPresence(view, foe, w) }] : []
  })
  // what the character could do from `cell` to the known foes it would see
  // there, as a walk's standing reads it (`planWalk`): the most potential
  // threat on any one of them
  const offence = (cell: Coord): number => known.reduce((most, k) => (sees(cell, k.at) ? Math.max(most, threatValue(getPotentialThreat(view, members, id, k.foe, k.at, cell, w))) : most), 0)
  const offenceHere = offence(here)
  const dark = known.length ? [] : extentCells(board.origin, board.extent).filter((c) => !team.some((t) => sees(t, c)))
  if (known.length === 0 && dark.length === 0) return null
  // the cells still to walk to attack the nearest known foe (`getAttackRoute`), null where none can be
  const nearest = (cell: Coord): number | null => known.reduce<number | null>((least, k) => {
    const route = getAttackRoute(view, id, k.foe, cell)
    return route && (least === null || route.steps < least) ? route.steps : least
  }, null)
  const nearestHere = known.length ? nearest(here) : null
  const perilHere = getDanger(view, members, id, 'potential', here, undefined, w)
  const every = Math.max(1, Math.ceil(dark.length / SEARCH_SPREAD))
  const read = dark.filter((_, i) => i % every === 0)
  let best: { cell: Coord; elevation: number; score: number; found: number; budget: Budget; movement: MovementKind } | null = null
  for (const { b, walks } of getWalkBudgets(view, id, getBudgets(view, id))) for (const walk of walks) {
    const far = walk.cells.filter((c) => !sameCell(c.cell, here)).sort((x, y) => distance(y.cell, here) - distance(x.cell, here))
    const step = Math.max(1, Math.floor(far.length / SEARCH_CELLS))
    for (let i = 0; i < far.length; i += step) {
      const { cell, AP, STA, elevation } = far[i]
      if (!isWalkPaid(view, id, b, AP)) continue
      const found = read.filter((c) => sees(cell, c)).length * every
      const recalled = known.reduce((sum, k) => sum + (sees(cell, k.at) ? k.presence : 0), 0)
      const nearestThere = known.length ? nearest(cell) : null
      const closer = !known.length ? distance(here, board.origin) - distance(cell, board.origin) : nearestHere !== null && nearestThere !== null ? nearestHere - nearestThere : 0
      const peril = w.peril * (getDanger(view, members, id, 'potential', cell, undefined, w) - perilHere)
      const threat = known.length ? w.offence * (offence(cell) - offenceHere) : 0
      const score = w.search * found + w.recall * recalled + threat + w.aggression * closer - getSpendPrice({ AP: ownAP(view, id, b, AP, AP), STA: STA + b.surgeSTA }, me.resources.STA, me.injuries.bleed, 0, w) - peril
      if (!best || score > best.score) best = { cell, elevation, score, found, budget: b, movement: walk.movement }
    }
  }
  if (!best || best.score <= w.margin) return null
  const why = known.length
    ? `searches where its side knows a foe stands: walks to see ${known.length > 1 ? 'them' : 'it'} (${best.score.toFixed(1)})`
    : `searches: walks where it sees about ${best.found} cells nobody of its side sees (${best.score.toFixed(1)})`
  if (best.budget.surge) return { kind: 'surge', surge: best.budget.surge, score: best.score, why: `makes the ${best.budget.surge} surge: ${why}` }
  const intent = moveIntent(id, best.movement, best.cell, best.elevation)
  return declare(view, intent, TRIAL).ok ? { kind: 'walk', intent, score: best.score, why } : null
}

// What every plan of the turn reads of the fight as the character holds the
// turn in `view`: where it stands, its foes, what it holds, its measures, the
// ways it may pay, and what the AP it keeps is worth to its allies.
type TurnContext = {
  view: SceneState
  members: readonly string[]
  id: string
  w: ThreatWeights
  unnoticed: ReadonlySet<string>
  me: SceneState['characters'][string]
  here: Coord | null
  foes: string[]
  left: { AP: number; STA: number }
  measures: AttackMeasures
  drawnOn: (to: Coord | null, AP: number, STA: number, running: boolean, path: readonly Coord[], holding?: { AP: number; STA: number }) => Drawn
  drawn: (to: Coord | null, AP: number, STA: number, running: boolean, path: readonly Coord[]) => number
  fired: (at: Coord | null, AP: number, STA: number) => number
  budgets: Budget[]
  keeping: (cell: Coord | null, AP: number) => number
  kept: number
}

function getTurnContext(view: SceneState, members: readonly string[], id: string, w: ThreatWeights, unnoticed: ReadonlySet<string>): TurnContext | null {
  const me = view.characters[id]
  const here = cellOf(view, id)
  if (!me) return null
  const { foes } = getSides(view, members)
  const left = { AP: me.resources.AP, STA: me.resources.STA }
  const measures = getAttackMeasures(view, members, id, w)
  // what answering with `guard` spends, as it answers an attack on its turn
  // (the user's ruling): what the AP and STA would have done otherwise this
  // round (`getRoundValue`), and the STA's worth (`getSTAWorth`)
  const value = getRoundValue(view, members, id, here, w)
  const spending = (guard: { AP: number; STA: number }): SpendCost => (spent) => value(guard.AP, guard.STA) - value(Math.max(0, guard.AP - spent.AP), Math.max(0, guard.STA - spent.STA)) + measures.STAWorth(spent.STA)
  // the opportunity attacks walking from where the character stands to `to`
  // draws from the foes it closes on within their reach, each answered as it
  // would answer it, the harm they leave and what answering them spends
  // (bot/approach.ts)
  const drawnOn = (to: Coord | null, AP: number, STA: number, running: boolean, path: readonly Coord[], holding = left): Drawn => {
    if (!here || !to || sameCell(here, to)) return NOTHING_DRAWN
    const guard = { AP: Math.max(0, holding.AP - AP), STA: holding.STA - STA }
    return getApproachDrawn(view, id, here, to, running, foes, (f) => getMeans(view.characters[f], false, w), guard, w, path, spending(guard))
  }
  const drawn = (to: Coord | null, AP: number, STA: number, running: boolean, path: readonly Coord[]) => w.opportunity * drawnOn(to, AP, STA, running, path).harm
  // the harm a shot fired from `at` takes from the opportunity attacks of the
  // foes whose melee weapons reach there (bot/approach.ts)
  const fired = (at: Coord | null, AP: number, STA: number) => {
    const guard = { AP: Math.max(0, left.AP - AP), STA: left.STA - STA }
    return w.opportunity * getStandingCost(view, id, at ?? here, foes, (f) => getMeans(view.characters[f], false, w), guard, w, 'harm', spending(guard))
  }
  const budgets = getBudgets(view, id)
  // what the AP it keeps is worth to its allies, where it stands now with all of it
  const keeping = getKeeping(view, id, getProtections(view, members, id, w), w)
  const kept = keeping(here, heldAP(budgets[0], 0))
  return { view, members, id, w, unnoticed, me, here, foes, left, measures, drawnOn, drawn, fired, budgets, keeping, kept }
}

// The attack worth most on the turn, from where the character stands or a
// cell it walks to first (`getAttackCells`), if it is worth making (or
// whatever it is worth, when `compelled`); never on anyone in `unnoticed`,
// whom it cannot aim at. The surges that may pay for it (the user's
// rulings): none at 0 STA but the focus a row needs; the movement surge only
// for a run of at least `RUN_BLOCKS` blocks; the combat surge only for an
// attack the character's own AP (or the movement surge's) cannot pay for, and
// only where its gain is worth the surge's STA. `on` keeps it to the foes
// named, and `allowed` to the attacks it lets through, read at the cell the
// attack is made from with the STA all of it spends and what it leaves.
type Allowed = (at: Coord | null, spentSTA: number, guard: { AP: number; STA: number }) => boolean

function planAttack(ctx: TurnContext, compelled = false, on: readonly string[] = ctx.foes, allowed: Allowed = () => true): Plan | null {
  const { view, id, w, unnoticed, me, here, budgets, drawnOn, fired } = ctx
  const foes = on
  const { score: attackScore, STAWorth } = ctx.measures
  const place = getPlace(ctx)
  const runBlock = getMovementOptions(view, me).find((o) => o.kind === 'run')?.block.AP ?? null
  // the order the budgets are tried in: none, then the movement surge, then the combat surge
  const order = [...budgets].sort((a, b) => (a.surge === null ? 0 : a.surge === 'movement' ? 1 : 2) - (b.surge === null ? 0 : b.surge === 'movement' ? 1 : 2))
  // the attacks (by foe and row) paid for without the combat surge
  const paid = new Set<string>()
  let best: Plan | null = null
  for (const b of order) {
    if (b.surge !== null && me.resources.STA <= 0) continue
    if (b.surge === 'combat' && !foes.some((foe) => !unnoticed.has(foe) && view.characters[foe] && getPair(me, view.characters[foe]).some((a, i) => a.opens.action && !paid.has(`${foe}|${i}`)))) continue
    const walks = b.surge === 'movement' ? [walkAt(b.view, id, 'run')].filter((x): x is Walk => x !== null) : getWalks(b.view, id)
    for (const walk of walks.length ? walks : [null]) for (const foe of foes) {
      const target = view.characters[foe]
      const at = cellOf(view, foe)
      if (!target || unnoticed.has(foe)) continue
      const guard = getMeans(target, false, w)
      const pair = getPair(me, target)
      for (let i = 0; i < pair.length; i++) {
        const attack = pair[i]
        const key = `${foe}|${i}`
        if (!attack.opens.action || (b.surge === 'combat' && paid.has(key))) continue
        const board = view.board
        const clear = attack.kind === 'shoot' && board && at ? (c: Coord) => firesAcross(board, [c], [at], getEyes(view, id, foe)) : getStrikeCells(view, id, foe, at, attack.reach)
        const draws = (c: AttackCell) => drawnOn(c.cell, c.AP, c.STA, runs(walk), c.path, b).harm
        for (const { cell, AP, STA, path, elevation } of getAttackCells(here, walk, at, attack.reach, draws, clear)) {
          if (b.surge === 'movement' && (runBlock === null || AP < RUN_BLOCKS * runBlock)) continue
          const gap = cell && at ? distance(cell, at) : 0
          const needsFocus = attack.needsFocus && me.usedSurge !== 'focus'
          if (needsFocus && (me.usedSurge !== null || b.surge !== null)) continue
          const spent = AP + attack.cost.AP
          const STAspent = STA + attack.cost.STA
          // the walk there, answering what it draws on the way out of what the
          // surge leaves it holding, and the attack, all paid for
          const answering = drawnOn(cell, AP, STA, runs(walk), path, b)
          if (!canPay(b, AP, attack.cost.AP + answering.AP) || STAspent + answering.STA > b.STA) continue
          if (b.surge !== 'combat') paid.add(key)
          const spend = getTargetSpend(view, foe, id, at, guard, w)
          const met = getDefendedHarm(attack, gap, guard, 'now', target.injuries.bleed, w, spend)
          if (!met || met.undefended <= 0) continue
          const held = { AP: Math.max(0, b.AP - spent - answering.AP), STA: Math.max(0, b.STA - STAspent - answering.STA) }
          if (!allowed(cell, me.resources.STA - held.STA, held)) continue
          // the walk in scored as a walk is (`getPlace`), the attack on its own AP and STA
          const walked = place && here && cell && !sameCell(cell, here) ? place.worth(b, cell, AP, STA, 0) - place.stay : 0
          const parts = attackScore(met.harm, spend(met.defence.cost), foe, cell, ownAP(view, id, b, AP, spent) - ownAP(view, id, b, AP, AP), attack.cost.STA + b.surgeSTA + answering.STA, walked)
          if (b.surge === 'combat' && gainOf(parts) <= STAWorth(b.surgeSTA)) continue
          const drew = w.opportunity * answering.harm + (attack.kind === 'shoot' ? fired(cell, AP, STA) : 0)
          const score = parts.total - drew
          if (best && score <= best.score) continue
          const why = `${attack.kind}s ${target.name} (${attackName(attack)}, worth ${met.worth.toFixed(1)}: harm ${met.harm.toFixed(1)} against ${met.defence.draft?.kind ?? 'no defence'}, score ${score.toFixed(1)} = ${showScore(parts)} - drawn ${drew.toFixed(1)})`
          // the attack from here, or the walk to where it is made from, only where the table
          // takes it, after the surge that pays for it: a foe seen may still be out of the line
          // of fire, and a surge made for a move refused is wasted
          const fromHere = !here || !cell || sameCell(cell, here)
          const next = fromHere ? attackIntent(id, attack, foe) : walk && elevation !== undefined ? moveIntent(id, walk.movement, cell, elevation) : null
          const surge = needsFocus ? 'focus' : b.surge
          const paidView = needsFocus ? trial(view, { kind: 'surge', args: [id, 'focus'] }) : b.view
          if (!next || (!fromHere && !declare(paidView, next, TRIAL).ok)) continue
          // the attack, where the walk leaves it: one a surge's AP left does not pay for is made
          // once that AP is given up, out of the character's own
          const opens = opensAfter(arrivedAt(paidView, id, cell, AP, STA), id, attackIntent(id, attack, foe))
          if (!opens || (opens === 'givingUp' && attack.cost.AP > heldAP(b, AP))) continue
          if (surge) best = { kind: 'surge', surge, score, why: surge === 'focus' ? `focuses to shoot: ${why}` : `makes the ${surge} surge: ${why}` }
          else best = fromHere ? { kind: 'attack', intent: next, score, why } : { kind: 'walk', intent: next, score, why: `walks to attack: ${why}`, expects: cell ? getExpects(view, ctx.members, id, cell, held.STA, w) : undefined }
        }
      }
    }
  }
  return best && (best.score > 0 || compelled) && (best.kind !== 'attack' || opensAfter(view, id, best.intent)) ? best : null
}

// A run from the danger the character is in now (the user's ruling: a high
// enough immediate threat makes running something to do now): where the harm
// it is believed to take this round as it stands with all it holds
// (`getHarmTaken`, the same harm an attack weighs) is above `flee`, the walk
// that betters most how it comes out of the round (`getOutcome`: the harm
// landing on it less what its AP and STA save or do, the user's ruling), read
// at the cell with what the walk leaves it, less the STA the walk spends
// (`getSTAWorth`) and the opportunity attacks it draws; made where that is
// above `margin`.
function planFlee(ctx: TurnContext): Plan | null {
  const { view, members, id, w, here, foes, left, budgets, drawn } = ctx
  const { STAWorth } = ctx.measures
  if (!here) return null
  const taken = getHarmTaken(view, members, id, here, left, w)
  if (taken <= w.flee || isExpected(view, id, here, taken, w)) return null
  const now = getOutcome(view, members, id, here, left, w)
  const worst = foes.reduce<{ id: string; danger: number } | null>((q, f) => {
    const danger = threatValue(getImmediateThreat(view, members, f, id, here, w))
    return !q || danger > q.danger ? { id: f, danger } : q
  }, null)
  let run: { cell: Coord; elevation: number; score: number; after: number; budget: Budget; movement: MovementKind } | null = null
  for (const { b, walks } of getWalkBudgets(view, id, budgets)) for (const walk of walks) {
    for (const { cell, AP, STA, path, elevation } of getDirectedCells(view, id, here, walk, [], worst ? worst.id : null, [])) {
      if (sameCell(cell, here) || !isWalkPaid(view, id, b, AP)) continue
      const after = getOutcome(view, members, id, cell, { AP: heldAP(b, AP), STA: Math.max(0, b.STA - STA) }, w)
      const score = now - after - STAWorth(STA + b.surgeSTA) - drawn(cell, AP, STA, runs(walk), path)
      if (!run || score > run.score) run = { cell, elevation, score, after, budget: b, movement: walk.movement }
    }
  }
  if (!run || run.score <= w.margin) return null
  const why = `runs from the danger it is in (${run.movement}, harm taken ${taken.toFixed(1)}; the round comes out ${now.toFixed(1)} to ${run.after.toFixed(1)}, ${run.score.toFixed(1)})`
  if (run.budget.surge) return { kind: 'surge', surge: run.budget.surge, score: run.score, why: `makes the ${run.budget.surge} surge: ${why}` }
  const intent = moveIntent(id, run.movement, run.cell, run.elevation)
  return declare(view, intent, TRIAL).ok ? { kind: 'walk', intent, score: run.score, why } : null
}

// A walk weighed (`getWalkMoves`): its score over standing still, with the
// STA all of it spends and what it leaves to answer with.
type WalkMove = { cell: Coord; elevation: number; score: number; budget: Budget; movement: MovementKind; spentSTA: number; guard: { AP: number; STA: number } }

// What a walk is worth where it ends, apart from what it keeps for its allies
// and the opportunity attacks it draws: the potential threat it gains on its
// foes, `aggression` for the cells it closes on those beyond it, less
// `company` for every metre from the nearest ally beyond the next cell (the
// user's ruling: everyone is safer close to allies), the walk's AP and STA at
// their price with no danger in it, and the danger it leaves the character in
// at the cell, its `arrival`, counted once (the user's ruling, 2026-11-22:
// exposure counted once). `stay` is standing still the same way, with all it
// holds. Read once a turn.
type Place = { stay: number; worth: (b: Budget, cell: Coord, AP: number, STA: number, surgeSTA: number) => number }

const places = new WeakMap<TurnContext, Place | null>()

function getPlace(ctx: TurnContext): Place | null {
  if (places.has(ctx)) return places.get(ctx)!
  const { view, members, id, w, unnoticed, me, here, foes, left } = ctx
  let place: Place | null = null
  if (here) {
    const price = (AP: number, STA: number) => getSpendPrice({ AP, STA }, me.resources.STA, me.injuries.bleed, 0, w)
    const friends = getTeam(view, members).filter((t) => t !== id).flatMap((t) => cellOf(view, t) ?? [])
    const apart = (cell: Coord): number => (friends.length ? Math.max(0, Math.min(...friends.map((f) => distance(cell, f))) - 1) : 0)
    const standing = (cell: Coord): number => {
      const offence = foes.reduce((most, foe) => Math.max(most, threatValue(getPotentialThreat(view, members, id, foe, cellOf(view, foe), cell, w))), 0)
      return w.offence * offence - w.company * apart(cell)
    }
    // the cells a walk closes on the foes too far off for its potential threat
    // to reach (the user's ruling), by the cells still to walk to attack them
    // (`getAttackRoute`)
    const beyond = foes.flatMap((foe) => {
      const at = cellOf(view, foe)
      const route = at && !unnoticed.has(foe) && !getPotentialThreat(view, members, id, foe, at, here, w) ? getAttackRoute(view, id, foe) : null
      return route ? [{ foe, steps: route.steps }] : []
    })
    const pull = (cell: Coord): number => w.aggression * beyond.reduce((most, b) => {
      const left = getAttackRoute(view, id, b.foe, cell)
      return left ? Math.max(most, b.steps - left.steps) : most
    }, 0)
    const stay = standing(here) - w.arrival * getDanger(view, members, id, 'immediate', here, left, w)
    place = {
      stay,
      worth: (b, cell, AP, STA, surgeSTA) => {
        // a surge's AP is dropped at the turn's end, so only the AP of its own is left to defend with
        const guard = { AP: heldAP(b, AP), STA: Math.max(0, b.STA - STA) }
        return standing(cell) + pull(cell) - price(ownAP(view, id, b, AP, AP), STA + surgeSTA) - w.arrival * getDanger(view, members, id, 'immediate', cell, guard, w)
      },
    }
  }
  places.set(ctx, place)
  return place
}

// The walks a turn weighs (`getDirectedCells`), each scored by what it gains
// over standing still (`stay`), so that it reads on the scale an attack's
// score does: harm gained over doing nothing (`getPlace`), with what the AP
// it keeps is worth to its allies there and the opportunity attacks it
// draws. With the STA all of it spends and what it leaves to answer with.
function getWalkMoves(ctx: TurnContext): { stay: number; moves: WalkMove[] } | null {
  const { view, members, id, here, foes, budgets, drawn, keeping, kept } = ctx
  const place = getPlace(ctx)
  if (!here || !place) return null
  const friends = getTeam(view, members).filter((t) => t !== id).flatMap((t) => cellOf(view, t) ?? [])
  const stay = place.stay + kept
  const moves: WalkMove[] = []
  const worst = foes.reduce<{ id: string; danger: number } | null>((q, f) => {
    const danger = threatValue(getPotentialThreat(view, members, f, id, here, cellOf(view, f), ctx.w))
    return !q || danger > q.danger ? { id: f, danger } : q
  }, null)
  for (const { b, walks } of getWalkBudgets(view, id, budgets)) for (const walk of walks) {
    for (const { cell, AP, STA, path, elevation } of getDirectedCells(view, id, here, walk, foes, worst && worst.danger > 0 ? worst.id : null, friends)) {
      if (sameCell(cell, here)) continue
      if (!isWalkPaid(view, id, b, AP)) continue
      const guard = { AP: heldAP(b, AP), STA: Math.max(0, b.STA - STA) }
      const score = place.worth(b, cell, AP, STA, b.surgeSTA) - drawn(cell, AP, STA, runs(walk), path) + keeping(cell, guard.AP)
      moves.push({ cell, elevation, score: score - stay, budget: b, movement: walk.movement, spentSTA: ctx.me.resources.STA - guard.STA, guard })
    }
  }
  return { stay, moves }
}

// The walk, as a plan: the surge that pays for it first, if any.
function walkPlan(view: SceneState, members: readonly string[], id: string, move: WalkMove, why: string, w: ThreatWeights): Plan | null {
  if (move.budget.surge) return { kind: 'surge', surge: move.budget.surge, score: move.score, why: `makes the ${move.budget.surge} surge: ${why}` }
  const intent = moveIntent(id, move.movement, move.cell, move.elevation)
  return declare(view, intent, TRIAL).ok ? { kind: 'walk', intent, score: move.score, why, expects: getExpects(view, members, id, move.cell, move.guard.STA, w) } : null
}

const bestOf = <T extends { score: number }>(xs: readonly T[]): T | null => xs.reduce<T | null>((best, x) => (!best || x.score > best.score ? x : best), null)

// With no attack to make now, a walk by where the character threatens more
// and is threatened less, where it gains over standing still by `margin`.
function planWalk(ctx: TurnContext): Plan | null {
  const walks = getWalkMoves(ctx)
  const move = walks && bestOf(walks.moves)
  if (!walks || !move || move.score <= ctx.w.margin) return null
  return walkPlan(ctx.view, ctx.members, ctx.id, move, `walks where it threatens more, is threatened less and goes after its foes (${move.movement}, ${move.score.toFixed(1)} over standing at ${walks.stay.toFixed(1)})`, ctx.w)
}

// With nothing worth doing (the user's ruling, 2026-11-22: the objective tips
// the scale when every option is bad): of the attacks on the foe it threatens
// most (bot/objective.ts `getObjective`) and the walks, only those that bring
// it fewer rounds from attacking that foe than standing still does
// (`getRoundsToAttack`; an attack this turn the fewest of all) and that do not
// ruin it (`isRuinous`), the one the meters score best, so long as what it
// loses against standing still is less than standing still costs this round
// (`getStayingCost`): where waiting costs nothing, the meters' no stands.
function planObjective(ctx: TurnContext): Plan | null {
  const { view, members, id, w, here } = ctx
  const objective = here && getObjective(view, id, ctx.foes, ctx.unnoticed, w)
  if (!here || !objective) return null
  const target = view.characters[objective.foe]?.name ?? objective.foe
  const now = getRoundsToAttack(view, id, objective, here)
  const floor = -getStayingCost(ctx)
  const allowed: Allowed = (at, spentSTA, guard) => !isRuinous(view, members, id, at, spentSTA, guard, w)
  const attacked = planAttack(ctx, true, [objective.foe], allowed)
  const attack = attacked && attacked.score > floor ? attacked : null
  const walk = bestOf((getWalkMoves(ctx)?.moves ?? []).filter((m) => {
    const then = getRoundsToAttack(view, id, objective, m.cell)
    return m.score > floor && then !== null && (now === null || then < now) && allowed(m.cell, m.spentSTA, m.guard)
  }))
  const why = (what: string) => `nothing is worth doing, so it goes after ${target}, whom it threatens most: ${what}`
  if (attack && (!walk || attack.score >= walk.score)) return { ...attack, why: why(attack.why) }
  return walk && walkPlan(view, members, id, walk, why(`${walk.movement}s to ${getRoundsToAttack(view, id, objective, walk.cell)} round(s) from attacking it, from ${now ?? 'none'} (${walk.score.toFixed(1)})`), w)
}

// The turn of a character its limit stress action makes violent: an attack
// whatever it is worth, or failing one, a walk.
function planViolent(view: SceneState, members: readonly string[], id: string, w: ThreatWeights, unnoticed: ReadonlySet<string>): Plan | null {
  const ctx = getTurnContext(view, members, id, w, unnoticed)
  if (!ctx) return null
  if (ctx.foes.every((f) => unnoticed.has(f))) return planSearch(view, members, id, w)
  return planAttack(ctx, true) ?? planWalk(ctx)
}

// What the character would do now with the turn it holds in `view` (the
// user's ruling): the attack worth making, or the run from the danger it is
// in, whichever is worth more; null when it has nothing to do now.
function planNow(view: SceneState, members: readonly string[], id: string, w: ThreatWeights, unnoticed: ReadonlySet<string>): Plan | null {
  const me = view.characters[id]
  if (me && isCollapsed(view, me)) return planCollapsed(view, id)
  const ctx = getTurnContext(view, members, id, w, unnoticed)
  if (!ctx || ctx.foes.every((f) => unnoticed.has(f))) return null
  return [planAttack(ctx), planFlee(ctx)].reduce<Plan | null>((best, p) => (p && (!best || p.score > best.score) ? p : best), null)
}

// What standing still costs the character this round (the user's ruling: the
// objective may lose no more than waiting costs): the danger it is in where it
// stands with all it holds (`getDanger`, immediate), and the IL its bleed adds
// at the next round's start (combat.tex "Bleed"), in harm.
function getStayingCost(ctx: TurnContext): number {
  const { view, members, id, w, here, me, left } = ctx
  return getDanger(view, members, id, 'immediate', here, left, w) + getHarm(OutcomeSchema.parse({ IL: me.injuries.bleed }))
}

// How the character would better its position with the turn it holds in
// `view`, once it has nothing to do now (the user's ruling): a walk, or with
// no foe it notices, a search; and with nothing worth doing, what its
// objective asks (`planObjective`).
function planLater(view: SceneState, members: readonly string[], id: string, w: ThreatWeights, unnoticed: ReadonlySet<string>): Plan | null {
  const me = view.characters[id]
  if (me && isCollapsed(view, me)) return null
  const ctx = getTurnContext(view, members, id, w, unnoticed)
  if (!ctx) return null
  if (ctx.foes.every((f) => unnoticed.has(f))) return planSearch(view, members, id, w)
  return planWalk(ctx) ?? planObjective(ctx)
}

// The turn of a collapsed character (the user's ruling): only its own bleed
// stopped, by First Aid where it has learned it, else by Tend Wounds (combat.tex
// "Tend Wounds"), after the focus surge both need; worth the harm the bleed
// does (§1). With no bleed, or neither open to it, it does nothing with a turn.
function planCollapsed(view: SceneState, id: string): Plan | null {
  const me = view.characters[id]
  if (!me || me.injuries.bleed === 0) return null
  const score = getHarm(OutcomeSchema.parse({ bleed: me.injuries.bleed }))
  const focused = me.usedSurge === null ? trial(view, { kind: 'surge', args: [id, 'focus'] }) : null
  for (const kind of ['firstAid', 'tendWounds'] as const) {
    if (kind === 'firstAid' && !hasAbility(me, getMedicineAbility(kind))) continue
    const intent: Intent = { actorId: id, option: { kind }, picks: kind === 'firstAid' ? [{ part: 'target', value: id }] : [] }
    const why = `collapsed, stops its bleed of ${me.injuries.bleed} with ${kind === 'firstAid' ? 'first aid' : 'tend wounds'}`
    if (declare(view, intent, TRIAL).ok) return { kind: 'care', intent, score, why }
    if (getMedicineBar(view, me, kind) === NEEDS_FOCUS && focused && focused !== view && declare(focused, intent, TRIAL).ok) return { kind: 'surge', surge: 'focus', score, why: `focuses: ${why}` }
  }
  return null
}

// What the character would do with the turn it holds in `view`: what it
// would do now, and on the pass that asks for anything, failing that, what
// would better its position.
function planTurn(view: SceneState, members: readonly string[], id: string, w: ThreatWeights, unnoticed: ReadonlySet<string>, pass: Pass): Plan | null {
  return planNow(view, members, id, w, unnoticed) ?? (pass === 'any' ? planLater(view, members, id, w, unnoticed) : null)
}

// The strike or the shot `open` on `defender` as the seat knows the attacker,
// and the metres between them: a foe's quiver is guessed and its abilities
// known only once seen (bot/belief.ts), so where the arrows it shoots or the
// variant it makes are not among what it is believed to have, the attack is
// read as the worst of the same row's that are (the user's ruling: an unknown
// arrow is assumed the worst). Null for any other action, or an attack the
// seat cannot read.
function getKnownAttack(view: SceneState, open: Action, defender: string): { attack: PairAttack; gap: number } | null {
  if (open.kind !== 'strike' && open.kind !== 'shoot') return null
  const attacker = view.characters[open.actorId]
  const me = view.characters[defender]
  if (!attacker || !me) return null
  const from = cellOf(view, open.actorId)
  const at = cellOf(view, defender)
  const gap = from && at ? distance(from, at) : 0
  const rows = getPair(attacker, me).filter((a) => a.kind === open.kind && a.row.weaponKey === open.weaponKey && a.row.attack === open.attack && (open.kind !== 'strike' || a.heavy === getHeavyDegree(attacker, open)))
  const undefended = (a: PairAttack) => {
    const none = a.defences.find((d) => d.draft === null)
    return none ? getHarmAgainst(a, none, gap) : 0
  }
  const worst = (list: PairAttack[]) => list.reduce<PairAttack | undefined>((most, a) => (!most || undefended(a) > undefended(most) ? a : most), undefined)
  const variant = rows.filter((a) => a.row.variant === open.variant)
  const known = (list: PairAttack[]) => list.find((a) => open.kind !== 'shoot' || a.ammoId === '' || a.ammoId === open.ammoId)
  const attack = known(variant) ?? worst(variant) ?? worst(rows)
  return attack ? { attack, gap } : null
}

// Who defends someone against `root` with a block, an intercept or a guard
// (combat.tex "Protect", "Guard"), its target among them.
const GUARDING = new Set<ActionDraft['kind']>(['block', 'intercept', 'guard'])
const getGuards = (view: SceneState, root: string): string[] => getReactionsTo(view, root).filter((r) => GUARDING.has(r.kind)).map((r) => r.actorId)

// The DL of the attack open in a state, read as the pair table reads the
// attack answered with `none`: moved by what the reactions declared in the
// state add to the DL the table gives the attack with none declared. The
// table scores a strike or a shot against whichever of its defences puts up
// the most (scene/rules/attack.ts), so two defences are read as it reads them.
function getPairDL(view: SceneState, none: PairDefence): (state: SceneState) => number | null {
  const open = getOpenAction(view)
  const bare = open ? getRootTest(withLiveActions(view, getLiveActions(view).filter((a) => a.reactionTo !== open.id)), open) : null
  return (state) => {
    const root = getOpenAction(state)
    const test = root && bare ? getRootTest(state, root) : null
    return test && bare ? none.DL + test.DL - bare.DL : null
  }
}

// The fight with `draft` declared as `id`'s answer to the open action, its
// picks filled in, or null where it cannot be.
function tryAnswer(view: SceneState, members: readonly string[], id: string, draft: ActionDraft, guard: { AP: number; STA: number }, w: ThreatWeights): { picks: Pick[]; ready: SceneState } | null {
  const picks = fillAnswer(view, members, id, draft, guard, w)
  const made = picks ? declare(view, { actorId: id, option: draft, picks }, TRIAL) : null
  return picks && made?.ok ? { picks, ready: made.ready } : null
}

// The defence of an ally attacked (combat.tex "Protect", "Guard"), made only
// where the attack is a greater immediate threat to the ally, as it would
// answer for itself, than it would be to the character, by `cover` (the
// user's ruling), and nobody defends the ally already (the user's ruling: no
// redundant defence). Of the block, intercept or guard the panel offers, the
// one that leaves the least of the ally's harm and costs the character the
// least, if that beats the ally answering for itself. Each is read with the
// DL the table gives the attack against it, as the difference it makes to
// the attack answered with none. One a surge with a press of its own opens
// is left out: that surge is made by pressing it, only where it is weighed
// (`answer`); a learned one is made only with the defence it opens.
function protect(input: SeatInput, id: string, w: ThreatWeights): Decision | null {
  const view = input.view()
  const open = getOpenAction(view)
  const ally = open?.targetId
  if (!open || !ally || ally === id || !getTeam(view, input.members).includes(ally)) return null
  if (getGuards(view, open.id).length > 0 || getReactionsTo(view, open.id).some((r) => r.actorId === ally)) return null
  const me = view.characters[id]
  const target = view.characters[ally]
  const onAlly = getKnownAttack(view, open, ally)
  const onMe = getKnownAttack(view, open, id)
  if (!me || !target || !onAlly) return null
  const toAlly = getDefendedHarm(onAlly.attack, onAlly.gap, getMeans(target, input.members.includes(ally), w), 'now', target.injuries.bleed, w)
  const means = getMeans(me, true, w)
  const toMe = onMe ? getDefendedHarm(onMe.attack, onMe.gap, means, 'now', me.injuries.bleed, w)?.worth ?? 0 : 0
  if (!toAlly || toAlly.worth - toMe <= w.cover) return null
  const none = onAlly.attack.defences.find((d) => d.draft === null)
  if (!none) return null
  const pairDL = getPairDL(view, none)
  const at = cellOf(view, id)
  let best: { draft: ActionDraft; picks: Pick[]; score: number } | null = null
  for (const o of getAvailableActions(view, id)) {
    if (!o.available || o.reactionTo !== open.id || !GUARDING.has(o.draft.kind) || !o.cost || (o.surge !== null && !isLearnedSurge(o.surge))) continue
    const tried = tryAnswer(view, input.members, id, o.draft, means, w)
    const DL = tried ? pairDL(tried.ready) : null
    if (!tried || DL === null) continue
    const left = getHarmAgainst(onAlly.attack, { ...none, draft: o.draft, cost: o.cost, DL }, onAlly.gap)
    const price = getSpendPrice(o.cost, means.STA, me.injuries.bleed, getDanger(view, input.members, id, 'immediate', at, { AP: Math.max(0, means.AP - o.cost.AP), STA: Math.max(0, means.STA - o.cost.STA) }, w), w)
    const score = left + price
    if (!best || score < best.score) best = { draft: o.draft, picks: tried.picks, score }
  }
  if (!best || best.score >= toAlly.worth) return null
  return { kind: 'declare', intent: { actorId: id, option: best.draft, picks: best.picks }, why: `defends ${target.name} with ${best.draft.kind} (harm left and price ${best.score.toFixed(1)} against ${toAlly.worth.toFixed(1)} answering for itself, ${toMe.toFixed(1)} were it on itself)` }
}

// Of the defences the panel offers `id` against the open attack in `view`,
// the one that leaves the least harm less what it keeps (the user's ruling:
// a defence is made where the harm it saves beats what its AP and STA would
// save answering another attack or do attacking, `getRoundValue`), or none
// (`draft` null); where someone else defends it already (`guardian`), read
// against the attack as that defence leaves it, and only one that saves more
// than `redundant`. `score` is the harm left less what is kept, `harm` the
// harm left. What is kept is the AP left once the stack is played out: an
// earmarked surge's AP left is lost then by one who does not keep it
// (rules/turn.ts `keepsSurgeAP`), so is spent first and never kept. An answer
// only a surge opens is left out: the surge is weighed by itself (`answer`).
function weighDefences(view: SceneState, members: readonly string[], id: string, attack: PairAttack, gap: number, guardian: string | undefined, w: ThreatWeights): { draft: ActionDraft | null; score: number; harm: number } {
  const open = getOpenAction(view)
  const at = cellOf(view, id)
  const means = getMeans(view.characters[id], true, w)
  const value = getRoundValue(view, members, id, at, w, open?.actorId)
  const APvalue = getAPValue(view, members, id, at, w)
  const offered = open ? getAvailableActions(view, id).filter((o) => o.available && o.reactionTo === open.id && o.surge === null) : []
  const me = view.characters[id]
  const dropped = me && !keepsSurgeAP(view, id) ? getSurgeAPLeft(me) : 0
  const keptAP = (spent: number) => Math.max(0, Math.min(means.AP - spent, means.AP - dropped))
  const worth = (d: PairDefence) => getHarmAgainst(attack, d, gap)
  const none = attack.defences.find((d) => d.draft === null)
  // defended by someone else: every answer read with the DL the defences together give the attack
  const pairDL = guardian && none ? getPairDL(view, none) : null
  const guarded = pairDL ? pairDL(view) : null
  const bare = none ? worth(guarded === null ? none : { ...none, DL: guarded }) : 0
  let best: { draft: ActionDraft | null; score: number; harm: number } = { draft: null, score: bare - value(keptAP(0), means.STA), harm: bare }
  for (const o of offered) {
    const d = attack.defences.find((x) => x.draft && sameDraft(x.draft, o.draft))
    if (!d) continue
    const tried = pairDL ? tryAnswer(view, members, id, o.draft, means, w) : null
    const DL = pairDL ? (tried ? pairDL(tried.ready) : null) : d.DL
    if (DL === null) continue
    const harm = worth({ ...d, DL })
    const score = harm - value(keptAP(d.cost.AP), Math.max(0, means.STA - d.cost.STA)) + getSTAWorth(view.characters[id], d.cost.STA, means.STA, APvalue, w) + (guardian ? w.redundant : 0)
    if (score < best.score) best = { draft: o.draft, score, harm }
  }
  return best
}

// The answer to an attack on `id`: the opportunity attack a shot draws from
// it, if one is worth making, then the defence that leaves the least harm less
// what it keeps, or none (`weighDefences`). A surge the panel offers (the
// reaction surge, or the movement surge with its reflexes, combat.tex
// "Reflex") is made first where the answers with it, read on the fight with
// it made, beat those without (the user's ruling: when the harm it would take
// is more than what the STA is worth), by more than the price of the STA it
// spends and what the recovery surge it gives up would give back; of several,
// the one that gains most;
// an opportunity attack or a riposte on it is answered the same way.
function answer(input: SeatInput, id: string, w: ThreatWeights, find: Find, press: Press): Decision | null {
  const view = input.view()
  const open = getOpenAction(view)
  const me = view.characters[id]
  if (!open || !me) return press(find('pass', id), 'lets it come')
  if (open.targetId !== id || (open.kind !== 'strike' && open.kind !== 'shoot')) return protect(input, id, w) ?? opportunity(input, id, w) ?? press(find('pass', id), 'lets it come')
  // shot at from within its reach: the opportunity attack the shot draws, then the defence
  const struck = open.kind === 'shoot' ? opportunity(input, id, w) : null
  if (struck) return struck
  const guardian = getGuards(view, open.id).find((g) => g !== id)
  const known = getKnownAttack(view, open, id)
  if (!known) return press(find('pass', id), 'lets it come: does not know the attack')
  const { attack, gap } = known
  const means = getMeans(me, true, w)
  const best = weighDefences(view, input.members, id, attack, gap, guardian, w)
  const surges = me.resources.STA > 0 ? input.buttons.filter((b) => b.command.kind === 'surge' && argOf(b.command) === id) : []
  let surging: { button: (typeof surges)[number]; gain: number; why: string } | null = null
  for (const surge of surges) {
    const kind = surge.command.args[1] as SurgeKind
    const surged = trial(view, surge.command)
    const made = surged.characters[id]
    const reopened = getOpenAction(surged)
    const after = reopened ? getKnownAttack(surged, reopened, id) : null
    if (surged === view || made?.usedSurge !== kind || !after) continue
    const recovered = getRecoveredSTA(me, me.resources.STA, getSurgeRecovery('recovery')(me)) - me.resources.STA
    const cost = getSTAWorth(me, me.resources.STA - made.resources.STA + recovered, me.resources.STA, getAPValue(view, input.members, id, cellOf(view, id), w), w)
    const withSurge = weighDefences(surged, input.members, id, after.attack, after.gap, guardian, w)
    const gain = best.score - withSurge.score - cost
    if (withSurge.draft === null || gain <= 0 || (surging && gain <= surging.gain)) continue
    surging = { button: surge, gain, why: `makes the ${kind} surge to answer with ${withSurge.draft.kind} (harm ${withSurge.harm.toFixed(1)} less kept: ${withSurge.score.toFixed(1)} against ${best.score.toFixed(1)}, the surge's STA and the recovery given up ${cost.toFixed(1)})` }
  }
  if (surging) {
    const pressed = press(surging.button, surging.why)
    if (pressed) return pressed
  }
  const covered = guardian ? `, ${view.characters[guardian]?.name ?? guardian} defends it` : ''
  if (best.draft === null) return press(find('pass', id), `lets it come (harm ${best.harm.toFixed(1)}, less kept ${best.score.toFixed(1)}${covered})`)
  const picks = fillAnswer(view, input.members, id, best.draft, { AP: means.AP, STA: means.STA }, w)
  if (!picks) return press(find('pass', id), `lets it come: ${best.draft.kind} cannot be finished`)
  return { kind: 'declare', intent: { actorId: id, option: best.draft, picks }, why: `answers with ${best.draft.kind} (harm ${best.harm.toFixed(1)}, less kept ${best.score.toFixed(1)}${covered})` }
}

// An opportunity attack on whoever drew it (combat.tex "Opportunity
// Attack"), weighed as an attack on the character's turn is
// (`getAttackMeasures`): of the rows the draw opens (a braced attack on a step
// towards the weapon, a hook attack on a runner moving away), at each heavy
// degree, the one that scores best, made only where it scores above nothing.
function opportunity(input: SeatInput, id: string, w: ThreatWeights): Decision | null {
  const view = input.view()
  const open = getOpenAction(view)
  const me = view.characters[id]
  if (!open || !me) return null
  const at = cellOf(view, id)
  const measures = getAttackMeasures(view, input.members, id, w)
  const offers = getAvailableActions(view, id).filter((o) => o.available && o.reactionTo === open.id && o.draft.kind === 'opportunityAttack')
  let best: { draft: ActionDraft; picks: Pick[]; score: number; why: string } | null = null
  for (const o of offers) {
    // declared on a copy, as pressed, for the rows the draw opens
    const declared = trial(view, { kind: 'react', args: [id, o.draft, o.surge] })
    const drawn = getUnfinishedAnswers(declared, open).find((r) => r.actorId === id)
    const target = drawn?.targetId ? view.characters[drawn.targetId] : undefined
    if (!drawn || !target) continue
    const rows = getOpenChoices(declared).filter((c) => c.actorId === id && c.part === 'row').map((c) => c.value as PairAttack['row'])
    const guard = getMeans(target, false, w)
    for (const attack of getPair(me, target)) {
      if (attack.kind !== 'strike' || !rows.some((r) => r.weaponKey === attack.row.weaponKey && r.attack === attack.row.attack && r.variant === attack.row.variant)) continue
      const { AP, STA } = attack.cost
      if (AP > me.resources.AP || STA > me.resources.STA) continue
      const spend = getTargetSpend(view, target.id, id, cellOf(view, target.id), guard, w)
      const met = getDefendedHarm(attack, attack.reach, guard, 'now', target.injuries.bleed, w, spend)
      if (!met || met.undefended <= 0) continue
      const parts = measures.score(met.harm, spend(met.defence.cost), target.id, at, AP, STA)
      const score = parts.total
      if (score <= 0 || (best && score <= best.score)) continue
      const picks: Pick[] = [{ part: 'row', value: attack.row }, ...(attack.declaresHeavy ? [{ part: 'modifier' as const, value: { key: `heavy${attack.heavy}`, on: true } }] : [])]
      best = { draft: o.draft, picks, score, why: `opportunity attack on ${target.name} (${attackName(attack)}, worth ${met.worth.toFixed(1)} against ${met.defence.draft?.kind ?? 'no defence'}, score ${score.toFixed(1)} = ${showScore(parts)})` }
    }
  }
  if (!best) return null
  const picks = fillAnswer(view, input.members, id, best.draft, { AP: me.resources.AP, STA: me.resources.STA }, w, best.picks)
  return picks ? { kind: 'declare', intent: { actorId: id, option: best.draft, picks }, why: best.why } : null
}

// What the answer still asks for once declared (where an evasive jump lands),
// picked: a cell where the danger on the character is least, anything else as
// first offered, after the `start` picks. Null when it asks for something
// nothing offers.
function fillAnswer(view: SceneState, members: readonly string[], id: string, draft: ActionDraft, guard: { AP: number; STA: number }, w: ThreatWeights, start: readonly Pick[] = []): Pick[] | null {
  const open = getOpenAction(view)
  if (!open) return null
  const picks: Pick[] = [...start]
  for (let i = 0; i < 4 + start.length; i++) {
    const made = declare(view, { actorId: id, option: draft, picks }, TRIAL)
    if (!made.ok) return null
    if (!getUnfinishedAnswers(made.ready, open).some((r) => r.actorId === id)) return picks
    const fills = getOpenChoices(made.ready).filter((c) => c.actorId === id && !c.chosen)
    const cells = fills.filter((c) => c.part === 'cell')
    const pick = cells.length
      ? cells.reduce((b, c) => (getDanger(view, members, id, 'immediate', c.value as Coord, guard, w) < getDanger(view, members, id, 'immediate', b.value as Coord, guard, w) ? c : b))
      : fills[0]
    if (!pick) return null
    picks.push({ part: pick.part, value: pick.value })
  }
  return null
}

function sameDraft(a: ActionDraft, b: ActionDraft): boolean {
  const ka = Object.keys(a).sort()
  const kb = Object.keys(b).sort()
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && JSON.stringify((a as Record<string, unknown>)[k]) === JSON.stringify((b as Record<string, unknown>)[k]))
}

// The limit stress action the character's turn is owed for (the user's
// ruling, 2026-11-15): a violent character makes its combat surge and
// attacks, whatever the attack is worth; a coward makes its movement surge and
// runs, as far as the surge carries it; every other one defaults to coward.
// Where only a rest makes the surge payable, it rests first (rules/stress.ts
// `getStressDue`). Tanatosis takes no turn. 'none' when the turn is no limit
// stress action.
function takeStressTurn(input: SeatInput, id: string, w: ThreatWeights, find: Find, press: Press): Decision | null | 'none' {
  const view = input.view()
  const turn = getStressTurn(view)
  const me = view.characters[id]
  if (!turn || turn.id !== id || !me) return 'none'
  if (getStressSocial(view, id)) return press(find('defaultToCoward', id), `will not ${turn.action === 'abusive' ? 'insult' : 'negotiate'}: defaults to coward`)
  const due = getStressDue(view)
  if (due?.kind === 'surge') {
    if (due.restFirst) {
      const rest = getAvailableActions(view, id).find((o) => o.available && o.draft.kind === 'rest')
      return rest ? { kind: 'declare', intent: { actorId: id, option: rest.draft, picks: [] }, why: `rests to make the ${due.surge} surge it owes` } : null
    }
    const surge = input.buttons.find((b) => b.command.kind === 'surge' && argOf(b.command) === id && b.command.args[1] === due.surge)
    return press(surge, `makes the ${due.surge} surge its limit stress action owes`)
  }
  if (turn.action === 'violent') {
    const plan = planViolent(view, input.members, id, w, input.unnoticed(id))
    if (plan?.kind === 'attack' || plan?.kind === 'walk') return { kind: 'declare', intent: plan.intent, why: `violent: ${plan.why}` }
  }
  if (turn.action === 'coward' && getSurgeAPLeft(me) > 0) {
    const run = getAway(view, input.members, id, w)
    if (run) return { ...run, why: `coward: ${run.why}` }
  }
  return endTurn(input, id, find, press)
}

// The turn as the box weighed it before starting it (`threatBox`), on the
// fight as starting it would leave it, kept for the turn it then takes: read
// again only where the fight the turn is taken in is not the one weighed.
type Weighed = { view: SceneState; members: readonly string[]; unnoticed: ReadonlySet<string>; plan: Plan }

const weighed = new WeakMap<ThreatWeights, Map<string, Weighed>>()

function keepWeighed(w: ThreatWeights, id: string, kept: Weighed): void {
  const byId = weighed.get(w) ?? new Map<string, Weighed>()
  weighed.set(w, byId)
  byId.set(id, kept)
}

function recallWeighed(w: ThreatWeights, id: string, view: SceneState, members: readonly string[], unnoticed: ReadonlySet<string>): Weighed | null {
  const byId = weighed.get(w)
  const kept = byId?.get(id)
  if (!kept) return null
  byId!.delete(id)
  const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>) => a.size === b.size && [...a].every((x) => b.has(x))
  return sameSet(new Set(kept.members), new Set(members)) && sameSet(kept.unnoticed, unnoticed) && isSame(kept.view, view) ? kept : null
}

// Whether two values written as JSON are alike, parts they share passed over.
function isSame(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null || Array.isArray(a) !== Array.isArray(b)) return false
  const x = a as Record<string, unknown>
  const y = b as Record<string, unknown>
  const keys = Object.keys(x)
  return keys.length === Object.keys(y).length && keys.every((k) => Object.hasOwn(y, k) && isSame(x[k], y[k]))
}

// The turn the character holds, one action at a time (the user's ruling: once
// the turn is its own it goes on acting): what it would do now, read again
// after every action, and failing that what would better its position.
function takeTurn(input: SeatInput, id: string, w: ThreatWeights, find: Find, press: Press): Decision | null {
  const stress = takeStressTurn(input, id, w, find, press)
  if (stress !== 'none') return stress
  const kept = recallWeighed(w, id, input.view(), input.members, input.unnoticed(id))
  const plan = kept ? kept.plan : planTurn(input.view(), input.members, id, w, input.unnoticed(id), 'any')
  // an attack the AP left of a surge does not pay for: that AP given up first
  if (plan?.kind === 'attack' && opensAfter(input.view(), id, plan.intent) === 'givingUp') {
    const give = input.buttons.find((b) => b.command.kind === 'edit' && argOf(b.command) === id && (b.command.args[1] as { kind: string }).kind === 'endSurge')
    const made = press(give, `gives up the ${getBindingSurge(input.view().characters[id])} surge AP left to attack: ${plan.why}`)
    if (made) return made
  }
  if (plan?.kind === 'walk' && plan.expects) keepExpects(w, id, input.view().round, plan.expects)
  if (plan?.kind === 'attack' || plan?.kind === 'walk' || plan?.kind === 'care') return { kind: 'declare', intent: plan.intent, why: plan.why }
  if (plan?.kind === 'surge') {
    const surge = input.buttons.find((b) => b.command.kind === 'surge' && argOf(b.command) === id && b.command.args[1] === plan.surge)
    const made = press(surge, plan.why)
    if (made) return made
  }
  return endTurn(input, id, find, press) ?? getAway(input.view(), input.members, id, w)
}

// A walk the turn cannot end without (a coward's run): to the cell where the
// worst foe's potential threat is least.
function getAway(view: SceneState, members: readonly string[], id: string, w: ThreatWeights): Decision | null {
  const walk = getWalk(view, id)
  if (!walk) return null
  const safest = walk.cells
    .map((c) => ({ cell: c.cell, elevation: c.elevation, danger: getDanger(view, members, id, 'potential', c.cell, undefined, w) }))
    .sort((a, b) => a.danger - b.danger)
    .find((c) => declare(view, moveIntent(id, walk.movement, c.cell, c.elevation), TRIAL).ok)
  return safest ? { kind: 'declare', intent: moveIntent(id, walk.movement, safest.cell, safest.elevation), why: `gets away (danger ${safest.danger.toFixed(1)})` } : null
}

// Outside a turn of its own, the seat asks for one as a player at the table
// would (combat.tex "Turn order": "first to ask, first to play"), for the
// member whose plan is worth most: a turn someone else holds it contests for
// what it would do now (the user's ruling: anyone's turn), and a turn nobody
// holds it starts for what it would do now, or on the pass that asks for
// anything, for what would better its position once no member has anything
// to do now.
export function threatBox(w: ThreatWeights): Box {
  const box: Box = (input) => {
    const { members, waits, buttons } = input
    const { find, press } = finding(buttons)
    for (const wait of waits) {
      const made = wait.for === 'answer' ? answer(input, wait.id, w, find, press)
        : wait.for === 'turn' ? takeTurn(input, wait.id, w, find, press)
        : settleWait(input, wait, find, press, w)
      if (made) return made
    }
    const view = input.view()
    const planned = plansOf(w, view)
    const holder = getTurnHolder(view)
    if (holder && !members.includes(holder) && !members.some((id) => view.contenders.includes(id))) {
      let contest: { id: string; plan: Plan } | null = null
      for (const id of members) {
        if (!find('toggleContest', id)) continue
        const plan = planned(`${id}|contest`, () => planNow(wonBy(view, id), members, id, w, input.unnoticed(id)))
        if (plan && (!contest || plan.score > contest.plan.score)) contest = { id, plan }
      }
      const made = contest && press(find('toggleContest', contest.id), `contests the turn: ${contest.plan.why}`)
      if (made) return made
    }
    let best: { id: string; begun: SceneState; plan: Plan } | null = null
    for (const pass of input.pass === 'any' ? (['immediate', 'any'] as const) : (['immediate'] as const)) {
      for (const id of members) {
        const start = find('startTurn', id)
        if (!start) continue
        const begun = trial(view, start.command)
        const unnoticed = input.unnoticed(id)
        const plan = planned(`${id}|${pass}`, () => (pass === 'immediate' ? planNow(begun, members, id, w, unnoticed) : planLater(begun, members, id, w, unnoticed)))
        if (plan && (!best || plan.score > best.plan.score)) best = { id, begun, plan }
      }
      if (best) break
    }
    const start = best && find('startTurn', best.id)
    if (best && start) {
      keepWeighed(w, best.id, { view: best.begun, members, unnoticed: input.unnoticed(best.id), plan: best.plan })
      return { kind: 'press', pick: start, why: `has something worth doing: ${best.plan.why}` }
    }
    return input.pass === 'any' ? carryOn(input, find) : { kind: 'wait', why: 'nothing to do now' }
  }
  box.remembers = true
  return box
}

// The plans the box has weighed on a view of the fight, by member and
// question, so that a seat asked again on the same view (its 'immediate' pass,
// then its 'any' pass) weighs each only once.
const plansKept = new WeakMap<ThreatWeights, WeakMap<SceneState, Map<string, Plan | null>>>()

function plansOf(w: ThreatWeights, view: SceneState): (key: string, weigh: () => Plan | null) => Plan | null {
  const byView = plansKept.get(w) ?? new WeakMap<SceneState, Map<string, Plan | null>>()
  plansKept.set(w, byView)
  const kept = byView.get(view) ?? new Map<string, Plan | null>()
  byView.set(view, kept)
  return (key, weigh) => {
    if (!kept.has(key)) kept.set(key, weigh())
    return kept.get(key)!
  }
}

// The fight as it would be had the character won the contest for the turn
// held now: the turn its own, the contest over.
function wonBy(view: SceneState, id: string): SceneState {
  return { ...view, inTurnCharacter: id, contenders: [], contestModes: {}, lastContest: { rolls: [], winner: id } }
}
