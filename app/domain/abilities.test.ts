import { describe, it, expect } from 'vitest'
import { ABILITIES, ABILITY_KEYS, AbilityKey } from './abilities'
import { forgetAbility, learnAbility, payUpkeep, toggleAbility } from './character/commands'
import { getUpkeep } from './character/lenses/effects'
import { makeCampaignCharacter, makeCharacter } from './factories'
import type { CampaignCharacter, Character } from './types'

// abilities.tex "Acquiring abilities": a multi-level ability "receives an I,
// II, III next to its name, indicating each level", so every stage of a
// family but its first stands on the stage before it.
describe('ability catalog — stages', () => {
  const familyStages = (family: string) =>
    ABILITY_KEYS.filter((k) => ABILITIES[k].family === family).sort((a, b) => ABILITIES[a].stage - ABILITIES[b].stage)
  const staged = ABILITY_KEYS.filter((key) => familyStages(ABILITIES[key].family)[0] !== key)

  it.each(staged)('"%s" requires the previous stage of its family', (key) => {
    const stages = familyStages(ABILITIES[key].family)
    const previous = stages[stages.indexOf(key) - 1]
    expect(ABILITIES[key].requires).toContain(previous)
  })

  it.each(ABILITY_KEYS)('every requirement of "%s" is a catalog key', (key) => {
    for (const req of ABILITIES[key].requires) expect(ABILITY_KEYS).toContain(req)
  })
})

function holdsRequirements(c: Character): boolean {
  return c.abilities.every((key) =>
    ABILITIES[key as AbilityKey].requires.every((req) => c.abilities.includes(req)),
  )
}

// The chain of stages up to and including `key`, in learning order.
function chain(key: AbilityKey): AbilityKey[] {
  const { requires } = ABILITIES[key]
  return [...requires.flatMap((req) => chain(req as AbilityKey)), key]
}

// abilities.tex "Acquiring abilities": "It is not possible to acquire an
// ability unless the requirements are met" and "Abilities can only be
// acquired once".
describe('learning abilities', () => {
  it.each(ABILITY_KEYS)('"%s" is learnable on a blank character iff it has no requirements', (key) => {
    const blank = makeCharacter({})
    const learned = learnAbility(key)(blank).abilities.includes(key)
    expect(learned).toBe(ABILITIES[key].requires.length === 0)
  })

  it.each(ABILITY_KEYS)('"%s" is learnable once its chain is learned, and only once', (key) => {
    const ready = chain(key).slice(0, -1).reduce<Character>((c, k) => learnAbility(k)(c), makeCharacter({}))
    const once = learnAbility(key)(ready)
    expect(once.abilities).toContain(key)
    expect(learnAbility(key)(once)).toBe(once)
  })

  it.each(ABILITY_KEYS)('forgetting any link of the chain to "%s" leaves the requirements met', (key) => {
    const full = chain(key).reduce<Character>((c, k) => learnAbility(k)(c), makeCharacter({}))
    expect(holdsRequirements(full)).toBe(true)
    for (const link of chain(key)) {
      const after = forgetAbility(link)(full)
      expect(after.abilities).not.toContain(link)
      expect(holdsRequirements(after)).toBe(true)
    }
  })
})

// abilities.tex "Synesthesia": "+1 STA per turn" — an ability held on is paid
// for at every round change, and one switched off costs nothing.
describe('toggle abilities', () => {
  const toggles = ABILITY_KEYS.filter((key) => ABILITIES[key].activation === 'toggle')

  it.each(toggles)('"%s" charges its upkeep at the round change only while on', (key) => {
    const learned = chain(key).reduce<Character>((c, k) => learnAbility(k)(c), makeCampaignCharacter({ resources: { STA: 10, AP: 8 } }))
    const off = learned as CampaignCharacter
    const on = toggleAbility(key)(off) as CampaignCharacter
    const upkeep = getUpkeep(on)

    expect(payUpkeep(off).resources).toEqual(off.resources)
    expect(payUpkeep(on).resources.STA).toBe(on.resources.STA - upkeep.STA)
    expect(payUpkeep(on).resources.AP).toBe(on.resources.AP - upkeep.AP)
    expect(toggleAbility(key)(on)).toEqual(off)
  })
})
