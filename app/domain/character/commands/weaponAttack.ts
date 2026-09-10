import { CampaignCharacter, Character } from "../../types"
import { AttackVariant } from "../lenses/gear"
import { updateSTA } from "./bleed"
import { getAccuracy, getStrike } from "../lenses/skills"

export function spendAttackResources (atk: AttackVariant) {
  return((c: CampaignCharacter) => {
    if(c.resources.AP < atk.AP) return c
    if(atk.STA > c.resources.STA) return c

    const newChar = updateSTA(c.resources.STA - atk.STA)(c) 
    return {...newChar, resources: {...newChar.resources, AP: newChar.resources.AP - atk.AP}}
  })
}


export function getAttackValues (atk: AttackVariant , type: string, weapon: string, roll: number) {
  return((c: Character) => {
    let val = roll - atk.penalty
    if(type=='ranged') val += getAccuracy(c)
    if(type=='melee') val += getStrike(c)

    return{atk: val, type: type, weapon, blunt: atk.blunt, cut: atk.cut}
  })
}
