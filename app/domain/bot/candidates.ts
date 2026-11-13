import type { SceneState, Coord } from '../scene/types'
import type { CampaignCharacter } from '../types'
import type { Dice } from '../play/dice'
import { setDistance } from '../scene/rules/board/geometry'
import { getOpenAction } from '../scene/rules/log'
import type { ReachableCell } from '../scene/rules/move'
import { getReachableCells } from '../scene/rules/board/reach'
import { amendAction, declareAction } from '../scene/commands/action'
import { getLiveFoes, getSide, getTuning, type Party } from './party'
import { getThreat } from './threat'
import { getArmedAttacks, type Armed } from './weapons'
import { canPay, getReadings, getSpentCost, getUnanswered } from './reading'
import { getSpots, getStandUp, walkMove } from './position'
import { getFightName } from '../scene/rules/fighters'
import { getFreeHoldingHands } from '../item/rules/hands'
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

// The foe to attack (threat.ts): the one that threatens the party's side most
// with a rested round, among those the character threatens most as things
// stand. Foes it has no attack on now are not in the running. Sorted best
// first; the foes the character threatens not at all follow, by the threat
// they pose.
function byThreat(state: SceneState, party: Party, id: string, newId: () => string): (a: string, b: string) => number {
  const side = getSide(state, party)
  const tuning = getTuning(party)
  const foes = getLiveFoes(state, party)
  const posed = new Map(foes.map((foe) => [foe, Math.max(0, ...side.map((target) => getThreat(state, foe, target, newId, 'potential', tuning)))]))
  const mine = new Map(foes.map((foe) => [foe, getThreat(state, id, foe, newId, 'immediate', tuning)]))
  const worth = (foe: string) => (posed.get(foe) ?? 0) * (mine.get(foe) ?? 0)
  return (a, b) => worth(b) - worth(a) || (mine.get(b) ?? 0) - (mine.get(a) ?? 0) || (posed.get(b) ?? 0) - (posed.get(a) ?? 0)
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
  const order = byThreat(state, party, id, newId)
  const armed = getArmed(state, id, newId)
  const targets = [...new Set(armed.flatMap((a) => a.targets.filter((t) => foes.includes(t))))].sort(order)
  const chosen = targets[0]
  return armed.flatMap((a) => (a.targets.includes(chosen) ? [attackOn(state, id, a, chosen, newId)] : []))
}

// Every attack the character can pay for on every foe in reach, by the quick
// reading of the blow alone (reading.ts), unanswered: the most IL for what it
// costs. Cheap enough for every turn of a fight played on.
export function getReadAttackCandidates(state: SceneState, party: Party, id: string, newId: () => string): Candidate[] {
  const attacker = state.characters[id]
  const read = getLiveFoes(state, party).flatMap((foe) => getReadings(state, id, foe)
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
    label: `${spot.surged ? 'surge and ' : ''}${spot.movement === 'basic' ? 'walk' : spot.movement} ${spot.to.steps} to (${spot.to.cell.q},${spot.to.cell.r}): deals ${+spot.offense.toFixed(2)}, takes ${+spot.danger.toFixed(2)}, draws ${+spot.drawn.toFixed(2)}`,
    play: committing(state, id, walkMove(id, spot.movement, spot.to.path, spot.surged), newId),
  }))
}

// combat.tex "Prone": standing up, for one lying down who may.
export function getStandCandidates(state: SceneState, id: string, newId: () => string): Candidate[] {
  const stand = getStandUp(state, id, newId)
  return stand ? [{ label: 'stand up', play: committing(state, id, stand, newId) }] : []
}

// A character may take up another weapon to fight with, or take up what it
// holds another way: each weapon it holds or carries in a quick slot (drawn
// from it, "Drawing items in combat", at the price the sheet charges), readied
// three ways: drawn beside what it holds, each kept in one hand; alone, all
// else in hand dropped first (combat.tex "Putting items away": "Dropping items
// on the floor costs 0 AP"), in one hand; and so, gripped in both. What is
// put away is dropped, never stowed. A way that leaves the hands as they are is
// no switch.
//
// It is offered when the switch pays in threat (threat.ts). For this turn:
// the immediate threat after the switch, the AP and STA it costs counted into
// the cost of the attack, is greater than the threat now; the switch and the
// attack on a foe are then one option. For a rested round: the potential
// threat now is under `switchBelow` and after the switch over it; the switch
// alone is then the option.
export function getSwitchCandidates(state: SceneState, party: Party, id: string, newId: () => string): Candidate[] {
  const c = state.characters[id]
  const foes = getLiveFoes(state, party)
  if (!c || foes.length === 0) return []
  const tuning = getTuning(party)
  const { switchBelow } = tuning
  const threat = (s: SceneState, kind: 'potential' | 'immediate', extra = 0) => Math.max(0, ...foes.map((foe) => getThreat(s, id, foe, newId, kind, tuning, extra)))
  const nowImmediate = threat(state, 'immediate')
  let nowPotential: number | undefined
  const gear = (kind: string, args: unknown[]) => ({ kind: 'editGear', args: [id, { kind, args }, false] }) as Move[number]
  const hands = (s: SceneState) => JSON.stringify([s.characters[id].held.map((item) => item.id), s.characters[id].body.map((part) => part.itemId)])
  const now = hands(state)

  const weapons = [
    ...c.held.filter((item) => item.type === 'weapon').map((item) => ({ itemId: item.id, name: item.name, draw: [] as Move })),
    ...getQuickWeapons(c).map(({ containerKey, itemId, name }) => ({ itemId, name, draw: [gear('drawItem', [containerKey, itemId])] as Move })),
  ]
  const tried = new Set([now])
  const switches = weapons.flatMap(({ itemId, name, draw }) => {
    const others = c.held.filter((item) => item.id !== itemId)
    const drop: Move = others.map((item) => gear('dropItem', [item.id]))
    const dropping = others.length > 0 ? `drop ${others.map((item) => item.name).join(' and ')}` : null
    const drawing = draw.length > 0 ? `draw ${name}` : null
    const ways: { before: Move; after: Move; how: string }[] = [
      ...(draw.length > 0 ? [{ before: others.map((item) => gear('regripItem', [item.id, 1])), after: [], how: `draw ${name}` }] : []),
      { before: drop, after: [], how: [dropping, drawing].filter(Boolean).join(', ') },
      { before: drop, after: [gear('regripItem', [itemId, 2])], how: [dropping, drawing, `grip ${name} in both hands`].filter(Boolean).join(', ') },
    ]
    return ways.flatMap(({ before, after, how }) => {
      const cleared = play(state, before, () => 5, newId).state
      if (draw.length > 0 && getFreeHoldingHands(cleared.characters[id]).length === 0) return []
      const move = [...before, ...draw, ...after]
      const switched = play(cleared, [...draw, ...after], () => 5, newId).state
      const held = hands(switched)
      if (tried.has(held) || !switched.characters[id].held.some((item) => item.id === itemId)) return []
      tried.add(held)
      return [{ move, how, state: switched }]
    })
  })

  return switches.flatMap(({ move, how, state: switched }): Candidate[] => {
    const after = switched.characters[id]
    const paid = c.resources.AP - after.resources.AP + c.resources.STA - after.resources.STA
    if (threat(switched, 'immediate', paid) > nowImmediate) {
      return getArmed(switched, id, newId).flatMap((armed) => armed.targets.filter((t) => foes.includes(t)).map((target) => ({
        label: `${how}: ${armed.option.weapon} ${armed.option.attack} (${armed.option.variant}) → ${getFightName(state, target)}`,
        play: committing(state, id, [...move, ...armed.move, { kind: 'target', args: [target] }, { kind: 'commit', args: [] }], newId),
      })))
    }
    nowPotential ??= threat(state, 'potential')
    if (nowPotential < switchBelow && threat(switched, 'potential') > switchBelow) return [{ label: how, play: committing(state, id, move, newId) }]
    return []
  })
}

// The weapons waiting in quick slots.
function getQuickWeapons(c: CampaignCharacter | undefined): { containerKey: string; itemId: string; name: string }[] {
  if (!c) return []
  return Object.entries(c.containers).flatMap(([containerKey, container]) => container.slots.quick.items.filter((item) => item.type === 'weapon').map((item) => ({ containerKey, itemId: item.id, name: item.name })))
}

export function getCandidates(state: SceneState, party: Party, id: string, newId: () => string): Candidate[] {
  return [...getStandCandidates(state, id, newId), ...getAttackCandidates(state, party, id, newId), ...getSwitchCandidates(state, party, id, newId), ...getPositionCandidates(state, party, id, newId)]
}
