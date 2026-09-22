import type { ArmorProperty, Character, Material } from '../../types'
import { getHardness, getItemScale } from '../../item/rules/items'
import { isCharged } from '../../item/rules/costs'
import { armorFits, getArmor, getDoffCost } from '../rules/armor'

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
