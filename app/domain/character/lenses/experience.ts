import { Character } from "../../types"
import { getTotalKarma, getXPByTalent } from "../rules/experience"
import type { TalentKey } from "../rules/learning"

export type ExperienceView = {
  // the XP spent from each talent's XP, in the creator's order
  talents: { talent: TalentKey; XP: number }[]
  karma: number
}

const ORDER: TalentKey[] = ['CON', 'SPI', 'INT', 'DEX']

// creating.tex "Gaining Experience (XP)": the XP the character is worth, by
// the talent it was spent from, and its karma.
export function getExperienceView(c: Character): ExperienceView {
  const byTalent = getXPByTalent(c)
  return {
    talents: ORDER.map((talent) => ({ talent, XP: byTalent[talent] })),
    karma: getTotalKarma(c),
  }
}
