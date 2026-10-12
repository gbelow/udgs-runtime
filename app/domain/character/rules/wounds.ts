import type { AfflictionKey, CampaignCharacter, Character, PartWound, Wound } from '../../types'
import { isCampaignCharacter } from '../../utils'

// combat.tex "Bleed": "For every STA spent ... the character receives +1 to
// their IL per bleed intensity" — none while it is staunched (abilities.tex
// "First Aid").
export function getBled(amount: number): <C extends CampaignCharacter>(c: C) => C {
  return <C extends CampaignCharacter>(c: C): C => {
    const damage = c.injuries.staunched ? 0 : amount * c.injuries.bleed
    return { ...c, injuries: { ...c.injuries, injuryLevel: c.injuries.injuryLevel + damage } }
  }
}

// combat.tex "Wounds": the wounds the character carries.
export function getWounds(c: Character): Wound[] {
  return isCampaignCharacter(c) ? c.injuries.wounds : []
}

// The wound of its part a carried wound is, as the part describes it.
export function getPartWound(c: Character, wound: Pick<Wound, 'name' | 'part'>): PartWound | null {
  return c.body.find((p) => p.id === wound.part)?.wounds.find((w) => w.name === wound.name) ?? null
}

// What the wounds do past the part they took: each one's affliction, for as
// long as it is carried.
export function getWoundAfflictions(c: Character): AfflictionKey[] {
  return getWounds(c).flatMap((w) => {
    const affliction = getPartWound(c, w)?.affliction
    return affliction ? [affliction] : []
  })
}

// combat.tex "Wounds": a broken hand is "useless" — the part is not there
// to hold or to fight with while the wound is carried.
export function isPartWounded(c: Character, partId: string): boolean {
  return getWounds(c).some((w) => w.part === partId)
}
