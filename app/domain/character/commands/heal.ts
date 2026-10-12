import type { CampaignCharacter, HealEffect } from "../../types"
import { getDeathIL } from "../rules/afflictions"
import { healWound, reattachPart } from "./wounds"

// survival.tex "Hunger": "cannot be increased further than 30" — the band's
// own ceiling. "Thirst": "15 = Dead" is thirst's own ceiling, the point past
// which there is no worse band to read a limit off.
const HUNGER_LIMIT = 30
const THIRST_LIMIT = 15

// survival.tex "Hunger": "Every hunger point that would be above 30
// increases IL by +1 instead".
export function gainHunger(amount: number): (c: CampaignCharacter) => CampaignCharacter {
  return (c) => {
    const hunger = Math.min(HUNGER_LIMIT, c.resources.hunger + amount)
    const over = c.resources.hunger + amount - hunger
    return { ...c, injuries: { ...c.injuries, injuryLevel: c.injuries.injuryLevel + over }, resources: { ...c.resources, hunger } }
  }
}

export function gainThirst(amount: number): (c: CampaignCharacter) => CampaignCharacter {
  return (c) => ({ ...c, resources: { ...c.resources, thirst: Math.min(THIRST_LIMIT, c.resources.thirst + amount) } })
}

export const addExhaustion = (amount: number) => (c: CampaignCharacter): CampaignCharacter =>
  ({ ...c, resources: { ...c.resources, exhaustion: Math.max(0, c.resources.exhaustion + amount) } })

export const addIL = (amount: number) => (c: CampaignCharacter): CampaignCharacter =>
  ({ ...c, injuries: { ...c.injuries, injuryLevel: c.injuries.injuryLevel + amount } })

export function heal( amount: number): (c: CampaignCharacter) => CampaignCharacter {
  return (c: CampaignCharacter) => {
    const potionDiscount = Math.min(c.injuries.potion, amount)
    // survival.tex "Healing": "It is not possible to heal if hunger or thirst
    // are at maximum value". "Healing Potions: Healing through potions does
    // not increase hunger and thirst", so banked potion still heals past the
    // cap; only the part that would push hunger or thirst further is what the
    // cap refuses.
    const capped = c.resources.hunger >= HUNGER_LIMIT || c.resources.thirst >= THIRST_LIMIT
    const healed = capped ? potionDiscount : amount
    const cost = healed - potionDiscount
    const healedChar = {...c, injuries: {...c.injuries, injuryLevel: c.injuries.injuryLevel - healed, potion: c.injuries.potion - potionDiscount}}
    return gainThirst(cost)(gainHunger(cost)(healedChar))
  }
}

// survival.tex "Healing": what a heal effect mends. IL healed costs hunger
// and thirst as any healing does; a wound healed by medicine or magic does
// not ("Healing Wounds"). A potion's healing is banked to be spent over the
// next ET ("Healing Potions"). A body revived keeps its wounds and IL, "IL
// defaults to" one short of death (the table's ruling over the book's 49).
export function mend(effect: HealEffect): (c: CampaignCharacter) => CampaignCharacter {
  return (c: CampaignCharacter) => {
    const amount = Math.max(0, effect.amount)
    switch (effect.of) {
      case 'injury':
        return effect.wound !== null ? healWound(effect.wound, amount)(c) : heal(Math.min(amount, c.injuries.injuryLevel))(c)
      case 'bleed':
        return { ...c, injuries: { ...c.injuries, bleed: Math.max(0, c.injuries.bleed - amount) } }
      case 'limb':
        return effect.part ? reattachPart(effect.part, amount)(c) : c
      case 'potion':
        return amount > 0 ? { ...c, injuries: { ...c.injuries, potion: c.injuries.potion + amount } } : c
      case 'revive':
        return { ...c, injuries: { ...c.injuries, injuryLevel: Math.min(c.injuries.injuryLevel, getDeathIL(c) - 1) } }
    }
  }
}

export function updateIL( newIL: number): (c: CampaignCharacter) => CampaignCharacter {
  return (c: CampaignCharacter) => {
    const amount = Math.max(0, c.injuries.injuryLevel - newIL)
    if(amount > 0) return heal(amount)(c)
    return c
  }
}
