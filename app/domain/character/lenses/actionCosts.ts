import { Character } from "../../types"
import { ACTION_COSTS, ActionKind } from "../../tables"
import { getBuffBonus } from "./effects"
import { getPrestidigitation } from "./skills"

export type ActionCost = { AP: number; STA: number }

// combat.tex "Prestidigitation": the standard action's 3 AP become 2 once the
// skill reaches 5 and 1 at 10; below -5 it costs 4.
function getStandardActionAP(c: Character): number {
  const skill = getPrestidigitation(c)
  if (skill >= 10) return 1
  if (skill >= 5) return 2
  if (skill < -5) return 4
  return ACTION_COSTS.standardAction.AP
}

// The price of an action for this character: the book's figure moved by
// whatever abilities the character has on. An attack variation's price is a
// delta on the weapon row and may be negative.
export function getActionCost(c: Character, kind: ActionKind): ActionCost {
  const base = ACTION_COSTS[kind]
  const AP = kind === 'standardAction' ? getStandardActionAP(c) : base.AP
  return {
    AP: AP + getBuffBonus(c, `ap:${kind}`),
    STA: base.STA + getBuffBonus(c, `sta:${kind}`),
  }
}
