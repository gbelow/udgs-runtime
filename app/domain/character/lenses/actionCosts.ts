import { Character } from "../../types"
import { ACTION_COSTS, ActionKind } from "../../tables"
import { getBuffBonus } from "./effects"

export type ActionCost = { AP: number; STA: number }

// The price of an action for this character: the book's figure moved by
// whatever abilities the character has on. An attack variation's price is a
// delta on the weapon row and may be negative.
export function getActionCost(c: Character, kind: ActionKind): ActionCost {
  const base = ACTION_COSTS[kind]
  return {
    AP: base.AP + getBuffBonus(c, `ap:${kind}`),
    STA: base.STA + getBuffBonus(c, `sta:${kind}`),
  }
}
