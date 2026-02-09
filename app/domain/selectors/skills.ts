import { Character, Lens, Skills } from '../types'
import { getSM, skill } from './helpers'
import { getAfflictionPenalty, getAfflictions } from './afflictions'
import { getAGI, getMelee, getRanged, getDetection, getSpellcast, getSTR } from './characteristics'
import { characteristicLenses } from '.'


export function makeSkillLens<T extends Character>(
  skillName: keyof Character['skills'],
  getter: (c: T) => number,
  setter?: (c: T, value: number) => T
): Lens<T, number> {
  return {
    get: getter,
    set: setter ?? ((subject: T, value: number): T => {
      const baseValue = subject.skills[skillName];
      const modifiers = getter(subject) - baseValue;
      
      // We return the whole subject T, ensuring metadata (id, etc) is preserved
      return {
        ...subject,
        skills: { 
          ...subject.skills, 
          [skillName]: value - modifiers 
        }
      } as T;
    })
  };
}

export function getStrike(c: Character) {
  return getMelee(c) + skill(c, 'strike') - getAfflictionPenalty(c, 'strike')
}

export function getAccuracy(c: Character) {
  return (
    getRanged(c) -
    3 * c.hasGauntlets +
    skill(c, 'accuracy') -
    getAfflictionPenalty(c, 'accuracy')
  )
}

export function getDefend(c: Character) {
  return getMelee(c) + skill(c, 'defend') - getAfflictionPenalty(c, 'defend')
}

export function getReflex(c: Character) {
  const SM = getSM(c)
  return (
    getDetection(c) +
    getRanged(c) -
    3 * c.hasHelm -
    SM +
    skill(c, 'reflex') -
    getAfflictionPenalty(c, 'reflex')
  )
}

export function getGrapple(c: Character) {
  const SM = getSM(c)
  return (
    getSTR(c) -
    10 +
    5 * SM +
    skill(c, 'grapple') -
    getAfflictionPenalty(c, 'grapple')
  )
}

export function getCunning(c: Character) {
  return (
    getDetection(c) -
    3 * c.hasHelm +
    skill(c, 'cunning') -
    getAfflictionPenalty(c, 'cunning')
  )
}

export function getSD(c: Character) {
  const SM = getSM(c)
  return -2 - SM + skill(c, 'SD') - (getAfflictions(c).includes('immobile') ? +3 : 0)
}

// selectors/skills/physical.ts

export function getBalance(c: Character) {
  return (
    getAGI(c) -
    10 +
    skill(c, 'balance') -
    getAfflictionPenalty(c, 'balance')
  )
}

export function getClimb(c: Character) {
  const SM = getSM(c)
  return (
    getAGI(c) -
    10 +
    skill(c, 'climb') -
    2 * SM -
    3 * c.hasGauntlets -
    getAfflictionPenalty(c, 'climb')
  )
}

export function getSwim(c: Character) {
  return (
    getAGI(c) -
    10 +
    skill(c, 'swim') -
    3 * c.hasHelm -
    getAfflictionPenalty(c, 'swim')
  )
}

export function getStrength(c: Character) {
  const SM = getSM(c)
  return (
    getSTR(c) -
    10 +
    5 * SM +
    skill(c, 'strength') -
    getAfflictionPenalty(c, 'strength')
  )
}

export function getStealth(c: Character) {
  const SM = getSM(c)
  return (
    skill(c, 'stealth') -
    3 * SM -
    getAfflictionPenalty(c, 'stealth')
  )
}

export function getPrestidigitation(c: Character) {
  return (
    c.characteristics.DEX -
    3 * c.hasGauntlets +
    skill(c, 'prestidigitation') -
    getAfflictionPenalty(c, 'prestidigitation')
  )
}

export function getHealth(c: Character) {
  return c.characteristics.CON + skill(c, 'health')
}

export function getKnowledge(c: Character) {
  return (
    2 * c.characteristics.INT +
    skill(c, 'knowledge') -
    getAfflictionPenalty(c, 'knowledge')
  )
}

export function getExplore(c: Character) {
  return (
    getDetection(c) +
    skill(c, 'explore') -
    getAfflictionPenalty(c, 'explore')
  )
}

export function getWill(c: Character) {
  return skill(c, 'will') - getAfflictionPenalty(c, 'will')
}

export function getCharm(c: Character) {
  return skill(c, 'charm') - getAfflictionPenalty(c, 'charm')
}

export function getStress(c: Character) {
  return skill(c, 'stress')
}

export function getActing(c: Character) {
  return skill(c, 'acting') + characteristicLenses.SPI.get(c)
}

export function getDevotion(c: Character) {
  return characteristicLenses.SPI.get(c) + skill(c, 'devotion')
}

const magic =
  (school: string) =>
  (c: Character) =>
    getSpellcast(c) +
    skill(c, school as keyof Character['skills']) -
    getAfflictionPenalty(c, school as keyof Character['skills'])

export const getCombustion = magic('combustion')
export const getEletromag = magic('eletromag')
export const getRadiation = magic('radiation')
export const getEntropy = magic('entropy')
export const getBiomancy = magic('biomancy')
export const getTelepathy = magic('telepathy')
export const getAnimancy = magic('animancy')