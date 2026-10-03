import type { Character } from '../../types'
import type { ActionKind, CastAction, ReactionKind, CombatState, Coord, DragAction, ExplosionAction, GrappleAction, MoveAction, PickUpAction, Placement, RootAction, ShootAction, StrikeAction } from '../types'
import { ACTIONS, isDefense, isReaction, reactsTo } from './actionCatalog'
import { getAdjacentIds, getFlankers, isGuardingShot, getFootprint, getMeleeRange, getMeleeThreateners, getPlacedFootprint } from './board'
import { getBlastOf, getThreatenedIds, isAvoidable } from './explosion'
import { isTrampleable } from './trample'
import { getDragGroup, getGroupOrigin, getGroupSteps } from './drag'
import { isGrappleRow } from './grapple'
import { hasProperty } from '../../weaponProperties'
import { isCampaignCharacter } from '../../utils'
import { getRetargetOptions } from './fireAgain'
import { sameCell, setDistance } from '../geometry'
import { getAction, getOpeningReaction, getReactionsTo } from './log'
import { getJoinReaction } from './coordinated'
import { hasShootingRow } from './attack'
import { drawsOpportunity, getContestRecipe } from './recipes'
import { getProtectors } from './protect'
import { FLEE_PERIMETER } from './flee'
import { isInTurn } from './turn'
import { getSweepTargets, isSweep, isSweepLink } from './sweep'

// combat.tex "Reactions": "actions that can be performed on another
// character's turn but must be triggered by something." What an action,
// once committed to, triggers in everyone else: who may answer it, with
// which reaction, and — for a move — at which step of the path. The
// declaration is locked at the commit, so reading these off the action is
// the same as loading them then; the commands refuse any reaction not on
// the list.

export type Trigger = {
  characterId: string
  kind: ReactionKind
  // the step of a move's path (counted from 1) at which the trigger fires;
  // null for a trigger that is not about a step
  at: number | null
  // who the reaction is against, when not the root's actor: the one a push
  // moves towards a third party
  against?: string
  // combat.tex "Catch": an opportunity to grab a runner and nothing else
  catchOnly?: boolean
  // the recipe the reaction is made under, by id (rules/recipes.ts)
  recipe?: string
  // the held spray a retarget aims anew
  key?: string
}

// How far the held sprays a character could aim anew reach: the range a
// retarget is triggered in, as melee range is an opportunity attack's.
function sprayReach(c: Character): number {
  return isCampaignCharacter(c) ? Math.max(0, ...getRetargetOptions(c).map((o) => o.reach)) : 0
}

// The retargets the holder may answer a trigger with, one per spray held.
function retargetsOf(c: Character, at: number | null, against?: string): Trigger[] {
  return isCampaignCharacter(c) ? getRetargetOptions(c).map(({ key }): Trigger => ({ characterId: c.id, kind: 'retarget', at, key, against })) : []
}

// The table's rulings: opportunity attacks never trigger other opportunity
// attacks, and a riposte draws none from those flanking the riposter. What
// an opportunity attack opens — a strike or a maneuver — and a riposte are still answered by their target, and draw no
// opportunity attack from anyone. combat.tex "Sweeping Attack": the sweep
// draws what it draws once, at its first target, and "do not draw attacks of
// opportunity from any of its targets" — who answer it each on their own
// strike, never on another's (no Protect either).
export function getTriggers(state: CombatState, root: RootAction): Trigger[] {
  const triggers = getKindTriggers(state, root)
  const opportunity = getOpeningReaction(state, root) !== null
  const drawsNone = opportunity || !drawsOpportunity(state, root) || (root.kind === 'strike' && isSweepLink(root))
  const drawn = drawsNone ? triggers.filter((t) => t.kind !== 'opportunityAttack' && t.kind !== 'retarget') : triggers
  const others = root.kind === 'strike' && isSweep(root) ? getSweepTargets(state, root).filter((id) => id !== root.targetId) : []
  return drawn.filter((t) => !others.includes(t.characterId))
}

function getKindTriggers(state: CombatState, root: RootAction): Trigger[] {
  switch (root.kind) {
    case 'strike': return strikeTriggers(state, root)
    case 'shoot': return shootTriggers(state, root)
    case 'explosion': return explosionTriggers(state, root)
    case 'move': return moveTriggers(state, root)
    case 'cast': return castTriggers(state, root)
    case 'pickUp': return pickUpTriggers(state, root)
    case 'throw': return opportunityTriggers(state, root.actorId)
    case 'grapple': return grappleTriggers(root)
    case 'drag': return [...dragAnswers(state, root), ...dragOpportunities(state, root)]
    // nobody answers the blast: the reflexes were against the explosion
    case 'blast': return []
    // the flee is its surge; what the fleer does with it comes in their turn
    case 'fleeFollowUp': return []
    // the target's test against the link: nothing to answer
    case 'spellTest': return []
    // letting go and grappling back draw nothing; nor does resting, which
    // is no standard action (combat.tex "Opportunity Attack"), nor firing a
    // held spell again (step 6 makes it a reaction of its own)
    case 'release':
    case 'slip':
    case 'feint':
    case 'cut':
    case 'holdBack':
    case 'rest':
    case 'fireAgain':
      return []
  }
}

export function getTriggersFor(state: CombatState, root: RootAction, characterId: string): Trigger[] {
  return getTriggers(state, root).filter((t) => t.characterId === characterId)
}

// The trigger a reaction answers, or would: one of its kind, at the step it
// names, and against whoever it is aimed at once it is. A reaction that
// names no step or no target yet matches on what it does name.
export type TriggerKey = { kind: ActionKind; actorId: string; at?: number | null; targetId?: string | null }

export function findTrigger(state: CombatState, root: RootAction, reaction: TriggerKey): Trigger | null {
  return getTriggersFor(state, root, reaction.actorId).find((t) =>
    t.kind === reaction.kind
    && (reaction.at === undefined || t.at === reaction.at)
    && (reaction.targetId === undefined || (t.against ?? root.actorId) === reaction.targetId)) ?? null
}

// combat.tex "Defend": the target may answer with any of the four defenses,
// or with a contested strike if a recipe gives them one (abilities.tex
// "Counterattack"), made under that recipe.
// combat.tex "Flanking": everyone flanking the attacker gets an opportunity
// attack.
function strikeTriggers(state: CombatState, root: StrikeAction): Trigger[] {
  if (!root.targetId) return []
  const target = state.characters[root.targetId]
  const contest = target ? getContestRecipe(target) : null
  const defenses = (Object.keys(ACTIONS) as ActionKind[]).filter(isDefense)
    .map((kind): Trigger => ({ characterId: root.targetId!, kind, at: null }))
  const flankers = getFlankers(state, root.actorId, root.targetId)
    .filter((id) => getMeleeRange(state.characters[id]) > 0)
    .map((id): Trigger => ({ characterId: id, kind: 'opportunityAttack', at: null }))
  // combat.tex "Protect": whoever stands by the line may block or intercept
  const protectors = getProtectors(state, root)
    .flatMap((id) => (['block', 'intercept'] as const).map((kind): Trigger => ({ characterId: id, kind, at: null })))
  const counters: Trigger[] = contest ? [{ characterId: root.targetId, kind: 'counterattack', at: null, recipe: contest.id }] : []
  const retargets = getFlankers(state, root.actorId, root.targetId, sprayReach).flatMap((id) => retargetsOf(state.characters[id], null))
  return [...defenses, ...counters, ...protectors, ...flankers, ...retargets]
}

// combat.tex "Opportunity Attack": a triggering action is answered by
// anyone who threatens the one attempting it with a melee weapon, and a
// held spray by anyone it reaches.
function opportunityTriggers(state: CombatState, actorId: string): Trigger[] {
  const attacks = getMeleeThreateners(state, actorId).map((id): Trigger => ({ characterId: id, kind: 'opportunityAttack', at: null }))
  const retargets = getMeleeThreateners(state, actorId, sprayReach).flatMap((id) => retargetsOf(state.characters[id], null))
  return [...attacks, ...retargets]
}

// combat.tex "Reflex": the target may answer a shot with evasion or guard.
// combat.tex "Guard": someone may "block ranged attacks against ...
// adjacent characters, as long as they are closer to the projectile source
// than the adjacent character". What they may guard with is the option's
// to say, as it is for the target.
// combat.tex "Coordinated Shots": "The target defends all shots with a
// single action" — declared against the shot the others join, so a joined
// shot draws no defense of its own, only the opportunity attacks its shooter
// draws, and no further join.
function shootTriggers(state: CombatState, root: ShootAction): Trigger[] {
  if (!root.targetId) return []
  const opportunities = opportunityTriggers(state, root.actorId)
  if (getJoinReaction(state, root)) return opportunities
  const own = (Object.keys(ACTIONS) as ActionKind[])
    .filter(isReaction)
    .filter((kind) => reactsTo(kind, 'shoot') && kind !== 'joinShot')
    .map((kind): Trigger => ({ characterId: root.targetId!, kind, at: null }))
  // combat.tex "Guard": each shot has its own angle, so one who guards any
  // of the shots — the lead's or a joiner's — may be declared
  const shooters = [root.actorId, ...getReactionsTo(state, root.id).flatMap((r) => (r.kind === 'joinShot' ? [r.actorId] : []))]
  const guards = getAdjacentIds(state, root.targetId)
    .filter((id) => shooters.some((shooter) => isGuardingShot(state, shooter, root.targetId!, id)))
    .map((id): Trigger => ({ characterId: id, kind: 'guard', at: null }))
  // combat.tex "Coordinated Shots": anyone with a shooting weapon may join,
  // whether or not they are in range of the target — that is declared
  const joins = Object.values(state.characters)
    .filter((c) => c.id !== root.actorId && c.id !== root.targetId && hasShootingRow(c))
    .map((c): Trigger => ({ characterId: c.id, kind: 'joinShot', at: null, against: root.targetId! }))
  // combat.tex "Opportunity Attack": "Triggering actions include ... ranged
  // attacks"
  return [...own, ...guards, ...joins, ...opportunities]
}

// combat.tex "Grapple Maneuvers": the partner may pay to resist — except
// an escape "Being stunned allows for", "without the possibility of active
// resistance".
function grappleTriggers(root: GrappleAction): Trigger[] {
  return root.targetId && !root.unresisted ? [{ characterId: root.targetId, kind: 'resist', at: null }] : []
}

// combat.tex "Push and drag": everyone in the group answers the block while
// committed — resists, helps, tags along, or lets go; circling displaces
// nobody, so there is nothing to tag along with or leave.
function dragAnswers(state: CombatState, root: DragAction): Trigger[] {
  if (root.step !== 'react') return []
  const kinds = root.pull || root.movement === 'basic' ? (['resist', 'assist'] as const) : (['resist', 'assist', 'carry', 'letGo'] as const)
  return getDragGroup(state, root)
    .filter((id) => id !== root.actorId)
    .flatMap((id) => kinds.map((kind): Trigger => ({ characterId: id, kind, at: null })))
}

// combat.tex "Opportunity Attack": "moving towards a melee weapon while
// within its attack range" — the block moves everyone it moves, and a third
// party gets the attack against the first of them it moves closer from
// within range, at that step.
function dragOpportunities(state: CombatState, root: DragAction): Trigger[] {
  const attacks = dragApproaches(state, root, getMeleeRange)
    .map(({ id, ...hit }): Trigger => ({ characterId: id, kind: 'opportunityAttack', ...hit }))
  const retargets = dragApproaches(state, root, sprayReach)
    .flatMap(({ id, at, against }) => retargetsOf(state.characters[id], at, against))
  return [...attacks, ...retargets]
}

// The first step of the block at which each third party, within `reachOf`
// of the first of the group it moves closer from, is approached.
function dragApproaches(state: CombatState, root: DragAction, reachOf: (c: Character) => number): { id: string; at: number; against: string }[] {
  const steps = getGroupSteps(state, root)
  if (!steps || steps.length === 0) return []
  const origin = getGroupOrigin(state, root)
  const movers = Object.keys(steps[0])
  const group = getDragGroup(state, root)
  const start = (id: string) => origin[id]
  const triggers: { id: string; at: number; against: string }[] = []
  for (const id of Object.keys(state.characters)) {
    const other = getPlacedFootprint(state, id)
    const range = reachOf(state.characters[id])
    if (group.includes(id) || !other || range === 0) continue
    const hit = movers.flatMap((m) => {
      const c = state.characters[m]
      const from = start(m)
      if (!c || !from) return []
      const at = getApproachStep(getPathDistances(c, [from, ...steps.map((step) => step[m])], other), range)
      return at === null ? [] : [{ at, against: m }]
    }).sort((a, b) => a.at - b.at)[0]
    if (hit) triggers.push({ id, ...hit })
  }
  return triggers
}

// combat.tex "Explosions": "defended against with a reflex test"; "Sprays":
// "target all characters in range, which their reflex saves to escape".
// Everyone the explosion as declared may reach — a spray not yet aimed
// threatens its whole range — may avoid it, the one who set it off as much
// as anyone: a bomb is no respecter of the hand that threw it, and whoever
// stands in the area is a target of it.
function explosionTriggers(state: CombatState, root: ExplosionAction): Trigger[] {
  if (!isAvoidable(root)) return []
  return getThreatenedIds(state, getBlastOf(state, root)).map((id): Trigger => ({ characterId: id, kind: 'avoidExplosion', at: null }))
}

// combat.tex "Opportunity Attack": "Triggering actions include casting
// spells"; spells.tex "Quicken Spell": "not cause oportunity attacks" — the
// one way to cast without drawing one.
function castTriggers(state: CombatState, root: CastAction): Trigger[] {
  return root.quicken ? [] : opportunityTriggers(state, root.actorId)
}

// combat.tex "Opportunity Attack": "Triggering actions include ... standard
// actions" — picking up is one (combat.tex "Standard Action"), whatever its
// AP cost comes to with Prestidigitation.
function pickUpTriggers(state: CombatState, root: PickUpAction): Trigger[] {
  return opportunityTriggers(state, root.actorId)
}

// combat.tex "Opportunity Attack": triggered by "moving towards a melee
// weapon while within its attack range" — the first step taken from a cell
// already within someone's melee range to one closer to them. Stepping into
// range is not yet moving towards the weapon while within it.
// combat.tex "Follow": "as a reaction to any movement except running,
// follow another character who is already within melee range."
// combat.tex "Opportunity Attack": "standing up in melee range" is a
// triggering action; the attack is fought before the mover is up, at step 0.
// Going prone triggers nothing.
function moveTriggers(state: CombatState, root: MoveAction): Trigger[] {
  if (root.movement === 'prone') return []
  if (root.movement === 'stand') return opportunityTriggers(state, root.actorId).map((t) => ({ ...t, at: 0 }))
  const mover = state.characters[root.actorId]
  const from = state.board?.placements[root.actorId]
  if (!mover || !from || !state.board) return []
  const path = root.path
  // the table's ruling: a move a reaction or a follow-up opened, or one
  // made in a flee turn, cannot be followed
  const opener = root.spawnedBy ? getAction(state, root.spawnedBy) : null
  const reactive = state.fleeing || root.followUpOf !== null || (opener !== null && isReaction(opener.kind))
  const triggers: Trigger[] = []
  for (const id of Object.keys(state.characters)) {
    if (id === root.actorId) continue
    const other = getPlacedFootprint(state, id)
    if (!other) continue
    // combat.tex "Trample": whoever the path comes into answers it — "Evades:
    // costs 2 AP to allow free passage", or braces for the crash ("The
    // target can spend 2AP+1STA to get +3"). "Is prone: free passage":
    // nothing to answer.
    if (isTrampleable(state, id) && path.some((cell) => getFootprint(mover, { ...from, cell }).some((f) => other.some((o) => sameCell(f, o))))) {
      triggers.push({ characterId: id, kind: 'evade', at: null }, { characterId: id, kind: 'brace', at: null })
    }
    const distances = getPathDistances(mover, [from, ...path.map((cell) => ({ ...from, cell }))], other)
    // combat.tex "Flee": "to prevent them from entering a 4m perimeter from
    // the character" — the step that first brings the mover within it. The
    // flee "interrupts the opponents turn", so it is never open to the one
    // whose turn it is.
    const enters = firstStep(distances, (previous, now) => previous > FLEE_PERIMETER && now <= FLEE_PERIMETER)
    if (enters !== null && !isInTurn(state, id)) triggers.push({ characterId: id, kind: 'flee', at: enters })
    const range = getMeleeRange(state.characters[id])
    if (range > 0 && distances[0] <= range && root.movement !== 'run' && !reactive) triggers.push({ characterId: id, kind: 'follow', at: null })
    const spray = sprayReach(state.characters[id])
    const aimed = spray > 0 ? getApproachStep(distances, spray) : null
    if (aimed !== null) triggers.push(...retargetsOf(state.characters[id], aimed))
    if (range === 0) continue
    const approach = getApproachStep(distances, range)
    if (approach !== null) triggers.push({ characterId: id, kind: 'opportunityAttack', at: approach })
    // combat.tex "Catch": "someone tries to initiate a grapple against a
    // running target" — one with a grapple row may grab a runner once the
    // run has brought them within its reach, as nobody else may; fought, as
    // every attack on a mover is, with the mover stood where the step before
    // `at` left them — here, the first step in reach
    const grab = root.movement === 'run' ? getMeleeRange(state.characters[id], isGrappleRow) : 0
    if (grab > 0) {
      const inReach = distances.slice(1).findIndex((d) => d <= grab)
      if (inReach >= 0 && !triggers.some((t) => t.characterId === id && t.at === inReach + 2)) triggers.push({ characterId: id, kind: 'opportunityAttack', at: inReach + 2, catchOnly: true })
    }
    // combat.tex "Hook Attack": "a reaction against running targets that
    // move away from the weapon within two spaces, which are both inside its
    // melee range"
    const hook = getMeleeRange(state.characters[id], (atk) => hasProperty(atk.properties, 'hook'))
    if (root.movement !== 'run' || hook === 0) continue
    const away = firstStep(distances, (previous, now) => now > previous && now <= hook)
    if (away !== null) triggers.push({ characterId: id, kind: 'opportunityAttack', at: away })
  }
  return triggers
}

// How far the mover's footprint stands from the other's at each placement
// along the way, the one set out from first.
function getPathDistances(mover: Character, placements: Placement[], other: Coord[]): number[] {
  return placements.map((p) => setDistance(getFootprint(mover, p), other))
}

// combat.tex "Opportunity Attack": "moving towards a melee weapon while
// within its attack range" — the first step taken from within the range to
// closer still.
function getApproachStep(distances: number[], range: number): number | null {
  return firstStep(distances, (previous, now) => previous <= range && now < previous)
}

// the first step, counted from 1, at which `moved` holds between the
// distance before it and the distance after it; `distances` starts with the
// one before the first step
function firstStep(distances: number[], moved: (previous: number, now: number) => boolean): number | null {
  for (let i = 1; i < distances.length; i++) if (moved(distances[i - 1], distances[i])) return i
  return null
}
