import { Character, Characteristics } from "../../types"
import { getGearPenalties } from "./gear"
import { Term, sumTerms } from "./terms"


export function getSTRTerms(c: Character): Term[] {
  return [{ label: 'base', value: c.trainables.STR.value }]
}
export function getSTR(c: Character): number {
  return sumTerms(getSTRTerms(c))
}

export function getAGITerms(c: Character): Term[] {
  return [
    { label: 'base', value: c.trainables.AGI.value },
    { label: 'gear', value: -getGearPenalties(c) },
  ]
}
export function getAGI(c: Character): number {
  return sumTerms(getAGITerms(c))
}

export function getSTATerms(c: Character): Term[] {
  return [
    { label: 'base', value: c.trainables.STA.value },
    { label: 'gear', value: -getGearPenalties(c) },
  ]
}
export function getSTA(c: Character): number {
  return sumTerms(getSTATerms(c))
}

// combat.tex "Rest": the Rest action costs 4 AP and recovers STA by an amount
// equal to STA/4. Both the Rest command and the character sheet's "STA regen"
// readout derive from here, so the displayed number and the applied number
// cannot drift.
export const REST_AP_COST = 4
export function getSTARegen(c: Character): number {
  return Math.floor(getSTA(c) / 4)
}

export const getCON = (c: Character) => c.trainables.CON.value
export const getINT = (c: Character) => c.trainables.INT.value
export const getSPI = (c: Character) => c.trainables.SPI.value
export const getDEX = (c: Character) => c.trainables.DEX.value

export const getMelee = (c: Character) => c.trainables.melee.value
export const getRanged = (c: Character) => c.trainables.ranged.value
export const getAwareness = (c: Character) => c.trainables.awareness.value
export const getSorcery = (c: Character) => c.trainables.sorcery.value
export const getConviction1 = (c: Character) => c.trainables.conviction1.value
export const getConviction2 = (c: Character) => c.trainables.conviction2.value
export const getCharisma = (c: Character) => c.trainables.charisma.value
export const getDevotion = (c: Character) => c.trainables.devotion.value

// Breakdown registry paralleling `characteristicLenses`. Only the derived
// characteristics (STR/AGI/STA) have meaningful terms; the rest are pure base
// values, so they're intentionally absent. `Partial` lets the hook degrade
// gracefully for characteristics without a term getter.
export const characteristicTermGetters: Partial<Record<keyof Characteristics, (c: Character) => Term[]>> = {
  STR: getSTRTerms,
  AGI: getAGITerms,
  STA: getSTATerms,
}
