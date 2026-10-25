import { Character, CharacterUpdater, Item, SlotKind } from '../../types'
import { canBeHeld, getFreeHoldingHands, getGrip, getHeldItem, Grip } from '../rules/hands'
import { canFitItem, findCarriedItem, findReadyItem, getContainer } from '../rules/containers'
import { ActionCost, getActionCost } from '../../character/rules/actionCosts'
import { MoveView, getDrawCost, getSlingView, getStoreCost, getUnslingView, isCharged } from '../rules/costs'
import { addItemToContainer, duplicateItem, mapContainerItem, removeItemFromContainer } from './items'
import { updateSTA } from '../../character/commands/bleed'
import { getSurgeBar } from '../../character/rules/surge'
import { getCastSize, getChargeTargets, getSpellGear, pickSpellGear } from '../../character/rules/spells'
import { SPELLS, isSpellKey } from '../../spells'
import { Improvements, drawOnFood, drawOnGear, produceEffects, settleTests } from '../../character/rules/production'
import { getConsume, getDosesLeft, getUnitDoses } from '../rules/consumables'

// What changes the hands keeps whichever kind of character it was given.
type HeldUpdater = <C extends Character>(c: C, charged?: boolean) => C

// A character in a combat that has started pays the price or the move does
// not happen; anywhere else nothing is charged. `null` is the refusal, so the
// caller returns the character untouched. Nothing done with the hands is
// anything a surge's AP allows, so none can be done while any is left.
export function pay<C extends Character>(c: C, cost: ActionCost, charged: boolean): C | null {
  if (!isCharged(c, charged)) return c
  if (getSurgeBar(c)) return null
  if (c.resources.AP < cost.AP || c.resources.STA < cost.STA) return null
  const paid = cost.STA > 0 ? updateSTA(c.resources.STA - cost.STA)(c) : c
  return { ...paid, resources: { ...paid.resources, AP: paid.resources.AP - cost.AP } }
}

// The first free hands that can hold take the stack. Whatever else the move
// costs has been paid by the time this runs.
function grip<C extends Character>(c: C, item: Item, hands: Grip): C {
  if (!canBeHeld(c, item)) {
    throw new Error(`"${item.name || item.refId}" cannot be held`)
  }
  const free = getFreeHoldingHands(c)
  if (free.length < hands) {
    throw new Error(`Not enough free hands to hold "${item.name || item.refId}"`)
  }
  const taking = new Set(free.slice(0, hands).map((part) => part.id))
  return {
    ...c,
    held: [...c.held, item],
    body: c.body.map((part) => (taking.has(part.id) ? { ...part, itemId: item.id } : part)),
  }
}

// What leaves the hands lets go of any spell held with it (the table's
// ruling: dropping the flamethrower ends it).
function release<C extends Character>(c: C, itemId: string): C {
  return {
    ...c,
    held: c.held.filter((item) => item.id !== itemId),
    body: c.body.map((part) => (part.itemId === itemId ? { ...part, itemId: '' } : part)),
    ...('active' in c ? { active: c.active.filter((e) => e.itemId !== itemId) } : {}),
  }
}

// Takes an item that is nowhere yet — stamped from the catalog — into the
// hands. Nothing is charged: it did not come out of a slot. A hand holds one
// of a stack, never the stack.
export function holdItem(item: Item, hands: Grip = 1): HeldUpdater {
  return <C extends Character>(c: C): C => grip(c, item.amount > 1 ? { ...item, amount: 1 } : item, hands)
}

// gear.tex "Small/One/Two hands": a held stack moves between one hand and two
// at no cost. The hand already on it stays; a second free hand joins or lets go.
export function regripItem(itemId: string, hands: Grip): HeldUpdater {
  return <C extends Character>(c: C): C => {
    const current = getGrip(c, itemId)
    if (current === 0 || current === hands) return c
    if (hands === 1) {
      let kept = false
      return {
        ...c,
        body: c.body.map((part) => {
          if (part.itemId !== itemId) return part
          if (kept) return { ...part, itemId: '' }
          kept = true
          return part
        }),
      }
    }
    const joining = getFreeHoldingHands(c)[0]
    if (!joining) {
      throw new Error('No free hand to grip with')
    }
    return { ...c, body: c.body.map((part) => (part.id === joining.id ? { ...part, itemId } : part)) }
  }
}

// The stack an id names in a container, and the slot group it sits in.
export function findInContainer(c: Character, containerKey: string, itemId: string): { slot: SlotKind; item: Item } {
  const container = getContainer(c, containerKey)
  if (!container) {
    throw new Error(`Container "${containerKey}" not found`)
  }
  const found = (Object.keys(container.slots) as SlotKind[]).flatMap((slot) =>
    container.slots[slot].items.flatMap((item) => (item.id === itemId ? [{ slot, item }] : [])),
  )[0]
  if (!found) {
    throw new Error(`Item "${itemId}" not in container "${containerKey}"`)
  }
  return found
}

// combat.tex "Drawing items in combat": one unit leaves the container's stack
// for the hands, at the price of where it sat.
export function drawItem(containerKey: string, itemId: string, hands: Grip = 1): CharacterUpdater {
  return (c: Character, charged = false) => {
    const found = findInContainer(c, containerKey, itemId)
    const paid = pay(c, getDrawCost(c, found.slot, found.item), charged)
    if (!paid) return c
    const unit = duplicateItem(found.item, { amount: 1 })
    return grip(removeItemFromContainer(containerKey, itemId, 1)(paid), unit, hands)
  }
}

// combat.tex "Putting items away": the held stack goes into a slot group, at
// the price of the group it goes into.
export function storeItem(itemId: string, containerKey: string, slot: SlotKind): CharacterUpdater {
  return (c: Character, charged = false) => {
    const item = getHeldItem(c, itemId)
    if (!item) return c
    const container = getContainer(c, containerKey)
    if (!container) {
      throw new Error(`Container "${containerKey}" not found`)
    }
    if (!canFitItem(container, slot, item)) {
      throw new Error(`Item "${item.name || item.refId}" does not fit in the ${slot} slots of container "${containerKey}"`)
    }
    const paid = pay(c, getStoreCost(c, slot, item), charged)
    if (!paid) return c
    return addItemToContainer(containerKey, slot, item)(release(paid, itemId))
  }
}

// gear.tex "Shields": each move to or from the back is a standard action,
// once its view allows it.
function payBackMove<C extends Character>(c: C, view: MoveView | null, what: string, charged: boolean): C | null {
  if (!view) return null
  if (!view.able) {
    throw new Error(`Cannot ${what}: ${view.why}`)
  }
  return pay(c, getActionCost(c, 'standardAction'), charged)
}

// The held shield is slid to the back.
export function slingShield(itemId: string): HeldUpdater {
  return <C extends Character>(c: C, charged = false): C => {
    const item = getHeldItem(c, itemId)
    if (!item) return c
    const paid = payBackMove(c, getSlingView(c, item, charged), `sling "${item.name || item.refId}"`, charged)
    return paid ? { ...release(paid, itemId), onBack: item } : c
  }
}

// The shield on the back is slid to the front, into one hand.
export function unslingShield(): HeldUpdater {
  return <C extends Character>(c: C, charged = false): C => {
    const item = c.onBack
    if (!item) return c
    const paid = payBackMove(c, getUnslingView(c, item, charged), 'unsling the shield', charged)
    return paid ? grip({ ...paid, onBack: null }, item, 1) : c
  }
}

// gear.tex "Shields": "Throwing the shield out also costs a standard action".
// There is no floor off the combat board, so it is gone.
export function throwOffShield(): HeldUpdater {
  return <C extends Character>(c: C, charged = false): C => {
    const paid = c.onBack && pay(c, getActionCost(c, 'standardAction'), charged)
    return paid ? { ...paid, onBack: null } : c
  }
}

// combat.tex "Putting items away": "Dropping items on the floor costs 0 AP".
// There is no floor yet, so the stack is gone.
export function dropItem(itemId: string): HeldUpdater {
  return <C extends Character>(c: C): C => (getHeldItem(c, itemId) ? release(c, itemId) : c)
}

// One object at hand changed: in the hands, or a quick slot. A lone one is
// changed where it lies; one of a stack leaves the stack to take a slot of
// its own. Nothing at hand by that id, nothing happens.
function changeReadyUnit(itemId: string, change: (item: Item) => Item): HeldUpdater {
  return <C extends Character>(c: C): C => {
    const found = findReadyItem(c, itemId)
    if (!found) return c
    const { item, containerKey } = found
    if (containerKey === null) return { ...c, held: c.held.map((i) => (i.id === item.id ? change(i) : i)) }
    if (item.amount <= 1) return mapContainerItem(containerKey, item.id, change)(c)
    return addItemToContainer(containerKey, 'quick', change(duplicateItem(item, { amount: 1 })))(removeItemFromContainer(containerKey, item.id, 1)(c))
  }
}

// spells.tex "Charged": "activates an object that stays charged" — the
// gear the spell is cast on (spells.tex "Requirements"), or a metal weapon
// at hand for one charged into a weapon ("Taser"). Its effects are drawn
// from the gear. What an object already carries is charged over.
export function chargeItem(key: string, improved: Improvements = {}, gearId = '', chargeItemId = ''): HeldUpdater {
  return <C extends Character>(c: C): C => {
    if (!isSpellKey(key)) return c
    const gear = getSpellGear(c, key, gearId)
    const target = pickSpellGear(getChargeTargets(c, key, gear), chargeItemId)
    if (!target) return c
    const charge = { key, effects: settleTests(c, produceEffects(c, drawOnFood(drawOnGear(SPELLS[key].effects, gear), target), getCastSize(c, key, improved.amplify ?? 0, gear?.id))) }
    return changeReadyUnit(target.id, (i) => ({ ...i, charge }))(c)
  }
}

// A charge written whole, with nobody's modifications to add: whatever sits at
// hand, or nothing when no such item is.
export function setCharge(itemId: string, charge: Item['charge']): HeldUpdater {
  return changeReadyUnit(itemId, (i) => ({ ...i, charge }))
}

// gear.tex "Electrite": "20 charges" — a cast draws its uses from the
// stone or device it is made with.
export function drawFromSource(itemId: string, ammo: number): HeldUpdater {
  return changeReadyUnit(itemId, (i) => (i.source ? { ...i, source: { ...i.source, ammo: Math.max(0, i.source.ammo - ammo) } } : i))
}

// spells.tex "Charged": the charge is released and the object that held it
// is empty. What it did is the blow's, not the item's.
export function dischargeItem(itemId: string): HeldUpdater {
  return <C extends Character>(c: C): C => (getHeldItem(c, itemId)?.charge ? { ...c, held: c.held.map((i) => (i.id === itemId ? { ...i, charge: null } : i)) } : c)
}

// gear.tex "Reload": what a held weapon is loaded with, or null once it is
// fired and left empty.
export function loadItem(itemId: string, loaded: Item['loaded']): HeldUpdater {
  return changeReadyUnit(itemId, (i) => ({ ...i, loaded }))
}

// combat.tex "Throw": what is thrown leaves the hand, and one unit of a held
// stack is gone — thrown, eaten, or gone off where it stood. The last one
// takes the stack with it; there is no floor yet, so it lands nowhere. The
// charge went with that unit (spells.tex "Charged": the spell activates one
// object), so what is left of the stack carries none. A charge that goes off
// in a slot, or a portion eaten out of one, takes its object with it the
// same way.
export function consumeItem(itemId: string): HeldUpdater {
  return <C extends Character>(c: C): C => {
    const found = findCarriedItem(c, itemId)
    if (found?.containerKey) return removeItemFromContainer(found.containerKey, itemId, 1)(c)
    const item = getHeldItem(c, itemId)
    if (!item) return c
    if (item.amount <= 1) return release(c, itemId)
    return { ...c, held: c.held.map((i) => (i.id === itemId ? { ...i, amount: i.amount - 1, charge: null } : i)) }
  }
}

// gear.tex "Potions and Medicine": doses taken out of a stack, out of the
// unit in use first; a unit emptied is gone and the next one is whole.
// Short of that many, nothing is taken.
export function spendDoses(itemId: string, count: number): HeldUpdater {
  return <C extends Character>(c: C): C => {
    const found = findCarriedItem(c, itemId)
    const consume = found ? getConsume(found.item) : null
    if (!found || !consume) return c
    const total = getDosesLeft(found.item)
    if (count <= 0 || count > total) return c
    const whole = getUnitDoses(found.item)
    const left = total - count
    const units = Math.ceil(left / whole)
    const emptied = Array.from({ length: found.item.amount - units }).reduce<C>((acc) => consumeItem(itemId)(acc), c)
    if (units === 0) return emptied
    const change = (i: Item): Item => ({ ...i, consume: { ...consume, doses: left - (units - 1) * whole } })
    return found.containerKey === null
      ? { ...emptied, held: emptied.held.map((i) => (i.id === itemId ? change(i) : i)) }
      : mapContainerItem(found.containerKey, itemId, change)(emptied)
  }
}
