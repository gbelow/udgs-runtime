import { Character, Weapon } from "../types";

export function getGearPenalties(c: Character){
  const pen = c.armor.penalty + 
  Object.values(c.weapons).reduce((acc: number, weapon: Weapon) => acc + weapon.penalty, 0) + 
  Object.values(c.containers).reduce((acc, container) => acc + container.penalty, 0)

  return pen 
}

