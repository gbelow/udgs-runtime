import type { Coord, MovementKind, SurgeKind } from '../../types'
import { getBindingSurge, getSurgeAPLeft, getSurgeRecovery } from '../../character/rules/surge'
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
import { getReachableCells } from '../../scene/rules/board/reach'
import { isClearWalk } from '../reach'
import { distance, extentCells, sameCell } from '../../scene/rules/board/geometry'
import { firesAcross, getEyes, getEyesToward, placeAt, seesAcross, withPlacements } from '../../scene/rules/board/board'
import { isOnProtectLine } from '../../scene/rules/protect'
import { makeAction } from '../../scene/factories'
import { declare, type Intent, type Pick } from '../declare'
import { getApproachDrawn, getStandingCost, type Drawn } from '../approach'
import { getSides } from '../table'
import { getPair, type PairAttack, type PairDefence } from '../pairs'
import { withSheet, cellOf, getTargetDanger, getDanger, getDefendedHarm, getStrikeCells, getHarmAgainst, getHarmDanger, getImmediateThreat, getMeans, getPotentialThreat, getSpendPrice, getSTAPrice, getTeam, getThreatened, getThreatening, threatValue } from '../threat'
import { carryOn, endTurn, finding, settleWait, type Find, type Press } from './nearest'
import { REST_TUNING, type RestTuning } from '../rest'
import { getStressDue, getStressSocial, getStressTurn } from '../../scene/rules/stress'
import type { Box, Decision, SeatInput } from '../decision'
import { getSwitches } from '../arms'
import { getPayBar } from '../../item/rules/moves'

// Moves by potential threat and attacks by immediate threat (bot/threat.ts),
// every term weighed by a tweakable:
//
// - an attack, from where the character stands or from a cell it can walk to
//   this turn, is worth what it costs the target answering as it is believed
//   to (`getDefendedHarm`: the harm taken, the defence paid for, and more the
//   more the defence takes off), made more by how threatened the target is
//   by the whole team and how threatening it is to anyone in the team, as a
//   share of a life; less the
//   defensive potential it loses (the user's ruling): how much more harm the
//   worst single foe's immediate threat would do it at the cell, with what it
//   has left to defend, than now, more the fewer AP it has left, what the AP
//   it spends was worth to its allies, and the STA it spends at its price (weighing the
//   cheapest cells that reach and the safest); made where that comes out
//   above nothing;
// - with no attack worth making, a walk is worth the potential harm the
//   character could do from the cell to the foe it threatens most, counting
//   every attack a fresh round pays for once the walk in is paid, so that
//   closing on a foe is worth the attacks it frees (the user's ruling), less
//   the worst single foe's potential threat on it there, and, for every
//   cell it closes on a foe too far off to have a potential threat on,
//   `aggression` (the user's ruling: a foe it cannot yet hurt is still gone after),
//   less `company` for every metre from the nearest ally beyond the next
//   cell (the user's ruling: everyone is safer close to allies), standing
//   still the same, and less the walk at the same price and the worst single foe's immediate
//   threat on it at the cell, with what it has left to defend once it has
//   walked there; it walks when that beats standing by a margin;
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
// - an attack, a walk and standing still are each worth what the AP they
//   leave the character is worth to its allies (`getProtections`): the most
//   a block or an intercept it still holds the AP for would save an ally a
//   foe threatens, from a cell on the line it is made from, by `guardian`
//   (the user's ruling: a defender whose defence takes off much is rather
//   passive);
// - at the turn's start, it changes arms (bot/arms.ts) where that raises the
//   most it threatens any foe and lowers the most any foe threatens it by more
//   than the switch costs, with the opportunity attacks its priced moves draw;
// - an attack or a walk may be paid for after a combat or a movement surge;
//   every AP spent is priced, a surge's included (the user's ruling);
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
  // what a walk must beat standing still by
  margin: number
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
  // what the harm an attack leaves the character open to is worth more the
  // fewer AP it has left: `reserve` over them, at least 1
  reserve: number
}

export const THREAT_WEIGHTS: ThreatWeights = { ...REST_TUNING, harm: 1, threatened: 0.6, threatening: 0.2, offence: 1, peril: 1, aggression: 4, arrival: 1, search: 1, margin: 1, cover: 0, redundant: 5, company: 1, guardian: 1, reserve: 10 }

const NOTHING_DRAWN: Drawn = { worth: 0, AP: 0, STA: 0 }

const TRIAL: CommandContext = { thrower: () => 0, newId: () => 'trial' }
const trial = (state: SceneState, command: SceneCommand) => toUpdater(command, TRIAL)(state)
const argOf = (command: SceneCommand): unknown => (command.args as readonly unknown[])[0]

type Walk = { movement: MovementKind; cells: { cell: Coord; AP: number; STA: number; path: Coord[] }[] }

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
  return { movement, cells: getReachableCells(moving, action as MoveAction).filter((r) => isClearWalk(moving, action as MoveAction, r.path)).map((r) => ({ cell: r.cell, AP: r.cost.AP, STA: r.cost.STA, path: r.path })) }
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

const moveIntent = (id: string, movement: MovementKind, cell: Coord): Intent => ({ actorId: id, option: { kind: 'move' }, picks: [{ part: 'movement', value: movement }, { part: 'cell', value: cell }] })

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
  | { kind: 'walk'; intent: Intent; score: number; why: string }
  | { kind: 'surge'; surge: SurgeKind; score: number; why: string }

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

function getDirectedCells(view: SceneState, here: Coord, walk: Walk, foes: readonly string[], worst: string | null, friends: readonly Coord[]): WalkCell[] {
  const picked = new Map<string, WalkCell>()
  const add = (cells: WalkCell[]) => cells.forEach((c) => picked.set(`${c.cell.q},${c.cell.r}`, c))
  const cheaper = (a: WalkCell, b: WalkCell) => a.AP + a.STA - (b.AP + b.STA)
  for (const foe of foes) {
    const at = cellOf(view, foe)
    if (!at) continue
    const now = distance(here, at)
    const closing = walk.cells.filter((c) => distance(c.cell, at) < now).sort((a, b) => distance(a.cell, at) - distance(b.cell, at) || cheaper(a, b))
    add(closing.slice(0, TOWARDS))
    const byBlock = new Map<number, WalkCell>()
    closing.forEach((c) => byBlock.has(c.AP) || byBlock.set(c.AP, c))
    add([...byBlock.values()])
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

// Where an attack with `reach` on a target standing at `at` may be made from:
// where the character stands, if it reaches from there, and of the cells of
// the walk that reach, the cheapest `ATTACK_CELLS` and the `ATTACK_CELLS`
// where the danger on the character is least (`dangerAt`); of those, only
// the ones `clear` keeps (a shot's: a line of fire to the target; a strike's:
// the melee gap the table measures within reach, `getStrikeCells`).
const ATTACK_CELLS = 2

function getAttackCells(here: Coord | null, walk: Walk | null, at: Coord | null, reach: number, dangerAt: (cell: Coord) => number, clear: (cell: Coord) => boolean = () => true): { cell: Coord | null; AP: number; STA: number; path: Coord[] }[] {
  const stay = !here || !at || (distance(here, at) <= reach && clear(here)) ? [{ cell: here, AP: 0, STA: 0, path: [] }] : []
  if (!walk || !at) return stay
  const reaching = walk.cells.filter((c) => (!here || !sameCell(c.cell, here)) && distance(c.cell, at) <= reach && clear(c.cell))
  const cheapest = [...reaching].sort((a, b) => a.AP + a.STA - (b.AP + b.STA)).slice(0, ATTACK_CELLS)
  const safest = reaching.map((c) => ({ c, danger: dangerAt(c.cell) })).sort((a, b) => a.danger - b.danger).slice(0, ATTACK_CELLS).map(({ c }) => c)
  return [...stay, ...new Set([...cheapest, ...safest])]
}

// The AP of a budget the character still holds once `spent` of it is paid
// for, the surge's paying first wherever it may: a surge's AP is dropped at
// the turn's end, so only the AP of its own is left to defend with.
const heldAP = (b: Budget, spent: number): number => Math.max(0, Math.min(b.AP - spent, b.AP - b.surgeAP))

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
      const threat = attacker ? getImmediateThreat(view, members, foe, ally, cellOf(view, ally), undefined, w) : null
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
// gains from the attack, less the defensive potential it loses making it. All
// of it is harm, where 100 is a life (2 per IL, death past 50 IL; combat.tex
// "Death"). The opportunity attacks it draws are its caller's to take off.
export type AttackScore = {
  total: number
  // what it gains: `w.harm` times the attack's worth against the defence,
  // made more by what the target is to the team as a share of a life,
  // `1 + target / LIFE` times
  harm: number
  target: number
  // the defensive potential it loses: the harm the worst single foe's
  // immediate threat would do it at the cell, made as many times as the foe
  // can pay for, with what it is left to defend,
  // over what it would do it now where it stands with all it holds
  // (`getHarmDanger`), `reserve` over the AP left times; and what the AP it
  // no longer holds was worth to its allies (`getKeeping`)
  defence: number
  allies: number
  // the offensive potential it loses (the user's ruling: its own AP counts in
  // its threat): its immediate threat now with all it holds, over what it is
  // at the cell with what it is left, and the attack itself, `offence` times;
  // what the walk and the attack spend without making attacks
  offence: number
  // the STA it spends, at its price (`getSTAPrice`)
  STA: number
}

// The harm of a life: 2 for each IL up to death at 50 (combat.tex "Death", `getHarm`).
const LIFE = 100
const gainOf = (s: AttackScore): number => s.harm * (1 + s.target / LIFE)
const showScore = (s: AttackScore): string =>
  `gain ${gainOf(s).toFixed(1)} (harm ${s.harm.toFixed(1)} x (1 + target ${s.target.toFixed(1)} / ${LIFE})) - defence lost ${s.defence.toFixed(1)} - offence lost ${s.offence.toFixed(1)} - allies' lost ${s.allies.toFixed(1)} - STA ${s.STA.toFixed(1)}`

type AttackMeasures = {
  // the worst foe's threat this round on the character at `at`, with what it
  // has left to defend
  dangerLeft: (AP: number, STA: number, at: Coord | null) => number
  // every AP spent at `AP` plus `danger` times the danger left (the user's
  // ruling: any AP spent costs, more the more threatened the character is);
  // STA dearer the less is left
  price: (AP: number, STA: number, at: Coord | null) => number
  // `held`, where given, is what the character is left with to defend at
  // `at` in place of what spending `AP` and `STA` leaves: a surge's AP added,
  // and what answering the opportunity attacks on the way spent (priced
  // already in what they draw); `allies` is what its allies lose of the AP it
  // keeps for them; `from` is the fight the spending starts from (a budget's,
  // its surge made), where it is other than `view`
  score: (worth: number, foe: string, AP: number, STA: number, at: Coord | null, held?: { AP: number; STA: number }, allies?: number, from?: SceneState) => AttackScore
}

function getAttackMeasures(view: SceneState, members: readonly string[], id: string, w: ThreatWeights): AttackMeasures {
  const me = view.characters[id]
  const left = { AP: me.resources.AP, STA: me.resources.STA }
  const dangerLeft = (AP: number, STA: number, at: Coord | null) => getDanger(view, members, id, 'immediate', at, { AP: Math.max(0, left.AP - AP), STA: Math.max(0, left.STA - STA) }, w)
  const price = (AP: number, STA: number, at: Coord | null) => {
    return getSpendPrice({ AP, STA }, left.STA, me.injuries.bleed, AP > 0 ? dangerLeft(AP, STA, at) : 0, w)
  }
  // how threatened the target is by the whole team, and how threatening to anyone in it
  const worths = new Map<string, number>()
  const targetWorth = (foe: string) => {
    let worth = worths.get(foe)
    if (worth === undefined) worths.set(foe, (worth = w.threatened * getThreatened(view, members, foe, w) + w.threatening * getThreatening(view, members, foe, w)))
    return worth
  }
  const now = getHarmDanger(view, members, id, cellOf(view, id), left, w)
  // its worst immediate threat on a foe in `state`, standing where it stands there
  const { foes } = getSides(view, members)
  const offenceIn = (state: SceneState) => foes.reduce((most, foe) => Math.max(most, threatValue(getImmediateThreat(state, members, id, foe, cellOf(state, foe), undefined, w), w)), 0)
  const offenceNow = offenceIn(view)
  const offences = new Map<string, number>()
  const offenceAt = (from: SceneState, at: Coord | null, kept: { AP: number; STA: number }) => {
    const c = from.characters[id]
    const key = `${at ? `${at.q},${at.r}` : '-'}|${kept.AP}|${kept.STA}|${c.usedSurge}`
    let offence = offences.get(key)
    if (offence === undefined) {
      const placed = from.board?.placements[id]
      const moved = at && placed && from.board ? withPlacements(from, { [id]: placeAt(from.board, placed, at) }) : from
      offences.set(key, (offence = offenceIn({ ...moved, characters: { ...moved.characters, [id]: { ...c, resources: { ...c.resources, AP: kept.AP, STA: kept.STA } } } })))
    }
    return offence
  }
  const score = (worth: number, foe: string, AP: number, STA: number, at: Coord | null, held?: { AP: number; STA: number }, allies = 0, from = view): AttackScore => {
    const kept = held ?? { AP: Math.max(0, left.AP - AP), STA: Math.max(0, left.STA - STA) }
    const open = getHarmDanger(view, members, id, at, kept, w) - now
    const offence = w.offence * Math.max(0, offenceNow - offenceAt(from, at, kept) - worth)
    const parts = { harm: w.harm * worth, target: targetWorth(foe), defence: (open * w.reserve) / Math.max(1, kept.AP), offence, allies, STA: getSTAPrice(STA, left.STA, me.injuries.bleed, w) }
    return { ...parts, total: gainOf({ ...parts, total: 0 }) - parts.defence - parts.offence - parts.allies - parts.STA }
  }
  return { dangerLeft, price, score }
}

// With no foe in sight, the search widens (the user's ruling): a walk to where
// the character sees the most of the board its side sees none of now, and the
// nearer the board's middle the better, `search` for every such cell and
// `aggression` for every cell nearer the middle, less the walk at its price.
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
  const dark = extentCells(board.origin, board.extent).filter((c) => !team.some((t) => sees(t, c)))
  if (dark.length === 0) return null
  const every = Math.ceil(dark.length / SEARCH_SPREAD)
  const read = dark.filter((_, i) => i % every === 0)
  let best: { cell: Coord; score: number; found: number; budget: Budget; movement: MovementKind } | null = null
  for (const b of getBudgets(view, id)) for (const walk of getWalks(b.view, id)) {
    const far = walk.cells.filter((c) => !sameCell(c.cell, here)).sort((x, y) => distance(y.cell, here) - distance(x.cell, here))
    const step = Math.max(1, Math.floor(far.length / SEARCH_CELLS))
    for (let i = 0; i < far.length; i += step) {
      const { cell, AP, STA } = far[i]
      if (!canPay(b, AP, 0)) continue
      const found = read.filter((c) => sees(cell, c)).length * every
      const score = w.search * found + w.aggression * (distance(here, board.origin) - distance(cell, board.origin)) - getSpendPrice({ AP, STA: STA + b.surgeSTA }, me.resources.STA, me.injuries.bleed, 0, w)
      if (!best || score > best.score) best = { cell, score, found, budget: b, movement: walk.movement }
    }
  }
  if (!best || best.score <= w.margin) return null
  const why = `searches: walks where it sees about ${best.found} cells nobody of its side sees (${best.score.toFixed(1)})`
  if (best.budget.surge) return { kind: 'surge', surge: best.budget.surge, score: best.score, why: `makes the ${best.budget.surge} surge: ${why}` }
  const intent = moveIntent(id, best.movement, best.cell)
  return declare(view, intent, TRIAL).ok ? { kind: 'walk', intent, score: best.score, why } : null
}

// What the character would do with the turn it holds in `view`, or null to
// end it; never an attack on anyone in `unnoticed`, whom it cannot aim at.
function planTurn(view: SceneState, members: readonly string[], id: string, w: ThreatWeights, unnoticed: ReadonlySet<string>, compelled = false): Plan | null {
  const me = view.characters[id]
  const here = cellOf(view, id)
  if (!me) return null
  const { foes } = getSides(view, members)
  if (foes.every((f) => unnoticed.has(f))) return planSearch(view, members, id, w)
  const left = { AP: me.resources.AP, STA: me.resources.STA }
  const { dangerLeft, price, score: attackScore } = getAttackMeasures(view, members, id, w)
  // the opportunity attacks walking from where the character stands to `to`
  // draws from the foes it closes on within their reach, and what answering
  // them costs it (bot/approach.ts)
  const drawnOn = (to: Coord | null, AP: number, STA: number, running: boolean, path: readonly Coord[], holding = left): Drawn => (here && to && !sameCell(here, to) ? getApproachDrawn(view, id, here, to, running, foes, (f) => getMeans(view.characters[f], false, w), { AP: Math.max(0, holding.AP - AP), STA: holding.STA - STA }, w, path) : NOTHING_DRAWN)
  const drawn = (to: Coord | null, AP: number, STA: number, running: boolean, path: readonly Coord[]) => w.opportunity * drawnOn(to, AP, STA, running, path).worth
  // what a shot fired from `at` costs it in the opportunity attacks of the
  // foes whose melee weapons reach there (bot/approach.ts)
  const fired = (at: Coord | null, AP: number, STA: number) => w.opportunity * getStandingCost(view, id, at ?? here, foes, (f) => getMeans(view.characters[f], false, w), { AP: Math.max(0, left.AP - AP), STA: left.STA - STA }, w)
  const budgets = getBudgets(view, id)
  // what the AP it keeps is worth to its allies, where it stands now with all of it
  const keeping = getKeeping(view, id, getProtections(view, members, id, w), w)
  const kept = keeping(here, heldAP(budgets[0], 0))

  let best: Plan | null = null
  for (const b of budgets) {
    const walks = getWalks(b.view, id)
    for (const walk of walks.length ? walks : [null]) for (const foe of foes) {
      const target = view.characters[foe]
      const at = cellOf(view, foe)
      if (!target || unnoticed.has(foe)) continue
      const guard = getMeans(target, false, w)
      for (const attack of getPair(me, target)) {
        if (!attack.opens.action) continue
        const board = view.board
        const clear = attack.kind === 'shoot' && board && at ? (c: Coord) => firesAcross(board, [c], [at], getEyes(view, id, foe)) : getStrikeCells(view, id, foe, at, attack.reach)
        for (const { cell, AP, STA, path } of getAttackCells(here, walk, at, attack.reach, (c) => dangerLeft(0, 0, c), clear)) {
          const gap = cell && at ? distance(cell, at) : 0
          const needsFocus = attack.needsFocus && me.usedSurge !== 'focus'
          if (needsFocus && (me.usedSurge !== null || b.surge !== null)) continue
          const spent = AP + attack.cost.AP
          const STAspent = STA + attack.cost.STA
          // the walk there, answering what it draws on the way out of what the
          // surge leaves it holding, and the attack, all paid for
          const answering = drawnOn(cell, AP, STA, runs(walk), path, b)
          if (!canPay(b, AP, attack.cost.AP + answering.AP) || STAspent + answering.STA > b.STA) continue
          const met = getDefendedHarm(attack, gap, guard, 'now', target.injuries.bleed, w, getTargetDanger(view, foe, at, guard, w))
          if (!met || met.undefended <= 0) continue
          const held = { AP: Math.max(0, b.AP - spent - answering.AP), STA: Math.max(0, b.STA - STAspent - answering.STA) }
          const parts = attackScore(met.worth, foe, spent, STAspent + b.surgeSTA, cell, held, kept - keeping(cell, heldAP(b, spent + answering.AP)), b.view)
          const drew = w.opportunity * answering.worth + (attack.kind === 'shoot' ? fired(cell, AP, STA) : 0)
          const score = parts.total - drew
          if (best && score <= best.score) continue
          const why = `${attack.kind}s ${target.name} (${attackName(attack)}, worth ${met.worth.toFixed(1)}: harm ${met.harm.toFixed(1)} against ${met.defence.draft?.kind ?? 'no defence'}, score ${score.toFixed(1)} = ${showScore(parts)} - drawn ${drew.toFixed(1)})`
          // the attack from here, or the walk to where it is made from, only where the table
          // takes it, after the surge that pays for it: a foe seen may still be out of the line
          // of fire, and a surge made for a move refused is wasted
          const fromHere = !here || !cell || sameCell(cell, here)
          const next = fromHere ? attackIntent(id, attack, foe) : walk ? moveIntent(id, walk.movement, cell) : null
          const surge = needsFocus ? 'focus' : b.surge
          const paid = needsFocus ? trial(view, { kind: 'surge', args: [id, 'focus'] }) : b.view
          if (!next || (!fromHere && !declare(paid, next, TRIAL).ok)) continue
          // the attack, where the walk leaves it: one a surge's AP left does not pay for is made
          // once that AP is given up, out of the character's own
          const opens = opensAfter(arrivedAt(paid, id, cell, AP, STA), id, attackIntent(id, attack, foe))
          if (!opens || (opens === 'givingUp' && attack.cost.AP > heldAP(b, AP))) continue
          if (surge) best = { kind: 'surge', surge, score, why: surge === 'focus' ? `focuses to shoot: ${why}` : `makes the ${surge} surge: ${why}` }
          else best = fromHere ? { kind: 'attack', intent: next, score, why } : { kind: 'walk', intent: next, score, why: `walks to attack: ${why}` }
        }
      }
    }
  }
  if (best && (best.score > 0 || compelled) && (best.kind !== 'attack' || opensAfter(view, id, best.intent))) return best

  // no attack worth making: a walk, by where the character threatens more and
  // is threatened less
  if (!here) return null
  // everyone is safer close to allies (the user's ruling): the metres to the nearest one, beyond the next cell
  const friends = getTeam(view, members).filter((t) => t !== id).flatMap((t) => cellOf(view, t) ?? [])
  const apart = (cell: Coord): number => (friends.length ? Math.max(0, Math.min(...friends.map((f) => distance(cell, f))) - 1) : 0)
  const standing = (cell: Coord): number => {
    const offence = foes.reduce((most, foe) => Math.max(most, threatValue(getPotentialThreat(view, members, id, foe, cellOf(view, foe), cell, w), w)), 0)
    return w.offence * offence - w.peril * getDanger(view, members, id, 'potential', cell, undefined, w) - w.company * apart(cell)
  }
  // the cells a walk closes on the foes too far off for its potential threat to reach (the user's ruling)
  const beyond = foes.flatMap((foe) => {
    const at = cellOf(view, foe)
    return at && !unnoticed.has(foe) && !getPotentialThreat(view, members, id, foe, at, here, w) ? [at] : []
  })
  const pull = (cell: Coord): number => w.aggression * beyond.reduce((most, at) => Math.max(most, distance(here, at) - distance(cell, at)), 0)
  const stay = standing(here) + kept
  let move: { cell: Coord; score: number; budget: Budget; movement: MovementKind } | null = null
  const worst = foes.reduce<{ id: string; danger: number } | null>((q, f) => {
    const danger = threatValue(getPotentialThreat(view, members, f, id, here, cellOf(view, f), w), w)
    return !q || danger > q.danger ? { id: f, danger } : q
  }, null)
  for (const b of budgets) for (const walk of getWalks(b.view, id)) {
    for (const { cell, AP, STA, path } of getDirectedCells(view, here, walk, foes, worst && worst.danger > 0 ? worst.id : null, friends)) {
      if (sameCell(cell, here)) continue
      if (!canPay(b, AP, 0)) continue
      const spent = AP
      // a surge's AP is dropped at the turn's end, so only the AP of its own is left to defend with
      const guard = { AP: heldAP(b, AP), STA: Math.max(0, b.STA - STA) }
      const arrival = w.arrival * getDanger(view, members, id, 'immediate', cell, guard, w)
      const score = standing(cell) + pull(cell) - price(spent, STA + b.surgeSTA, cell) - drawn(cell, AP, STA, runs(walk), path) - arrival + keeping(cell, guard.AP)
      if (!move || score > move.score) move = { cell, score, budget: b, movement: walk.movement }
    }
  }
  if (!move || move.score <= stay + w.margin) return null
  const why = `walks where it threatens more, is threatened less and goes after its foes (${move.movement}, ${move.score.toFixed(1)} over ${stay.toFixed(1)})`
  if (move.budget.surge) return { kind: 'surge', surge: move.budget.surge, score: move.score, why: `makes the ${move.budget.surge} surge: ${why}` }
  const intent = moveIntent(id, move.movement, move.cell)
  return declare(view, intent, TRIAL).ok ? { kind: 'walk', intent, score: move.score, why } : null
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
// the attack answered with none.
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
    if (!o.available || o.reactionTo !== open.id || !GUARDING.has(o.draft.kind) || !o.cost) continue
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

// The answer to an attack on `id`: the opportunity attack a shot draws from
// it, if one is worth making, then the defence offered that leaves the least
// harm and price together, or none; where someone else defends it already,
// read against the attack as that defence leaves it, and made only where it
// saves more than `redundant`.
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
  const at = cellOf(view, id)
  const known = getKnownAttack(view, open, id)
  if (!known) return press(find('pass', id), 'lets it come: does not know the attack')
  const { attack, gap } = known
  const means = getMeans(me, true, w)
  const offered = getAvailableActions(view, id).filter((o) => o.available && o.reactionTo === open.id)
  const worth = (d: PairDefence) => getHarmAgainst(attack, d, gap)
  const none = attack.defences.find((d) => d.draft === null)
  // defended by someone else: every answer read with the DL the defences together give the attack
  const pairDL = guardian && none ? getPairDL(view, none) : null
  const guarded = pairDL ? pairDL(view) : null
  let best: { draft: ActionDraft | null; score: number } = { draft: null, score: none ? worth(guarded === null ? none : { ...none, DL: guarded }) : 0 }
  for (const o of offered) {
    const d = attack.defences.find((x) => x.draft && sameDraft(x.draft, o.draft))
    if (!d) continue
    const tried = pairDL ? tryAnswer(view, input.members, id, o.draft, means, w) : null
    const DL = pairDL ? (tried ? pairDL(tried.ready) : null) : d.DL
    if (DL === null) continue
    const priced = getSpendPrice(d.cost, means.STA, me.injuries.bleed, getDanger(view, input.members, id, 'immediate', at, { AP: Math.max(0, means.AP - d.cost.AP), STA: Math.max(0, means.STA - d.cost.STA) }, w), w)
    const score = worth({ ...d, DL }) + priced + (guardian ? w.redundant : 0)
    if (score < best.score) best = { draft: o.draft, score }
  }
  const covered = guardian ? `, ${view.characters[guardian]?.name ?? guardian} defends it` : ''
  if (best.draft === null) return press(find('pass', id), `lets it come (harm ${best.score.toFixed(1)}${covered})`)
  const picks = fillAnswer(view, input.members, id, best.draft, { AP: means.AP, STA: means.STA }, w)
  if (!picks) return press(find('pass', id), `lets it come: ${best.draft.kind} cannot be finished`)
  return { kind: 'declare', intent: { actorId: id, option: best.draft, picks }, why: `answers with ${best.draft.kind} (harm and price ${best.score.toFixed(1)}${covered})` }
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
    const declared = trial(view, { kind: 'react', args: [id, o.draft] })
    const drawn = getUnfinishedAnswers(declared, open).find((r) => r.actorId === id)
    const target = drawn?.targetId ? view.characters[drawn.targetId] : undefined
    if (!drawn || !target) continue
    const rows = getOpenChoices(declared).filter((c) => c.actorId === id && c.part === 'row').map((c) => c.value as PairAttack['row'])
    const guard = getMeans(target, false, w)
    for (const attack of getPair(me, target)) {
      if (attack.kind !== 'strike' || !rows.some((r) => r.weaponKey === attack.row.weaponKey && r.attack === attack.row.attack && r.variant === attack.row.variant)) continue
      const { AP, STA } = attack.cost
      if (AP > me.resources.AP || STA > me.resources.STA) continue
      const met = getDefendedHarm(attack, attack.reach, guard, 'now', target.injuries.bleed, w, getTargetDanger(view, target.id, cellOf(view, target.id), guard, w))
      if (!met || met.undefended <= 0) continue
      const parts = measures.score(met.worth, target.id, AP, STA, at)
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
    const plan = planTurn(view, input.members, id, w, input.unnoticed(id), true)
    if (plan?.kind === 'attack' || plan?.kind === 'walk') return { kind: 'declare', intent: plan.intent, why: `violent: ${plan.why}` }
  }
  if (turn.action === 'coward' && getSurgeAPLeft(me) > 0) {
    const run = getAway(view, input.members, id, w)
    if (run) return { ...run, why: `coward: ${run.why}` }
  }
  return endTurn(input, id, find, press)
}

// A change of arms (bot/arms.ts) where what it does to the most the
// character threatens any foe from where it stands, and to the worst any foe
// threatens it there (both potential threats, which weigh how far each foe is
// and what a shield blocks), is worth more than the switch costs at the price
// of an attack or a walk, with the opportunity attacks its priced moves draw
// (bot/approach.ts), and by `margin`: the first of its moves, declared.
function planSwitch(view: SceneState, members: readonly string[], id: string, w: ThreatWeights): { intent: Intent; why: string } | null {
  const me = view.characters[id]
  const here = cellOf(view, id)
  const { foes } = getSides(view, members)
  if (!me || foes.length === 0) return null
  const offence = (state: SceneState) => foes.reduce((most, foe) => Math.max(most, threatValue(getPotentialThreat(state, members, id, foe, cellOf(state, foe), here, w), w)), 0)
  const peril = (state: SceneState) => getDanger(state, members, id, 'potential', here, undefined, w)
  const now = { offence: offence(view), peril: peril(view) }
  const { price } = getAttackMeasures(view, members, id, w)
  const drawn = w.opportunity * getStandingCost(view, id, here, foes, (f) => getMeans(view.characters[f], false, w), { AP: me.resources.AP, STA: me.resources.STA }, w)
  let best: { intent: Intent; why: string; gain: number } | null = null
  for (const sw of getSwitches(me)) {
    if ((sw.cost.AP > 0 || sw.cost.STA > 0) && getPayBar(me, sw.cost, true)) continue
    const after = withSheet(view, id, sw.after)
    const paid = price(sw.cost.AP, sw.cost.STA, here)
    const thenOffence = offence(after)
    const beaten = (gain: number) => gain <= w.margin || (best !== null && gain <= best.gain)
    // danger is never below none, so the most the switch could gain is with
    // none left: a switch that loses even so is not worth reading the danger for
    if (w.peril >= 0 && beaten(w.offence * (thenOffence - now.offence) - w.peril * (0 - now.peril) - paid - sw.paid * drawn)) continue
    const then = { offence: thenOffence, peril: peril(after) }
    const gain = w.offence * (then.offence - now.offence) - w.peril * (then.peril - now.peril) - paid - sw.paid * drawn
    if (beaten(gain)) continue
    const intent: Intent = { actorId: id, option: { kind: 'gear', move: sw.moves[0] }, picks: [] }
    // every move of it the table takes, each from the sheet the ones before leave
    // (a surge's AP may not pay for every gear move, combat.tex "Action surge")
    const takes = sw.moves.every((move, i) => declare(i === 0 ? view : withSheet(view, id, sw.before[i]), { actorId: id, option: { kind: 'gear', move }, picks: [] }, TRIAL).ok)
    const why = `changes arms (${sw.moves.map((m) => m.kind).join(', ')}): threat ${now.offence.toFixed(1)} to ${then.offence.toFixed(1)}, danger ${now.peril.toFixed(1)} to ${then.peril.toFixed(1)}, for ${sw.cost.AP} AP, gain ${gain.toFixed(1)}`
    if (takes) best = { intent, why, gain }
  }
  return best && { intent: best.intent, why: best.why }
}

// The turn as the box weighed it before starting it (`threatBox`), on the
// fight as starting it would leave it, kept for the turn it then takes: read
// again only where the fight the turn is taken in is not the one weighed. The
// plan is left unread (undefined) where the change of arms was found first.
type Weighed = { view: SceneState; members: readonly string[]; unnoticed: ReadonlySet<string>; arms: ReturnType<typeof planSwitch>; plan?: Plan | null }

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

function takeTurn(input: SeatInput, id: string, w: ThreatWeights, find: Find, press: Press): Decision | null {
  const stress = takeStressTurn(input, id, w, find, press)
  if (stress !== 'none') return stress
  const kept = recallWeighed(w, id, input.view(), input.members, input.unnoticed(id))
  const arms = kept ? kept.arms : planSwitch(input.view(), input.members, id, w)
  if (arms) return { kind: 'declare', intent: arms.intent, why: arms.why }
  const plan = kept?.plan !== undefined ? kept.plan : planTurn(input.view(), input.members, id, w, input.unnoticed(id))
  // an attack the AP left of a surge does not pay for: that AP given up first
  if (plan?.kind === 'attack' && opensAfter(input.view(), id, plan.intent) === 'givingUp') {
    const give = input.buttons.find((b) => b.command.kind === 'edit' && argOf(b.command) === id && (b.command.args[1] as { kind: string }).kind === 'endSurge')
    const made = press(give, `gives up the ${getBindingSurge(input.view().characters[id])} surge AP left to attack: ${plan.why}`)
    if (made) return made
  }
  if (plan?.kind === 'attack' || plan?.kind === 'walk') return { kind: 'declare', intent: plan.intent, why: plan.why }
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
    .map((c) => ({ cell: c.cell, danger: getDanger(view, members, id, 'potential', c.cell, undefined, w) }))
    .sort((a, b) => a.danger - b.danger)
    .find((c) => declare(view, moveIntent(id, walk.movement, c.cell), TRIAL).ok)
  return safest ? { kind: 'declare', intent: moveIntent(id, walk.movement, safest.cell), why: `gets away (danger ${safest.danger.toFixed(1)})` } : null
}

export function threatBox(w: ThreatWeights): Box {
  return (input) => {
    const { members, waits, buttons } = input
    const { find, press } = finding(buttons)
    for (const wait of waits) {
      const made = wait.for === 'answer' ? answer(input, wait.id, w, find, press)
        : wait.for === 'turn' ? takeTurn(input, wait.id, w, find, press)
        : settleWait(input, wait, find, press, w)
      if (made) return made
    }
    const view = input.view()
    for (const id of members) {
      const start = find('startTurn', id)
      if (!start) continue
      const begun = trial(view, start.command)
      const unnoticed = input.unnoticed(id)
      const arms = planSwitch(begun, members, id, w)
      const plan = arms ? undefined : planTurn(begun, members, id, w, unnoticed)
      if (arms || plan) {
        keepWeighed(w, id, { view: begun, members, unnoticed, arms, plan })
        return { kind: 'press', pick: start, why: 'has something worth doing' }
      }
    }
    return carryOn(input, find)
  }
}

