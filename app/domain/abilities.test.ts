import { describe, it, expect } from 'vitest'
import { ABILITIES, ABILITY_KEYS, AbilityKey } from './abilities'
import { forgetAbility, learnAbility } from './character/commands'
import { makeCharacter } from './factories'
import type { Character } from './types'

// abilities.tex "Acquiring abilities": a multi-level ability "receives an I,
// II, III next to its name, indicating each level", so stage n of a family
// stands on stage n-1 of the same family.
describe('ability catalog — stages', () => {
  const staged = ABILITY_KEYS.filter((key) => ABILITIES[key].stage > 1)

  it.each(staged)('"%s" requires the previous stage of its family', (key) => {
    const { family, stage, requires } = ABILITIES[key]
    const previous = ABILITY_KEYS.filter(
      (k) => ABILITIES[k].family === family && ABILITIES[k].stage === stage - 1,
    )
    expect(previous).toHaveLength(1)
    expect(requires).toContain(previous[0])
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
