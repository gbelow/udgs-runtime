import { Armor, Character, Item, SlotKind } from '../../types'
import { GEAR_SIZE, getItemArmor, getItemScale } from '../../item/rules/items'
import { getStoreCost, isCharged } from '../../item/rules/costs'
import { ActionCost, getActionCost } from './actionCosts'
import { getSize } from './misc'

// The armor the character's body presents: the worn item's, at the size the
// item is made for, over whatever the creature is underneath. A worn item
// that resolves to nothing is treated as not there.
export function getArmor(c: Character): Armor {
  return (c.worn && getItemArmor(c.worn)) || c.armor
}

// gear.tex "Donning and Doffing armor": "a standard action to doff helmet
// and gauntlets", and "Donning anything takes twice as much time as doffing".
export function getPieceCost(c: Character, worn: boolean): ActionCost {
  const doff = getActionCost(c, 'standardAction')
  return worn ? doff : { AP: doff.AP * 2, STA: doff.STA * 2 }
}

// gear.tex "Closed helmet": a helmet worn with its visor down.
export function isVisorClosed(c: Character): boolean {
  return !!c.hasHelm && !c.visorOpen
}

// Armor has no oversize allowance: it fits only a wearer of the size it is
// made for. The creature's own hide is its own size by definition.
export function armorFits(c: Character): boolean {
  return c.worn === null || getItemScale(c.worn) === getSize(c)
}

export function isArmorItem(item: Item): boolean {
  return getItemArmor(item) !== undefined
}

// gear.tex "Donning and Doffing armor": "Costs 8 AP to doff non rigid armor
// and several minutes to doff large ones." Large is the Bulk column as
// printed, so an armor is classed by its template's bulk whatever size it has
// been scaled to. A rigid armor has no price a turn pays either: in a fight it
// comes off only by being cut away. Null is nothing a turn can pay for.
function getArmorDoffCost(c: Character, item: Item): ActionCost | null {
  const printedBulk = item.bulk - getItemScale(item) + GEAR_SIZE
  if (printedBulk >= 3) return null
  if (getItemArmor(item)?.properties.includes('rigid')) return null
  return getActionCost(c, 'doffArmor')
}

const add = (a: ActionCost, b: ActionCost): ActionCost => ({ AP: a.AP + b.AP, STA: a.STA + b.STA })

// Doffed then put away on the way off; dropping it is free after the doff.
export function getDoffCost(c: Character, into: SlotKind | null): ActionCost | null {
  if (!c.worn) return null
  const doff = getArmorDoffCost(c, c.worn)
  return doff && (into ? add(doff, getStoreCost(c, into, c.worn)) : doff)
}

export type WearView = {
  wearable: boolean
  // Why not, when not; '' when wearable.
  why: string
}

// Whether this item could be put on right now. gear.tex "Donning and Doffing
// armor": "It is not possible to don armor during combat"; on the sheet, off
// the clock, only the fit is asked.
export function getWearView(c: Character, item: Item): WearView | null {
  if (!isArmorItem(item)) return null
  if (c.worn) return { wearable: false, why: `already wearing ${c.worn.name || c.worn.refId}` }
  const scale = getItemScale(item)
  if (scale !== getSize(c)) return { wearable: false, why: `made for size ${scale}` }
  if (isCharged(c)) return { wearable: false, why: 'armor cannot be donned in combat' }
  return { wearable: true, why: '' }
}

// Whether an item that is nowhere yet — a catalog pick — could be put straight
// on. On the sheet only the fit is asked: it replaces whatever is worn and
// costs nothing, the way holding a catalog pick does. In a fight it is a don
// like any other, and there is none (gear.tex "Donning and Doffing armor").
export function getEquipView(c: Character, item: Item): WearView | null {
  if (isCharged(c)) return getWearView(c, item)
  if (!isArmorItem(item)) return null
  const scale = getItemScale(item)
  if (scale !== getSize(c)) return { wearable: false, why: `made for size ${scale}` }
  return { wearable: true, why: '' }
}
