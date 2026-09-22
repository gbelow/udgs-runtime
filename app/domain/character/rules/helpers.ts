import { Armor, Character, Skills, Weapon } from '../../types'
import { dmgArr, RMArr, SMArr } from '../../tables'
import { getSize } from './misc'

export const getSM = (c: Character): number => {
  const size = getSize(c)
  return SMArr[size-1]
}

export const getDM = (c: Character): number => {
  const size = getSize(c)
  return dmgArr[size-1]
}

// creating.tex "Reach Multiplier (RM)": "multiplies the range of all weapons".
export const getRM = (c: Character): number => {
  const size = getSize(c)
  return RMArr[size-1]
}


export function scaleArmor(armor: Armor, scale: number): Armor {
  // Sizes run 1-7; scale-1 is the row in the size tables.
  const clampedScale = Math.max(1, Math.min(7, scale))
  const scaleIndex = clampedScale - 1

  const arm = {
    ...armor,
    scale: clampedScale,
    RES: Math.floor(armor.RES * dmgArr[scaleIndex]),
    INS: Math.floor(armor.INS * dmgArr[scaleIndex]),
    protection: Math.floor(armor.protection * dmgArr[scaleIndex]),
    deflection: armor.deflection - SMArr[scaleIndex]
  }
  return arm
}

// gear.tex "Scaling weapons": "multiply damages and RES by the DM and reach
// by the RM". Reach is a named range here, not a number, so only the DM half
// is applied; the panel shows the size beside the name instead.
export function scaleWeapon(weapon: Weapon, scale: number): Weapon {
  // Sizes run 1-7; scale-1 is the row in the size tables.
  const clampedScale = Math.max(1, Math.min(7, scale))
  const scaleIndex = clampedScale - 1

  const weap = {
    ...weapon,
    scale: clampedScale,
    attacks: weapon.attacks.map(el => ({
      ...el,
      blunt: Math.floor(el.blunt * dmgArr[scaleIndex]),
      cut: Math.floor(el.cut * dmgArr[scaleIndex]),
      RES: Math.floor(el.RES * dmgArr[scaleIndex]),

    }))
  }
  return weap
}

export const skill = (c: Character, key: keyof Skills) => c.trainables[key as keyof Skills] ?? 0

