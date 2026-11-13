import type { Character, GearMove, Item, SlotKind } from '../../types'
import { SlotKindSchema } from '../../types'
import { ActionCost, getActionCost } from '../../character/rules/actionCosts'
import { getSurgeBar } from '../../character/rules/surge'
import { getDoffCost, getPieceCost, getWearView } from '../../character/rules/donning'
import { FREE, getDrawCost, getPutOnView, getSlingView, getStoreCost, getUnslingView, isCharged } from './costs'
import { canHoldWith, getFreeHoldingHands, getGrip, getHeldItem } from './hands'
import { canFitItem, getContainer, getContainerItem, getOpenContainers } from './containers'

// A move with the character's own gear (`GearMove`): what it costs in play,
// and why it cannot be made now. The move refuses by these, and so does the
// fight, where the move is an action of its own (scene `gear`).

// A character in a combat that has started pays the price or the move does
// not happen; anywhere else nothing is charged. Nothing done with the gear is
// anything a surge's AP allows, so none is paid for while any is left.
export function getPayBar(c: Character, cost: ActionCost, charged: boolean): string | null {
  if (!isCharged(c, charged)) return null
  const surge = getSurgeBar(c)
  if (surge) return surge
  if (c.resources.AP < cost.AP) return 'not enough AP'
  return c.resources.STA < cost.STA ? 'not enough STA' : null
}

// The stack an id names in an open container, and the slot group it sits in.
export function findStack(c: Character, containerKey: string, itemId: string): { slot: SlotKind; item: Item } | null {
  const container = getContainer(c, containerKey)
  if (!container) return null
  for (const slot of SlotKindSchema.options) {
    const item = container.slots[slot].items.find((i) => i.id === itemId)
    if (item) return { slot, item }
  }
  return null
}

// The moves nothing is paid for, made whatever is left of a surge: a regrip
// (gear.tex "Small/One/Two hands": "at no cost"), a drop (combat.tex "Putting
// items away": "Dropping items on the floor costs 0 AP"), a container put on
// from the hands or taken off, and armor donned, which no fight allows.
const UNPAID: readonly GearMove['kind'][] = ['regripItem', 'dropItem', 'putOnFromHands', 'takeOffContainer', 'wearFromHands', 'wearFromContainer']

export function isUnpaidMove(kind: string): boolean {
  return (UNPAID as readonly string[]).includes(kind)
}

const standard = (c: Character) => getActionCost(c, 'standardAction')

// What the move costs a character in play; null where the item is not there,
// or where no turn can pay for it (an armor that takes minutes to doff).
export function getGearMoveCost(c: Character, move: GearMove): ActionCost | null {
  switch (move.kind) {
    case 'regripItem':
    case 'dropItem':
    case 'putOnFromHands':
    case 'takeOffContainer':
    case 'wearFromHands':
    case 'wearFromContainer':
      return FREE
    // gear.tex "Shields": to the back, to the front or thrown off, a standard
    // action; "Closed helmet": the visor the same
    case 'slingShield':
    case 'unslingShield':
    case 'throwOffShield':
    case 'toggleVisor':
      return standard(c)
    // combat.tex "Putting items away"
    case 'storeItem': {
      const item = getHeldItem(c, move.args[0])
      return item ? getStoreCost(c, move.args[2], item) : null
    }
    // combat.tex "Drawing items in combat", and a container put on from a slot
    // at that slot's draw price
    case 'drawItem':
    case 'putOnFromContainer': {
      const found = findStack(c, move.args[0], move.args[1])
      return found ? getDrawCost(c, found.slot, found.item) : null
    }
    // gear.tex "Donning and Doffing armor"
    case 'doffArmor':
      return getDoffCost(c, move.args[0]?.slot ?? null)
    case 'putGauntlets':
      return getPieceCost(c, !!c.hasGauntlets)
    case 'putHelm':
      return getPieceCost(c, !!c.hasHelm)
  }
}

// Why the move cannot be made now, its price aside.
export function getGearMoveBlock(c: Character, move: GearMove, charged: boolean): string | null {
  switch (move.kind) {
    // gear.tex "Small/One/Two hands": a second free hand joins, or lets go
    case 'regripItem': {
      const [itemId, hands] = move.args
      const current = getGrip(c, itemId)
      if (current === 0) return 'not held'
      if (current === hands) return hands === 1 ? 'already held in one hand' : 'already held in two hands'
      return hands === 2 && getFreeHoldingHands(c).length === 0 ? 'no free hand' : null
    }
    case 'dropItem':
      return getHeldItem(c, move.args[0]) ? null : 'not held'
    case 'slingShield': {
      const item = getHeldItem(c, move.args[0])
      const view = item ? getSlingView(c, item, charged) : null
      return !item ? 'not held' : !view ? 'not a shield' : view.able ? null : view.why
    }
    case 'unslingShield': {
      if (!c.onBack) return 'nothing on the back'
      const view = getUnslingView(c, c.onBack, charged)
      return view.able ? null : view.why
    }
    case 'throwOffShield':
      return c.onBack ? null : 'nothing on the back'
    case 'putOnFromHands': {
      const item = getHeldItem(c, move.args[0])
      return item ? putOnBlock(c, 'hand', item, charged) : 'not held'
    }
    case 'putOnFromContainer': {
      const found = findStack(c, move.args[0], move.args[1])
      return found ? putOnBlock(c, found.slot, found.item, charged) : 'not in that container'
    }
    case 'wearFromHands': {
      const item = getHeldItem(c, move.args[0])
      return item ? wearBlock(c, item, charged) : 'not held'
    }
    case 'wearFromContainer': {
      const found = findStack(c, move.args[0], move.args[1])
      return found ? wearBlock(c, found.item, charged) : 'not in that container'
    }
    case 'storeItem': {
      const [itemId, containerKey, slot] = move.args
      const item = getHeldItem(c, itemId)
      const container = getContainer(c, containerKey)
      if (!item) return 'not held'
      if (!container) return 'no such container'
      return canFitItem(container, slot, item) ? null : `does not fit in the ${slot} slots`
    }
    // a unit of the stack into a free hand
    case 'drawItem': {
      const found = findStack(c, move.args[0], move.args[1])
      if (!found) return 'not in that container'
      return canHoldWith(c, found.item, 1) ? null : 'no free hand'
    }
    // one opened in a slot comes off the way any item in a slot does
    case 'takeOffContainer':
      return c.containers[move.args[0]] ? null : 'not put on'
    // put away into a slot group it fits, or let go of; on the clock, an
    // armor that takes minutes to doff stays on
    case 'doffArmor': {
      const into = move.args[0]
      if (!c.worn) return 'no armor worn'
      if (into) {
        const container = getContainer(c, into.containerKey)
        if (!container || !canFitItem(container, into.slot, c.worn)) return `does not fit in the ${into.slot} slots`
      }
      return getDoffCost(c, into?.slot ?? null) || !isCharged(c, charged) ? null : 'takes more than a turn to doff'
    }
    case 'putGauntlets':
    case 'putHelm':
      return null
    case 'toggleVisor':
      return c.hasHelm ? null : 'no closed helmet'
  }
}

function putOnBlock(c: Character, from: SlotKind | 'hand', item: Item, charged: boolean): string | null {
  const view = getPutOnView(c, from, item, charged)
  return !view ? 'not a container to put on' : view.able ? null : view.why
}

function wearBlock(c: Character, item: Item, charged: boolean): string | null {
  const view = getWearView(c, item, charged)
  return !view ? 'not armor' : view.wearable ? null : view.why
}

// Why the move cannot be made now and paid for as it is made, or null.
export function getGearMoveBar(c: Character, move: GearMove, charged: boolean): string | null {
  const block = getGearMoveBlock(c, move, charged)
  if (block || isUnpaidMove(move.kind)) return block
  const cost = getGearMoveCost(c, move)
  return cost ? getPayBar(c, cost, charged) : null
}

const GRIPS = [1, 2] as const

// Every move the character's gear offers, made or not: each stack held
// regripped, dropped, slung, put on, worn or put in each slot group of each
// open container; what is on the back unslung or thrown off; each stack in an
// open container drawn, put on or worn; each container put on taken off; the
// armor taken off to the floor or into each slot group; the gauntlets, the
// helmet and the visor.
export function getGearMoves(c: Character): GearMove[] {
  const containers = Object.entries(getOpenContainers(c))
  const slotsOf = (key: string) => SlotKindSchema.options.filter((slot) => (getContainer(c, key)?.slots[slot].numSlots ?? 0) > 0)
  return [
    ...c.held.flatMap((item): GearMove[] => [
      ...GRIPS.map((grip): GearMove => ({ kind: 'regripItem', args: [item.id, grip] })),
      { kind: 'dropItem', args: [item.id] },
      { kind: 'slingShield', args: [item.id] },
      { kind: 'putOnFromHands', args: [item.id] },
      { kind: 'wearFromHands', args: [item.id] },
      ...containers.flatMap(([key]) => slotsOf(key).map((slot): GearMove => ({ kind: 'storeItem', args: [item.id, key, slot] }))),
    ]),
    ...(c.onBack ? [{ kind: 'unslingShield', args: [] }, { kind: 'throwOffShield', args: [] }] satisfies GearMove[] : []),
    ...containers.flatMap(([key, container]) => SlotKindSchema.options.flatMap((slot) => container.slots[slot].items.flatMap((item): GearMove[] => [
      { kind: 'drawItem', args: [key, item.id] },
      { kind: 'putOnFromContainer', args: [key, item.id] },
      { kind: 'wearFromContainer', args: [key, item.id] },
    ]))),
    ...Object.keys(c.containers).map((key): GearMove => ({ kind: 'takeOffContainer', args: [key] })),
    ...(c.worn ? [{ kind: 'doffArmor', args: [null] } satisfies GearMove, ...containers.flatMap(([key]) => slotsOf(key).map((slot): GearMove => ({ kind: 'doffArmor', args: [{ containerKey: key, slot }] })))] : []),
    { kind: 'putGauntlets', args: [] },
    { kind: 'putHelm', args: [] },
    { kind: 'toggleVisor', args: [] },
  ]
}

// What the move lets go of, which in a fight lands on the floor where the
// character stands: the stack dropped, the shield thrown off the back, the
// armor doffed and not put away, a container taken off with no hand free to
// take it.
export function getLetGoOf(c: Character, move: GearMove): Item | null {
  switch (move.kind) {
    case 'dropItem':
      return getHeldItem(c, move.args[0]) ?? null
    case 'throwOffShield':
      return c.onBack
    case 'doffArmor':
      return move.args[0] ? null : c.worn
    case 'takeOffContainer': {
      const container = c.containers[move.args[0]]
      if (!container) return null
      const item = getContainerItem(move.args[0], container)
      const { [move.args[0]]: _off, ...remaining } = c.containers
      return canHoldWith({ ...c, containers: remaining }, item, 1) ? null : item
    }
    default:
      return null
  }
}
