import { getSTR } from "../lenses/characteristics"
import { dmgArr } from "../../tables"
import { CampaignCharacter, Character, WeaponAttack } from "../../types"
import { updateSTA } from "./bleed"
import { getAccuracy, getStrike } from "../lenses/skills"

export type AttackVariant = {
  type: string
  name: string
  AP: number
  STA:number
  penalty: number
  blunt: number
  cut: number
}

export function getAttacksList ({atk} : {atk: WeaponAttack }) : (c: Character) => AttackVariant[] {
  const props = atk.properties.split(',').filter(el => ["heavy I", "heavy II", "heavy III", "heavy I-III", "heavy I-II", "heavy II-III", "braced", "hook", "fast"].includes(el.trim())).map(el => el.trim())

  return((c:Character) => {
    const STR = getSTR(c)
    // gear.tex: "STR x" damage entries are a multiple of STR added to the flat
    // blunt value of the row. Only blunt rows carry STR multiples in the tables.
    const blunt = Math.floor(atk.blunt + atk.STRmod*STR)
    const cut = atk.cut

    const basic = {name: 'basic', type: 'melee', AP: atk.AP, STA:0, penalty: 0, blunt, cut }
    const heavyI = {name: 'heavyI', type: 'melee', AP: atk.AP+1, STA:0, penalty: 0, blunt: blunt+ Math.floor(STR/2), cut: cut ? cut+ Math.floor(STR/2) : 0}
    const heavyII = {name: 'heavyII', type: 'melee', AP: atk.AP+2, STA:1, penalty: 2, blunt: blunt+ Math.floor(STR), cut: cut ? cut+ Math.floor(STR) : 0}
    const heavyIII = {name: 'heavyIII', type: 'melee', AP: atk.AP+3, STA:1, penalty: 3, blunt: blunt+ Math.floor(3*STR/2), cut: cut ? cut+ Math.floor(3*STR/2) : 0}
    const braced = {name: 'braced', type: 'melee', AP: atk.AP+2, STA:1, penalty: 0, blunt: blunt+ Math.floor(STR), cut: cut ? cut+ Math.floor(STR) : 0}
    const hook = {name: 'hook', type: 'melee', AP: atk.AP, STA:0, penalty: 0, blunt, cut }
    const quickShot = {name: 'quick', type: 'ranged', AP: atk.AP, STA:0, penalty: 3, blunt, cut }
    const snipe = {name: 'snipe', type: 'ranged', AP: atk.AP+2, STA:0, penalty: 0, blunt, cut }

    const attacks = []
    if(!props.includes('heavy I-III') && !props.includes('heavy I-II') && !props.includes('heavy II-III') ) attacks.push(basic)
    if(props.includes('heavy I')) attacks.push(heavyI)
    if(props.includes('heavy II')) attacks.push(heavyI, heavyII)
    if(props.includes('heavy III')) attacks.push(heavyI, heavyII, heavyIII)
    if(props.includes('heavy I-II')) attacks.push(heavyI, heavyII)
    if(props.includes('heavy I-III')) attacks.push(heavyI, heavyII, heavyIII)
    if(props.includes('heavy II-III')) attacks.push(heavyII, heavyIII)
    if(props.includes('braced')) attacks.push(braced)
    if(props.includes('hook')) attacks.push(hook)
    if(props.includes('fast')) attacks.push(quickShot, snipe)  

    return attacks
  })  
}

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

export function parseAtkDamage (atk: WeaponAttack, scale: number, component: string) {
  const value = 
  component === "blunt" ? atk.blunt*scale /*+(atk.heavyMod ? '+' + Math.floor(atk.heavyMod*STR*dmgScale) : '' )*/ :
  component === "cutting" ? atk.cut*scale /*+ (atk.heavyMod ? '+'+ Math.floor(atk.heavyMod*STR*dmgScale) : '')*/ : 0

  return(value)
}

