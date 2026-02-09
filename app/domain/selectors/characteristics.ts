import { Character, Lens } from "../types"
import { getGearPenalties } from "./gear"
import { getDM } from "./helpers"

export function makeCharacteristicLens<T extends Character>(
  characteristicName: keyof Character['characteristics'], 
  getter: (c: T) => number, 
  setter?: (c: T, value: number) => T,
)
  : Lens<T, number> {
    return {
      get: getter,
      set: setter ?? ((subject: T, value: number): T => {
        const calculated = getter(subject) - subject.characteristics[characteristicName]
        const updated = {...subject, characteristics: {...subject.characteristics, [characteristicName]: value - calculated}}
        return updated as T;
      })
    } 
}


export function getSTR(c: Character): number {
  return c.characteristics.STR
}

export function getAGI(c: Character): number {
  return c.characteristics.AGI - getGearPenalties(c)
}

export function getSTA(c: Character): number {
  return c.characteristics.STA
}

export const getCON = (c: Character) => c.characteristics.CON
export const getINT = (c: Character) => c.characteristics.INT
export const getSPI = (c: Character) => c.characteristics.SPI
export const getDEX = (c: Character) => c.characteristics.DEX

export const getSize = (c: Character) => c.characteristics.size

export const getMelee = (c: Character) => c.characteristics.melee
export const getRanged = (c: Character) => c.characteristics.ranged
export const getDetection = (c: Character) => c.characteristics.detection
export const getSpellcast = (c: Character) => c.characteristics.spellcast
export const getConviction1 = (c: Character) => c.characteristics.conviction1
export const getConviction2 = (c: Character) => c.characteristics.conviction2

// Wound thresholds are derived from STR (bulk) + base additive term, then scaled by DM.
// Stored values in `c.characteristics.RES/TGH/INS` represent the *base* additive term.
const EPS = 1e-9

export const getRES = (c: Character) => Math.floor(((0.5 * getSTR(c) + c.characteristics.RES) * getDM(c)) + EPS)
export const getTGH = (c: Character) => Math.floor(((0.5 * getSTR(c) + c.characteristics.TGH) * getDM(c)) + EPS)
export const getINS = (c: Character) => Math.floor(((0.5 * getSTR(c) + c.characteristics.INS) * getDM(c)) + EPS)
