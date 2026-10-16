import { rollDie, rollD10, type Dice } from "../domain/play/dice"
import { rollCall, type DieCall } from "../domain/play/calls"

// UI-layer convenience wrapper: injects the real entropy source into the pure
// domain dice rule. This is the single Math.random seam for test rolls.
export const realDice: Dice = (explodes) => rollD10(explodes, Math.random)

export function makeDieRoll(sides: number){
  return rollDie(sides, Math.random)
}

// The die the screen rolls for a test called for, by the same seam.
export const rollOnScreen = (call: DieCall): number => rollCall(call, Math.random)
