import { getSTR } from "../lenses/characteristics"
import { CampaignCharacter, Character, WeaponAttack } from "../../types"
import { applySTRmod } from "../lenses/gear"
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

// gear.tex "Heavy I/II/III". Degree n costs +n AP and adds n/2 x STR to damage;
// the STA cost and to-hit penalty are not a formula, so they are tabulated.
const HEAVY_DEGREES: Record<number, { AP: number; STA: number; penalty: number; STRmul: number }> = {
  1: { AP: 1, STA: 0, penalty: 0, STRmul: 0.5 },
  2: { AP: 2, STA: 1, penalty: 2, STRmul: 1 },
  3: { AP: 3, STA: 1, penalty: 3, STRmul: 1.5 },
}

export function getAttacksList ({atk} : {atk: WeaponAttack }) : (c: Character) => AttackVariant[] {
  const props = atk.props

  return((c:Character) => {
    const STR = getSTR(c)
    // The STR-mod rule lives in the gear lens; both this and the weapon table
    // row rendered by the UI go through it.
    const blunt = applySTRmod(atk.blunt, atk.STRmod, c)
    const cut = applySTRmod(atk.cut, atk.STRmod, c)

    // A heavy attack adds the same STR multiple to both damage components, but
    // only to a component the attack actually has — a weapon with no cut stays
    // at 0 rather than becoming a cutting weapon at higher degrees.
    const heavy = (degree: number): AttackVariant => {
      const { AP, STA, penalty, STRmul } = HEAVY_DEGREES[degree]
      const bonus = Math.floor(STRmul * STR)
      return {
        name: `heavy${'I'.repeat(degree)}`,
        type: 'melee',
        AP: atk.AP + AP,
        STA,
        penalty,
        blunt: blunt + bonus,
        cut: cut ? cut + bonus : 0,
      }
    }

    const basic = {name: 'basic', type: 'melee', AP: atk.AP, STA:0, penalty: 0, blunt, cut }
    const braced = {name: 'braced', type: 'melee', AP: atk.AP+2, STA:1, penalty: 0, blunt: blunt+ Math.floor(STR), cut: cut ? cut+ Math.floor(STR) : 0}
    const hook = {name: 'hook', type: 'melee', AP: atk.AP, STA:0, penalty: 0, blunt, cut }
    const quickShot = {name: 'quick', type: 'ranged', AP: atk.AP, STA:0, penalty: 3, blunt, cut }
    const snipe = {name: 'snipe', type: 'ranged', AP: atk.AP+2, STA:0, penalty: 0, blunt, cut }

    const attacks: AttackVariant[] = []

    // gear.tex "Heavy I/II/III": a heavy range ("heavy I-II") sets its lower
    // bound as the minimum and forbids the normal attack; a bare degree keeps
    // it. `min === 0` carries that distinction out of the parser.
    if (!props.heavy || props.heavy.min === 0) attacks.push(basic)
    if (props.heavy) {
      for (let degree = Math.max(1, props.heavy.min); degree <= props.heavy.max; degree++) {
        attacks.push(heavy(degree))
      }
    }

    if (props.braced) attacks.push(braced)
    if (props.hook) attacks.push(hook)
    if (props.fast) attacks.push(quickShot, snipe)

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
