import { Character, Skills } from '../../types'
import { getSM, skill } from './helpers'
import { getAfflictionPenalty, getAfflictions } from './afflictions'
import { getBuffBonus } from './effects'
import { getAGI, getMelee, getRanged, getAwareness, getSTR, getCharisma, getSPI, getDEX, getCON } from './characteristics'
import { Term, sumTerms } from './terms'

export { sumTerms }
export type { Term }

export function getStrikeTerms(c: Character): Term[] {
  return [
    { label: 'melee', value: getMelee(c) },
    { label: 'strike', value: skill(c, 'strike').value },
    { label: 'affliction', value: -getAfflictionPenalty(c, 'strike') },
    { label: 'abilities', value: getBuffBonus(c, 'skill:strike') },
  ]
}
export function getStrike(c: Character) {
  return sumTerms(getStrikeTerms(c))
}

export function getAccuracyTerms(c: Character): Term[] {
  return [
    { label: 'ranged', value: getRanged(c) },
    { label: 'gear', value: -3 * c.hasGauntlets },
    { label: 'accuracy', value: skill(c, 'accuracy').value },
    { label: 'affliction', value: -getAfflictionPenalty(c, 'accuracy') },
    { label: 'abilities', value: getBuffBonus(c, 'skill:accuracy') },
  ]
}
export function getAccuracy(c: Character) {
  return sumTerms(getAccuracyTerms(c))
}

export function getDefendTerms(c: Character): Term[] {
  return [
    { label: 'melee', value: getMelee(c) },
    { label: 'defend', value: skill(c, 'defend').value },
    { label: 'affliction', value: -getAfflictionPenalty(c, 'defend') },
    { label: 'abilities', value: getBuffBonus(c, 'skill:defend') },
  ]
}
export function getDefend(c: Character) {
  return sumTerms(getDefendTerms(c))
}

export function getReflexTerms(c: Character): Term[] {
  const SM = getSM(c)
  return [
    { label: 'awareness', value: getAwareness(c) },
    { label: 'ranged', value: getRanged(c) },
    { label: 'gear', value: -2 * c.hasHelm }, // gear.tex "Closed helmet": -2 reflexes
    { label: 'size', value: -SM },
    { label: 'reflex', value: skill(c, 'reflex').value },
    { label: 'affliction', value: -getAfflictionPenalty(c, 'reflex') },
    { label: 'abilities', value: getBuffBonus(c, 'skill:reflex') },
  ]
}
export function getReflex(c: Character) {
  return sumTerms(getReflexTerms(c))
}

export function getGrappleTerms(c: Character): Term[] {
  const SM = getSM(c)
  return [
    { label: 'grapple', value: skill(c, 'grapple').value },
    { label: 'STR', value: getSTR(c) - 10 },
    { label: 'size', value: 5 * SM },
    { label: 'melee', value: getMelee(c) },
    { label: 'affliction', value: -getAfflictionPenalty(c, 'grapple') },
    { label: 'abilities', value: getBuffBonus(c, 'skill:grapple') },
  ]
}
export function getGrapple(c: Character) {
  return sumTerms(getGrappleTerms(c))
}

export function getCunningTerms(c: Character): Term[] {
  return [
    { label: 'cunning', value: skill(c, 'cunning').value },
    { label: 'awareness', value: getAwareness(c) },
    { label: 'affliction', value: -getAfflictionPenalty(c, 'cunning') },
    { label: 'abilities', value: getBuffBonus(c, 'skill:cunning') },
  ]
}
export function getCunning(c: Character) {
  return sumTerms(getCunningTerms(c))
}

export function getSDTerms(c: Character): Term[] {
  const SM = getSM(c)
  return [
    { label: 'base', value: -2 },
    { label: 'size', value: -SM },
    { label: 'SD', value: skill(c, 'SD').value },
    { label: 'immobile', value: getAfflictions(c).includes('immobile') ? -3 : 0 },
    { label: 'abilities', value: getBuffBonus(c, 'skill:SD') },
  ]
}
export function getSD(c: Character) {
  return sumTerms(getSDTerms(c))
}

export function getForceTerms(c: Character): Term[] {
  const SM = getSM(c)
  return [
    { label: 'FOR', value: getSTR(c) - 10 },
    { label: 'force', value: skill(c, 'force').value },
    { label: 'size', value: 5 * SM },
    { label: 'affliction', value: -getAfflictionPenalty(c, 'force') },
    { label: 'abilities', value: getBuffBonus(c, 'skill:force') },
  ]
}
export function getForce(c: Character) {
  return sumTerms(getForceTerms(c))
}

export function getBalanceTerms(c: Character): Term[] {
  return [
    { label: 'AGI', value: getAGI(c) - 10 },
    { label: 'balance', value: skill(c, 'balance').value },
    { label: 'affliction', value: -getAfflictionPenalty(c, 'balance') },
    { label: 'abilities', value: getBuffBonus(c, 'skill:balance') },
  ]
}
export function getBalance(c: Character) {
  return sumTerms(getBalanceTerms(c))
}

export function getClimbTerms(c: Character): Term[] {
  const SM = getSM(c)
  return [
    { label: 'AGI', value: getAGI(c) - 10 },
    { label: 'climb', value: skill(c, 'climb').value },
    { label: 'size', value: -2 * SM },
    { label: 'gear', value: -3 * c.hasGauntlets },
    { label: 'affliction', value: -getAfflictionPenalty(c, 'climb') },
    { label: 'abilities', value: getBuffBonus(c, 'skill:climb') },
  ]
}
export function getClimb(c: Character) {
  return sumTerms(getClimbTerms(c))
}

export function getSwimTerms(c: Character): Term[] {
  return [
    { label: 'AGI', value: getAGI(c) - 10 },
    { label: 'swim', value: skill(c, 'swim').value },
    { label: 'affliction', value: -getAfflictionPenalty(c, 'swim') }, 
    { label: 'abilities', value: getBuffBonus(c, 'skill:swim') },
  ]
}
export function getSwim(c: Character) {
  return sumTerms(getSwimTerms(c))
}

export function getDetectionTerms(c: Character): Term[] {
  return [
    { label: 'detection', value: skill(c, 'detection').value },
    { label: 'awareness', value: getAwareness(c) },
    { label: 'gear', value: -2 * c.hasHelm }, // gear.tex "Closed helmet": -2 detection
    { label: 'affliction', value: -getAfflictionPenalty(c, 'detection') },
    { label: 'abilities', value: getBuffBonus(c, 'skill:detection') },
  ]
}
export function getDetection(c: Character) {
  return sumTerms(getDetectionTerms(c))
}

export function getStealthTerms(c: Character): Term[] {
  const SM = getSM(c)
  return [
    { label: 'stealth', value: skill(c, 'stealth').value },
    { label: 'size', value: -2 * SM }, // creating.tex "Skill Modifier (SM)": Stealth -2x
    { label: 'affliction', value: -getAfflictionPenalty(c, 'stealth') },
    { label: 'abilities', value: getBuffBonus(c, 'skill:stealth') },
  ]
}
export function getStealth(c: Character) {
  return sumTerms(getStealthTerms(c))
}

export function getPrestidigitationTerms(c: Character): Term[] {
  return [
    { label: 'DEX', value: getDEX(c) },
    { label: 'gear', value: -3 * c.hasGauntlets },
    { label: 'prestidigitation', value: skill(c, 'prestidigitation').value },
    { label: 'affliction', value: -getAfflictionPenalty(c, 'prestidigitation') },
    { label: 'abilities', value: getBuffBonus(c, 'skill:prestidigitation') },
  ]
}
export function getPrestidigitation(c: Character) {
  return sumTerms(getPrestidigitationTerms(c))
}

export function getHealthTerms(c: Character): Term[] {
  return [
    { label: 'CON', value: getCON(c) },
    { label: 'health', value: skill(c, 'health').value },
    { label: 'affliction', value: -getAfflictionPenalty(c, 'health') },
    { label: 'abilities', value: getBuffBonus(c, 'skill:health') },
  ]
}
export function getHealth(c: Character) {
  return sumTerms(getHealthTerms(c))
}

// export function getKnowledge(c: Character) {
//   return (
//     2 * c.characteristics.INT +
//     skill(c, 'knowledge').value -
//     getAfflictionPenalty(c, 'knowledge')
//   )
// }

export function getExploreTerms(c: Character): Term[] {
  return [
    { label: 'awareness', value: getAwareness(c) },
    { label: 'explore', value: skill(c, 'explore').value },
    { label: 'affliction', value: -getAfflictionPenalty(c, 'explore') },
    { label: 'abilities', value: getBuffBonus(c, 'skill:explore') },
  ]
}
export function getExplore(c: Character) {
  return sumTerms(getExploreTerms(c))
}

export function getWillTerms(c: Character): Term[] {
  return [
    { label: 'will', value: skill(c, 'will').value },
    { label: 'SPI', value: getSPI(c) },
    { label: 'affliction', value: -getAfflictionPenalty(c, 'will') },
    { label: 'abilities', value: getBuffBonus(c, 'skill:will') },
  ]
}
export function getWill(c: Character) {
  return sumTerms(getWillTerms(c))
}

export function getPersuasionTerms(c: Character): Term[] {
  return [
    { label: 'charisma', value: getCharisma(c) },
    { label: 'persuasion', value: skill(c, 'persuasion').value },
    { label: 'affliction', value: -getAfflictionPenalty(c, 'persuasion') },
    { label: 'abilities', value: getBuffBonus(c, 'skill:persuasion') },
  ]
}
export function getPersuasion(c: Character) {
  return sumTerms(getPersuasionTerms(c))
}

export function getDeceptionTerms(c: Character): Term[] {
  return [
    { label: 'charisma', value: getCharisma(c) },
    { label: 'deception', value: skill(c, 'deception').value },
    { label: 'affliction', value: -getAfflictionPenalty(c, 'deception') },
    { label: 'abilities', value: getBuffBonus(c, 'skill:deception') },
  ]
}
export function getDeception(c: Character) {
  return sumTerms(getDeceptionTerms(c))
}

export function getInsightTerms(c: Character): Term[] {
  return [
    { label: 'charisma', value: getCharisma(c) },
    { label: 'insight', value: skill(c, 'insight').value },
    { label: 'affliction', value: -getAfflictionPenalty(c, 'insight') },
    { label: 'abilities', value: getBuffBonus(c, 'skill:insight') },
  ]
}
export function getInsight(c: Character) {
  return sumTerms(getInsightTerms(c))
}


export const skillTermGetters: Record<keyof Skills, (c: Character) => Term[]> = {
  strike: getStrikeTerms,
  accuracy: getAccuracyTerms,
  defend: getDefendTerms,
  reflex: getReflexTerms,
  grapple: getGrappleTerms,
  cunning: getCunningTerms,
  SD: getSDTerms,
  balance: getBalanceTerms,
  climb: getClimbTerms,
  swim: getSwimTerms,
  detection: getDetectionTerms,
  stealth: getStealthTerms,
  prestidigitation: getPrestidigitationTerms,
  health: getHealthTerms,
  force: getForceTerms,
  explore: getExploreTerms,
  will: getWillTerms,
  persuasion: getPersuasionTerms,
  deception: getDeceptionTerms,
  insight: getInsightTerms,
}
