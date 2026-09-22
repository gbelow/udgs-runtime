import { CampaignCharacter } from "../../types"

// survival.tex "Hunger": "cannot be increased further than 30" — the band's
// own ceiling. "Thirst": "15 = Dead" is thirst's own ceiling, the point past
// which there is no worse band to read a limit off.
const HUNGER_LIMIT = 30
const THIRST_LIMIT = 15

export function heal( amount: number): (c: CampaignCharacter) => CampaignCharacter {
  return (c: CampaignCharacter) => {
    const potionDiscount = Math.min(c.injuries.potion, amount)
    // survival.tex "Healing": "Healing is not possible if hunger values are
    // at their maximum value" — thirst caps the same way at its own limit.
    // "Healing Potions: ... do not affect the hunger and thirst values", so
    // banked potion still heals past the cap; only the part that would push
    // hunger or thirst further is what the cap refuses.
    const capped = c.resources.hunger >= HUNGER_LIMIT || c.resources.thirst >= THIRST_LIMIT
    const healed = capped ? potionDiscount : amount
    const newHunger = c.resources.hunger + healed - potionDiscount
    const newThirst = c.resources.thirst + healed - potionDiscount
    return {...c, injuries: {...c.injuries, injuryLevel: c.injuries.injuryLevel - healed, potion: c.injuries.potion - potionDiscount}, resources: {...c.resources, hunger:  newHunger, thirst: newThirst}}
  }
}

export function updateIL( newIL: number): (c: CampaignCharacter) => CampaignCharacter {
  return (c: CampaignCharacter) => {
    const amount = Math.max(0, c.injuries.injuryLevel - newIL)
    if(amount > 0) return heal(amount)(c)
    return c
  }
}