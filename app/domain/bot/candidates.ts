import type { SceneState, Coord } from '../scene/types'
import type { CampaignCharacter } from '../types'
import type { Dice } from '../play/dice'
import { setDistance } from '../scene/rules/board/geometry'
import { getOpenAction } from '../scene/rules/log'
import type { ReachableCell } from '../scene/rules/move'
import { getReachableCells } from '../scene/rules/board/reach'
import { amendAction, declareAction } from '../scene/commands/action'
import { getInjuryPenalty } from '../character/rules/afflictions'
import { getLiveFoes, type Party } from './party'
import { getArmedAttacks, type Armed } from './weapons'
import { canPay, getBestOf, getReadings, getSpentCost, getUnanswered } from './reading'
import { getSpots, walkMove } from './position'
import { getFightName } from '../scene/rules/fighters'
import { play, type Move, type Played } from './move'

// What a bot may do with its turn, each as a way to play it with a die:
// strike or shoot a foe within reach with a row and variation, or walk
// towards the foes. Null from `play` is an option that did not come off.

export type Candidate = {
  label: string
  play: (dice: Dice) => Played | null
}

// The move pressed from the turn as it stood, if the action it declares got
// past its commit: one refused stays open at `define`.
export function committing(state: SceneState, id: string, move: Move, newId: () => string): (dice: Dice) => Played | null {
  return (dice) => {
    const played = play(state, move, dice, newId)
    const open = getOpenAction(played.state)
    return open?.actorId === id && open.step === 'define' ? null : played
  }
}

// The most wounded first.
function byWounds(state: SceneState): (a: string, b: string) => number {
  return (a, b) => getInjuryPenalty(state.characters[b]) - getInjuryPenalty(state.characters[a])
}

function attackOn(state: SceneState, id: string, armed: Armed, target: string, newId: () => string): Candidate {
  return {
    label: `${armed.option.weapon} ${armed.option.attack} (${armed.option.variant}) → ${getFightName(state, target)}`,
    play: committing(state, id, [...armed.move, { kind: 'target', args: [target] }, { kind: 'commit', args: [] }], newId),
  }
}

function getArmed(state: SceneState, id: string, newId: () => string): Armed[] {
  return (['strike', 'shoot'] as const).flatMap((kind) => getArmedAttacks(state, id, kind, newId))
}

export function getAttackCandidates(state: SceneState, party: Party, id: string, newId: () => string): Candidate[] {
  const foes = getLiveFoes(state, party)
  return getArmed(state, id, newId).flatMap((armed) =>
    armed.targets.filter((t) => foes.includes(t)).sort(byWounds(armed.state)).map((target) => attackOn(state, id, armed, target, newId)))
}

// Every attack the character can pay for on every foe in reach, by the quick
// reading of the blow alone (reading.ts), unanswered: the most IL for what it
// costs. Cheap enough for every turn of a fight played on.
export function getReadAttackCandidates(state: SceneState, party: Party, id: string, newId: () => string): Candidate[] {
  const attacker = state.characters[id]
  const read = getLiveFoes(state, party).flatMap((foe) => getReadings(state, id, foe, false)
    .filter((reading) => canPay(state, attacker, reading.cost))
    .map((reading) => ({ reading, foe, worth: getUnanswered(reading) / Math.max(1, getSpentCost(reading)) })))
    .sort((a, b) => b.worth - a.worth)
  const armed = getArmed(state, id, newId)
  return read.flatMap(({ reading, foe }): Candidate[] => {
    const made = armed.find((a) => a.kind === reading.kind && a.option.weaponKey === reading.weaponKey && a.option.attack === reading.attack && a.option.variant === reading.variant && a.targets.includes(foe))
    return made ? [attackOn(state, id, made, foe, newId)] : []
  })
}

// For each kind of movement, the walk to the reachable cell nearest a foe, if
// it is nearer than where the character stands, and not into a foe's space,
// which would be a crash and no approach.
export function getApproachCandidates(state: SceneState, party: Party, id: string, newId: () => string): Candidate[] {
  const origin = state.board?.placements[id]?.cell
  const foes: Coord[] = getLiveFoes(state, party).flatMap((f) => state.board?.placements[f]?.cell ?? [])
  if (!origin || foes.length === 0) return []
  const declared = declareAction(id, { kind: 'move' }, newId)(state)
  const open = getOpenAction(declared)
  if (open?.kind !== 'move') return []

  const here = setDistance([origin], foes)
  return (['basic', 'run'] as const).flatMap((movement): Candidate[] => {
    const moving = amendAction({ movement })(declared)
    const aimed = getOpenAction(moving)
    if (aimed?.kind !== 'move') return []
    const best = getReachableCells(moving, aimed)
      .map((to) => ({ to, gap: setDistance([to.cell], foes) }))
      .filter((w) => w.gap < here && w.gap > 0)
      .reduce<{ to: ReachableCell; gap: number } | null>((a, b) => (!a || b.gap < a.gap || (b.gap === a.gap && b.to.steps < a.to.steps) ? b : a), null)
    if (!best) return []
    return [{
      label: `move (${movement}) ${best.to.steps} cells, ${best.gap} from the nearest foe`,
      play: committing(state, id, walkMove(id, movement, best.to.path), newId),
    }]
  })
}

// The walks to the cells the position finder (position.ts) puts first.
export function getPositionCandidates(state: SceneState, party: Party, id: string, newId: () => string): Candidate[] {
  return getSpots(state, party, id, newId).map((spot) => ({
    label: `${spot.surged ? 'surge and ' : ''}${spot.movement === 'run' ? 'run' : 'walk'} ${spot.to.steps} to (${spot.to.cell.q},${spot.to.cell.r}): deals ${+spot.offense.toFixed(2)}, takes ${+spot.danger.toFixed(2)}, draws ${+spot.drawn.toFixed(2)}`,
    play: committing(state, id, walkMove(id, spot.movement, spot.to.path, spot.surged), newId),
  }))
}

// A shooter a foe has in melee reach may fight it there instead, when what it
// would strike with hits harder than what it shoots with (the quick reading,
// as the foe would answer). A melee weapon in a quick slot is drawn if it
// carries one ("Drawing items in combat", at the price the sheet charges):
// with the weapons it shoots with kept in one hand where the other is then
// free for it, else dropped first (combat.tex "Putting items away":
// "Dropping items on the floor costs 0 AP"). With none to draw, it strikes
// with what is left in hand once they are dropped.
export function getSwitchCandidates(state: SceneState, party: Party, id: string, newId: () => string): Candidate[] {
  const c = state.characters[id]
  const foes = getLiveFoes(state, party)
  const shot = getArmed(state, id, newId).filter((a) => a.kind === 'shoot').map((a) => a.option.weaponKey)
  if (!c || shot.length === 0 || !foes.some((foe) => getReadings(state, foe, id, false).some((r) => r.kind === 'strike'))) return []
  const ranged = c.held.filter((item) => shot.includes(item.id))
  const hardest = (s: SceneState, kind: 'strike' | 'shoot') => Math.max(0, ...foes.map((foe) =>
    getBestOf(s, getReadings(s, id, foe).filter((r) => r.kind === kind), s.characters[id], s.characters[foe])?.harm ?? 0))
  const shooting = hardest(state, 'shoot')
  const gear = (kind: string, args: unknown[]) => ({ kind: 'editGear', args: [id, { kind, args }, false] }) as Move[number]
  const keep: Move = ranged.map((item) => gear('regripItem', [item.id, 1]))
  const drop: Move = ranged.map((item) => gear('dropItem', [item.id]))
  const draws: Move[] = [[], ...getQuickWeapons(c).map(({ containerKey, itemId }): Move => [gear('drawItem', [containerKey, itemId])])]
  const switches = draws.flatMap((draw): { move: Move; state: SceneState }[] => {
    const kept = play(state, [...keep, ...draw], () => 5, newId).state
    if (draw.length > 0 && kept.characters[id].held.length > c.held.length) return [{ move: [...keep, ...draw], state: kept }]
    const move = [...drop, ...draw]
    return [{ move, state: play(state, move, () => 5, newId).state }]
  }).filter((s) => hardest(s.state, 'strike') > shooting)
  return switches.flatMap(({ move, state: switched }) => {
    const dropped = move.some((m) => (m.args[1] as { kind?: string } | undefined)?.kind === 'dropItem')
    const drew = move.some((m) => (m.args[1] as { kind?: string } | undefined)?.kind === 'drawItem')
    const how = [dropped ? `drop ${ranged.map((item) => item.name).join(' and ')}` : null, drew ? 'draw' : null].filter(Boolean).join(', ')
    return getArmed(switched, id, newId).filter((a) => a.kind === 'strike').flatMap((armed) => armed.targets.filter((t) => foes.includes(t)).map((target) => ({
      label: `${how}: ${armed.option.weapon} ${armed.option.attack} (${armed.option.variant}) → ${getFightName(state, target)}`,
      play: committing(state, id, [...move, ...armed.move, { kind: 'target', args: [target] }, { kind: 'commit', args: [] }], newId),
    })))
  })
}

// The weapons waiting in quick slots.
function getQuickWeapons(c: CampaignCharacter | undefined): { containerKey: string; itemId: string }[] {
  if (!c) return []
  return Object.entries(c.containers).flatMap(([containerKey, container]) => container.slots.quick.items.filter((item) => item.type === 'weapon').map((item) => ({ containerKey, itemId: item.id })))
}

export function getCandidates(state: SceneState, party: Party, id: string, newId: () => string): Candidate[] {
  return [...getAttackCandidates(state, party, id, newId), ...getSwitchCandidates(state, party, id, newId), ...getPositionCandidates(state, party, id, newId)]
}
