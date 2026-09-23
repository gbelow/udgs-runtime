import { rollDie, rollD10, type Dice } from "../domain/combat/dice"

// UI-layer convenience wrapper: injects the real entropy source into the pure
// domain dice rule. This is the single Math.random seam for test rolls.
export const realDice: Dice = (explodes) => rollD10(explodes, Math.random)

export function makeDieRoll(sides: number){
  return rollDie(sides, Math.random)
}
