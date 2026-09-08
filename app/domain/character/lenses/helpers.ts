import { Armor, Character, Skills, Weapon } from '../../types'
import { dmgArr, SMArr } from '../../tables'
import { getSize } from './misc'

export const getSM = (c: Character): number => {
  const size = getSize(c)
  if (size < 1 || size > SMArr.length) {
    throw new Error(`Invalid character size: ${size}. Size must be between 0 and ${SMArr.length}.`)
  }
  return SMArr[size-1]
}

export const getDM = (c: Character): number => {
  const size = getSize(c)
  if (size < 1 || size > SMArr.length) {
    throw new Error(`Invalid character size: ${size}. Size must be between 0 and ${SMArr.length}.`)
  }
  return dmgArr[size-1]
}


export function scaleArmor(armor: Armor, scale: number): Armor {
  // Validate scale is within bounds (1-7, where scale-1 maps to array indices 0-6)
  const clampedScale = Math.max(1, Math.min(7, scale))
  const scaleIndex = clampedScale - 1
  
  if (scaleIndex < 0 || scaleIndex >= dmgArr.length || scaleIndex >= SMArr.length) {
    throw new Error(`Invalid scale value: ${scale}. Scale must be between 1 and ${dmgArr.length}.`)
  }

  const arm = {
    ...armor,
    RES: Math.floor(armor.RES * dmgArr[scaleIndex]),
    INS: Math.floor(armor.INS * dmgArr[scaleIndex]),
    RESlayer: Math.floor(armor.RESlayer * dmgArr[scaleIndex]),
    protection: Math.floor(armor.protection * dmgArr[scaleIndex]),
    deflection: armor.deflection - SMArr[scaleIndex]
  }
  return arm
}

export function scaleWeapon(weapon: Weapon, scale: number): Weapon {
  // Validate scale is within bounds (1-7, where scale-1 maps to array indices 0-6)
  const clampedScale = Math.max(1, Math.min(7, scale))
  const scaleIndex = clampedScale - 1
  
  if (scaleIndex < 0 || scaleIndex >= dmgArr.length) {
    throw new Error(`Invalid scale value: ${scale}. Scale must be between 1 and ${dmgArr.length}.`)
  }

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

