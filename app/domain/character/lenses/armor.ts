import { getActionCost } from '../rules/actionCosts'
import type { ArmorProperty, Character, Material } from '../../types'
import { getHardness, getItemScale } from '../../item/rules/items'
import { isCharged } from '../../item/rules/costs'
import { armorFits, getArmor, getDoffCost, getPieceCost } from '../rules/armor'

export type ArmorPanelView = {
  name: string
  // The worn item, or null when the creature wears only its own hide.
  // gear.tex "Armor Breakage": broken armor is pitted.
  worn: { id: string; name: string; scale: number; fits: boolean; pitted: boolean; doffCost: number | null; canDoff: boolean } | null
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
          pitted: c.worn.broken,
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

// gear.tex "Donning and Doffing armor", "Closed helmet": the gauntlets and
// the closed helmet, each worn or not and what putting it on or taking it
// off costs in play (null on the sheet), and the helmet's visor while it is
// worn.
export type PieceView = { worn: boolean; cost: number | null }
export type VisorView = { open: boolean; cost: number | null }
export type ArmorPiecesView = { gauntlets: PieceView; helm: PieceView; visor: VisorView | null }

export function getArmorPiecesView(c: Character): ArmorPiecesView {
  const cost = (worn: boolean) => (isCharged(c) ? getPieceCost(c, worn).AP : null)
  return {
    gauntlets: { worn: !!c.hasGauntlets, cost: cost(!!c.hasGauntlets) },
    helm: { worn: !!c.hasHelm, cost: cost(!!c.hasHelm) },
    visor: c.hasHelm ? { open: c.visorOpen, cost: isCharged(c) ? getActionCost(c, 'standardAction').AP : null } : null,
  }
}
