import { Armor, Character, Skills, Weapon } from '../../types'
import { dmgArr, RMArr, SMArr, VMArr } from '../../tables'
import { getSize } from './misc'

// creating.tex "Size": a row of the size table, read at any size — the
// sizes run 1 to 7, and a size beyond them reads the nearest end.
function atSize(table: readonly number[], size: number): number {
  return table[Math.max(1, Math.min(table.length, size)) - 1]
}

export const getDMAt = (size: number): number => atSize(dmgArr, size)

// creating.tex "Reach Multiplier (RM)": "multiplies the range of all weapons".
export const getRMAt = (size: number): number => atSize(RMArr, size)

// creating.tex "Volume Multiplier (VM)"; spells.tex "Amplify Spell": "The
// amount of material or charges consumed is multiplied by the VM".
export const getVMAt = (size: number): number => atSize(VMArr, size)

export const getSM = (c: Character): number => atSize(SMArr, getSize(c))

export const getDM = (c: Character): number => getDMAt(getSize(c))

export const getRM = (c: Character): number => getRMAt(getSize(c))

// creating.tex "Size": the largest size the table has.
export const MAX_SIZE = dmgArr.length


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

