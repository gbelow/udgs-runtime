import { Character, Weapon } from "../../types";
import { getBurdenPenalty } from "../../item/lenses/containers";
import { getSTR } from "./characteristics";

// gear.tex "Burden penalties": armor, shield and container penalties stack and
// are then "modified by (STR-10)/3". Penalties are stored as positive
// magnitudes here and negated by the AGI/STA getters that consume them, so a
// stronger character subtracts from the total. The rulebook does not state a
// rounding rule; truncating toward zero keeps the modifier symmetric for
// STR above and below 10. The total floors at 0 — carrying gear never grants
// a bonus.
export function getGearPenalties(c: Character){
  const gear = c.armor.penalty +
    Object.values(c.weapons).reduce((acc: number, weapon: Weapon) => acc + weapon.penalty, 0) +
    getBurdenPenalty(c)

  const strMod = Math.trunc((getSTR(c) - 10) / 3)

  return Math.max(0, gear - strMod)
}
