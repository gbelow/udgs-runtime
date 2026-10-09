import { Attributes, Character, Characteristics } from "../../types"
import { getInjuryPenalty } from "./afflictions"
import { getBurdenPenalty } from "../../item/rules/containers"
import { getShieldBurden } from "../../item/rules/hands"
import { getArmor } from "./armor"
import { Term, sumTerms } from "./terms"
import { getBuffBonus } from "./effects"

// combat.tex "Afflictions": "Injury (IL): penalties affect STR, AGI, STA. This
// does not affect TGH. It affects all other usages of attributes." The penalty
// therefore lives on the three attributes rather than on a list of skills, and
// everything derived from them inherits it. The stated exception reads
// `getSTRBase` below instead.
export function getSTRTerms(c: Character): Term[] {
  return [
    { label: 'base', value: getSTRBase(c) },
    { label: 'injury', value: -getInjuryPenalty(c) },
  ]
}
export function getSTR(c: Character): number {
  return sumTerms(getSTRTerms(c))
}

export function getAGITerms(c: Character): Term[] {
  return [
    { label: 'base', value: getAttributeHeld(c, 'AGI') },
    { label: 'gear', value: -getGearPenalties(c) },
    { label: 'injury', value: -getInjuryPenalty(c) },
  ]
}
export function getAGI(c: Character): number {
  return sumTerms(getAGITerms(c))
}

export function getSTATerms(c: Character): Term[] {
  return [
    { label: 'base', value: getAttributeHeld(c, 'STA') },
    { label: 'gear', value: -getGearPenalties(c) },
    { label: 'injury', value: -getInjuryPenalty(c) },
  ]
}
export function getSTA(c: Character): number {
  return sumTerms(getSTATerms(c))
}

// An attribute as the character has it: what was trained, and what their
// abilities add or take (abilities.tex "Grow!": "loses 3 STR and 1 AGI").
export function getAttributeHeld(c: Character, key: keyof Attributes): number {
  return c.trainables[key].value + getBuffBonus(c, `attribute:${key}`)
}

// The STR with the injury penalty left out. TGH is the rulebook's stated
// exception to it. Burden reads
// `getSTRBase` for a second reason: the injury threshold is itself derived from
// the affliction set, which includes an over-burden `lame`, so reading the
// penalized STR here would close a loop.
export function getSTRBase(c: Character): number {
  return getAttributeHeld(c, 'STR')
}

// combat.tex "Rest": the Rest action recovers STA by an amount equal to STA/4
// (its AP price is in ACTION_COSTS). Both the Rest command and the "STA regen"
// readout derive from here, so the displayed number and the applied number
// cannot drift.
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

// gear.tex "Burden penalties": armor, shield and container penalties stack and
// are then "modified by (STR-10)/5". Penalties are stored as positive
// magnitudes here and negated by the AGI/STA getters that consume them, so a
// stronger character subtracts from the total. The rulebook does not state a
// rounding rule; truncating toward zero keeps the modifier symmetric for
// STR above and below 10. The total floors at 0 — carrying gear never grants
// a bonus. STR is read unpenalized here: this value feeds AGI/STA, which the
// injury penalty already reduces on its own.
export function getGearPenalties(c: Character){
  const gear = getArmor(c).burdenPenalty +
    getShieldBurden(c) +
    getBurdenPenalty(c)

  const strMod = Math.trunc((getSTRBase(c) - 10) / 5)

  return Math.max(0, gear - strMod)
}
