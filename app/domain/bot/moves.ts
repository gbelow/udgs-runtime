import { OutcomeSchema, type Coord, type MovementKind, type SurgeKind } from '../types'
import { getBindingSurge, getSurgeAPLeft, getSurgeRecovery, NEEDS_FOCUS } from '../character/rules/surge'
import { getRecoveredSTA } from '../character/rules/characteristics'
import type { Action, ActionDraft, MoveAction, SceneState } from '../scene/types'
import { toUpdater, type CommandContext, type SceneCommand } from '../scene/commands/registry'
import { getAction, getOpenAction } from '../scene/rules/log'
import { isReactionAction } from '../scene/rules/actionCatalog'
import { getHeavyDegree } from '../scene/rules/heavy'
import { getHeavyName } from '../character/rules/gear'
import { getMovementOptions, getMovePrice, type MovementOption } from '../scene/rules/move'
import { getReachableCells } from '../scene/rules/board/reach'
import { getMoveFall } from '../scene/rules/board/cliff'
import { coordKey, distance, sameCell } from '../scene/rules/board/geometry'
import { placeAt, withPlacements } from '../scene/rules/board/board'
import { getMedicineAbility, getMedicineBar } from '../scene/rules/medicine'
import { hasAbility } from '../abilities'
import { getKeptWalk } from './walks'
import { isClearWalk } from './reach'
import { declare, declareOpened, type Declared, type Intent } from './declare'
import { getHarm, getPair, type PairAttack } from './pairs'
import { cellOf, getHarmAgainst } from './threat'
import { getNoFall } from './footing'

// What a box presses to walk, attack and pay for it, tried on its own copy of
// the fight: the walks open, the surges that may pay, the cells an attack is
// made from, the intents a person would press. Nothing here decides.

// what the box tries on its own copy of the fight; nothing it presses there is sent
export const TRIAL: CommandContext = { thrower: () => 0, newId: () => 'trial' }
export const trial = (state: SceneState, command: SceneCommand) => toUpdater(command, TRIAL)(state)
export const argOf = (command: SceneCommand): unknown => (command.args as readonly unknown[])[0]

// `elevation`: the floor the walk ends on in the cell (a cell may be come to on two).
// `clear`: whether the walk to a cell of `cells` comes into nobody standing
// (`isClearWalk`), asked only of the cells a turn picks from, each once.
// `footing`: the chance the walk there is not cut short by a fall (spec
// "Movement", `getNoFall`). `fall`: the fall it may end in, a jump down
// surely, a climb on a miss, `p` how likely; null for none.
export type WalkCell = { cell: Coord; AP: number; STA: number; path: Coord[]; elevation: number }
export type WalkFall = { height: number; to: Coord; p: number }
export type Walk = { movement: MovementKind; cells: WalkCell[]; clear: (c: WalkCell) => boolean; footing: (c: WalkCell) => number; fall: (c: WalkCell) => WalkFall | null }

// The first `n` of `cells`, in their order, that walk clear.
export function firstClear(walk: Walk, cells: readonly WalkCell[], n = Infinity): WalkCell[] {
  const found: WalkCell[] = []
  for (const c of cells) {
    if (found.length >= n) break
    if (walk.clear(c)) found.push(c)
  }
  return found
}

// The movements open to the character this turn, fastest first.
export function openMovements(state: SceneState, id: string): MovementKind[] {
  const c = state.characters[id]
  return c ? fastestFirst(getMovementOptions(state, c)) : []
}

function fastestFirst(options: MovementOption[]): MovementKind[] {
  return options
    .filter((o): o is typeof o & { kind: MovementKind } => o.available && o.speed > 0)
    .sort((a, b) => b.speed - a.speed)
    .map((o) => o.kind)
}

// The cells the character can walk to this turn at `movement`, what the walk
// costs, the cells it is walked through, and whether it comes into nobody
// standing on the way there: a bot never walks through anyone.
export function walkAt(state: SceneState, id: string, movement: MovementKind): Walk | null {
  return walkDeclared(trial(state, { kind: 'declare', args: [id, { kind: 'move' }] }), id, movement)
}

// The cells the move the character has open to declare can take it to at `movement`.
function walkDeclared(declared: SceneState, id: string, movement: MovementKind): Walk | null {
  const moving = trial(declared, { kind: 'amend', args: [{ movement }] })
  const action = getOpenAction(moving)
  if (action?.kind !== 'move' || action.actorId !== id) return null
  const cells = getReachableCells(moving, action as MoveAction, getKeptWalk).map((r) => ({ cell: r.cell, AP: r.cost.AP, STA: r.cost.STA, path: r.path, elevation: r.elevation }))
  const move = action as MoveAction
  const known = new Map<WalkCell, boolean>()
  const clear = (c: WalkCell) => {
    let is = known.get(c)
    if (is === undefined) known.set(c, (is = isClearWalk(moving, move, c.path)))
    return is
  }
  const footings = new Map<WalkCell, number>()
  const footing = (c: WalkCell) => {
    let p = footings.get(c)
    if (p === undefined) footings.set(c, (p = getNoFall(moving, move, c.path)))
    return p
  }
  const from = moving.board?.placements[id]?.elevation ?? 0
  const fall = (c: WalkCell): WalkFall | null => {
    if (movement === 'jump') {
      const made = getMoveFall(moving, { ...move, path: c.path }, c.path, false)
      return made ? { height: made.height, to: made.to ?? c.cell, p: 1 } : null
    }
    const height = Math.abs(c.elevation - from)
    return movement === 'climb' && height > 0 ? { height, to: c.cell, p: 1 - footing(c) } : null
  }
  return { movement, cells, clear, footing, fall }
}

// The walks weighed: at a walk, a run and a climb where each is open, and at
// the fastest movement open, so that one who can only swim, climb or crawl
// still has a walk; and at a jump, to the cells no other of them comes to
// (down a cliff, over a gap); or only at `only`.
const WEIGHED: readonly MovementKind[] = ['walk', 'run', 'climb']

export function getWalks(state: SceneState, id: string, only?: MovementKind): Walk[] {
  const open = openMovements(state, id)
  if (only) return open.includes(only) ? [walkAt(state, id, only)].flatMap((x) => x ?? []) : []
  const walks = weighedOf(open).flatMap((m) => walkAt(state, id, m) ?? [])
  const jump = open.includes('jump') && !walks.some((x) => x.movement === 'jump') ? walkAt(state, id, 'jump') : null
  if (!jump) return walks
  const reached = new Set(walks.flatMap((x) => x.cells.map((c) => `${coordKey(c.cell)}@${c.elevation}`)))
  const beyond = jump.cells.filter((c) => !reached.has(`${coordKey(c.cell)}@${c.elevation}`))
  return beyond.length ? [...walks, { ...jump, cells: beyond }] : walks
}

const weighedOf = (open: MovementKind[]): MovementKind[] => [...new Set([...open.slice(0, 1), ...WEIGHED.filter((m) => open.includes(m))])]

// The move a reaction of the character's has opened for it to declare or pass
// up (combat.tex "Evasion"), and the walks it may be, each costing what the
// reaction has not paid already; null when none is open.
export function getOpenedWalks(state: SceneState, id: string): Walk[] | null {
  const open = getOpenAction(state)
  const c = state.characters[id]
  if (open?.kind !== 'move' || open.actorId !== id || open.step !== 'define' || !c) return null
  const opener = open.spawnedBy ? getAction(state, open.spawnedBy) : null
  if (!opener || !isReactionAction(opener)) return null
  return weighedOf(fastestFirst(getMovementOptions(state, c, open))).flatMap((m) => walkDeclared(state, id, m) ?? [])
}

// whether the walk runs or jumps, which a braced attack answers (combat.tex "Braced Attack")
export const runs = (walk: Walk | null): boolean => walk?.movement === 'run' || walk?.movement === 'jump'

export const moveIntent = (id: string, movement: MovementKind, cell: Coord, elevation: number): Intent => ({ actorId: id, option: { kind: 'move' }, picks: [{ part: 'movement', value: movement }, { part: 'cell', value: { q: cell.q, r: cell.r, height: elevation } }] })

export const attackIntent = (id: string, attack: PairAttack, target: string): Intent => ({
  actorId: id,
  option: { kind: attack.kind },
  picks: [
    { part: 'row', value: attack.row },
    ...(attack.declaresHeavy ? [{ part: 'modifier' as const, value: { key: `heavy${attack.heavy}`, on: true } }] : []),
    ...(attack.ammoId ? [{ part: 'ammo' as const, value: attack.ammoId }] : []),
    { part: 'target', value: target },
  ],
})

export const attackName = (attack: PairAttack) => `${attack.row.attack}${attack.heavy ? `, ${getHeavyName(attack.heavy)}` : ''}`

// The ways the turn may be paid for: with no surge, or after the combat or the
// movement surge (combat.tex "Action surge"), tried on the fight as a person
// presses it; what the surge costs besides is its STA and what the recovery
// surge it gives up would have given back (`surgeSTA`).
export type Budget = { surge: SurgeKind | null; view: SceneState; AP: number; STA: number; surgeAP: number; surgeSTA: number }

export function getBudgets(view: SceneState, id: string): Budget[] {
  const me = view.characters[id]
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

export const canPay = (b: Budget, move: number, attack: number): boolean => move + attack <= b.AP

// The movement surge only for a run of at least RUN_BLOCKS blocks (the
// user's ruling, 2026-11-20); never at 0 STA.
export const RUN_BLOCKS = 2

const runBlocks = new WeakMap<SceneState, Map<string, number | null>>()

export function getRunBlock(view: SceneState, id: string): number | null {
  let byId = runBlocks.get(view)
  if (!byId) runBlocks.set(view, (byId = new Map()))
  if (byId.has(id)) return byId.get(id)!
  const me = view.characters[id]
  const made = (me && getMovementOptions(view, me).find((o) => o.kind === 'run')?.block.AP) ?? null
  byId.set(id, made)
  return made
}

// The walks each budget pays for with no attack after them: none's every
// walk, the movement surge's run alone; the combat surge none.
export function getWalkBudgets(view: SceneState, id: string, budgets: readonly Budget[]): { b: Budget; walks: Walk[] }[] {
  const me = view.characters[id]
  return budgets.flatMap((b) => {
    if (b.surge === null) return [{ b, walks: getWalks(b.view, id) }]
    if (b.surge !== 'movement' || !me || me.resources.STA <= 0) return []
    const run = getWalks(b.view, id, 'run')
    return run.length ? [{ b, walks: run }] : []
  })
}

export function isWalkPaid(view: SceneState, id: string, b: Budget, AP: number): boolean {
  if (!canPay(b, AP, 0)) return false
  if (b.surge !== 'movement') return true
  const block = getRunBlock(view, id)
  return block !== null && AP >= RUN_BLOCKS * block
}

// The fight as a walk of `AP` and `STA` to `cell` leaves the character.
export function arrivedAt(state: SceneState, id: string, cell: Coord | null, AP: number, STA: number): SceneState {
  const c = state.characters[id]
  const placed = state.board?.placements[id]
  if (!c || !cell || AP + STA === 0) return state
  const moved = placed && state.board ? withPlacements(state, { [id]: placeAt(state.board, placed, cell) }) : state
  return { ...moved, characters: { ...moved.characters, [id]: { ...c, resources: { ...c.resources, AP: c.resources.AP - AP, STA: c.resources.STA - STA } } } }
}

export const givenUp = (state: SceneState, id: string): SceneState => trial(state, { kind: 'edit', args: [id, { kind: 'endSurge', args: [] }, false] })

// Whether the table takes `intent`: as it stands ('open'), or once what is
// left of a surge's AP is given up ('givingUp'); null when neither.
export function opensAfter(state: SceneState, id: string, intent: Intent): 'open' | 'givingUp' | null {
  if (declare(state, intent, TRIAL).ok) return 'open'
  const c = state.characters[id]
  return c && getBindingSurge(c) && declare(givenUp(state, id), intent, TRIAL).ok ? 'givingUp' : null
}

// The AP of a budget still held once `spent` of it is paid, a surge's paying
// first: a surge's AP is dropped at the turn's end.
export const heldAP = (b: Budget, spent: number): number => Math.max(0, Math.min(b.AP - spent, b.AP - b.surgeAP))

// The AP of `spent` paid out of the character's own, a surge's AP paying first
// for what it may: a movement surge's only the walk, any other's all of it.
export function ownAP(view: SceneState, id: string, b: Budget, walkAP: number, spent: number): number {
  const kind = b.surge ?? view.characters[id]?.usedSurge ?? null
  return Math.max(0, spent - Math.min(b.surgeAP, kind === 'movement' ? walkAP : spent))
}

// Whether the table takes the walk `intent` at no more than `AP` and `STA`.
export function takesWalk(state: SceneState, id: string, intent: Intent, AP: number, STA: number): boolean {
  return isPricedAt(declare(state, intent, TRIAL), id, AP, STA)
}

// Whether the table takes the open move filled in as `intent` fills it, at no more than `AP` and `STA`.
export function takesOpenedWalk(state: SceneState, id: string, intent: Intent, AP: number, STA: number): boolean {
  return isPricedAt(declareOpened(state, intent.picks, TRIAL), id, AP, STA)
}

function isPricedAt(made: Declared, id: string, AP: number, STA: number): boolean {
  if (!made.ok) return false
  const move = getOpenAction(made.ready)
  const c = made.ready.characters[id]
  if (move?.kind !== 'move' || !c) return true
  const cost = getMovePrice(made.ready, c, move as MoveAction, (move as MoveAction).path.length)
  return cost.AP <= AP && cost.STA <= STA
}

// Where an attack with `reach` on a target at `at` is made from (the user's
// ruling, 2026-11-20: the cheapest route into reach, the opportunity attacks
// it draws the caveat): where the character stands if it reaches from there,
// else the cheapest cell of the walk that does, and of the next ATTACK_SCAN
// the one that draws least (`draws`), where the cheapest draws any.
const ATTACK_SCAN = 8

export type AttackCell = { cell: Coord | null; AP: number; STA: number; path: Coord[]; elevation?: number }

export function getAttackCells(here: Coord | null, walk: Walk | null, at: Coord | null, reach: number, draws: (c: AttackCell) => number, clear: (cell: Coord) => boolean = () => true): AttackCell[] {
  if (!here || !at || (distance(here, at) <= reach && clear(here))) return [{ cell: here, AP: 0, STA: 0, path: [] }]
  if (!walk) return []
  const reaching = firstClear(walk, walk.cells.filter((c) => !sameCell(c.cell, here) && distance(c.cell, at) <= reach && clear(c.cell)).sort((a, b) => a.AP - b.AP || a.STA - b.STA), 1 + ATTACK_SCAN)
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

// The strike or the shot `open` on `defender` as the seat knows the attacker,
// and the metres between them; an arrow or a variant the seat does not know
// it has is read as the worst of the same row's (the user's ruling).
export function getKnownAttack(view: SceneState, open: Action, defender: string): { attack: PairAttack; gap: number } | null {
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

export function sameDraft(a: ActionDraft, b: ActionDraft): boolean {
  const ka = Object.keys(a).sort()
  const kb = Object.keys(b).sort()
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && JSON.stringify((a as Record<string, unknown>)[k]) === JSON.stringify((b as Record<string, unknown>)[k]))
}

// The turn of a collapsed character (the user's ruling): only its own bleed
// stopped, by First Aid where it has learned it, else by Tend Wounds
// (combat.tex "Tend Wounds"), after the focus surge both need; worth the harm
// the bleed does. Null with no bleed, or neither open to it. `then`: what is
// declared after the surge.
export type Care = { kind: 'care'; intent: Intent; score: number; why: string } | { kind: 'surge'; surge: SurgeKind; score: number; why: string; then: Intent[] }

export function getCollapsedCare(view: SceneState, id: string): Care | null {
  const me = view.characters[id]
  if (!me || me.injuries.bleed === 0) return null
  const score = getHarm(OutcomeSchema.parse({ bleed: me.injuries.bleed }))
  const focused = me.usedSurge === null ? trial(view, { kind: 'surge', args: [id, 'focus'] }) : null
  for (const kind of ['firstAid', 'tendWounds'] as const) {
    if (kind === 'firstAid' && !hasAbility(me, getMedicineAbility(kind))) continue
    const intent: Intent = { actorId: id, option: { kind }, picks: kind === 'firstAid' ? [{ part: 'target', value: id }] : [] }
    const why = `collapsed, stops its bleed of ${me.injuries.bleed} with ${kind === 'firstAid' ? 'first aid' : 'tend wounds'}`
    if (declare(view, intent, TRIAL).ok) return { kind: 'care', intent, score, why }
    if (getMedicineBar(view, me, kind) === NEEDS_FOCUS && focused && focused !== view && declare(focused, intent, TRIAL).ok) return { kind: 'surge', surge: 'focus', score, why: `focuses: ${why}`, then: [intent] }
  }
  return null
}

// The fight as it would be had the character won the contest for the turn held now.
export function wonBy(view: SceneState, id: string): SceneState {
  return { ...view, inTurnCharacter: id, contenders: [], contestModes: {}, lastContest: { rolls: [], winner: id } }
}
