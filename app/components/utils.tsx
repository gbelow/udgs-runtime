import { rollDie, rollFull } from "../domain/combat/dice"

// UI-layer convenience wrapper: injects the real entropy source into the pure
// domain dice rule. This is the single Math.random seam for full rolls.
export function makeFullRoll(){
  return rollFull(Math.random)
}

export function makeDieRoll(sides: number){
  return rollDie(sides, Math.random)
}
