import { Character } from "../../types";
import { getDevotion, getSorcery } from "./characteristics";
import { getMentalAfflictionPenalty } from "./afflictions";
import { getKnowledge } from "./knowledge";

// spells.tex "Learning spells" — the three skills a spell can be cast with.
//
// combat.tex "Afflictions" lists both "all Knowledges" and "all spellcasting"
// as taking the mental penalty, and a spellcasting value that is built out of
// a knowledge already carries it through `getKnowledge`; the divine
// value is built out of two proficiencies and takes it here instead. Miracles
// are exempt by decision: 2 x Devotion is read raw.

// "The Knowledge level + Sorcery is used as a skill to perform spells."
export function getSchoolCasting(knowledge: string): (c: Character) => number {
  return (c: Character) => getSorcery(c) + (getKnowledge(knowledge)(c))
}

export const getAlchemy = getSchoolCasting('alchemy')
export const getAnimancy = getSchoolCasting('animancy')
export const getBiomancy = getSchoolCasting('biomancy')
export const getShamanism = getSchoolCasting('shamanism')

// "The Devotion level + Sorcery is used as a skill to perform divine spells."
export function getDivine(c: Character): number {
  return getSorcery(c) + getDevotion(c) - getMentalAfflictionPenalty(c)
}

// "they use 2x Devotion as a skill" — the shortfall penalty against a given
// spell's requirement is applied where the spell is known, in getSpellSkill.
export function getMiracle(c: Character): number {
  return 2 * getDevotion(c)
}
