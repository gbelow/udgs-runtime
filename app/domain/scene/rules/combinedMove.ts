import type { Character, CombinedMoveRecipe } from '../../types'
import type { Action, ActionKind, ActionOf, Coord, MoveAction, Placement, SceneState, ShootAction, StrikeAction } from '../types'
import type { ActionCost } from '../../character/rules/actionCosts'
import type { Term } from '../../character/rules/terms'
import { makeAction } from '../factories'
import { canAfford } from '../../character/rules/cost'
import { getMovementBlock } from '../../character/rules/movement'
import { getSurgeAP } from '../../character/rules/surge'
import { hasAffliction } from '../../character/rules/afflictions'
import { getAttackKind } from '../../weaponProperties'
import { SHOTS } from '../../tables'
import { isCampaignCharacter } from '../../utils'
import { getAction, getOpenedBy, getPassedUp, getReactionsTo, getRootOf } from './log'
import { getFootprint, getMeleeThreateners, getPlacedFootprint, placeAt, withPlacements } from './board/board'
import { isInLiquid } from './board/ground'
import { setDistance } from './board/geometry'
import { getMoveDestination, getMoveOrigin } from './board/waypoint'
import { getPostureCost, getWalkableCells } from './move'
import { getFreeAttackOptions, type AttackOption } from './attack'
import { getTargetIds } from './action'
import { getSurgeBarFor } from './surge'
import { isCombatStarted } from './started'
import { findWeaponRow } from './weaponRow'
import { isMartyrGuard } from './stress'
import { isGuardPlacedAt } from './protect'
import { getRecipeEntry, getRecipesOf, type RecipeEntry } from './recipes'
import type { ReactionMove } from './reactionMoves'

// A movement of the actor's own made with an action, at a price of its own
// (RecipeSchema `combinedMove`).
// abilities.tex "Lunge": "Allows you to jump for 1 STA while using an attack
// as an action and attack from the final position. This movement triggers
// opportunity attacks and braced attacks normally."
// abilities.tex "Jump Shot": "Spends 1 extra AP and 1 STA to jump backward
// and perform a quick shot or throw, avoiding opportunity attacks if the jump
// takes them out of range." Backward is away from everyone who threatens the
// shooter (the table's ruling), at half the jump (combat.tex "Movement": "If
// performed backwards, the horizontal distance is halved").
// abilities.tex "Defender": "Allows you to spend 1 STA to move 1 basic
// movement as a reaction to position yourself to defend someone."
// abilities.tex "Defensive Advance": "Spend 1 STA to move forward to get in
// range to intercept, adding shield cover to the defense": one space towards
// the attacker (the table's ruling).
// abilities.tex "Technical Lift": "perform an evasive jump and stand up in
// the same action", taking "-3 to defend while doing so"; the stand up comes
// once the strike has landed, and an interruption cancels it.
// An attack of the actor's own is declared on the move, which opens it from
// where it lands; a defense carries the move, made before its die (where the
// defense is then made from) or after the strike lands. The move is a move
// like any other and draws opportunity attacks as one does, but for one a
// reaction opened, never from the one whose attack the reaction answers
// (rules/reactions.ts).

export type CombinedEntry = RecipeEntry<CombinedMoveRecipe>
type OwnAttack = 'strike' | 'shoot'
export type CombinedDefense = ActionOf<'block'> | ActionOf<'intercept'> | ActionOf<'evasiveJump'>

function isOwnAttack(kind: string): kind is OwnAttack {
  return kind === 'strike' || kind === 'shoot'
}

// The combined moves the fighter has that go with an action of the kind: on
// a move, those that open an attack of their own from where it lands; on a
// defense, those it carries.
export function getCombinedMoves(c: Character, kind: ActionKind): CombinedEntry[] {
  return getRecipesOf(c, 'combinedMove').filter((e) => (kind === 'move' ? e.recipe.with.some(isOwnAttack) : !isOwnAttack(kind) && (e.recipe.with as readonly string[]).includes(kind)))
}

// The combined move the action is declared with or carries, as its actor has
// it; null for any other.
export function getCombinedOf(c: Character | undefined, action: { recipe?: string | null }): CombinedEntry | null {
  const entry = c ? getRecipeEntry(c, action.recipe ?? null) : null
  return entry && entry.recipe.type === 'combinedMove' ? (entry as CombinedEntry) : null
}

const OPEN_WHEN: Record<NonNullable<CombinedMoveRecipe['openWhen']>, (state: SceneState, id: string) => boolean> = {
  martyrGuard: isMartyrGuard,
}

function holds(state: SceneState, id: string, recipe: CombinedMoveRecipe): boolean {
  return recipe.openWhen === null || OPEN_WHEN[recipe.openWhen](state, id)
}

// What the recipe does to the price of what carries it.
export function getCombinedPrice(c: Character, recipe: CombinedMoveRecipe): { set: ActionCost } | { add: ActionCost } {
  const { operation, AP, STA } = recipe.cost
  if (operation === 'movement') return { set: { AP: getMovementAP(c, recipe.movement), STA: 0 } }
  return operation === 'set' ? { set: { AP, STA } } : { add: { AP, STA } }
}

export function getCombinedTerms(entry: CombinedEntry): Term[] {
  return entry.recipe.hit !== 0 ? [{ label: entry.label, value: entry.recipe.hit }] : []
}

function getMovementAP(c: Character, movement: CombinedMoveRecipe['movement']): number {
  return movement === 'stand' ? getPostureCost(c, 'stand').AP : getMovementBlock(c, movement).AP
}

// ---------------------------------------------------------------------------
// A move that opens an attack

// Whether the move may be declared with the recipe: a move of its movement
// of the actor's own in their action.
export function canDeclareOnMove(state: SceneState, move: MoveAction, entry: CombinedEntry): boolean {
  return move.movement === entry.recipe.movement && move.spawnedBy === null && move.preparedPart === null && !move.forced && holds(state, move.actorId, entry.recipe)
}

// The recipe the move is declared with, open, when it opens an attack.
export function getMoveAttack(state: SceneState, move: MoveAction): CombinedEntry | null {
  const entry = getCombinedOf(state.characters[move.actorId], move)
  return entry && canDeclareOnMove(state, move, entry) ? entry : null
}

// Whether the move takes its mover away from everyone threatening them, as
// it is declared to be: a jump backward runs half its length.
export function isBackwardMove(c: Character, move: { recipe?: string | null }): boolean {
  return getCombinedOf(c, move)?.recipe.toward === 'awayFromThreateners'
}

function getOpenedKind(entry: CombinedEntry): OwnAttack {
  return entry.recipe.with.find(isOwnAttack) ?? 'strike'
}

// The attack the move declared with the recipe opens, from where it lands,
// for its actor to declare.
export function getMoveAttackOpened(move: MoveAction, entry: CombinedEntry, id: string): StrikeAction | ShootAction {
  return makeAction(getOpenedKind(entry), { id, actorId: move.actorId, spawnedBy: move.id })
}

// The recipe of the move that opened the attack, if a move did.
export function getOpeningMove(state: SceneState, action: Action): CombinedEntry | null {
  const opener = (action.kind === 'strike' || action.kind === 'shoot') && action.spawnedBy ? getAction(state, action.spawnedBy) : null
  return opener?.kind === 'move' ? getCombinedOf(state.characters[opener.actorId], opener) : null
}

// Whether the row and variation may be the attack the recipe opens.
export function isOpenedRow(c: Character, entry: CombinedEntry | null, o: Pick<AttackOption, 'weaponKey' | 'attack' | 'variant'>): boolean {
  if (!entry || entry.recipe.rows === 'any') return true
  const row = findWeaponRow(c, o.weaponKey, o.attack)
  return o.variant === SHOTS.quickShot.variant || (!!row && getAttackKind(row.atk.range) === 'throw')
}

// Whether a move declared with the recipe may land on the cell: where the
// recipe sends it, and from there some attack it opens that its actor can pay
// for, the move's price besides, and that their surge lets them make, reaches
// someone they may attack.
function isAttackLanding(state: SceneState, move: MoveAction, entry: CombinedEntry, cell: Coord): boolean {
  const c = state.characters[move.actorId]
  const from = state.board?.placements[move.actorId]
  const opens = getOpenedKind(entry)
  if (!c || !isCampaignCharacter(c) || getSurgeBarFor(state, c, opens) !== null) return false
  if (entry.recipe.toward === 'awayFromThreateners' && !isAway(state, move, cell)) return false
  const price = getCombinedPrice(c, entry.recipe)
  const extra = 'add' in price ? price.add : price.set
  const landed = from ? withPlacements(state, { [c.id]: placeAt(state.board, from, cell) }) : state
  const opened = getMoveAttackOpened(move, entry, '')
  return getFreeAttackOptions(landed, c, opens).some((o) =>
    isOpenedRow(c, entry, o)
    && canAfford(c, { AP: o.AP + extra.AP, STA: o.STA + extra.STA }, isCombatStarted(state))
    && getTargetIds(landed, { ...opened, weaponKey: o.weaponKey, attack: o.attack, variant: o.variant }).length > 0)
}

// Whether landing on the cell takes the mover further from everyone who
// threatens them where they set out.
function isAway(state: SceneState, move: MoveAction, cell: Coord): boolean {
  const c = state.characters[move.actorId]
  const origin = getMoveOrigin(state, move)
  const end = getMoveDestination(state, move, [cell])
  if (!c || !origin || !end) return true
  const before = getFootprint(c, origin)
  const after = getFootprint(c, end)
  return getMeleeThreateners(state, move.actorId).every((id) => {
    const other = getPlacedFootprint(state, id)
    return !other || setDistance(after, other) > setDistance(before, other)
  })
}

// ---------------------------------------------------------------------------
// A move a defense carries

// The move the defense carries, as the move opened for it: its movement, as
// far as the recipe reaches, bought with the defense's price.
export function getCarriedStep(c: Character, entry: CombinedEntry): ReactionMove {
  const { movement, reach } = entry.recipe
  const AP = reach === 'reactionSurge' && isCampaignCharacter(c) ? getSurgeAP('reaction')(c) : getMovementAP(c, movement)
  return movement === 'stand' ? { movement, budget: AP, prepaid: AP } : { movement, movements: [movement], budget: AP, prepaid: AP }
}

// Whether the defense may be declared with the recipe against the root:
// against a strike, made on the spot, for someone else where the recipe asks
// it, while its condition holds, and with somewhere for the move to end
// (one made before its die) or someone to stand up (a stand up).
export function canCarryStep(state: SceneState, root: Action | null, defense: CombinedDefense, entry: CombinedEntry): boolean {
  const c = state.characters[defense.actorId]
  const { recipe } = entry
  if (root?.kind !== 'strike' || !c || !(recipe.with as readonly string[]).includes(defense.kind) || !holds(state, c.id, recipe)) return false
  if ('preparedId' in defense && defense.preparedId !== '') return false
  if (recipe.defends === 'ally' && defense.actorId === root.targetId) return false
  if (recipe.movement === 'stand') return hasAffliction(c, 'prone') && !isInLiquid(state, c)
  return recipe.order === 'after' || getStepLandings(state, root, defense, entry).length > 0
}

// The spaces the move a defense carries before its die may end on: within
// its reach, where the recipe sends it, where the defense can be made from,
// and not where an evasive jump answering the same strike lands.
export function getStepLandings(state: SceneState, root: StrikeAction, defense: CombinedDefense, entry: CombinedEntry): Coord[] {
  const c = state.characters[defense.actorId]
  if (!c || !state.board?.placements[c.id]) return []
  const probe = makeAction('move', { id: '', actorId: c.id, ...getCarriedStep(c, entry) })
  return getWalkableCells(state, probe).map(({ cell }) => cell).filter((cell) => isStepLanding(state, root, defense, entry, cell))
}

function isStepLanding(state: SceneState, root: StrikeAction, defense: CombinedDefense, entry: CombinedEntry, cell: Coord): boolean {
  const c = state.characters[defense.actorId]
  const from = state.board?.placements[defense.actorId]
  if (!c || !from) return true
  const at: Placement = { ...from, cell }
  const here = getFootprint(c, at)
  if (entry.recipe.reach === 'oneSpace' && setDistance(here, getFootprint(c, from)) !== 1) return false
  const attacker = getPlacedFootprint(state, root.actorId)
  if (entry.recipe.toward === 'towardAttacker' && attacker && setDistance(here, attacker) >= setDistance(getFootprint(c, from), attacker)) return false
  if (entry.recipe.toward === 'awayFromThreateners' && getMeleeThreateners(state, c.id).some((id) => {
    const other = getPlacedFootprint(state, id)
    return !!other && setDistance(here, other) <= setDistance(getFootprint(c, from), other)
  })) return false
  if ((defense.kind === 'block' || defense.kind === 'intercept') && !isGuardPlacedAt(state, root, defense, at)) return false
  return !isLandedOn(state, root, c, at)
}

// Whether an evasive jump answering the strike lands on any of that place:
// the jump was declared first and has the space (the table's ruling).
function isLandedOn(state: SceneState, root: StrikeAction, c: Character, at: Placement): boolean {
  const landings = getReactionsTo(state, root.id).flatMap((r) => {
    const jumper = state.characters[r.actorId]
    return r.kind === 'evasiveJump' && r.to && jumper && r.actorId !== c.id ? getFootprint(jumper, r.to) : []
  })
  return getFootprint(c, at).some((cell) => landings.some((l) => l.q === cell.q && l.r === cell.r))
}

function getCarrier(state: SceneState, move: MoveAction): { defense: CombinedDefense; entry: CombinedEntry } | null {
  const opener = move.spawnedBy ? getAction(state, move.spawnedBy) : null
  if (!opener || (opener.kind !== 'block' && opener.kind !== 'intercept' && opener.kind !== 'evasiveJump')) return null
  const entry = getCombinedOf(state.characters[opener.actorId], opener)
  return entry ? { defense: opener, entry } : null
}

// The defense declared against the root whose move before its die has still
// to be offered, and that move.
export function getPendingStep(state: SceneState, root: Action): { defense: CombinedDefense; move: ReactionMove } | null {
  if (root.kind !== 'strike') return null
  for (const r of getReactionsTo(state, root.id)) {
    if (r.kind !== 'block' && r.kind !== 'intercept') continue
    const c = state.characters[r.actorId]
    const entry = getCombinedOf(c, r)
    if (!c || !entry || entry.recipe.order !== 'before' || getOpenedBy(state, r) || getPassedUp(state, r.id).length > 0) continue
    return { defense: r, move: getCarriedStep(c, entry) }
  }
  return null
}

// The defenses declared against the root with a move before their die that
// come to nothing: the move passed up, or ended where the defense cannot be
// made from.
export function getLapsedSteps(state: SceneState, root: Action): CombinedDefense[] {
  if (root.kind !== 'strike') return []
  return getReactionsTo(state, root.id).filter((r): r is ActionOf<'block'> | ActionOf<'intercept'> => {
    if ((r.kind !== 'block' && r.kind !== 'intercept') || r.step === 'done') return false
    const entry = getCombinedOf(state.characters[r.actorId], r)
    const at = state.board?.placements[r.actorId]
    if (!entry || entry.recipe.order !== 'before') return false
    return getPassedUp(state, r.id).length > 0 || (!!at && !isGuardPlacedAt(state, root, r, at))
  })
}

// Whether the defense waits on the move it carries before its die.
export function isStepPending(state: SceneState, defense: Action): boolean {
  if (defense.kind !== 'block' && defense.kind !== 'intercept') return false
  const entry = getCombinedOf(state.characters[defense.actorId], defense)
  return !!entry && entry.recipe.order === 'before' && !getOpenedBy(state, defense) && getPassedUp(state, defense.id).length === 0
}

// The moves defenses carry after the strike has landed, for their actors to
// make or pass up.
export function openStepsAfter(state: SceneState, root: Action, newId: () => string): MoveAction[] {
  if (root.kind !== 'strike') return []
  return getReactionsTo(state, root.id).flatMap((r) => {
    const c = state.characters[r.actorId]
    const entry = r.kind === 'evasiveJump' || r.kind === 'block' || r.kind === 'intercept' ? getCombinedOf(c, r) : null
    return c && entry && entry.recipe.order === 'after' ? [makeAction('move', { id: newId(), actorId: r.actorId, spawnedBy: r.id, ...getCarriedStep(c, entry) })] : []
  })
}

// Whether a move may end on the cell as the recipe behind it allows: a move
// declared to open an attack, only where the attack reaches someone; the
// move a defense carries before its die, only where the recipe sends it and
// the defense can be made from. Any other move may end anywhere it reaches.
export function isCombinedLanding(state: SceneState, move: MoveAction, cell: Coord | undefined): boolean {
  const carrier = getCarrier(state, move)
  if (carrier && carrier.entry.recipe.order === 'before') {
    const root = getRootOf(state, carrier.defense)
    return !!cell && root?.kind === 'strike' && isStepLanding(state, root, carrier.defense, carrier.entry, cell)
  }
  const entry = getCombinedOf(state.characters[move.actorId], move)
  if (!entry) return true
  return !!cell && canDeclareOnMove(state, move, entry) && isAttackLanding(state, move, entry, cell)
}
