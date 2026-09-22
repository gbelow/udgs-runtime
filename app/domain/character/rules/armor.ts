import { Armor, ArmorProperty, Character, Item, Material, SlotKind } from '../../types'
import { GEAR_SIZE, getHardness, getItemArmor, getItemScale } from '../../item/lenses/items'
import { getDrawCost, getStoreCost, isCharged } from '../../item/lenses/costs'
import { ActionCost, getActionCost } from './actionCosts'
import { getSize } from './misc'

// The armor the character's body presents: the worn item's, at the size the
// item is made for, over whatever the creature is underneath. A worn item
// that resolves to nothing is treated as not there.
export function getArmor(c: Character): Armor {
  return (c.worn && getItemArmor(c.worn)) || c.armor
}

// Armor has no oversize allowance: it fits only a wearer of the size it is
// made for. The creature's own hide is its own size by definition.
export function armorFits(c: Character): boolean {
  return c.worn === null || getItemScale(c.worn) === getSize(c)
}

export function isArmorItem(item: Item): boolean {
  return getItemArmor(item) !== undefined
}

// gear.tex "Donning and Doffing armor": "a standard action to don/doff helmet,
// gauntlets and small armor. Costs 6 AP to don/doff medium armors and several
// minutes to don/doff large ones." Small, medium and large are the Bulk column
// as printed, so an armor is classed by its template's bulk whatever size it
// has been scaled to. Null is "several minutes": nothing a turn can pay for.
export function getDonCost(c: Character, item: Item): ActionCost | null {
  const printedBulk = item.bulk - getItemScale(item) + GEAR_SIZE
  if (printedBulk <= 1) return getActionCost(c, 'standardAction')
  if (printedBulk === 2) return getActionCost(c, 'donMedium')
  return null
}

const add = (a: ActionCost, b: ActionCost): ActionCost => ({ AP: a.AP + b.AP, STA: a.STA + b.STA })

// Armor out of a container passes through the hands on the way on, so it is
// drawn from its slot and then donned; from the hands it is only donned.
export function getWearCost(c: Character, from: SlotKind | null, item: Item): ActionCost | null {
  const don = getDonCost(c, item)
  return don && (from ? add(getDrawCost(c, from, item), don) : don)
}

// And doffed then put away on the way off; dropping it is free after the doff.
export function getDoffCost(c: Character, into: SlotKind | null): ActionCost | null {
  if (!c.worn) return null
  const doff = getDonCost(c, c.worn)
  return doff && (into ? add(doff, getStoreCost(c, into, c.worn)) : doff)
}

export type WearView = {
  wearable: boolean
  // What a character in play pays; null on the sheet, or when there is no
  // price a turn can pay.
  cost: number | null
  // Why not, when not; '' when wearable.
  why: string
}

// Whether this item could be put on right now, and for how much. A character
// on the sheet is not on the clock, so only the fit is asked of them.
export function getWearView(c: Character, from: SlotKind | null, item: Item): WearView | null {
  if (!isArmorItem(item)) return null
  if (c.worn) return { wearable: false, cost: null, why: `already wearing ${c.worn.name || c.worn.refId}` }
  const scale = getItemScale(item)
  if (scale !== getSize(c)) return { wearable: false, cost: null, why: `made for size ${scale}` }
  if (!isCharged(c)) return { wearable: true, cost: null, why: '' }
  const cost = getWearCost(c, from, item)
  if (!cost) return { wearable: false, cost: null, why: 'takes several minutes' }
  return { wearable: true, cost: cost.AP, why: '' }
}

// Whether an item that is nowhere yet — a catalog pick — could be put straight
// on. On the sheet only the fit is asked: it replaces whatever is worn and
// costs nothing, the way holding a catalog pick does. On the clock it is a don
// like any other (gear.tex "Donning and Doffing armor"): over nothing, at the
// don price, with no slot to draw from.
export function getEquipView(c: Character, item: Item): WearView | null {
  if (isCharged(c)) return getWearView(c, null, item)
  if (!isArmorItem(item)) return null
  const scale = getItemScale(item)
  if (scale !== getSize(c)) return { wearable: false, cost: null, why: `made for size ${scale}` }
  return { wearable: true, cost: null, why: '' }
}

export type ArmorPanelView = {
  name: string
  // The worn item, or null when the creature wears only its own hide.
  worn: { id: string; name: string; scale: number; fits: boolean; doffCost: number | null; canDoff: boolean } | null
  burdenPenalty: number
  deflection: number
  material: Material
  hardness: number
  properties: ArmorProperty[]
  notes: string
}

export function getArmorPanel(c: Character): ArmorPanelView {
  const armor = getArmor(c)
  const doff = getDoffCost(c, null)
  return {
    name: armor.name,
    worn: c.worn
      ? {
          id: c.worn.id,
          name: c.worn.name || c.worn.refId,
          scale: getItemScale(c.worn),
          fits: armorFits(c),
          doffCost: isCharged(c) && doff ? doff.AP : null,
          canDoff: !isCharged(c) || doff !== null,
        }
      : null,
    burdenPenalty: armor.burdenPenalty,
    deflection: armor.deflection,
    material: armor.material,
    hardness: getHardness(armor.material),
    properties: armor.properties,
    notes: armor.notes,
  }
}
